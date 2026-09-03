---
name: Labyrinths town + interiors
description: How the RPG town at the overworld origin and its walk-in building interiors are structured.
---

# Town at the overworld origin

The overworld's start zone is a drawn RPG town in the clear plaza at world origin
(0,0). Data/geometry live in `lib/overworld/town.ts` (pure, no React); the
overworld renders from it; interiors are a separate route.

## Building art = detailed isometric PNG sprites (not procedural)
- The 6 buildings are hand-prompted **detailed isometric 2.5D pixel-art PNGs** in
  `public/game/overworld16/t_*.png`, stamped bottom-center at `fx,fy` sized by
  `SPRITE_PX[sprite] * BUILDING_SCALE`. Native px are the **transparent-trimmed**
  dims (`magick -trim +repage`); update `SPRITE_PX` whenever you regenerate.
- Each sprite bakes in ONE fixed 3/4 orientation lit from the **top-left**. To make
  buildings "face the centre" on all sides WITHOUT mirror-flipping (a flip reverses
  the baked light + roof angle → looks wrong), the LEFT arc uses dedicated
  **down-right-facing `t_*_r` variants** (generated fresh, still lit top-left) while
  the RIGHT arc reuses the base down-left sprites. Add `_r` names to `TOWN_TILES`
  (preload) in OverworldMap.tsx AND to `SPRITE_PX`.
- **Why:** single-orientation iso sprites can't be flipped to face the other way
  without breaking lighting; generating a real opposite-facing variant is the only
  consistent fix. Verify facing with an ImageMagick composite (foot-anchored) before
  wiring — the live overworld is behind a mock-wallet login gate the screenshot tool
  can't click through.

## Layout & collision
- SUPERSEDED (fortified crossroads): the town is now a "fortified crossroads" where the
  six biome roads dominate. Buildings sit evenly on a full `RING_R` ring at
  `GAP_ANGLES = BIOME_ANGLES + 30°` (one per 60° gap BETWEEN roads, de-clustered), right
  arc = base sprites, left arc = `_r` variants. `PLAZA_RADIUS`/`WALL_R`/`TOWN_SPAWN` were
  enlarged so the whole fort clears origin (`HUB_CLEAR = WALL_R + 60`). Roads are the
  authored `roads.ts` rays (see `labyrinths-overworld-authored.md`), no longer a block in
  `drawTownGround`. The northern-arc description below is the older layout.
- Buildings ring the **northern ~140° arc** on a ~560px foot ring (feet in `PLACEMENT`),
  all facing IN toward the fountain; the whole **south half is left open** as the spawn
  court. `PLAZA_RADIUS`/`WALL_R` (in town.ts, consumed by OverworldMap draw) size the
  cobble disc + perimeter wall; gates are cut at the six `BIOME_ANGLES`, which stay in
  sync with `BIOME_ORDER` in `api-server/src/lib/world.ts`.
- The **door point sits just below the foot anchor** and the solid footprint sits
  ABOVE it, so the player can always stand at the door to enter. `resolveTownMove` is
  axis-separated and chained AFTER `tileMap.resolveMove` in the movement loop
  (scenery+clamp first, town second).
- Buildings/props are pushed into the existing y-sorted `drawables` list (ry = foot
  y) so the player occludes correctly; plaza disc + rotated tiled path spokes are
  painted in the ground pass (`drawTownGround`, replaced the old `drawHub`).

## Spawn / return
- Spawn is overridden to `TOWN_SPAWN` (ignore `fetchSpawn` position). Returning from
  an interior, the exit writes `sessionStorage["townReturn"] = doorReturn(id)` and
  the overworld init consumes+clears it to land back at that door.

## Interiors
- Route `/town/:id` → `components/overworld/InteriorScene.tsx` (canvas room). Configs
  in `INTERIORS` map (floor/wall/props/npc). NPC action is either `{route}` (navigate
  to /marketplace, /forge, /loadout, /codex, /economy) or `{rest:true}` (inn dialog).
- The interior player sprite reuses `composeSpriteFromLayers(layersFromSlots(loadout))`
  + `drawLpcAvatar` (same contract as the overworld), with `player_full.png` as the
  pre-compose fallback.

