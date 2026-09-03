import {
  pgTable,
  serial,
  text,
  integer,
  timestamp,
  jsonb,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const treasuryTable = pgTable("treasury", {
  id: integer("id").primaryKey().default(1),
  labTokenBalance: integer("lab_token_balance").notNull().default(0),
  totalEntryFeesCollected: integer("total_entry_fees_collected").notNull().default(0),
  totalRuns: integer("total_runs").notNull().default(0),
  // Lifetime marketplace fees collected by the house, in USDC cents.
  usdcFeesCollected: integer("usdc_fees_collected").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export type Treasury = typeof treasuryTable.$inferSelect;

// Canonical economy ledger — the source of accounting truth. Every balance or
// pending-earnings mutation writes a record here with a credit/debit direction.
// userId is nullable so non-user entries (e.g. treasury_entry_share_credit) fit.
export const ledgerEntriesTable = pgTable("ledger_entries", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => usersTable.id),
  type: text("type").notNull(),
  direction: text("direction").notNull().default("credit"),
  description: text("description").notNull(),
  reason: text("reason"),
  amount: integer("amount").notNull(),
  currency: text("currency").notNull(),
  labyrinthId: integer("labyrinth_id"),
  runId: integer("run_id"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type LedgerEntry = typeof ledgerEntriesTable.$inferSelect;

// Per-currency pending owner earnings (drop-share + paid-entry share). Owners
// collect these into their wallet via Collect Earnings. Tracked per currency so
// the spec's per-currency floor(value * 0.20) drop-share pays out exactly.
export const ownerEarningsPendingTable = pgTable(
  "owner_earnings_pending",
  {
    id: serial("id").primaryKey(),
    labyrinthId: integer("labyrinth_id").notNull(),
    source: text("source").notNull(),
    currency: text("currency").notNull(),
    amount: integer("amount").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex("owner_earnings_pending_idx").on(t.labyrinthId, t.source, t.currency),
  ],
);

export type OwnerEarningsPending = typeof ownerEarningsPendingTable.$inferSelect;

export const activityLogTable = pgTable("activity_log", {
  id: serial("id").primaryKey(),
  type: text("type").notNull(),
  message: text("message").notNull(),
  actorUserId: integer("actor_user_id").references(() => usersTable.id),
  labyrinthId: integer("labyrinth_id"),
  value: integer("value"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ActivityLog = typeof activityLogTable.$inferSelect;

/**
 * Chain-neutral settlement records. The physical table name is intentionally
 * retained so the first migration preserves existing ledger history; the
 * publish-time schema migration can rename it after the legacy rows are
 * reviewed.
 */
export const chainTransactionsTable = pgTable("solana_transactions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => usersTable.id),
  reference: text("signature").notNull(),
  kind: text("kind").notNull(),
  status: text("status").notNull(),
  amount: integer("amount").notNull(),
  currency: text("currency").notNull(),
  memo: text("memo"),
  network: text("network"),
  chainId: integer("chain_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ChainTransaction = typeof chainTransactionsTable.$inferSelect;

export const idempotencyRecordsTable = pgTable("idempotency_records", {
  key: text("key").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => usersTable.id),
  scope: text("scope").notNull(),
  response: jsonb("response").notNull().$type<unknown>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type IdempotencyRecord = typeof idempotencyRecordsTable.$inferSelect;
