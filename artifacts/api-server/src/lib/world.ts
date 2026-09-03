// ---------------------------------------------------------------------------
// Unbounded overworld geometry.
//
// The overworld is no longer a fixed canvas: it is a sprawling, streaming plane
// centered on the origin (0,0) hub. Each biome owns an angular wedge around the
// hub and its labyrinth land-plots fill that wedge ring-by-ring outward, so the
// world grows without bound as plots are claimed — and stays non-overlapping and
// deterministic. Region descriptors (centroid + radius per biome) drive the
// zoomed-out level-of-detail view on the client.
// ---------------------------------------------------------------------------

import { BIOME_BY_KEY } from "./catalog";

/** World-space size of a streaming chunk (square). */
export const CHUNK_SIZE = 1024;

/** Hard clamp for presence positions — prevents abuse, far beyond any plot. */
export const WORLD_LIMIT = 250_000;

/** Canonical biome arrangement around the hub ring (clockwise from top). */
export const BIOME_ORDER = [
  "verdant_grove",
  "sunlit_ruins",
  "tidecaller",
  "crystal_caverns",
  "emberforge",
  "astral_spire",
] as const;

// Layout tuning (world px).
const INNER_RADIUS = 1100; // clear plaza radius around the hub before the first ring
const RING_STEP = 420; // radial distance between successive plot rings
const PLOT_SPACING = 420; // minimum arc spacing between plots within a ring
const WEDGE_FILL = 0.78; // fraction of a biome's angular wedge actually populated

function hash32(n: number): number {
  let h = (n ^ 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

function biomeIndex(key: string): number {
  const i = BIOME_ORDER.indexOf(key as (typeof BIOME_ORDER)[number]);
  return i === -1 ? 0 : i;
}

/** The angular wedge (center angle + usable width) a biome occupies. */
function wedge(biomeKey: string): { center: number; width: number } {
  const n = BIOME_ORDER.length;
  const i = biomeIndex(biomeKey);
  const full = (Math.PI * 2) / n;
  const center = -Math.PI / 2 + i * full; // start at the top, go clockwise
  return { center, width: full * WEDGE_FILL };
}

/** How many plots a ring at the given radius can hold across a wedge. */
function ringCapacity(radius: number, width: number): number {
  return Math.max(1, Math.floor((radius * width) / PLOT_SPACING));
}

/** Number of rings needed to seat `count` plots in a biome wedge. */
function ringsForCount(biomeKey: string, count: number): number {
  if (count <= 0) return 1;
  const { width } = wedge(biomeKey);
  let remaining = count;
  let ring = 0;
  while (remaining > 0) {
    const radius = INNER_RADIUS + ring * RING_STEP;
    remaining -= ringCapacity(radius, width);
    ring += 1;
  }
  return ring;
}

/**
 * Deterministic world position for the `indexInBiome`-th (0-based) plot of a
 * biome. Fills ring by ring outward; within a ring, plots spread evenly across
 * the wedge with a small deterministic radial jitter so the arc doesn't read as
 * a perfect circle. Stable for a given (biome, index) forever.
 */
export function plotPosition(biomeKey: string, indexInBiome: number): { x: number; y: number } {
  const { center, width } = wedge(biomeKey);
  let k = Math.max(0, Math.floor(indexInBiome));
  let ring = 0;
  // Iterate outward until the index falls within a ring's capacity.
  // Bounded in practice; guard against pathological inputs anyway.
  for (let guard = 0; guard < 100000; guard++) {
    const radius = INNER_RADIUS + ring * RING_STEP;
    const cap = ringCapacity(radius, width);
    if (k < cap) {
      const t = cap === 1 ? 0.5 : k / (cap - 1); // 0..1 across the wedge
      const ang = center + (t - 0.5) * width;
      const jitter = ((hash32(biomeIndex(biomeKey) * 99991 + indexInBiome * 6271) % 1000) / 1000 - 0.5) * RING_STEP * 0.28;
      const r = radius + jitter;
      return { x: Math.round(Math.cos(ang) * r), y: Math.round(Math.sin(ang) * r) };
    }
    k -= cap;
    ring += 1;
  }
  // Fallback (unreachable): drop on the inner ring center.
  return { x: Math.round(Math.cos(center) * INNER_RADIUS), y: Math.round(Math.sin(center) * INNER_RADIUS) };
}

/** A symbolic biome region for the zoomed-out level-of-detail view. */
export interface BiomeRegion {
  key: string;
  name: string;
  accent: string;
  /** Region centroid in world coordinates. */
  cx: number;
  cy: number;
  /** Radius of the painted/symbolic biome blob. */
  radius: number;
  count: number;
}

/**
 * Compute one symbolic region per biome from the live plot counts. The centroid
 * sits partway out along the wedge's center; the radius grows with how many
 * rings the biome's plots span so a busy biome reads as a bigger territory.
 */
export function biomeRegions(countByBiome: Record<string, number>): BiomeRegion[] {
  return (BIOME_ORDER as readonly string[]).map((key) => {
    const def = BIOME_BY_KEY[key];
    const count = countByBiome[key] ?? 0;
    const { center } = wedge(key);
    const rings = ringsForCount(key, count);
    // Push each biome's centroid well out along its wedge so the six territories
    // sit apart, then cap the blob radius below half the centroid distance
    // (adjacent centroids are `midR` apart) so they never merge into one blob.
    const ringsEff = Math.max(1, rings);
    const midR = INNER_RADIUS + 520 + ringsEff * RING_STEP * 0.6;
    const cx = Math.round(Math.cos(center) * midR);
    const cy = Math.round(Math.sin(center) * midR);
    const radius = Math.round(Math.min(midR * 0.46, 760 + ringsEff * RING_STEP * 0.5));
    return {
      key,
      name: def?.name ?? key,
      accent: def?.accentColor ?? "#f5b942",
      cx,
      cy,
      radius,
      count,
    };
  });
}

/** Chunk key for a world position, e.g. "-2,3". */
export function chunkKey(x: number, y: number): string {
  return `${Math.floor(x / CHUNK_SIZE)},${Math.floor(y / CHUNK_SIZE)}`;
}

/** Clamp a presence coordinate to the sane world limit. */
export function clampWorld(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(-WORLD_LIMIT, Math.min(WORLD_LIMIT, v));
}
