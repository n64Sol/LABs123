import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import {
  treasuryTable,
  labyrinthsTable,
  ledgerEntriesTable,
  activityLogTable,
  usersTable,
  chainTransactionsTable,
} from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { requireAuth, newToken } from "../lib/auth";
import { ROBINHOOD_NETWORK } from "../lib/robinhood";
import { addCurrency, addMaterial, getBalancesDto } from "../lib/balances";
import { ownedLabyrinthId } from "../lib/dto";
import { getIdempotentResponse, saveIdempotentResponse } from "../lib/idempotency";
import { writeLedger } from "../lib/ledger";
import {
  getPendingEarnings,
  clearPendingEarnings,
  isWalletCurrency,
} from "../lib/earnings";
import type { DbLike } from "../lib/db";

const router: IRouter = Router();

export async function ensureTreasury(tx: DbLike = db) {
  const rows = await tx.select().from(treasuryTable).where(eq(treasuryTable.id, 1)).limit(1);
  if (rows[0]) return rows[0];
  const inserted = await tx
    .insert(treasuryTable)
    .values({ id: 1 })
    .onConflictDoNothing()
    .returning();
  if (inserted[0]) return inserted[0];
  const again = await tx.select().from(treasuryTable).where(eq(treasuryTable.id, 1)).limit(1);
  return again[0]!;
}

router.get("/economy/treasury", async (_req: Request, res: Response): Promise<void> => {
  const t = await ensureTreasury();
  res.json({
    labTokenBalance: t.labTokenBalance,
    totalEntryFeesCollected: t.totalEntryFeesCollected,
    totalRuns: t.totalRuns,
    updatedAt: t.updatedAt.toISOString(),
  });
});

async function buildOwnerEarnings(userId: number) {
  const labId = await ownedLabyrinthId(userId);
  if (labId == null) {
    return {
      hasLabyrinth: false,
      pendingDropShareValue: 0,
      pendingEntryShare: 0,
      pendingTotal: 0,
      lifetimeDropShareValue: 0,
      lifetimeEntryShare: 0,
      dropShareToday: 0,
      entryShareToday: 0,
    };
  }
  const rows = await db.select().from(labyrinthsTable).where(eq(labyrinthsTable.id, labId)).limit(1);
  const lab = rows[0]!;
  return {
    hasLabyrinth: true,
    pendingDropShareValue: lab.pendingDropShareValue,
    pendingEntryShare: lab.pendingEntryShare,
    pendingTotal: lab.pendingDropShareValue + lab.pendingEntryShare,
    lifetimeDropShareValue: lab.lifetimeDropShareValue,
    lifetimeEntryShare: lab.lifetimeEntryShare,
    dropShareToday: lab.dropShareToday,
    entryShareToday: lab.entryShareToday,
  };
}

router.get(
  "/economy/owner-earnings",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    res.json(await buildOwnerEarnings(req.user!.id));
  },
);

