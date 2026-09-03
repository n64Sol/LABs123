import {
  pgTable,
  serial,
  text,
  integer,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { usersTable } from "./users";

// Durable record of a resolved PvP duel. Duel sessions themselves are ephemeral
// (in-memory, swept shortly after both players leave the arena); this table
// persists the only thing worth keeping: who won, who lost, and when. The
// server is the sole authority on the outcome, so each row is written exactly
// once at resolution time and never mutated.
export const duelResultsTable = pgTable(
  "duel_results",
  {
    id: serial("id").primaryKey(),
    // The in-memory duel session id, kept so a resolution can only ever be
    // recorded once (see the unique index below).
    duelSessionId: text("duel_session_id").notNull(),
    winnerUserId: integer("winner_user_id")
      .notNull()
      .references(() => usersTable.id),
    loserUserId: integer("loser_user_id")
      .notNull()
      .references(() => usersTable.id),
    durationMs: integer("duration_ms").notNull().default(0),
    resolvedAt: timestamp("resolved_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("duel_results_session_idx").on(t.duelSessionId),
    index("duel_results_winner_idx").on(t.winnerUserId),
    index("duel_results_loser_idx").on(t.loserUserId),
  ],
);

export type DuelResult = typeof duelResultsTable.$inferSelect;
