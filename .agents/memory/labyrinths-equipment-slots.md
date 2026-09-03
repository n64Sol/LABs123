---
name: Labyrinths equipment slots & gear catalog
description: How gear slots, the LPC catalog, drops, and sprite z-order fit together across the stack.
---

## Two distinct slot enums in openapi.yaml — keep both in sync
Adding a new gear slot touches TWO separate enums in `lib/api-spec/openapi.yaml`:
- `LoadoutSlots` (+ `EquipInput`/`UnequipInput`) — the equip surface; uses **camelCase** keys (e.g. `abilityStone`, `abilityStone2`).
- `ItemTemplate.slot` — the DB slot string of a template; uses **snake_case** (e.g. `ability_stone`).
**Why:** loadout keys and template `slot` values are different namespaces. It is easy to update LoadoutSlots and forget `ItemTemplate.slot`; that leaves the generated client union (`ItemTemplateSlot`) stale while the DB/runtime serve the new slots — silent type-contract drift, no runtime error.
**How to apply:** after editing either enum, run `pnpm --filter @workspace/api-spec run codegen`, then typecheck api-server AND the web app.

## Backfill vs seed for reference data
`seed.ts` TRUNCATEs everything (wipes player progress). For additive reference data like item templates on a live DB, use a separate idempotent upsert script (`backfill.ts`, `onConflictDoUpdate` keyed on `key`, chunked) — never re-seed.

## Loot drops are rarity-sampled from ALL templates
Run completion (`routes/runs.ts`) selects loot by `db.select().from(itemTemplatesTable)` then filters by rolled rarity. So ANY item_template that exists becomes droppable automatically — backfilling new gear needs no drop-logic change.

## Sprite z-order (Run.tsx compositor)
Gear overlays are full 832x1344 PNGs composited at (0,0) over `player_full.png`. Z-order: cape / weapon_behind render BEHIND the base; legs→feet→torso→shoulders→neck→gloves→helmet→shield→weapon_fg render in front (low→high). The compositor gathers spriteLayers across ALL loadout slots, splits behind/front around the base image index.
