---
name: Labyrinths gear comparison (shared)
description: Where the upgrade/downgrade delta + Best-in-Slot logic lives and how the in-run loot popup reuses it.
---

## Shared comparison module
`artifacts/labyrinths/src/lib/gear.ts` holds the gear-comparison helpers (`targetSlotFor`, `compareItemFor`, `computeBestInSlotIds`, `isUpgradeOver`) and `src/components/StatList.tsx` holds the green/red stat-delta display. Both Loadout and the Run loot popup import these.
**Why:** the deltas + Upgrade/Best-in-Slot flags must read identically in both places; duplicating the logic in each page caused drift. Built on the `effectiveStats`/`statTotal` helpers in `lib/game.ts`.

## In-run loot popup compares via inventory, not the drop payload
The run summary "Item Drops" card shows deltas by matching each `summary.itemDrops[].playerItemId` back to the owned `PlayerItem` from `useListMyItems`, then reusing the shared helpers against `run.loadout.slots`.
**Why:** `ItemDropResult` carries no stats — but every drop is created as a real level-1 PlayerItem during completion, so the inventory has full (level-scaled) stats AND is required for Best-in-Slot anyway. After completing a run you MUST invalidate `getListMyItemsQueryKey()` (alongside balances/run) or the new drops won't appear as owned items and the deltas/crown won't show.
