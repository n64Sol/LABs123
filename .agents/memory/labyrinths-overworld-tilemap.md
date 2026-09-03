---
name: Overworld 16-bit tile map + collision
description: How the live overworld ground/scenery/collision layer is built (client-only, deterministic) and the constraints behind it.
---

The live overworld (artifacts/labyrinths `OverworldMap.tsx`) renders a pixel-art
ground + scattered scenery from AI-generated textures in
`public/game/overworld16/` (`g_*` ground tiles, `o_*` transparent object
sprites), with per-object circle collision. The deterministic engine lives in
`src/lib/overworld/tileMap.ts` (TILE=32, PLAYER_RADIUS=16): `biomeAt` keys off
`region.key` (deepest dist/radius wins), `objectAt` gates placement on a coherent
FBM cluster field (`vnoise`/`fbm`) so props form groves/clearings, then picks the
per-biome palette + per-cluster-cell species + sub-tile jitter; `collectTileObjects`
gathers visible scenery, `resolveMove` is axis-separated sliding collision. NOTE:
`objectAt` is the SINGLE source for both render and collision — changing the
placement field (cluster threshold/density/etc.) silently moves collision too;
never fork them.

**Why these choices:**
- Client-only + deterministic: the task forbade server changes. The world is
  unbounded/chunk-streamed, so scenery/collision must be a pure function of
  world coords (hash per tile), never DB-backed, or it won't agree across
  clients/sessions.
- Solid vs walk-through: trees/rocks/crystals/pillars/lava-rock/rune collide;
  bushes + reeds are decorative pass-through. Keep that split or movement feels
  wrong.
- Clearances are mandatory, or players get stranded: hub kept clear (~170px),
  each labyrinth entrance kept clear (ENTRANCE_CLEAR≈76), world origin clear.
- Collision needs a stuck-escape: click-to-move abandons its target after a few
  near-zero-movement frames, else a player who clicks behind a tree wedges
  forever.

**How to apply / gotchas:**
- Objects are drawn bottom-anchored and y-sorted *together with player avatars*
  (pushed into the same `drawables` list) so tall objects occlude characters
  correctly. Object PNGs must be `magick mogrify -trim +repage`-trimmed or the
  bottom-anchor floats.
- Ground draws with default smoothing (NOT nearest) because the source art is
  1024px downscaled — nearest-neighbor there aliases badly.
- `g_field` is the base field; `g_<region.key>` are clipped biome discs with a
  soft radial edge (no dashed rings / no biome name labels anymore). `g_road`
  is preloaded but unused (open field has no roads).
- These overworld16 assets are NOT part of the LPC sprite pipeline; the
  `validate:sprites` workflow ignores them (it checks the character catalog).
- AI ground gen can fail with "no image bytes"; `g_field` was produced by
  copying `g_verdant_grove.png` as a fallback.
- Tidecaller is special-cased in render: its `g_tidecaller` texture BAKES a river
  into the art, so tiling it repeats/cuts the river. `drawRegionFloors` paints
  clean pixel-sand for tidecaller instead, and `drawRegionWater`/`drawWater`
  overlay decorative procedural ponds (walkable, NOT solid — solid water could
  strand a portal inside a pond). Any biome whose ground tile bakes in a feature
  tiles badly the same way; keep features procedural, not baked into the texture.
