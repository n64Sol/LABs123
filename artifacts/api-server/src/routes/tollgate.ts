import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { labyrinthsTable, activityLogTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth } from "../lib/auth";
import { buildLabyrinthDto } from "../lib/dto";
import { getBalancesDto, ensureBalances, addCurrency } from "../lib/balances";
import { getIdempotentResponse, saveIdempotentResponse } from "../lib/idempotency";
import { writeLedger } from "../lib/ledger";
import {
  computeAppealScore,
  getLabRatingStats,
  getUpgradeLevels,
  suggestedFeeRange,
} from "../lib/game";

const router: IRouter = Router();

const TOLL_GATE_UNLOCK_COST_GOLD = 800;

function parseId(raw: string | string[] | undefined): number | null {
  const v = Array.isArray(raw) ? raw[0] : raw;
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}

router.get(
  "/labyrinths/:id/toll-gate/suggested-fee",
  async (req: Request, res: Response): Promise<void> => {
    const id = parseId(req.params.id);
    if (id == null) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const rows = await db.select().from(labyrinthsTable).where(eq(labyrinthsTable.id, id)).limit(1);
    const lab = rows[0];
    if (!lab) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const { ratingAverage, ratingCount } = await getLabRatingStats(id);
    const upgradeLevels = await getUpgradeLevels(id);
    const appealScore = computeAppealScore(lab, ratingAverage, ratingCount, upgradeLevels);
    const { suggestedMin, suggestedMax } = suggestedFeeRange(appealScore);
    let warning: string | null = null;
    if (lab.entryFee > suggestedMax) {
      warning = "Your fee is above the recommended range — adventurers may skip your labyrinth.";
    } else if (lab.tollGateUnlocked && lab.entryFee === 0) {
      warning = "Toll Gate is unlocked but the fee is 0. Set a fee to start earning entry tolls.";
    }
    res.json({
      appealScore,
      suggestedMin,
      suggestedMax,
      currentFee: lab.entryFee,
      tollGateUnlocked: lab.tollGateUnlocked,
      warning,
      rationale: `Based on an appeal score of ${appealScore} (depth, rare nodes, upgrades, ratings${lab.bossActive ? ", and a guardian boss" : ""}), most adventurers will pay between ${suggestedMin} and ${suggestedMax} $LAB.`,
    });
  },
);

router.post(
  "/labyrinths/:id/toll-gate/unlock",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const id = parseId(req.params.id);
    if (id == null) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const userId = req.user!.id;
    const idempotencyKey = String(req.body?.idempotencyKey ?? "").trim();
    if (!idempotencyKey) {
      res.status(400).json({ error: "idempotencyKey is required" });
      return;
    }
    const cached = await getIdempotentResponse(idempotencyKey, userId, "unlock_toll_gate");
    if (cached) {
      res.json(cached);
      return;
    }
    const rows = await db.select().from(labyrinthsTable).where(eq(labyrinthsTable.id, id)).limit(1);
    const lab = rows[0];
    if (!lab) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    if (lab.ownerUserId !== userId) {
      res.status(403).json({ error: "You do not own this labyrinth" });
      return;
    }
    if (lab.tollGateUnlocked) {
      const labyrinth = await buildLabyrinthDto(lab, userId);
      const balances = await getBalancesDto(userId);
      const response = { labyrinth, balances };
      res.json(response);
      return;
    }
    const bal = await ensureBalances(userId);
    if (bal.gold < TOLL_GATE_UNLOCK_COST_GOLD) {
      res.status(402).json({
        error: `Insufficient gold. Unlocking the Toll Gate costs ${TOLL_GATE_UNLOCK_COST_GOLD} gold.`,
      });
      return;
    }
    const result = await db.transaction(async (tx) => {
      await addCurrency(userId, { gold: -TOLL_GATE_UNLOCK_COST_GOLD }, tx);
      await writeLedger(tx, {
        userId,
        type: "toll_gate_unlock_debit",
        direction: "debit",
        amount: TOLL_GATE_UNLOCK_COST_GOLD,
        currency: "gold",
        reason: `Unlocked the Toll Gate on ${lab.name}`,
        labyrinthId: id,
      });
      const updated = await tx
        .update(labyrinthsTable)
        .set({ tollGateUnlocked: true })
        .where(eq(labyrinthsTable.id, id))
        .returning();
      await tx.insert(activityLogTable).values({
        type: "toll_gate",
        message: `${req.user!.displayName} unlocked the Toll Gate on ${lab.name}`,
        actorUserId: userId,
        labyrinthId: id,
        value: TOLL_GATE_UNLOCK_COST_GOLD,
      });
      const labyrinth = await buildLabyrinthDto(updated[0]!, userId, tx);
      const balances = await getBalancesDto(userId, tx);
      return { labyrinth, balances };
    });
    await saveIdempotentResponse(idempotencyKey, userId, "unlock_toll_gate", result);
    res.json(result);
  },
);

router.patch(
  "/labyrinths/:id/toll-gate/fee",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const id = parseId(req.params.id);
    if (id == null) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const userId = req.user!.id;
    const entryFee = Number(req.body?.entryFee);
    if (!Number.isInteger(entryFee) || entryFee < 0) {
      res.status(400).json({ error: "entryFee must be a non-negative integer" });
      return;
    }
    const rows = await db.select().from(labyrinthsTable).where(eq(labyrinthsTable.id, id)).limit(1);
    const lab = rows[0];
    if (!lab) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    if (lab.ownerUserId !== userId) {
      res.status(403).json({ error: "You do not own this labyrinth" });
      return;
    }
    if (!lab.tollGateUnlocked) {
      res.status(400).json({ error: "Unlock the Toll Gate before setting a fee" });
      return;
    }
    const updated = await db
      .update(labyrinthsTable)
      .set({ entryFee })
      .where(eq(labyrinthsTable.id, id))
      .returning();
    res.json(await buildLabyrinthDto(updated[0]!, userId));
  },
);

export default router;
