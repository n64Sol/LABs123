import { WORLD_W, WORLD_H } from "./types";
import { biome as biomeInfo, BIOMES } from "@/lib/game";

const LPC_CELL = 64;

// LPC walk rows: 8=up, 9=left, 10=down, 11=right (9 frames each).
export function lpcRowFor(dx: number, dy: number): number {
  if (Math.abs(dy) > Math.abs(dx)) return dy < 0 ? 8 : 10;
  return dx >= 0 ? 11 : 9;
}

/**
 * Blit one LPC frame from a (64px cell) sprite sheet, centered at (x, y) on the
 * given context, scaled to `size`. Mirrors the rendering contract used in the
 * in-labyrinth Run renderer so avatars look identical across the game. The
 * source may be a plain base sheet (`HTMLImageElement`) or a composed loadout
 * sprite (`OffscreenCanvas`); both share the same cell layout.
 */
export function drawLpcAvatar(
  ctx: CanvasRenderingContext2D,
  sheet: CanvasImageSource,
  x: number,
  y: number,
  size: number,
  row: number,
  frame: number,
  alpha = 1,
): void {
  const sx = frame * LPC_CELL;
  const sy = row * LPC_CELL;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(sheet, sx, sy, LPC_CELL, LPC_CELL, x - size / 2, y - size, size, size);
  ctx.restore();
}

export interface Entrance {
  id: number;
  name: string;
  level: number;
  biomeKey: string;
  accent: string;
  x: number;
  y: number;
}

/** A biome-themed region of the world that clusters its labyrinth entrances. */
export interface Zone {
  biomeKey: string;
  name: string;
  accent: string;
  /** Center of the zone in world coordinates. */
  cx: number;
  cy: number;
  /** Radius of the painted biome terrain patch. */
  radius: number;
  count: number;
}