## Biome overlap fix (symbolic LOD)
- The "everything overlaps" blob was `biomeRegions()` (zoomed-out LOD discs), not the
  plots. Fix: push centroids out (`midR = INNER_RADIUS + 520 + ringsEff*RING_STEP*0.6`)
  and **cap radius below half the centroid spacing** (`min(midR*0.46, …)`), since the
  six centroids are `midR` apart, so `2*radius < midR` guarantees no merge.

**Why:** doors-below-footprint + axis-separated town collision is what makes entry
reliable; the radius<midR/2 cap is the actual geometric condition that stops biome
discs merging regardless of plot counts.

## Walled sanctuary spawn
The spawn town is a compact enclosed courtyard: a perimeter stone wall + hedge with
gate gaps at the six `BIOME_ANGLES`, fountain/plaza center, shops hand-placed in the
upper arc facing inward (with L/R `flip` mirroring about the foot anchor), spawn just
inside the south gate. Wall collision (`wallBlocks`) leaves the gate gaps open so the
biome roads still radiate out. Buildings get a cast shadow + stone foundation + dirt
apron when grounded.

## Themed entrance arches + first-room peek
`drawEntrance` is a stone/biome-themed archway (not a portal blob): an `archOpeningPath`
clip shows a procedural `drawDungeonPeek` of the dungeon's first room inside the opening
(animated glow), framed by `drawArchFrame`. Accent color is the biome accent.

