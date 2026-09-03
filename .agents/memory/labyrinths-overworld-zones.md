---
name: Labyrinths overworld biome zones
description: How the overworld groups entrances into biome zones and renders terrain/roads/minimap
---

> SUPERSEDED for the live overworld: the streaming/LOD rewrite (see
> `labyrinths-streaming-world.md`) no longer uses `layoutWorld`/`drawWorld`/`scatterDecor`
> in `OverworldMap.tsx`. Those helpers still exist in `render.ts` but are unused by the
> map; symbolic zoom-out now consumes server-derived `biomeRegions` from `/overworld/meta`.
> The terrain/ambient notes below remain accurate only as historical reference.

- The overworld layout is built by `layoutWorld(labs)` in `src/lib/overworld/render.ts` (replaced the old `layoutEntrances`). It returns `{ entrances, zones, paths, hub }`.
- Labyrinths are grouped by their `biome` field into one zone per biome, arranged on an ellipse around the world-center hub; entrances are sunflower-packed inside their zone. Single-biome worlds put the one zone at the hub.
- Terrain is painted per-zone in `drawWorld` (`OverworldMap.tsx`): base `floor_verdant_grove` grass everywhere, then each zone clips a circle and tiles its `floor_<biomeKey>.png`. The `verdant_grove` zone intentionally skips re-painting (same as base) but still gets a boundary ring + label.

**Why:** biome floor tile filenames map 1:1 to BIOME keys (`floor_sunlit_ruins`, `floor_tidecaller`, etc.), so `floor_${z.biomeKey}` resolves directly.

**How to apply:** to add a biome, add it to `BIOMES` in `lib/game.ts`, add a `public/game/floor_<key>.png`, add the name to `FLOOR_TILES` + `BIOME_ORDER`. Roads (hub spokes + ring loop) and the minimap derive automatically from zones/paths — no extra wiring.

## Per-biome ambient effects
- Each zone draws biome-specific ambient: `BIOME_AMBIENT` (render.ts) maps biomeKey → "water" (tidecaller/crystal_caverns), "ember" (emberforge), "star" (astral_spire), "pollen" (verdant_grove), "dust" (sunlit_ruins). To give a new biome ambient, add it there + a branch in `drawZoneParticles`/`drawWaterPools` (OverworldMap.tsx).
- Particle anchors come from `zoneParticles(z, count, spread)` — deterministic sunflower scatter seeded off the zone center, so pools/embers/stars stay put across frames/reloads while only their phase animates. Water pools render at ground level (before the soft overlay, under players); ember/star/pollen/dust render as floating particles after the global motes.
- Global drifting motes are now tinted by `nearestZone()` accent when within `radius*1.25` (else warm `#fff7d6`). Scattered decor (rock vs grass tuft) is chosen per-item by comparing its stable `bias` (added to `scatterDecor`) against `BIOME_ROCK_BIAS[biome]` — Emberforge/Crystal lean rocky, Verdant/Tidecaller lean grassy. Tufts tint toward the nearest accent inside a zone.
