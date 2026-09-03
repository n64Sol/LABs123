---
name: Authored overworld (roads + biome landmarks)
description: How the infinite streaming overworld is made to read as an intentionally-designed WC3-style map — dominant biome roads with a keep-out mask, plus one authored centerpiece per biome zone.
---

# Authored overworld: roads + landmarks

Goal: the world stays infinite/chunk-streamed and client-only-deterministic (see
`labyrinths-overworld-tilemap.md`), but must read as a *designed* map, not random
scatter. Two authored layers do this, both in `lib/overworld/`.

## Roads (`roads.ts`)
- Six long dominant roads radiate from town along `BIOME_ANGLES` (kept in sync with
  `BIOME_ORDER` in api-server `world.ts`). Constants: `ROAD_HALF` (half-width),
  `ROAD_START` (gap around the fort), `ROAD_KEEPOUT` (extra margin scenery avoids),
  `ROAD_RAYS` derived from the angles.
- `onRoad(x,y,margin?)` is the single keep-out mask. It gates BOTH scenery placement
  (`collectTileObjects`) and collision (`collidesCircle`), and the roads are painted
  (`drawRoads`, capped ~6000px) BEFORE the ground/biome floors so props/ground never
  cover them. **Never place objects on roads** was an explicit user requirement.
- **Why one shared `onRoad`:** placement and collision must agree or you get invisible
  walls / props you can't reach — same rule as objectAt being the single source.

## Biome landmarks (`tileMap.ts`)
- `LANDMARKS: Record<biomeKey, {kind,h,solidR}>` defines ONE authored centerpiece per
  biome — all six are wired: verdant_grove→`o_elder_tree`, sunlit_ruins→`o_sunlit_temple`,
  tidecaller→`o_lighthouse`, crystal_caverns→`o_crystal_spire`, emberforge→`o_ember_spire`,
  astral_spire→`o_astral_obelisk`. `collectLandmarks(regions, entrances)` returns
  one per eligible `BiomeRegion`, anchored at the region centroid, skipping town
  (`HUB_CLEAR`), roads (`onRoad`), and entrances (`nearAnyEntrance`).
- It's wired into TWO places: injected into `collectTileObjects` (view-culled, pushed as
  a normal TileObject with `w:0` so it y-sorts/occludes with scenery+players) AND checked
  in `collidesCircle` (solid trunk at `solidR`). Add the sprite kind to `OBJECT_TILES`
  preload in OverworldMap.tsx or it draws blank.
- Draw uses only `obj.h` + the sprite's natural aspect (obj.w is ignored for objects), so
  landmark size is one number (`h`); pick `solidR` for just the trunk/base footprint.
- **Why centroid-anchored & deterministic:** gives every zone a visible destination
  (WC3 feel) while staying a pure function of world coords — no DB, agrees across clients.

## Overworld-only art regen
- Regenerate OVERWORLD assets only (biome ground `g_*`, props/landmarks `o_*`, town
  `t_*`) in detailed isometric style — NOT dungeon interiors. Verdant Grove was the first
  vertical slice: `g_verdant_grove` + `o_tree/o_bush/o_rock/o_fern/o_flowers` + the
  `o_elder_tree` landmark.
- generateImage's built-in bg-removal is unreliable for some props → fall back to the
  remove-image-background tool, then `magick -trim +repage`. Verify the set with an
  ImageMagick composite (foot-anchored, y-sorted); the live overworld is behind a
  mock-wallet login gate the screenshot tool can't pass.
