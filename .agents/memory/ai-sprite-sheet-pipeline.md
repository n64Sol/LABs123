---
name: AI sprite sheet pipeline (Labyrinths)
description: How to turn a single AI-generated multi-subject character grid into a clean, uniform, frame-animatable sprite sheet.
---

# Turning an AI-generated character grid into a usable sprite sheet

**Context:** `generateImage` cannot reliably produce per-frame transparent sprites, but it CAN produce one coherent grid of the same character in many poses on a flat key color. That single-image approach gives the best character consistency. The cleanup is what makes it usable.

**Pipeline that worked (player_sheet):**
1. Generate ONE grid (e.g. 4x3) of the character on a flat magenta (#ff00ff) background. Pick a key color the character palette never uses (blue/gold/brown warrior → magenta + maroon shadows key out cleanly).
2. Background-removal services (sharp/PIL-based, and the hosted remove-bg tool) FAIL on a multi-subject grid — they can't segment multiple figures. Do NOT rely on them here.
3. Chroma-key in HSV via Pillow: bg = (hue in magenta band & saturated) OR (near-white low-sat for gridlines) OR (low-sat mid-value for faint gray gridline dashes). Baked ground shadows key out with the magenta if they're a different hue than the character.
4. Wipe gutter bands (±5px around grid lines) + outer border to kill gridline remnants.
5. **Keep only the largest connected component per cell** (flood fill). This is the key step that removes leftover gridline dashes/specks that otherwise inflate the per-cell alpha bbox and get baked into frames.
6. Re-anchor: trim each cell to its alpha bbox, normalize by HEIGHT to a common target, then paste bottom-center into UNIFORM output cells. This fixes the per-cell scale/position drift the generator produces (otherwise the character jitters/pops between frames).
7. Normalize FACING: the generator mixes left/right-facing poses. Mirror the odd ones during compose so every frame is canonically one direction; flip at draw time by facing.

**Why:** generated grids have non-uniform cell scale, mixed facing, baked shadows, and gridlines — drawing them raw produces jitter, popping, and stray lines. The trim+normalize+largest-CC+facing steps are what make frames cycle cleanly.

**How to apply:** one-off Pillow scripts (`pip install pillow numpy`); keep the ORIGINAL magenta source around (don't overwrite it) so you can re-tune the key/compose. Output a known geometry (cols/rows/cellW/cellH) and hardcode it in the slicer (`drawImage` source-rect).

## Multi-direction (up/down) follow-on
- Side-flip CANNOT make up/down: a back/front view is genuinely different art. Generate a separate FRONT-view grid (facing camera = "down") and BACK-view grid (facing away = "up") of the same character; one grid per view keeps frames consistent.
- **Chroma-key gotcha:** the broad "low-sat gray = background" band that removes faint gridlines will ALSO erase a silver/steel shield (low saturation, mid value). For art with metal/gray gear, key ONLY the saturated magenta hue band (e.g. `S>=70`) plus near-white gridlines, and strip gridlines via gutter/border wipe instead of a gray band.
- AI grids don't honor requested layout: a "2x2" request can come back 2x3. Inspect the returned image and set rows/cols from what's actually there before slicing.
- **Facing is aim-driven, not movement-driven** in this game: pick the sheet from the aim vector — `|ady|>|adx|` → up (ady<0) / down (ady>=0) with no flip, else side flipped by sign of adx. Fallback chain: directional sheet → side sheet → single player.png → primitive shape.

## Multi-direction consistency (front/back/side)
- Directions MUST come from ONE generation pass. Generating side separately from front/back drifts the character (beard/proportions/shield/colors) — users notice instantly and ask to redo.
- Best one-pass layout: a 4-direction turnaround sheet (front / both sides / back), all WALKING. Models reliably keep one consistent character across a turnaround but bias toward animating the SIDE profile, so expect few/one front+back frames and many side frames.
- All generated side views tend to face ONE way (often left). Mirror them at compose time so the side sheet is canonically RIGHT-facing (game flips by `s.facing`).
- Derive the code's idle/run/attack/dash rows from whatever poses exist: side gets a real cycle; front/back may be 1–2 frames reused. Do NOT mirror-flip a FRONT frame every tick to fake a walk — it flickers (beard/shield jump sides). Prefer a static front over flicker.
- Keep the chosen source image (e.g. /tmp/source_4dir.png) for re-slicing without regenerating.
