import { db } from "@workspace/db";
import { duelResultsTable, usersTable, type DuelResult } from "@workspace/db";
import { and, desc, eq, or, sql } from "drizzle-orm";

// ---------------------------------------------------------------------------
// Durable PvP duel record. A duel session is ephemeral, but its OUTCOME is
// persisted here the instant it resolves so wins/losses accumulate into a real
// record players can see and take pride in. Writes are idempotent on the duel
// session id, so a retried accept never double-counts a single fight.
// ---------------------------------------------------------------------------

/** Persist a resolved duel outcome. Idempotent on the duel session id. */
export async function recordDuelResult(input: {
  duelSessionId: string;
  winnerUserId: number;
  loserUserId: number;
  durationMs: number;
}): Promise<void> {
  await db
    .insert(duelResultsTable)
    .values({
      duelSessionId: input.duelSessionId,
      winnerUserId: input.winnerUserId,
      loserUserId: input.loserUserId,
      durationMs: input.durationMs,
    })
    .onConflictDoNothing({ target: duelResultsTable.duelSessionId });
}

export interface RecentDuel {
  id: number;
  outcome: "win" | "loss";
  opponentUserId: number;
  opponentName: string;
  opponentAvatarUrl: string;
  durationMs: number;
  resolvedAt: string;
}

export interface DuelRecordDto {
  wins: number;
  losses: number;
  total: number;
  /** Win rate as a 0–100 percentage, rounded; 0 when no duels yet. */
  winRate: number;
  recent: RecentDuel[];
}

/**
 * The caller's lifetime win/loss tally plus a short list of their most recent
 * duels (with the opponent's identity for display).
 */
export async function buildDuelRecordDto(
  userId: number,
  recentLimit = 8,
): Promise<DuelRecordDto> {
  const [tally] = await db
    .select({
      wins: sql<number>`count(*) filter (where ${duelResultsTable.winnerUserId} = ${userId})`,
      losses: sql<number>`count(*) filter (where ${duelResultsTable.loserUserId} = ${userId})`,
    })
    .from(duelResultsTable)
    .where(
      or(
        eq(duelResultsTable.winnerUserId, userId),
        eq(duelResultsTable.loserUserId, userId),
      ),
    );

  const wins = Number(tally?.wins ?? 0);
  const losses = Number(tally?.losses ?? 0);
  const total = wins + losses;
  const winRate = total > 0 ? Math.round((wins / total) * 100) : 0;

  const rows = await db
    .select({
      result: duelResultsTable,
      opponent: usersTable,
    })
    .from(duelResultsTable)
    .innerJoin(
      usersTable,
      // Join the OTHER participant: if the viewer won, the opponent is the
      // loser, and vice versa.
      or(
        and(
          eq(duelResultsTable.winnerUserId, userId),
          eq(usersTable.id, duelResultsTable.loserUserId),
        ),
        and(
          eq(duelResultsTable.loserUserId, userId),
          eq(usersTable.id, duelResultsTable.winnerUserId),
        ),
      ),
    )
    .orderBy(desc(duelResultsTable.resolvedAt))
    .limit(recentLimit);

  const recent: RecentDuel[] = rows.map(({ result, opponent }) => ({
    id: result.id,
    outcome: result.winnerUserId === userId ? "win" : "loss",
    opponentUserId: opponent.id,
    opponentName: opponent.displayName,
    opponentAvatarUrl: opponent.avatarUrl,
    durationMs: result.durationMs,
    resolvedAt: (result.resolvedAt as Date).toISOString(),
  }));

  return { wins, losses, total, winRate, recent };
}

export type { DuelResult };
