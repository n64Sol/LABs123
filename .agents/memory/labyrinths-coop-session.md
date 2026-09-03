---
name: Labyrinths co-op session layer
description: How shared co-op runs sync clients and settle rewards; the reusable real-time layer PvP builds on.
---

# Co-op session layer (Labyrinths)

The real-time session layer for parties (CoopStore + `/api/coop/ws` + polling fallback)
is deliberately the reusable foundation PvP will extend — don't fork a parallel layer.

## Server-authoritative tally vs client sim
- Combat stays **client-simulated** (matches the existing solo model). Enemies/nodes/chests
  are deterministic from the shared chamber layout, so every client renders the same entities.
- Clients **broadcast** their own kills/harvests; the server keeps an **authoritative deduped
  shared tally per category**. Shared rewards settle from that tally, never raw client counts.
- **Why:** prevents double-counting and over-minting beyond the scaled content, and keeps the
  owner cut intact through the existing economy split.

## Client apply rule (Run.tsx)
- A teammate's relayed kill/harvest must clear the matching entity locally **by id** (entity ids
  are deterministic/shared across clients) so doors/progression stay in sync — but must **NOT**
  bump local counters (`enemiesDefeated`, `nodesHarvested`, …). Local counters are solo-only;
  co-op reward truth is the server tally. Own kills are applied locally + broadcast; incoming
  relays skip your own userId.

## Entity-id contract
- Entities are keyed by their spawn id from the shared layout. Both broadcast (`sendCombat(kind, id)`)
  and apply (`find(x => x.id === id)`) rely on this. Any change that makes entity ids non-deterministic
  across clients silently breaks co-op clears and door-open sync.

## Teammate rendering
- CoopMember telemetry carries no LPC sprite-layer data, so teammates render with the shared **base
  player sheet** (graceful fallback), not the local LPC compositor. Only draw teammates whose
  `chamberIndex === my chamberIdx`; smooth their position toward the latest telemetry each frame.

## Transport
- CoopRunClient mirrors the overworld PresenceClient: WS-first (`/api/coop/ws`), transparent fallback
  to polling (`/api/coop/sync` discrete events + party snapshot for positions; `/api/coop/combat` for
  events). Pos relays are excluded from the polling event buffer — positions ride the party snapshot.