router.post(
  "/economy/collect",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const userId = req.user!.id;
    const idempotencyKey = String(req.body?.idempotencyKey ?? "").trim();
    if (!idempotencyKey) {
      res.status(400).json({ error: "idempotencyKey is required" });
      return;
    }
    const cached = await getIdempotentResponse(idempotencyKey, userId, "collect");
    if (cached) {
      res.json(cached);
      return;
    }

    const labId = await ownedLabyrinthId(userId);
    if (labId == null) {
      res.status(400).json({ error: "You do not own a labyrinth" });
      return;
    }

    const result = await db.transaction(async (tx) => {
      const rows = await tx
        .select()
        .from(labyrinthsTable)
        .where(eq(labyrinthsTable.id, labId))
        .limit(1);
      const lab = rows[0]!;
      // Pay out the per-currency pending earnings table — the authoritative
      // source of what the owner actually collects. The lab.pending* value
      // fields are display aggregates and are zeroed alongside.
      const pending = await getPendingEarnings(labId, tx);
      let collectedLabToken = 0;
      for (const row of pending) {
        if (row.amount <= 0) continue;
        if (isWalletCurrency(row.currency)) {
          await addCurrency(userId, { [row.currency]: row.amount }, tx);
          if (row.currency === "labToken") collectedLabToken += row.amount;
        } else {
          await addMaterial(userId, row.currency, row.amount, tx);
        }
        await writeLedger(tx, {
          userId,
          type: "owner_earnings_collected",
          direction: "credit",
          amount: row.amount,
          currency: row.currency,
          reason: `Collected owner earnings (${row.source}) from ${lab.name}`,
          labyrinthId: labId,
        });
      }
      const hadPending =
        pending.length > 0 ||
        lab.pendingDropShareValue > 0 ||
        lab.pendingEntryShare > 0;
      if (hadPending) {
        await clearPendingEarnings(tx, labId);
        await tx
          .update(labyrinthsTable)
          .set({ pendingDropShareValue: 0, pendingEntryShare: 0 })
          .where(eq(labyrinthsTable.id, labId));
        await tx.insert(activityLogTable).values({
          type: "collect",
          message: `${req.user!.displayName} collected owner earnings from ${lab.name}`,
          actorUserId: userId,
          labyrinthId: labId,
          value: collectedLabToken,
        });
        if (collectedLabToken > 0) {
          await tx.insert(chainTransactionsTable).values({
            userId,
            reference: newToken("ledger_"),
            kind: "collect_earnings",
            status: "confirmed",
            amount: collectedLabToken,
            currency: "LAB",
            memo: "Owner earnings withdrawal",
            network: ROBINHOOD_NETWORK.name,
            chainId: ROBINHOOD_NETWORK.chainId,
          });
        }
      }
      const balances = await getBalancesDto(userId, tx);
      return { collectedLabToken, balances };
    });

    const earnings = await buildOwnerEarnings(userId);
    const response = { ...result, earnings };
    await saveIdempotentResponse(idempotencyKey, userId, "collect", response);
    res.json(response);
  },
);

router.get("/economy/ledger", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const rows = await db
    .select()
    .from(ledgerEntriesTable)
    .where(eq(ledgerEntriesTable.userId, req.user!.id))
    .orderBy(desc(ledgerEntriesTable.createdAt))
    .limit(100);
  res.json(
    rows.map((r) => ({
      id: r.id,
      type: r.type,
      description: r.description,
      amount: r.amount,
      currency: r.currency,
      createdAt: r.createdAt.toISOString(),
    })),
  );
});

async function activityFeed(userId: number | null) {
  const base = db
    .select({
      id: activityLogTable.id,
      type: activityLogTable.type,
      message: activityLogTable.message,
      value: activityLogTable.value,
      labyrinthId: activityLogTable.labyrinthId,
      createdAt: activityLogTable.createdAt,
      actorName: usersTable.displayName,
      actorAvatarUrl: usersTable.avatarUrl,
      labyrinthName: labyrinthsTable.name,
    })
    .from(activityLogTable)
    .leftJoin(usersTable, eq(activityLogTable.actorUserId, usersTable.id))
    .leftJoin(labyrinthsTable, eq(activityLogTable.labyrinthId, labyrinthsTable.id))
    .orderBy(desc(activityLogTable.createdAt))
    .limit(40);
  const rows =
    userId == null ? await base : await base.where(eq(activityLogTable.actorUserId, userId));
  return rows.map((r) => ({
    id: r.id,
    type: r.type,
    message: r.message,
    actorName: r.actorName ?? "The World",
    actorAvatarUrl: r.actorAvatarUrl ?? "",
    labyrinthId: r.labyrinthId,
    labyrinthName: r.labyrinthName,
    value: r.value,
    createdAt: r.createdAt.toISOString(),
  }));
}

router.get("/activity", async (_req: Request, res: Response): Promise<void> => {
  res.json(await activityFeed(null));
});

router.get("/activity/mine", requireAuth, async (req: Request, res: Response): Promise<void> => {
  res.json(await activityFeed(req.user!.id));
});

export default router;
