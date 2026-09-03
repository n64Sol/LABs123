import type { LoadoutSlots } from "@workspace/api-client-react";

/** Side length (px) of one LPC sprite cell in the source sheets. */
export const LPC_CELL = 64;

/** Columns per row in a classic LPC sheet (max frame count of any animation). */
export const LPC_COLS = 13;

/** Total rows in a classic LPC sheet (832x1344). */
export const LPC_ROWS = 21;

/**
 * Oversize weapons (e.g. katana) ship one sheet PER action with 128px frames
 * (1664x512 = 13 cols x 4 dir rows). Each 128px frame is centered onto a 64px
 * target cell with this offset, mirroring the build pipeline's
 * `_paste_oversize_weapon` (tools/sprite-pipeline/compose.py).
 */
export const OVERSIZE_FRAME = 128;
const OVERSIZE_OFFSET = (LPC_CELL - OVERSIZE_FRAME) / 2; // -32

/** First row of each LPC animation group in a classic sheet (up/left/down/right). */
const ANIMATION_START_ROW: Record<string, number> = {
  walk: 8,
  slash: 12,
};

/**
 * Weapon layer keys carry an *animation target* in their name: bare keys map to
 * the walk rows (8-11), `*_slash` variants map to the slash rows (12-15). Listed
 * here so {@link composeSpriteFromLayers} knows which rows an oversize per-action
 * weapon sheet belongs to. Spellcast/thrust/shoot rows are intentionally absent,
 * so a weapon is gracefully omitted from those animations.
 */
const WEAPON_LAYER_ANIMATION: Record<string, "walk" | "slash"> = {
  weapon_behind: "walk",
  weapon_fg: "walk",
  weapon_behind_slash: "slash",
  weapon_fg_slash: "slash",
};

/**
 * Z-order for composited equipment layers. Negative values render behind the
 * body (capes, weapons held behind); positive values render in front, drawn low
 * to high. Shared so the run renderer and the loadout preview stay identical.
 * Each weapon's `*_slash` variant inherits the z of its walk counterpart so the
 * blade draws on the same side of the body across animations.
 */
export const LAYER_Z: Record<string, number> = {
  cape: -20,
  weapon_behind: -10,
  weapon_behind_slash: -10,
  legs: 10,
  feet: 20,
  torso: 30,
  shoulders: 40,
  neck: 50,
  gloves: 60,
  helmet: 70,
  shield: 80,
  weapon_fg: 90,
  weapon_fg_slash: 90,
};

/**
 * A clean, front-facing idle pose (LPC walk rows: 8=up, 9=left, 10=down,
 * 11=right; frame 0 is the standing frame). Used for still character previews.
 */
export const STILL_POSE = { row: 10, frame: 0 } as const;

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`LPC load failed: ${src}`));
    img.src = src;
  });
}

/**
 * Flatten an equipped loadout into a single `{ layerKey -> relativePath }` map.
 *
 * This is the transport-friendly shape of a character's appearance: it carries
 * just the sprite-layer paths (no item stats/templates), so it can be sent over
 * the overworld presence channel and composed by remote clients. Later slots win
 * on a key collision, matching the draw order applied by {@link LAYER_Z}.
 */
export function layersFromSlots(
  slots: LoadoutSlots | null | undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  if (slots) {
    for (const slot of Object.values(slots)) {
      const layers = slot?.template?.spriteLayers;
      if (!layers) continue;
      for (const [layerKey, relPath] of Object.entries(layers)) {
        if (typeof relPath === "string") out[layerKey] = relPath;
      }
    }
  }
  return out;
}

/**
 * Place an oversize per-action weapon sheet (128px frames, 4 direction rows for
 * a single animation) onto the target animation's rows, centering each 128px
 * frame on its 64px cell. Mirrors `_paste_oversize_weapon` in the build pipeline
 * (tools/sprite-pipeline/compose.py) so a weapon equipped at runtime lands in
 * exactly the same place as one baked into the base sheet.
 */
function drawOversizeWeapon(
  octx: OffscreenCanvasRenderingContext2D,
  img: HTMLImageElement,
  animation: "walk" | "slash",
): void {
  const startRow = ANIMATION_START_ROW[animation];
  const srcRows = Math.floor(img.naturalHeight / OVERSIZE_FRAME); // typically 4
  for (let d = 0; d < srcRows; d++) {
    const targetRow = startRow + d;
    if (targetRow >= LPC_ROWS) break;
    for (let c = 0; c < LPC_COLS; c++) {
      const sx = c * OVERSIZE_FRAME;
      const sy = d * OVERSIZE_FRAME;
      if (sx + OVERSIZE_FRAME > img.naturalWidth || sy + OVERSIZE_FRAME > img.naturalHeight) continue;
      const dx = c * LPC_CELL + OVERSIZE_OFFSET;
      const dy = targetRow * LPC_CELL + OVERSIZE_OFFSET;
      octx.drawImage(
        img,
        sx, sy, OVERSIZE_FRAME, OVERSIZE_FRAME,
        dx, dy, OVERSIZE_FRAME, OVERSIZE_FRAME,
      );
    }
  }
}

