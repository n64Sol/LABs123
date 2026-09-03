import {
  pgTable,
  serial,
  text,
  integer,
  boolean,
  timestamp,
  jsonb,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { usersTable } from "./users";

export interface ItemStatsData {
  attack?: number;
  defense?: number;
  health?: number;
  moveSpeed?: number;
  attackSpeed?: number;
  range?: number;
  critChance?: number;
  lootBonus?: number;
  cooldownReduction?: number;
}

export interface MaterialCost {
  key: string;
  name: string;
  amount: number;
  icon?: string;
}

export const itemTemplatesTable = pgTable("item_templates", {
  key: text("key").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull(),
  slot: text("slot").notNull(),
  category: text("category").notNull(),
  rarity: text("rarity").notNull(),
  damageType: text("damage_type").notNull().default("physical"),
  baseValue: integer("base_value").notNull(),
  stats: jsonb("stats").notNull().$type<ItemStatsData>(),
  abilityKey: text("ability_key"),
  abilityName: text("ability_name"),
  abilityDescription: text("ability_description"),
  icon: text("icon"),
  spriteLayers: jsonb("sprite_layers").$type<Record<string, string>>(),
});

export type ItemTemplate = typeof itemTemplatesTable.$inferSelect;

export const playerItemsTable = pgTable("player_items", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => usersTable.id),
  templateKey: text("template_key")
    .notNull()
    .references(() => itemTemplatesTable.key),
  level: integer("level").notNull().default(1),
  acquiredAt: timestamp("acquired_at", { withTimezone: true }).notNull().defaultNow(),
});

export type PlayerItem = typeof playerItemsTable.$inferSelect;

export const playerLoadoutsTable = pgTable(
  "player_loadouts",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => usersTable.id),
    slotKey: text("slot_key").notNull(),
    playerItemId: integer("player_item_id").references(() => playerItemsTable.id),
  },
  (t) => [uniqueIndex("player_loadouts_user_slot_idx").on(t.userId, t.slotKey)],
);

export type PlayerLoadout = typeof playerLoadoutsTable.$inferSelect;

export const craftingRecipesTable = pgTable("crafting_recipes", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull(),
  resultTemplateKey: text("result_template_key")
    .notNull()
    .references(() => itemTemplatesTable.key),
  costGold: integer("cost_gold").notNull().default(0),
  costMaterials: jsonb("cost_materials").notNull().$type<MaterialCost[]>(),
});

export type CraftingRecipe = typeof craftingRecipesTable.$inferSelect;

// Fixed-price USDC marketplace listings. While a listing is `active` the
// referenced player item is escrowed: it cannot be equipped, upgraded, or
// disposed, and only the seller can cancel it. On purchase the item's ownership
// transfers to the buyer and the listing becomes `sold`. Prices and fees are
// integer USDC cents. At most one active listing may reference a given item
// (enforced in the listing transaction).
export const marketplaceListingsTable = pgTable(
  "marketplace_listings",
  {
    id: serial("id").primaryKey(),
    playerItemId: integer("player_item_id")
      .notNull()
      .references(() => playerItemsTable.id),
    sellerUserId: integer("seller_user_id")
      .notNull()
      .references(() => usersTable.id),
    buyerUserId: integer("buyer_user_id").references(() => usersTable.id),
    priceCents: integer("price_cents").notNull(),
    feeCents: integer("fee_cents").notNull().default(0),
    // active | sold | cancelled
    status: text("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    soldAt: timestamp("sold_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  },
  (t) => [
    index("marketplace_listings_status_idx").on(t.status),
    index("marketplace_listings_item_idx").on(t.playerItemId),
    index("marketplace_listings_seller_idx").on(t.sellerUserId),
    // At most one ACTIVE listing may reference a given item. This is the
    // database-level guard against duplicate-listing races; the in-transaction
    // check is a friendly fast-path, this is the hard guarantee. Cancelled/sold
    // listings are excluded so an item can be relisted after a prior listing
    // resolves.
    uniqueIndex("marketplace_listings_one_active_per_item")
      .on(t.playerItemId)
      .where(sql`${t.status} = 'active'`),
  ],
);

export type MarketplaceListing = typeof marketplaceListingsTable.$inferSelect;
