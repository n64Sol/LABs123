---
name: Labyrinths overworld multiplayer presence
description: Durable decisions for the walkable overworld presence layer (transport choice, identity ownership, idle-sweep heartbeat).
---

# Overworld presence — durable decisions

The Overworld home view is a canvas top-down map with ephemeral, in-memory
presence (avatars, emotes, short chat). One global room.

## Identity is owned per-USER, not per-clientId
A presence `clientId` is owned by the authenticated user who first claimed it.
The polling routes enforce this: `/sync` ignores a supplied clientId owned by a
*different* user and mints a fresh one; `/emote` and `/chat` return 403 when the
caller doesn't own the clientId; `/leave` no-ops unless owned.
**Why:** clientIds are broadcast in snapshots/events, so a client-supplied id is
spoofable — without this, any logged-in user could move/chat-as/evict another.
**How to apply:** the security boundary is the user (`req.user.id`), so a single
user acting across their own connections (WS avatar + polling, or multiple tabs)
is allowed by design. Only cross-user action is rejected. Test spoofing with TWO
distinct logged-in users — a single-user test will (correctly) see 200.

## Transport: WebSocket-first, polling fallback
Client tries WS (`/api/overworld/ws`); falls back to HTTP polling (`/sync`,
`/emote`, `/chat`, `/leave`) if the socket never opens or drops. The Replit
workspace proxy *does* upgrade WS for this app (verified by 2-context e2e).
Polling clients must adopt the `clientId` returned by `/sync` (server may mint
it) for subsequent calls.

## Appearance (sprite layers) is client-supplied, sanitized at the boundary
Each player's cosmetic look travels through presence as a flat
`{ lpcLayerKey -> relativeAssetPath }` map the client derives from its own
equipped loadout — presence stays DB-free/ephemeral. It rides on the `join`
message/body (WS + `/sync`) and a dedicated `appearance` event/message for live
changes; `setAppearance` only re-broadcasts when a layer signature changes.
**Why:** keeping appearance off the server's item DB means no extra queries in
the hot presence path, and it mirrors how Run composes the player sprite.
**How to apply:** ALWAYS pass untrusted layers through `sanitizeSpriteLayers`
(server) — only `^game/<path>.png` relative paths, no `..`, capped count/key-len.
This is cosmetic-only; battle/stat tamper-proofing is a separate concern. Remote
clients compose+cache per clientId and fall back to the base sheet when empty.

## Idle WS players get swept without a heartbeat
**Why:** the stale sweep evicts players whose `lastSeen` is older than STALE_MS
(12s). A standing-still WS client sends no move/emote/chat, so its `lastSeen`
never refreshes and it vanishes while the socket is still open.
**How to apply:** client sends an app-level `{t:"ping"}` every ~5s; the server's
`ping` AND `pong` handlers both `presence.touch(clientId)`. Keep heartbeat well
under STALE_MS.