/**
 * Draw one composited layer onto the canvas. Standard full-sheet gear (832-wide,
 * covering every animation row) blits at the origin. Weapon layers may instead
 * ship as oversize per-action sheets (1664-wide, 128px frames) that only carry a
 * single animation group; those are routed by their layer key to the matching
 * rows (`weapon_*` -> walk, `weapon_*_slash` -> slash) so an equipped weapon's
 * own blade is shown during both walking and the slash attack.
 */
function drawLayer(
  octx: OffscreenCanvasRenderingContext2D,
  layerKey: string,
  img: HTMLImageElement,
): void {
  const animation = WEAPON_LAYER_ANIMATION[layerKey];
  if (animation) {
    const frameW = img.naturalWidth / LPC_COLS;
    if (Math.abs(frameW - OVERSIZE_FRAME) < 1) {
      drawOversizeWeapon(octx, img, animation);
      return;
    }
  }
  octx.drawImage(img, 0, 0);
}

/**
 * Compose a flat `{ layerKey -> relativePath }` appearance map over the base
 * body into a single sprite sheet (an `OffscreenCanvas` matching the base
 * sheet's dimensions). Layers are ordered by {@link LAYER_Z} and drawn around
 * the base body. Returns `null` when `OffscreenCanvas` is unavailable or
 * composition fails, so callers can fall back to the plain base sheet.
 */
export async function composeSpriteFromLayers(
  layers: Record<string, string> | null | undefined,
  baseUrl: string,
): Promise<OffscreenCanvas | null> {
  if (typeof OffscreenCanvas === "undefined") return null;
  const basePath = `${baseUrl}game/player_full.png`;

  const entries: { key: string; z: number; path: string }[] = [];
  if (layers) {
    for (const [layerKey, relPath] of Object.entries(layers)) {
      entries.push({ key: layerKey, z: LAYER_Z[layerKey] ?? 35, path: `${baseUrl}${relPath}` });
    }
  }
  entries.sort((a, b) => a.z - b.z);

  const behind = entries.filter((e) => e.z < 0);
  const front = entries.filter((e) => e.z >= 0);
  const ordered = [...behind, { key: "__base__", z: 0, path: basePath }, ...front];
  const baseIndex = behind.length;

  try {
    const images = await Promise.all(ordered.map((e) => loadImage(e.path)));
    const base = images[baseIndex];
    if (!base || base.naturalWidth === 0) return null;
    const canvas = new OffscreenCanvas(base.naturalWidth, base.naturalHeight);
    const octx = canvas.getContext("2d")!;
    octx.imageSmoothingEnabled = false;
    for (let i = 0; i < ordered.length; i++) {
      const img = images[i];
      if (img && img.naturalWidth > 0) drawLayer(octx, ordered[i].key, img);
    }
    return canvas;
  } catch {
    return null;
  }
}

/**
 * Compose a character's equipped sprite layers over the base body into a single
 * sprite sheet. Thin wrapper over {@link composeSpriteFromLayers} that first
 * flattens the loadout, so the run renderer and loadout preview stay identical.
 */
export async function composeLoadoutSprite(
  slots: LoadoutSlots | null | undefined,
  baseUrl: string,
): Promise<OffscreenCanvas | null> {
  return composeSpriteFromLayers(layersFromSlots(slots), baseUrl);
}

/** Load just the base body sheet — fallback when composition is unavailable. */
export async function loadBaseSprite(baseUrl: string): Promise<HTMLImageElement | null> {
  try {
    return await loadImage(`${baseUrl}game/player_full.png`);
  } catch {
    return null;
  }
}

/**
 * Blit a single still cell from a composed sheet (or any LPC source) onto a 2D
 * context, scaled to `size`, with pixel-art smoothing disabled.
 */
export function drawStillPose(
  ctx: CanvasRenderingContext2D,
  src: CanvasImageSource,
  dx: number,
  dy: number,
  size: number,
  row: number = STILL_POSE.row,
  frame: number = STILL_POSE.frame,
): void {
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(src, frame * LPC_CELL, row * LPC_CELL, LPC_CELL, LPC_CELL, dx, dy, size, size);
}
