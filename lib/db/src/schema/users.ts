import {
  pgTable,
  serial,
  text,
  integer,
  boolean,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const usersTable = pgTable("users", {
  id: serial("id").primaryKey(),
  walletAddress: text("wallet_address").notNull().unique(),
  walletChainId: integer("wallet_chain_id").notNull().default(4663),
  displayName: text("display_name").notNull(),
  avatarUrl: text("avatar_url").notNull(),
  tagline: text("tagline"),
  isPrimary: boolean("is_primary").notNull().default(false),
  isGuest: boolean("is_guest").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type User = typeof usersTable.$inferSelect;

export const playerBalancesTable = pgTable("player_balances", {
  userId: integer("user_id")
    .primaryKey()
    .references(() => usersTable.id),
  gold: integer("gold").notNull().default(0),
  ore: integer("ore").notNull().default(0),
  dust: integer("dust").notNull().default(0),
  keys: integer("keys").notNull().default(0),
  labToken: integer("lab_token").notNull().default(0),
  // Real-money USDC balance, stored as integer cents (1 USDC = 100). Marketplace
  // settlement remains a separate integration and currently uses the custodial ledger.
  usdc: integer("usdc").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export type PlayerBalances = typeof playerBalancesTable.$inferSelect;

export const playerMaterialsTable = pgTable(
  "player_materials",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => usersTable.id),
    materialKey: text("material_key").notNull(),
    amount: integer("amount").notNull().default(0),
  },
  (t) => [uniqueIndex("player_materials_user_key_idx").on(t.userId, t.materialKey)],
);

export type PlayerMaterial = typeof playerMaterialsTable.$inferSelect;

export const authChallengesTable = pgTable("auth_challenges", {
  id: serial("id").primaryKey(),
  walletAddress: text("wallet_address").notNull(),
  chainId: integer("chain_id").notNull().default(4663),
  nonce: text("nonce").notNull(),
  consumed: boolean("consumed").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull().defaultNow(),
});

export type AuthChallenge = typeof authChallengesTable.$inferSelect;

export const authSessionsTable = pgTable("auth_sessions", {
  token: text("token").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => usersTable.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

export type AuthSession = typeof authSessionsTable.$inferSelect;