/** A dirt road segment connecting two world landmarks. */
export interface Path {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface WorldLayout {
  entrances: Entrance[];
  zones: Zone[];
  paths: Path[];
  /** Central plaza landmark where roads converge. */
  hub: { x: number; y: number };
}

// Canonical biome arrangement order (visual variety around the ring).
const BIOME_ORDER = [
  "verdant_grove",
  "sunlit_ruins",
  "tidecaller",
  "crystal_caverns",
  "emberforge",
  "astral_spire",
];

function biomeRank(key: string): number {
  const i = BIOME_ORDER.indexOf(key);
  return i === -1 ? BIOME_ORDER.length + Object.keys(BIOMES).indexOf(key) : i;
}

function hash32(n: number): number {
  let h = (n ^ 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

/**
 * Build the full overworld layout: labyrinths are grouped into biome-themed
 * zones arranged around a central hub, entrances are sunflower-packed inside
 * their zone, and dirt roads connect the hub to each zone (plus a ring loop).
 * Everything is derived deterministically from labyrinth ids so a given world
 * keeps a consistent, non-overlapping layout across reloads.
 */
export function layoutWorld(
  labs: { id: number; name: string; level: number; biome: string; accentColor?: string | null }[],
): WorldLayout {
  const hub = { x: WORLD_W / 2, y: WORLD_H / 2 };

  // Group labyrinths by biome, preserving a stable id sort within each group.
  const groups = new Map<string, typeof labs>();
  for (const lab of [...labs].sort((a, b) => a.id - b.id)) {
    const key = lab.biome || "verdant_grove";
    const arr = groups.get(key);
    if (arr) arr.push(lab);
    else groups.set(key, [lab]);
  }

  const biomeKeys = [...groups.keys()].sort((a, b) => biomeRank(a) - biomeRank(b));
  const nz = Math.max(1, biomeKeys.length);

  // Place zones around an ellipse centered on the hub (single zone sits at hub).
  const ringX = WORLD_W * 0.3;
  const ringY = WORLD_H * 0.3;

  const zones: Zone[] = [];
  const entrances: Entrance[] = [];

  biomeKeys.forEach((key, zi) => {
    const members = groups.get(key)!;
    const info = biomeInfo(key);
    const count = members.length;

    let cx: number;
    let cy: number;
    if (nz === 1) {
      cx = hub.x;
      cy = hub.y;
    } else {
      const ang = -Math.PI / 2 + (zi * 2 * Math.PI) / nz;
      cx = hub.x + Math.cos(ang) * ringX;
      cy = hub.y + Math.sin(ang) * ringY;
    }

    // Zone radius scales with how many entrances it holds.
    const radius = Math.min(380, 210 + Math.sqrt(count) * 70);
    // Keep zones inside the world bounds.
    cx = Math.max(radius + 40, Math.min(WORLD_W - radius - 40, cx));
    cy = Math.max(radius + 40, Math.min(WORLD_H - radius - 40, cy));

    zones.push({ biomeKey: key, name: info.name, accent: info.accent, cx, cy, radius, count });

    // Sunflower packing distributes entrances evenly inside the zone.
    members.forEach((lab, j) => {
      const h = hash32(lab.id);
      let ex = cx;
      let ey = cy;
      if (count > 1) {
        const t = (j + 0.5) / count;
        const rad = radius * 0.58 * Math.sqrt(t);
        const ang = j * 2.39996323 + (h & 0xff) / 255;
        const jit = radius * 0.08;
        ex = cx + Math.cos(ang) * rad + (((h >> 8) & 0xff) / 255 - 0.5) * jit;
        ey = cy + Math.sin(ang) * rad + (((h >> 16) & 0xff) / 255 - 0.5) * jit;
      }
      const info2 = biomeInfo(lab.biome);
      entrances.push({
        id: lab.id,
        name: lab.name,
        level: lab.level,
        biomeKey: lab.biome,
        accent: lab.accentColor || info2.accent,
        x: ex,
        y: ey,
      });
    });
  });

  // Roads: spokes from the hub to each zone, plus a ring loop between zones.
  const paths: Path[] = [];
  if (nz > 1) {
    for (const z of zones) {
      paths.push({ x1: hub.x, y1: hub.y, x2: z.cx, y2: z.cy });
    }
    for (let i = 0; i < zones.length; i++) {
      const a = zones[i];
      const b = zones[(i + 1) % zones.length];
      if (zones.length > 2) paths.push({ x1: a.cx, y1: a.cy, x2: b.cx, y2: b.cy });
    }
  }

  return { entrances, zones, paths, hub };
}

/**
 * Deterministic decorative scatter (rocks/tufts) so the field looks designed.
 * `bias` is a stable 0..1 value used to decide rock-vs-tuft per the nearest
 * biome zone at draw time (so decor leans biome-appropriate, not uniform).
 */
export function scatterDecor(
  count: number,
): { x: number; y: number; r: number; kind: number; bias: number }[] {
  const out: { x: number; y: number; r: number; kind: number; bias: number }[] = [];
  for (let i = 0; i < count; i++) {
    const h = hash32(i * 2654435761);
    out.push({
      x: (h % 100000) / 100000 * WORLD_W,
      y: ((h >> 7) % 100000) / 100000 * WORLD_H,
      r: 0.5 + ((h >> 3) & 0x7) / 7,
      kind: h & 1,
      bias: ((h >> 11) & 0x3ff) / 0x3ff,
    });
  }
  return out;
}

/** Nearest zone to a world point (by center distance), or null if no zones. */
export function nearestZone(zones: Zone[], x: number, y: number): Zone | null {
  let best: Zone | null = null;
  let bd = Infinity;
  for (const z of zones) {
    const d = Math.hypot(z.cx - x, z.cy - y);
    if (d < bd) {
      bd = d;
      best = z;
    }
  }
  return best;
}

/** A deterministic ambient particle anchor inside a zone. */
export interface ZoneParticle {
  x: number;
  y: number;
  /** Stable per-particle seed for phase/size variation. */
  seed: number;
}

/**
 * Deterministically scatter `count` ambient anchors inside a zone (sunflower
 * packing within `spread` of the radius). Stable across frames/reloads so a
 * region's water pools / embers / stars stay put while only animating.
 */
export function zoneParticles(z: Zone, count: number, spread = 0.78): ZoneParticle[] {
  const base = hash32(Math.round(z.cx) * 73856093 + Math.round(z.cy) * 19349663);
  const out: ZoneParticle[] = [];
  for (let i = 0; i < count; i++) {
    const h = hash32(base + i * 2654435761);
    const t = (i + 0.5) / count;
    const rad = z.radius * spread * Math.sqrt(t);
    const ang = i * 2.39996323 + (h & 0xff) / 255 * Math.PI * 2;
    out.push({
      x: z.cx + Math.cos(ang) * rad,
      y: z.cy + Math.sin(ang) * rad,
      seed: h % 100000,
    });
  }
  return out;
}

/** Per-biome ambient style + how rock-heavy its scattered decor should be. */
export const BIOME_AMBIENT: Record<string, "water" | "ember" | "star" | "pollen" | "dust"> = {
  tidecaller: "water",
  crystal_caverns: "water",
  emberforge: "ember",
  astral_spire: "star",
  verdant_grove: "pollen",
  sunlit_ruins: "dust",
};

/** Probability that a decor item renders as a rock (vs a grass tuft) per biome. */
export const BIOME_ROCK_BIAS: Record<string, number> = {
  verdant_grove: 0.25,
  tidecaller: 0.3,
  sunlit_ruins: 0.72,
  crystal_caverns: 0.78,
  emberforge: 0.82,
  astral_spire: 0.6,
};

/** Stable per-player accent color for nameplates/ground rings. */
export function playerColor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (Math.imul(h, 31) + seed.charCodeAt(i)) >>> 0;
  const hue = h % 360;
  return `hsl(${hue} 70% 60%)`;
}
