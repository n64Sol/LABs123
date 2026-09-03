---
name: Labyrinths room-type pool
description: Owner-unlockable room-type pool that constrains run assembly
---

# Room-type pool (owner curation)

Owners unlock a pool of **room types** (a room type = `role:size`, e.g. `combat:large`)
that the run assembler draws from. The assembler still auto-picks order, applies
role-arc, depth/size gating, and difficulty scaling — owners curate *which* rooms
can appear, never their order, enemies, or loot.

**Key invariants**
- A room type's identity is `roomTypeKey(role,size)` = `${role}:${size}`. The same
  derivation must be used everywhere (assembly filter, seed, backfill, catalog).
- **Starter set = the free (size==="small") room types.** Cost 0 → always unlocked.
  This must always cover the fresh-claim arc (entry + treasure), or a brand-new
  depth-2 / 2-chamber lab cannot assemble.
- `getUnlockedRoomKeys` falls back to the starter set when a lab has **zero** rows,
  so assembly never breaks for un-ensured/legacy labs.
- Assembly filters the full template set to the unlocked pool, but **falls back to
  the full set if the filtered pool is empty** — runs must never break.
- Boss is injected separately (via `bossActive`), independent of the pool filter.

**Why pricing lives in code, not a row:** `roomTypeCost(role,size)` is deterministic
(roleBase × sizeMul, rounded). The catalog is derived at runtime from `ROOM_LIBRARY`,
so adding library rooms automatically extends the catalog.

**Backfill parity rule:** seeded/live labs get unlocks for every `role:size` whose
size-rank ≤ the lab's depth gate (depth≥5 large, ≥3 medium, else small) **plus**
`boss:large` if `bossActive`. This reproduces the pre-feature assembly exactly, so
the feature is a no-op for existing labs until an owner buys more. Backfill is
idempotent (`onConflictDoNothing`) and preserves owner purchases.

**Purchase path** mirrors upgrades/tollgate: check-then-debit in `db.transaction`
+ ledger (`room_type_unlock_debit`) + activity log (`room_unlock`) + idempotency.
Already-unlocked / starter keys return current state without charging.
