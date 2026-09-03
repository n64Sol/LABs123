// Deterministic 16-bit tile/object layer for the streaming overworld.
//
// Everything here is a pure function of world coordinates + the server-provided
// biome regions, so every client derives the exact same object placement and
// collision without any extra network state. Ground textures are still painted
// by the existing pattern tiler in OverworldMap; this module only decides where
// decorative/solid objects live and resolves player movement against them.

import type { BiomeRegion } from "./worldClient";
import { onRoad } from "./roads";
import { WALL_HALF } from "./town";

export const TILE = 32; // world px per logical tile
export const PLAYER_RADIUS = 16; // collision radius around the player's feet
// Keep wild scenery out of the ENTIRE fortified town, not just a tiny disc — the
// perimeter wall sits at WALL_HALF, so clear a touch beyond it.
const HUB_CLEAR = WALL_HALF + 60;
const ENTRANCE_CLEAR = 76; // keep objects away from labyrinth portals

/** A decorative (and optionally solid) object placed on a tile. */
export interface TileObject {
  /** Sprite key (matches a preloaded overworld16 image). */
  kind: string;
  /** World position of the object's base (its "feet"), used for y-sorting. */
  x: number;
  y: number;
  /** Draw size in world px. */
  w: number;
  h: number;
  /** Whether the player collides with it. */
  solid: boolean;
  /** Collision radius around the base. */
  solidR: number;
}

interface ObjectDef {
  kind: string;
  w: number;
  h: number;
  solid: boolean;
  solidR: number;
  weight: number;
}

// Per-biome object palettes (weights bias how often each appears).
const PALETTES: Record<string, ObjectDef[]> = {
  field: [
    { kind: "o_rock", w: 44, h: 38, solid: true, solidR: 15, weight: 1 },
  ],
  verdant_grove: [
    { kind: "o_tree", w: 95, h: 118, solid: true, solidR: 14, weight: 4 },
    { kind: "o_bush", w: 50, h: 46, solid: false, solidR: 0, weight: 3 },
    { kind: "o_fern", w: 41, h: 40, solid: false, solidR: 0, weight: 2 },
    { kind: "o_flowers", w: 43, h: 34, solid: false, solidR: 0, weight: 2 },
    { kind: "o_rock", w: 45, h: 42, solid: true, solidR: 15, weight: 1 },
  ],
  sunlit_ruins: [
    { kind: "o_cactus", w: 54, h: 80, solid: true, solidR: 13, weight: 3 },
    { kind: "o_ruin_pillar", w: 56, h: 88, solid: true, solidR: 16, weight: 2 },
    { kind: "o_rock", w: 46, h: 40, solid: true, solidR: 16, weight: 3 },
  ],
  tidecaller: [
    { kind: "o_reed", w: 46, h: 50, solid: false, solidR: 0, weight: 4 },
    { kind: "o_rock", w: 46, h: 40, solid: true, solidR: 16, weight: 3 },
  ],
  crystal_caverns: [
    { kind: "o_crystal", w: 58, h: 64, solid: true, solidR: 16, weight: 4 },
    { kind: "o_rock", w: 46, h: 40, solid: true, solidR: 16, weight: 3 },
  ],
  emberforge: [
    { kind: "o_lava_rock", w: 52, h: 46, solid: true, solidR: 16, weight: 4 },
    { kind: "o_rock", w: 46, h: 40, solid: true, solidR: 16, weight: 2 },
  ],
  astral_spire: [
    { kind: "o_rune_stone", w: 56, h: 84, solid: true, solidR: 16, weight: 3 },
    { kind: "o_rock", w: 46, h: 40, solid: true, solidR: 14, weight: 2 },
  ],
};

// How densely each biome scatters objects (fraction of tiles, 0..1).
const DENSITY: Record<string, number> = {
  field: 0.018,
  verdant_grove: 0.1,
  sunlit_ruins: 0.085,
  tidecaller: 0.07,
  crystal_caverns: 0.09,
  emberforge: 0.08,
  astral_spire: 0.07,
};

// Authored biome centerpieces: one landmark anchored at each biome zone's core,
// giving every region a destination (Warcraft-III style) rather than uniform scatter.
interface LandmarkDef {
  kind: string;
  h: number; // draw height in world px (width follows the sprite's aspect)
  solidR: number;
}
const LANDMARKS: Record<string, LandmarkDef> = {
  verdant_grove: { kind: "o_elder_tree", h: 340, solidR: 46 },
  sunlit_ruins: { kind: "o_sunlit_temple", h: 360, solidR: 58 },
  tidecaller: { kind: "o_lighthouse", h: 380, solidR: 42 },
  crystal_caverns: { kind: "o_crystal_spire", h: 340, solidR: 50 },
  emberforge: { kind: "o_ember_spire", h: 350, solidR: 52 },
  astral_spire: { kind: "o_astral_obelisk", h: 360, solidR: 34 },
};

