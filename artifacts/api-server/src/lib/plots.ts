// Persistent land-plot assignment for the unbounded overworld.
//
// A labyrinth's plot (plotX/plotY) is its permanent anchor in the world. Plots
// are assigned lazily — the first time a labyrinth is read into the world, or at
// claim time — and then persisted so they never move. Assignment is by stable
// per-biome insertion order (id ascending), which keeps the wedge-ring packing
// in lib/world.ts deterministic and non-overlapping.

import { db } from "@workspace/db";
import { labyrinthsTable, type Labyrinth } from "@workspace/db";
import { asc, eq } from "drizzle-orm";
import { plotPosition } from "./world";
import type { DbLike } from "./db";

export interface PlottedLabyrinth extends Labyrinth {
  plotX: number;
  plotY: number;
}

/**
 * Ensure a single labyrinth has a persistent plot, assigning + saving one if it
 * is missing. The index within the biome is the count of already-plotted
 * labyrinths in that biome, so each new plot lands on the next free slot.
 */
export async function ensurePlot(lab: Labyrinth, tx: DbLike = db): Promise<{ x: number; y: number }> {
  if (lab.plotX != null && lab.plotY != null) {
    return { x: lab.plotX, y: lab.plotY };
  }
  // Next free slot = count of already-plotted labyrinths in the same biome.
  const sameBiome = await tx
    .select({ plotX: labyrinthsTable.plotX })
    .from(labyrinthsTable)
    .where(eq(labyrinthsTable.biome, lab.biome));
  const indexInBiome = sameBiome.filter((r) => r.plotX != null).length;
  const pos = plotPosition(lab.biome, indexInBiome);
  await tx
    .update(labyrinthsTable)
    .set({ plotX: pos.x, plotY: pos.y })
    .where(eq(labyrinthsTable.id, lab.id));
  lab.plotX = pos.x;
  lab.plotY = pos.y;
  return pos;
}

/**
 * Ensure every labyrinth in the world has a plot and return the full list with
 * coordinates resolved. Unplotted labyrinths are assigned in id order within
 * their biome and persisted. This is the source of truth for world reads.
 */
export async function ensureAllPlots(tx: DbLike = db): Promise<PlottedLabyrinth[]> {
  const all = await tx.select().from(labyrinthsTable).orderBy(asc(labyrinthsTable.id));
  // Seed per-biome counters from already-plotted labs.
  const counter: Record<string, number> = {};
  for (const lab of all) {
    if (lab.plotX != null && lab.plotY != null) {
      counter[lab.biome] = (counter[lab.biome] ?? 0) + 1;
    }
  }
  const result: PlottedLabyrinth[] = [];
  for (const lab of all) {
    if (lab.plotX == null || lab.plotY == null) {
      const idx = counter[lab.biome] ?? 0;
      const pos = plotPosition(lab.biome, idx);
      counter[lab.biome] = idx + 1;
      await tx
        .update(labyrinthsTable)
        .set({ plotX: pos.x, plotY: pos.y })
        .where(eq(labyrinthsTable.id, lab.id));
      lab.plotX = pos.x;
      lab.plotY = pos.y;
    }
    result.push(lab as PlottedLabyrinth);
  }
  return result;
}
