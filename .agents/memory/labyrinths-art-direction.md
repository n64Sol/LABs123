---
name: Labyrinths art-direction comparison
description: Which asset packs / approach back each candidate look, and how the comparison mockup is built.
---

# Labyrinths art-direction comparison

A 3-way visual comparison lives in the Canvas (mockup-sandbox) as
`src/components/mockups/StyleCompare.tsx`, viewable at `/__mockup/preview/StyleCompare`.
It shows the same dungeon chamber in three candidate looks with style-matched HUD overlays.
Scene images are committed under `mockup-sandbox/src/assets/styles/`.

A second, PREMIUM 4-way comparison lives as `src/components/mockups/ArtDirections.tsx`
(`/__mockup/preview/ArtDirections`). Each direction shows BOTH in-world surfaces
(AI dungeon battle scene + overworld strip w/ minimap) AND full game chrome
(nav rail, player card, combat HUD, ability bar, swatches, buttons) so HUD/menu
treatment is comparable, not just scenes. Same HUD numbers across all four.
Generated scene art committed under `mockup-sandbox/src/assets/artdirections/`
(`*_battle.png` + `*_overworld.png` per direction). Fonts via Google Fonts <link>.
The four named directions:
- **Obsidian Forge** — dark soulslike, iron/ember, Cinzel Decorative. AI scenes; pure CSS HUD.
- **Arcane Circuit** — neon mystic-tech, cyan/magenta rune-glow, Orbitron. AI scenes + glassmorphism.
- **Gilded Myth** — painterly illuminated, jewel tones + gold filigree, serif. Hardest to keep
  consistent in-engine (same caveat as Hades above) — needs generated/commissioned art.
- **Stormveil** — Nordic misty minimal, slate-blue fog, thin type. Cheapest chrome (hairline glass).

**Honest in-engine mockup (preferred framing):** `src/components/mockups/InEngineDirections.tsx`
(`/__mockup/preview/InEngineDirections`) composes each scene the way the real top-down
engine renders — a repeating SEAMLESS tile + individual TRANSPARENT sprites + CSS lighting
(vignette/light-pool/glow) — NOT a single AI-painted scene. **Why:** a painted full-scene
splash misrepresents what a tile-and-sprite engine can actually render at runtime; the user
explicitly rejected painted backdrops and asked for what's truthfully shippable.
**How to apply:** AI images are fine as ASSET-SHAPED pieces only — each generated image is
EITHER a seamless edge-tileable texture OR one single subject on a flat chroma bg
(then background-removed to transparent PNG); never prompt for a composed scene. Assets live
under `mockup-sandbox/src/assets/inengine/<dir>/` (floor/wall/ground tiles + hero/grunt/caster/
boss/portal/prop/loot sprites). Painterly "Gilded Myth" is dropped here on purpose — it can't be
honestly reproduced from tiles+sprites. The earlier ArtDirections.tsx (painted backgrounds) is
kept only as a look-target reference.

**Distinct directions must differ in STRUCTURE, not just palette.** A first pass reskinned one
shared scene+HUD template per direction (same camera, same left rail, same sprite blocking, only
colors/fonts/assets swapped) and the user immediately called it "the same thing with different
skins." **Why:** an art direction is a camera scale + HUD architecture + framing decision, not a
color theme; recoloring one template always reads as one game. **How to apply:** give each
direction its own bespoke layout/render path. The current InEngineDirections does this with three
different game paradigms over the SAME engine primitives: Obsidian=ARPG (tight camera, ornate
framed HUD, HP/MP orbs + skill belt, minimap), Arcane=MOBA (zoomed-OUT tactical grid, top score
bar, right leaderboard+shop, ground AoE reticles, cooldown sweeps), Stormveil=Soulslike
(letterboxed, near-zero HUD, centered boss bar, fog, pause menu).