export interface Landmark {
  kind: string;
  x: number;
  y: number;
  h: number;
  solidR: number;
}

/** The authored centerpiece of every eligible biome zone (deterministic: one per
 *  zone, anchored at its centre, skipping roads/town/entrances). */
export function collectLandmarks(
  regions: BiomeRegion[],
  entrances: { x: number; y: number }[],
): Landmark[] {
  const out: Landmark[] = [];
  for (const r of regions) {
    const def = LANDMARKS[r.key];
    if (!def) continue;
    if (Math.abs(r.cx) < HUB_CLEAR && Math.abs(r.cy) < HUB_CLEAR) continue;
    if (onRoad(r.cx, r.cy)) continue;
    if (nearAnyEntrance(r.cx, r.cy, entrances)) continue;
    out.push({ kind: def.kind, x: r.cx, y: r.cy, h: def.h, solidR: def.solidR });
  }
  return out;
}

function hashTile(tx: number, ty: number, salt: number): number {
  let h = (Math.imul(tx | 0, 374761393) ^ Math.imul(ty | 0, 668265263) ^ Math.imul(salt | 0, 2246822519)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 2246822519) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 3266489917) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 0xffffffff;
}

// Smooth value noise + fbm — gives a coherent low-frequency field so scatter forms
// intentional clusters (groves/patches) with bare clearings, not uniform per-tile noise.
function vnoise(x: number, y: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const tl = hashTile(xi, yi, 91);
  const tr = hashTile(xi + 1, yi, 91);
  const bl = hashTile(xi, yi + 1, 91);
  const br = hashTile(xi + 1, yi + 1, 91);
  const u = xf * xf * (3 - 2 * xf);
  const w = yf * yf * (3 - 2 * yf);
  const top = tl + (tr - tl) * u;
  const bot = bl + (br - bl) * u;
  return top + (bot - top) * w;
}