## Seamless walk-in entrance chamber (town -> run, no loading screen)
Walking into an arch opens `EntranceChamber.tsx` — a self-contained full-screen `z-50`
canvas overlay (its own loop, so a bug here can't break the live overworld beneath it).
It warms the run sprite cache + `qc.prefetchQuery(getRun)` while a hero silhouette
descends toward a glowing themed door, then fades to black and calls `onBegin` to
navigate to `/run/:id`.

Hard-won details:
- **The run is created in `LabyrinthPopup` BEFORE the chamber opens** (fee charged at
  `start_run`). There is **no cancel/refund path**, so the chamber is a strictly one-way
  cinematic — no Esc-to-cancel (that would orphan a paid run). Enter/click only
  fast-forwards the descent.
- **Suppress overworld input while the chamber is open**: OverworldMap's global keydown
  gates on `chamberOpenRef` alongside `popupOpenRef`/`chatFocusedRef`, or Enter/E leak
  through to `enterPopup`/`enterTown` behind the overlay.
- **For true seamlessness, hold on FULL BLACK until the run query is actually warm**
  (readyRef) before navigating, with a `BLACK_HOLD_CAP_MS` backstop — do NOT navigate
  the instant the fade hits 1, or Run.tsx flashes its own (dark-rethemed) loading branch
  on slow networks. The black hold is indistinguishable from a loaded dark run.
- Shared sprite-name list lives in `lib/runSprites.ts` (`RUN_SPRITE_NAMES`) so the
  chamber pre-warms exactly what Run.tsx loads.

## Buildings are drawn procedurally in-engine, NOT stamped PNGs
The six shops render from geometry in `lib/overworld/buildings.ts`
(`drawTownBuilding`), called by `drawBuilding` in OverworldMap (which still adds
the cast-shadow/stone `drawFoundation` under them). The old `t_*.png` building
sprites are no longer drawn — they had baked backgrounds/lighting that read as
rectangular stickers on the cobble.

**Why:** same root cause as the ground tiles — AI/image building art bakes in its
own background + light + scale, so it never blends. Geometry gives one consistent
light direction, real shadows, no seams, dynamic detail (forge glow, chimney
smoke, near-window warmth), and per-shop identity keyed by `TownBuilding.id`.

**RENDER STYLE = clean Gen-3 "Pokémon town" pixel art.** Iteration order that
landed it: (1) smooth vector gradients → "look like trash"; (2) a busy 3/4 pixel
pass with side-wall depth skew + fine brick/shingle/quoin texture → "Still looks
bad"; (3) the accepted look = FRONT-ON (no side wall, no depth skew), big
OVERHANGING roof with a chunky scalloped shingle eave (`eaveScallop`), a bright
ridge cap, 3 FLAT cel bands, bold dark `OUTLINE` on every silhouette, and cyan
2×2-pane windows with a white cross muntin. **Why:** Pokémon-town reads through
bold silhouette + few flat saturated colours; the earlier fine per-pixel texture
just muddied it. Keep it chunky and low-noise — do NOT reintroduce dense
brick/shingle rows, gradients, or a skewed side wall. Still bakes to an OFFSCREEN
canvas per `id`, blitted nearest-neighbour (`SCALE=3`, `imageSmoothingEnabled=false`
both ctxs), flat bands via `shade()` + scanline `tri()`/`quad()`.

**How to apply / gotchas:**
- Style is keyed by building `id` in `STYLES` (wall/roof/trim/glass/wood +
  roofStyle **hip|battlement** only + flags stone/brick/timber/columns/awning/
  chimney/banner). New shop → add its `id` or it falls back to `shop`.
- Layout is a FRONT elevation in art px: wall `WX0..WX1` × `WTY..GY`, big roof
  trapezoid `EAVE_L/EAVE_R` (overhang past the wall) up to a narrow ridge
  `RIDGE_L/RIDGE_R@RIDGE_Y`; `AX/GY` is the foot anchor. There is no APEX/ADX/ADY
  anymore. Because the building is symmetric & front-on, `flip` is visually a
  near-noop (only mirrors chimney/banner side) — that's fine.
- `drawTownBuilding` blits inside a LOCAL frame: `translate(fx,fy)` then `flip`
  mirrors via `scale(-1,1)`; animated overlays (chimney smoke, pulsing forge glow
  on windows, swaying banner, near door-glow) draw AFTER the blit in that same
  flipped frame. `now` drives them. Keep chimney on the RIGHT and banner on the
  LEFT (off-centre) so the centred signboard label doesn't clash.
- Signboard label + door-proximity highlight stay in `drawBuilding` (world space,
  outside the flip). Label y = `b.fy - b.drawH + 34` (drawH=300); ridge screen top
  ≈ foot−246, so the label sits just above the roof — keep toppers modest/off-centre.
- Openings: armory (`stone`) uses `drawSlit` (dark arrow-loops, NOT bright
  `drawWindow`); bank (`columns`) draws a colonnade instead of windows; forge
  windows are the glowing orange ones (meta.forge pulses them). Windows sit at
  `AX±16` so they clear the centred door.
- Verify visually via a throwaway mockup in mockup-sandbox (fs.strict blocks
  cross-artifact import, so copy the draw code + inline the TownBuilding type +
  a default-export harness); app_preview canvas screenshot works (pure canvas).
  Delete the mockup + restart the sandbox after so the generated registry is clean.

## Ground is painted procedurally, NOT tiled from PNGs
The plaza + roads are drawn brick-by-brick in canvas (`paintCobbleField`, world-space
deterministic `sandHash` per stone) clipped to a wobbly `plazaEdgePath`. Do **not**
`tileFloor` an AI-generated "ground tile" here.

**Why:** the AI "tile" assets (`g_plaza.png`, `g_path.png`, and the biome `g_*` floors)
are one-off *illustrations*, not seamless tiles — they bake in a character sprite, a
building corner, baked lighting, and even sit on a white background. `tileFloor`-ing
them stamps that same character + white gaps across the whole map (the "fake sprites /
retiling" the user called out). Same root cause already forced tidecaller to
`paintSandFloor`. **How to apply:** for any new ground surface, paint it procedurally
in world space (per-cell hash for variation so it never visibly repeats) instead of
stamping a generated PNG; AI image-gen cannot produce seamless subject-free tiles.

## Square-town biome gates

The fortified town is a true square with six dimensional portal arches seated in
the wall exits. Generic terrain between authored biome regions is neutral earth,
not green field/hedge texture; each portal is named and colored for its destination.

**Why:** the old green base made the world read as one undergrowth field, and a bare
gap did not communicate that each exit owns a biome region. Region centroids also
hold solid landmarks, so teleporting to the exact centroid can trap the player.

**How to apply:** keep gate order paired directly with the canonical biome-angle
order. Place arrivals inward from the region centroid along its radial axis, leaving
the centroid landmark and its collision footprint clear.
