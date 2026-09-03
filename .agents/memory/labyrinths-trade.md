---
name: Labyrinths peer-to-peer trade
description: How the overworld two-player item+currency trade is structured (negotiation in-memory, settlement in DB).
---

# Peer-to-peer trade

Two overworld players swap items + currency through a both-sides-confirm escrow window.

## Two-layer design (mirrors the presence layer)
- **Negotiation state is in-memory**, never the source of truth for ownership. A `TradeStore`
  singleton (lib/trade.ts) holds sessions: invite/respond/setOffer/setConfirm/cancel, one live
  trade per user, TTL sweep. Any offer edit **resets BOTH confirmations** so nobody can sneak an
  edit past an already-confirmed counterpart.
- **Settlement is a DB transaction** (routes/trade.ts) that re-validates ownership + balances
  in-tx, transfers items, applies currency deltas, writes ledger + activity, and is idempotent
  on `trade_settle_<id>`. The in-memory offer is only an intent; the tx is the gate.

**Why:** parallels the ephemeral presence model and keeps the swap atomic/safe even though the
negotiation is ephemeral and unauthenticated-by-position.

## Settlement rules that must stay consistent
- Currency is a **pure transfer** (each side's delta = received − given). No minting — same
  economy rule as the rest of the game.
- Transferred items must have their **loadout refs cleared** (set playerLoadouts.playerItemId
  null) or a dangling cross-user equip remains.
- Double-settle guarded by `session.settling` flag AND the DB idempotency record together.

## Client
- TradePanel.tsx polls `GET /trade/active` at 1s (refetchInterval) — but the generated
  `query` option type **requires an explicit `queryKey`** (pass `getGetActiveTradeQueryKey()`),
  unlike a bare hook call.
- On `status === "settled"` it invalidates the items + balances queries so the swap shows up.
- OverworldMap detects the nearest remote player within `TRADE_RADIUS` in the rAF loop and
  feeds it to TradePanel; 'T' key invites.

## Gotcha
- `activity_log` has **no metadata column** — only type/message/actorUserId/labyrinthId/value.
  Put counts in `value`, not a metadata object.