function fbm(x: number, y: number): number {
  let sum = 0;
  let amp = 0.5;
  let freq = 1;
  let norm = 0;
  for (let o = 0; o < 3; o++) {
    sum += amp * vnoise(x * freq, y * freq);
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}

/** Biome key containing a world point (deepest region wins), or null for open field. */
export function biomeAt(x: number, y: number, regions: BiomeRegion[]): string | null {
  let best: string | null = null;
  let bestScore = Infinity;
  for (const r of regions) {
    const d = Math.hypot(r.cx - x, r.cy - y);
    if (d < r.radius) {
      const score = d / r.radius; // closer to a region's center = more "inside" it
      if (score < bestScore) {
        bestScore = score;
        best = r.key;
      }
    }
  }
  return best;
}

/** Deterministic object on a given tile (or null if the tile is empty). */
export function objectAt(tx: number, ty: number, regions: BiomeRegion[]): TileObject | null {
  const cx = tx * TILE + TILE / 2;
  const cy = ty * TILE + TILE / 2;

  // Keep the spawn plaza clear.
  if (Math.abs(cx) < HUB_CLEAR && Math.abs(cy) < HUB_CLEAR) return null;

  const biome = biomeAt(cx, cy, regions) ?? "field";

  // Coherent cluster field: dense "groves" with bare clearings between them so the
  // landscape reads as composed terrain, not uniform per-tile sprinkle. Outside a
  // cluster = intentional negative space.
  const cf = 1 / (TILE * 4.8);
  const field = fbm(cx * cf + 11.3, cy * cf + 4.7);
  const THRESH = 0.55;
  if (field < THRESH) return null;
  const core = (field - THRESH) / (1 - THRESH); // 0 at cluster edge → 1 at its core
  const density = DENSITY[biome] ?? DENSITY.field;
  if (hashTile(tx, ty, 1) > density * (0.2 + 3.4 * core * core)) return null;

  // Kind chosen mostly per cluster cell, so each grove shares a species (a few accents).
  const ck = TILE * 3;
  const cellX = Math.floor(cx / ck);
  const cellY = Math.floor(cy / ck);
  const palette = PALETTES[biome] ?? PALETTES.field;
  const total = palette.reduce((a, d) => a + d.weight, 0);
  const useCluster = hashTile(tx, ty, 5) < 0.8;
  let roll = (useCluster ? hashTile(cellX, cellY, 2) : hashTile(tx, ty, 2)) * total;
  let def = palette[palette.length - 1];
  for (const d of palette) {
    roll -= d.weight;
    if (roll <= 0) {
      def = d;
      break;
    }
  }

  // Sub-tile jitter so objects don't sit on a visible grid.
  const jx = (hashTile(tx, ty, 3) - 0.5) * TILE * 0.7;
  const jy = (hashTile(tx, ty, 4) - 0.5) * TILE * 0.7;
  return { kind: def.kind, x: cx + jx, y: cy + jy, w: def.w, h: def.h, solid: def.solid, solidR: def.solidR };
}

function nearAnyEntrance(x: number, y: number, entrances: { x: number; y: number }[]): boolean {
  for (const e of entrances) {
    const dx = e.x - x;
    const dy = e.y - y;
    if (dx * dx + dy * dy < ENTRANCE_CLEAR * ENTRANCE_CLEAR) return true;
  }
  return false;
}

/** Collect every object whose base falls inside (a margin around) the view rect. */
export function collectTileObjects(
  regions: BiomeRegion[],
  vx0: number,
  vy0: number,
  vx1: number,
  vy1: number,
  entrances: { x: number; y: number }[],
): TileObject[] {
  // Margin so tall objects rooted just off-screen still draw / sort in.
  const tx0 = Math.floor((vx0 - TILE) / TILE);
  const ty0 = Math.floor((vy0 - 16) / TILE);
  const tx1 = Math.ceil((vx1 + TILE) / TILE);
  const ty1 = Math.ceil((vy1 + 140) / TILE);
  const out: TileObject[] = [];
  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      const obj = objectAt(tx, ty, regions);
      if (!obj) continue;
      if (nearAnyEntrance(obj.x, obj.y, entrances)) continue;
      if (onRoad(obj.x, obj.y)) continue;
      out.push(obj);
    }
  }
  // Inject each in-view biome landmark so it y-sorts with the scenery and players.
  for (const lm of collectLandmarks(regions, entrances)) {
    if (lm.x < vx0 - 260 || lm.x > vx1 + 260 || lm.y < vy0 - 40 || lm.y > vy1 + lm.h + 60) continue;
    out.push({ kind: lm.kind, x: lm.x, y: lm.y, w: 0, h: lm.h, solid: true, solidR: lm.solidR });
  }
  return out;
}

/** True if a circle at (x,y) overlaps any solid object near it. */
export function collidesCircle(
  x: number,
  y: number,
  r: number,
  regions: BiomeRegion[],
  entrances: { x: number; y: number }[],
): boolean {
  const tcx = Math.floor(x / TILE);
  const tcy = Math.floor(y / TILE);
  for (let ty = tcy - 2; ty <= tcy + 2; ty++) {
    for (let tx = tcx - 2; tx <= tcx + 2; tx++) {
      const obj = objectAt(tx, ty, regions);
      if (!obj || !obj.solid) continue;
      if (nearAnyEntrance(obj.x, obj.y, entrances)) continue;
      if (onRoad(obj.x, obj.y)) continue;
      const dx = obj.x - x;
      const dy = obj.y - y;
      const rr = r + obj.solidR;
      if (dx * dx + dy * dy < rr * rr) return true;
    }
  }
  // Biome landmarks are solid at their trunk/base so the player can't walk through them.
  for (const lm of collectLandmarks(regions, entrances)) {
    const dx = lm.x - x;
    const dy = lm.y - y;
    const rr = r + lm.solidR;
    if (dx * dx + dy * dy < rr * rr) return true;
  }
  return false;
}

/** Axis-separated movement against solid objects, clamped to the world limit. */
export function resolveMove(
  curX: number,
  curY: number,
  dx: number,
  dy: number,
  regions: BiomeRegion[],
  entrances: { x: number; y: number }[],
  lim: number,
): { x: number; y: number } {
  const clamp = (v: number) => (v < -lim ? -lim : v > lim ? lim : v);
  let nx = clamp(curX + dx);
  if (collidesCircle(nx, curY, PLAYER_RADIUS, regions, entrances)) nx = curX;
  let ny = clamp(curY + dy);
  if (collidesCircle(nx, ny, PLAYER_RADIUS, regions, entrances)) ny = curY;
  return { x: nx, y: ny };
}
