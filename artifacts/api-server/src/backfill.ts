import { db, pool } from "@workspace/db";
import { itemTemplatesTable, labyrinthsTable, labyrinthRoomUnlocksTable } from "@workspace/db";
import { sql } from "drizzle-orm";
import { GENERATED_TEMPLATES } from "./data/generatedCatalog";
import { ROOM_TYPE_CATALOG, SIZE_RANK, roomTypeKey } from "./lib/roomPool";

// Idempotent backfill of the auto-generated LPC equipment catalog into the live
// database. Unlike seed.ts this does NOT truncate any tables, so it never wipes
// player progress. Re-running upserts (insert-or-update) every generated
// template, so regenerating the catalog and re-running stays consistent.
async function main(): Promise<void> {
  console.log(`Backfilling ${GENERATED_TEMPLATES.length} generated item templates...`);
  const CHUNK = 200;
  let upserted = 0;
  for (let i = 0; i < GENERATED_TEMPLATES.length; i += CHUNK) {
    const batch = GENERATED_TEMPLATES.slice(i, i + CHUNK);
    await db
      .insert(itemTemplatesTable)
      .values(batch)
      .onConflictDoUpdate({
        target: itemTemplatesTable.key,
        set: {
          name: sql`excluded.name`,
          description: sql`excluded.description`,
          slot: sql`excluded.slot`,
          category: sql`excluded.category`,
          rarity: sql`excluded.rarity`,
          damageType: sql`excluded.damage_type`,
          baseValue: sql`excluded.base_value`,
          stats: sql`excluded.stats`,
          abilityKey: sql`excluded.ability_key`,
          abilityName: sql`excluded.ability_name`,
          abilityDescription: sql`excluded.ability_description`,
          icon: sql`excluded.icon`,
          spriteLayers: sql`excluded.sprite_layers`,
        },
      });
    upserted += batch.length;
  }
  console.log(`Backfill complete: ${upserted} templates upserted.`);

  // Ensure every existing labyrinth has a room-type pool that matches what its
  // depth/size could already assemble (plus boss if active). Idempotent: existing
  // unlocks are left untouched, so owner purchases are preserved.
  const labs = await db.select().from(labyrinthsTable);
  let labsTouched = 0;
  for (const lab of labs) {
    const maxRank = lab.depth >= 5 ? SIZE_RANK.large : lab.depth >= 3 ? SIZE_RANK.medium : SIZE_RANK.small;
    const roomKeys = ROOM_TYPE_CATALOG.filter(
      (e) => e.role !== "boss" && SIZE_RANK[e.size] <= maxRank,
    ).map((e) => e.key);
    if (lab.bossActive) roomKeys.push(roomTypeKey("boss", "large"));
    if (roomKeys.length > 0) {
      await db
        .insert(labyrinthRoomUnlocksTable)
        .values(roomKeys.map((roomKey) => ({ labyrinthId: lab.id, roomKey })))
        .onConflictDoNothing();
      labsTouched += 1;
    }
  }
  console.log(`Room-pool backfill complete: ${labsTouched} labyrinths ensured.`);

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
