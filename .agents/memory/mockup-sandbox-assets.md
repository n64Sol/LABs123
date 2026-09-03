---
name: Mockup-sandbox runtime asset loading & screenshots
description: Why canvas mockups in artifacts/mockup-sandbox render only fallbacks under the screenshot tool, and how to load public assets correctly.
---

# Runtime asset loading in artifacts/mockup-sandbox

Two non-obvious traps when a mockup component loads images at runtime via `new Image()` and paints them to a `<canvas>`:

## 1. `import.meta.env.BASE_URL` has NO trailing slash here
In this sandbox it resolves to `/__mockup` (not `/__mockup/`). Naive `${BASE_URL}game/x.png`
becomes `/__mockupgame/x.png` → 404, so every texture silently falls back.
**How to apply:** normalize before building any runtime asset URL:
`const base = import.meta.env.BASE_URL.replace(/\/?$/, "/");`
(Most mockups dodge this entirely by `import x from "@/assets/..."` — Vite bundles those with correct hashed URLs. Prefer ESM imports unless you truly need many runtime-keyed paths.)

## 2. The app_preview screenshot captures the canvas via DOM-to-image, not a live wait
`screenshot type=app_preview` serializes the page with modern-screenshot. For a `<canvas>`
it reads `canvas.toDataURL()` — whatever is painted at capture time. It does NOT wait for
offscreen `new Image()` loads (those aren't DOM `<img>` nodes). So if textures haven't
downloaded+painted yet, the screenshot shows your fallback rendering.
**Why:** real game ground tiles were ~1–1.7MB each (19MB total) and never finished before capture.
**How to apply:** keep mockup assets tiny (downscaled with ImageMagick `magick in.png -resize 96x96 out.png`;
ground tiles tile fine at ~96px, object sprites at height ~112px, upscaled nearest-neighbor for the
16-bit look). A DOM `<img>` debug overlay using the same path is the fastest way to tell a 404
(broken-image icon) apart from a paint-timing issue.

## 4. Cohesion for mixed pixel-art + procedural-effect scenes
When a scene layers crisp pixel-art tiles/sprites with procedural canvas effects, the smooth
vector effects (radial-gradient glows, a solid-fill water ellipse, neon flower dots) read as
"pasted on" and the biome feels incoherent. Two fixes that work together:
1. **Per-biome color grade** — after drawing everything, clip to the region and paint a soft
   `multiply` (mood/shadow color) + `screen` (light-haze color) wash over the WHOLE biome.
   This pulls tiles, sprites, AND effects into one palette; it is THE biggest cohesion lever.
2. **Match the pixel aesthetic** — render procedural water/ground-cover as blocky flat-color
   cells (`fillRect` on a grid, 3-tone depth + animated caustic cells + foam dabs), not smooth
   gradients; mute decal palettes and lower glow alpha/radius so effects support, not dominate.

**Biggest lever for "looks intentional, not thrown all over the floor":** it is COMPOSITION,
not palette. A uniform per-tile probability (`hashTile(tx,ty) < density`) is white-noise scatter
and always reads as random clutter — and a subtle color grade (mulA ~0.1–0.3) is too weak to
register as a change. Fix placement with a coherent low-frequency field (value-noise FBM):
gate scatter on `fbm(x,y) > THRESH` so props form clusters (groves/veins) with bare clearings
between them, ramp per-tile density toward the cluster core (`density*(a + b*core²)`), and pick
the sprite KIND per low-res cluster cell so each clump shares a species (a copse of trees, a
boulder field). Apply the same clustered field to ground decals. Negative space + grouping =
intentional. **Why:** user twice said grade-only changes "look basically the exact same."

**Tiles with a baked-in FEATURE tile into broken artifacts.** A single ground tile that has a
water channel / road / river painted into it (e.g. the raw `g_tidecaller` beach+channel) cannot
be flat-tiled — the feature repeats and "cuts off" at every seam, and it fights any procedural
version of the same feature. Fix: drop the feature-baked tile for that biome, paint a clean
featureless base (flat color + sparse blocky speckle for pixel texture), and let ONE procedural
generator own the feature (here `drawWater` ponds). Autotiling would need edge/corner variants
we don't have. **How to apply:** when a biome floor shows disconnected strips of water/path.

## 3. Animated canvas effects: continuous rAF + design for a frozen frame
Animated effects (water shimmer/ripples, prop glows, rising embers, foliage sway) need a
*continuous* requestAnimationFrame loop — a dirty-flag-only repaint never animates. But the
app_preview screenshot captures one arbitrary phase, so every effect must also look good in a
single still frame (use steady glows/halos + a bit of motion, not effects that are invisible
except mid-transition). Procedural per-biome ground cover + effects can be drawn entirely in
canvas (no new sprite assets); gate the fine decal grid by zoom (`scale > ~0.18`) so world-zoom
frames stay cheap.
