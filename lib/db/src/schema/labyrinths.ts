import {
  pgTable,
  serial,
  text,
  integer,
  boolean,
  timestamp,
  jsonb,
  uniqueIndex,
  date,
} from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const labyrinthsTable = pgTable("labyrinths", {
  id: serial("id").primaryKey(),
  ownerUserId: integer("owner_user_id")
    .notNull()
    .references(() => usersTable.id),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  biome: text("biome").notNull().default("sunlit_ruins"),
  accentColor: text("accent_color").notNull().default("#f5b942"),
  level: integer("level").notNull().default(1),
  depth: integer("depth").notNull().default(1),
  chamberCount: integer("chamber_count").notNull().default(1),
  rareNodeCount: integer("rare_node_count").notNull().default(0),
  // Persistent land-plot anchor in the unbounded overworld. Null until assigned
  // (lazily on first world read or at claim time). See api-server lib/world.ts.
  plotX: integer("plot_x"),
  plotY: integer("plot_y"),
  published: boolean("published").notNull().default(false),
  featured: boolean("featured").notNull().default(false),
  tollGateUnlocked: boolean("toll_gate_unlocked").notNull().default(false),
  entryFee: integer("entry_fee").notNull().default(0),
  bossActive: boolean("boss_active").notNull().default(false),
  runsAllTime: integer("runs_all_time").notNull().default(0),
  runsToday: integer("runs_today").notNull().default(0),
  rewardValueToday: integer("reward_value_today").notNull().default(0),
  rewardValueAllTime: integer("reward_value_all_time").notNull().default(0),
  dailyRunCapacity: integer("daily_run_capacity").notNull().default(50),
  dailyRewardCapacity: integer("daily_reward_capacity").notNull().default(5000),
  lastResetDate: date("last_reset_date", { mode: "string" }),
  pendingDropShareValue: integer("pending_drop_share_value").notNull().default(0),
  pendingEntryShare: integer("pending_entry_share").notNull().default(0),
  lifetimeDropShareValue: integer("lifetime_drop_share_value").notNull().default(0),
  lifetimeEntryShare: integer("lifetime_entry_share").notNull().default(0),
  dropShareToday: integer("drop_share_today").notNull().default(0),
  entryShareToday: integer("entry_share_today").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export type Labyrinth = typeof labyrinthsTable.$inferSelect;

export const labyrinthUpgradesTable = pgTable(
  "labyrinth_upgrades",
  {
    id: serial("id").primaryKey(),
    labyrinthId: integer("labyrinth_id")
      .notNull()
      .references(() => labyrinthsTable.id),
    upgradeKey: text("upgrade_key").notNull(),
    level: integer("level").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("labyrinth_upgrades_lab_key_idx").on(t.labyrinthId, t.upgradeKey),
  ],
);

export type LabyrinthUpgrade = typeof labyrinthUpgradesTable.$inferSelect;

// Which room types (role × size class) an owner has unlocked for their labyrinth.
// The run assembler only draws from a labyrinth's unlocked pool. `roomKey` is the
// stable "role:size" identifier (e.g. "combat:large"). A starter set is unlocked
// by default so a brand-new labyrinth is always playable.
export const labyrinthRoomUnlocksTable = pgTable(
  "labyrinth_room_unlocks",
  {
    id: serial("id").primaryKey(),
    labyrinthId: integer("labyrinth_id")
      .notNull()
      .references(() => labyrinthsTable.id),
    roomKey: text("room_key").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("labyrinth_room_unlocks_lab_key_idx").on(t.labyrinthId, t.roomKey),
  ],
);

export type LabyrinthRoomUnlock = typeof labyrinthRoomUnlocksTable.$inferSelect;

export const ratingsTable = pgTable(
  "ratings",
  {
    id: serial("id").primaryKey(),
    labyrinthId: integer("labyrinth_id")
      .notNull()
      .references(() => labyrinthsTable.id),
    runId: integer("run_id").notNull(),
    raterUserId: integer("rater_user_id")
      .notNull()
      .references(() => usersTable.id),
    stars: integer("stars").notNull(),
    comment: text("comment"),
    difficultyVote: text("difficulty_vote"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  // One rating per completed run (enforced at the DB level).
  (t) => [uniqueIndex("ratings_run_id_idx").on(t.runId)],
);

export type Rating = typeof ratingsTable.$inferSelect;

export interface ChamberSpawnData {
  id: string;
  type:
    | "player_start"
    | "enemy"
    | "elite"
    | "boss"
    | "node"
    | "chest"
    | "portal"
    | "hazard";
  x: number;
  y: number;
  variant?: string;
  hp?: number;
  damage?: number;
  speed?: number;
  lootTier?: number;
  label?: string;
}

export interface ChamberObstacleData {
  x: number;
  y: number;
  width: number;
  height: number;
  kind?: string;
}

// Compact tile grid for handcrafted rooms. `data` is a row-major string of one
// char per cell using the room tile alphabet:
//   "." floor, "#" wall, "^" hazard floor, "~" water, "o" pit, "+" door, "," decor
// Additive: chambers without a tile grid fall back to rectangle obstacles.
export interface ChamberTileGrid {
  cols: number;
  rows: number;
  cell: number;
  data: string;
}

export const chamberTemplatesTable = pgTable("chamber_templates", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  biome: text("biome").notNull(),
  accentColor: text("accent_color").notNull().default("#f5b942"),
  backgroundStyle: text("background_style"),
  width: integer("width").notNull(),
  height: integer("height").notNull(),
  difficulty: integer("difficulty").notNull().default(1),
  lootTier: integer("loot_tier").notNull().default(1),
  hasBoss: boolean("has_boss").notNull().default(false),
  spawns: jsonb("spawns").notNull().$type<ChamberSpawnData[]>(),
  obstacles: jsonb("obstacles").notNull().$type<ChamberObstacleData[]>(),
  // Handcrafted-room metadata (nullable for legacy templates).
  tiles: jsonb("tiles").$type<ChamberTileGrid>(),
  hazardZones: jsonb("hazard_zones").$type<ChamberObstacleData[]>(),
  doors: jsonb("doors").$type<ChamberObstacleData[]>(),
  role: text("role"),
  sizeClass: text("size_class"),
});

export type ChamberTemplate = typeof chamberTemplatesTable.$inferSelect;
