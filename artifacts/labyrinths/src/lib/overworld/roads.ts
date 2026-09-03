// Road network for the overworld.
//
// The six biome roads are the spine of the map: they radiate from the hub along
// the biome wedge angles and run outward without bound. This module is the single
// source of truth for that geometry, so the renderer (which paints cobble) and the
// scatter mask (which keeps scenery off the roads) agree exactly — nothing ever
// spawns on a path. Pure geometry: no canvas, no React.

import { BIOME_ANGLES } from "./town";

/** Half-width of a road's cobbled surface (world px). Matches the renderer. */
export const ROAD_HALF = 84;

/** Roads begin at the square plaza edge, so the town interior isn't cut by a stub. */
export const ROAD_START = 760;

/** Extra terrain margin scenery must keep beyond the road edge. */
const ROAD_KEEPOUT = 30;

/** Precomputed unit direction of each of the six main roads. */
export const ROAD_RAYS: { cos: number; sin: number }[] = BIOME_ANGLES.map((a) => ({
  cos: Math.cos(a),
  sin: Math.sin(a),
}));

/**
 * True if the world point (x,y) lies on (or within `margin` of) any main road.
 * A road is a ray from the hub along a biome angle; a point counts only if it
 * projects past ROAD_START (so we don't clear scenery behind the town).
 */
export function onRoad(x: number, y: number, margin = ROAD_KEEPOUT): boolean {
  const half = ROAD_HALF + margin;
  for (const r of ROAD_RAYS) {
    const along = x * r.cos + y * r.sin; // projection along the road direction
    if (along < ROAD_START) continue;
    const perp = Math.abs(y * r.cos - x * r.sin); // perpendicular distance to the ray
    if (perp < half) return true;
  }
  return false;
}
