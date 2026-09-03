import {
  pgTable,
  serial,
  text,
  integer,
  boolean,
  timestamp,
  jsonb,
} from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import {
  labyrinthsTable,
  type ChamberSpawnData,
  type ChamberObstacleData,
  type ChamberTileGrid,
} from "./labyrinths";

export interface ChamberLayoutData {
  id: number;
  name: string;
  biome: string;
  width: number;
  height: number;
  accentColor: string;
  backgroundStyle?: string;
  spawns: ChamberSpawnData[];
  obstacles: ChamberObstacleData[];
  // Handcrafted-room extensions (optional; absent for legacy rectangle rooms).
  tiles?: ChamberTileGrid;
  hazardZones?: ChamberObstacleData[];
  doors?: ChamberObstacleData[];
  role?: string;
  sizeClass?: string;
}

export const runsTable = pgTable("runs", {
  id: serial("id").primaryKey(),
  labyrinthId: integer("labyrinth_id")
    .notNull()
    .references(() => labyrinthsTable.id),
  visitorUserId: integer("visitor_user_id")
    .notNull()
    .references(() => usersTable.id),
  ownerUserId: integer("owner_user_id")
    .notNull()
    .references(() => usersTable.id),
  status: text("status").notNull().default("in_progress"),
  isOwnerRun: boolean("is_owner_run").notNull().default(false),
  // Co-op linkage: members of the same party share a coopPartyId and partySize.
  // Solo runs leave coopPartyId null and partySize 1.
  coopPartyId: text("coop_party_id"),
  partySize: integer("party_size").notNull().default(1),
  isPaid: boolean("is_paid").notNull().default(false),
  entryFee: integer("entry_fee").notNull().default(0),
  ownerEntryShare: integer("owner_entry_share").notNull().default(0),
  treasuryEntryShare: integer("treasury_entry_share").notNull().default(0),
  cleared: boolean("cleared").notNull().default(false),
  enemiesDefeated: integer("enemies_defeated").notNull().default(0),
  nodesHarvested: integer("nodes_harvested").notNull().default(0),
  chestsOpened: integer("chests_opened").notNull().default(0),
  bossDefeated: boolean("boss_defeated").notNull().default(false),
  timeSeconds: integer("time_seconds").notNull().default(0),
  damageTaken: integer("damage_taken").notNull().default(0),
  rewardValue: integer("reward_value").notNull().default(0),
  ownerDropShareValue: integer("owner_drop_share_value").notNull().default(0),
  chambers: jsonb("chambers").notNull().$type<ChamberLayoutData[]>(),
  summary: jsonb("summary").$type<unknown>(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
});

export type Run = typeof runsTable.$inferSelect;