**Code-only map lab (latest, strongest framing):** `src/components/mockups/MapStyleLab.tsx`
(`/__mockup/preview/MapStyleLab`, deep-linkable `?style=ink|holo|stained`). The user rejected
ALL image-backed mockups (AI scenes AND tile+sprite composites) as "the same thing with
different skins" and asked: "what can YOU make without outside assets — ACTUALLY MAKE IT —
switches the view for me." **Why:** they wanted proof of what's renderable from pure code, not
asset curation. **How to apply:** the deliverable renders the real overworld (hub at origin +
6 biome wedges + ring/sunflower-packed plots + hash-scattered decor + players) on an HTML5
canvas with ZERO image imports — all gradients/paths/hatching — and switches the SAME seeded
world between three rendering LANGUAGES via live tabs (drag-pan, scroll-zoom, rAF anim).
Distinct direction = distinct rendering technique on identical data, not a recolor. Faithful
map structure was taken from artifacts/labyrinths overworld render.ts (do NOT modify the live game).
**Refined after user feedback:** they wanted the ZOOMED-IN PLAYABLE map (big textured biome
circles + hero + full game HUD like the live client screenshot), not abstract cartography. Current
three directions: Painterly Realms (procedural filled floor textures per biome — grass/brick/water/
crystal/lava/stars — soft shadows, drawn cloaked heroes, light glass HUD), Arcane Holotable (neon
wire-grid terrain discs + sweep lines + diamond avatars + scanlines), Inked Codex (vellum + per-biome
hatch washes + ink portal flags + sketched figures + parchment serif HUD). HUD chrome mirrors the
client (online/appearance/control-hint/Local Map minimap canvas/Co-op/reactions/chat/+- zoom).
**Why:** "distinct directions" for a top-down game means distinct procedural terrain + chrome
language on the real map composition, not different framings of an abstract diagram.
**FINAL pivot (what landed):** user called the vector/abstract canvas versions "trash" and
pointed at a polished pixel-art top-down reference (detailed buildings, lush grass, trees,
characters, chunky game UI). Winning approach = REAL pixel-art pipeline: draw whole scene to a
small low-res offscreen canvas, then upscale with imageSmoothingEnabled=false (PIXEL=3) for crisp
chunky pixels — NOT vector shapes on a hi-res canvas. Hand-built procedural pixel sprites (grass
noise/blades/flowers, dirt roads, layered trees, 5 distinct buildings, monument, fenced pen+eggs,
idle heroes) + chunky Press Start 2P HUD. Three options are MOODS (Verdant Dawn / Emberfall Dusk /
Moonlit Hollow) = full-res lighting grade + particles + window-glow over the SAME baked pixel scene.
**Why this worked:** lo-fi-render-then-nearest-upscale is the trick that makes pure code read as a
real pixel game; abstract gradient/vector "directions" read as diagrams and got rejected twice.
**How to apply:** for any "make it look like a real game" ask, reach for the low-res+nearest-upscale
pipeline and author blocky sprites via fillRects on the low-res buffer, not smooth vector art.
**TRUE FINAL outcome:** even the hand-coded pixel-upscale version was rejected as "trash"; the user
showed pro 16-bit references (Stardew farm, RPG village) and said "generate something that looks like
this — I've seen you do it in my other projects." Lesson: when a user wants asset-pack-grade pixel
art for an art-direction MOCKUP, hand-rolled procedural code will NOT clear the bar — use generateImage
(16:9, detailed "top-down 2D pixel art overworld, 16-bit SNES JRPG / Stardew Valley style" prompts,
negativePrompt to kill text/UI/3d/blurry). That landed instantly. The "no outside assets / code-only"
rule was the user's own earlier constraint and they overrode it; always defer to the latest explicit
ask. Generated dirs saved under attached_assets/generated_images/labyrinths_*.png.

The three directions and their backing sources:
- **Hades-style** — painterly/ornate. NOT available as free real assets; only via AI concept art
  (generateImage) or paid/commissioned. Hardest to keep consistent at scale.
- **Clean pixel** — Kenney "Tiny Dungeon" pack (CC0, free to ship). Individual 16x16 PNGs in `Tiles/`.
- **Dark gritty stone** — Kenney "Caves" pack (CC0). Spritesheet, 16px tiles + 1px spacing, 29 cols.
  Its tiles are LIGHT grey by default; the "gritty" mood comes from post-processing
  (multiply-darken + radial vignette + warm torch glow), NOT from the tiles themselves.

**Why:** the user is choosing an art direction before any in-game art work; this is a
visual-only comparison, the live game is unchanged.

**How to apply:** if the user picks a direction, that determines whether real CC0 assets can
be used directly (pixel/gritty) or whether art must be generated/commissioned (Hades).

Kenney download trick: GET `https://kenney.nl/assets/<slug>`, grep for
`/media/pages/assets/.../*.zip`, prefix with `https://kenney.nl`. All packs are CC0.
The scene-composition scripts were scratch work in `/tmp/kpacks/` (ephemeral — rebuild if needed).
