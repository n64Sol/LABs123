import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import {
  labyrinthsTable,
  labyrinthUpgradesTable,
  activityLogTable,
  type Labyrinth,
} from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { requireAuth } from "../lib/auth";
import { buildLabyrinthDto } from "../lib/dto";
import { getBalancesDto, ensureBalances, addCurrency } from "../lib/balances";
import { getIdempotentResponse, saveIdempotentResponse } from "../lib/idempotency";
import { writeLedger } from "../lib/ledger";
import {
  UPGRADES,
  UPGRADE_BY_KEY,
  upgradeCostForLevel,
  type UpgradeDef,
} from "../lib/catalog";
import { getUpgradeLevels } from "../lib/game";

const router: IRouter = Router();

function parseId(raw: string | string[] | undefined): number | null {
  const v = Array.isArray(raw) ? raw[0] : raw;
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function buildUpgradeDto(def: UpgradeDef, level: number) {
  return {
    key: def.key,
    name: def.name,
    level,
    maxLevel: def.maxLevel,
    nextCostGold: level < def.maxLevel ? upgradeCostForLevel(def, level) : null,
    effectSummary: def.effectSummary,
    category: def.category,
  };
}

router.get("/upgrades", async (_req: Request, res: Response): Promise<void> => {
  res.json(
    UPGRADES.map((u) => ({
      key: u.key,
      name: u.name,
      description: u.description,
      category: u.category,
      maxLevel: u.maxLevel,
      baseCostGold: u.baseCostGold,
      costScaling: u.costScaling,
      effectSummary: u.effectSummary,
      icon: u.icon,
    })),
  );
});

router.get(
  "/labyrinths/:id/upgrades",
  async (req: Request, res: Response): Promise<void> => {
    const id = parseId(req.params.id);
    if (id == null) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const levels = await getUpgradeLevels(id);
    res.json(UPGRADES.map((u) => buildUpgradeDto(u, levels[u.key] ?? 0)));
  },
);

// Apply an upgrade's structural effect to the labyrinth row (per level gained)
function applyUpgradeEffect(lab: Labyrinth, key: string): Partial<typeof labyrinthsTable.$inferInsert> {
  switch (key) {
    case "expand_chambers":
      return {
        chamberCount: lab.chamberCount + 1,
        depth: lab.depth + 1,
        dailyRunCapacity: lab.dailyRunCapacity + 15,
      };
    case "deepen_vault":
      return { dailyRewardCapacity: lab.dailyRewardCapacity + 2500 };
    case "rare_nodes":
      return { rareNodeCount: lab.rareNodeCount + 1 };
    case "boss_chamber":
      return { bossActive: true };
    case "beacon":
      return { featured: true };
    default:
      return {};
  }
}

router.post(
  "/labyrinths/:id/upgrades",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const id = parseId(req.params.id);
    if (id == null) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const userId = req.user!.id;
    const upgradeKey = String(req.body?.upgradeKey ?? "");
    const idempotencyKey = String(req.body?.idempotencyKey ?? "").trim();
    if (!idempotencyKey) {
      res.status(400).json({ error: "idempotencyKey is required" });
      return;
    }
    const def = UPGRADE_BY_KEY[upgradeKey];
    if (!def) {
      res.status(400).json({ error: "Unknown upgrade" });
      return;
    }
    const cached = await getIdempotentResponse(idempotencyKey, userId, "buy_upgrade");
    if (cached) {
      res.json(cached);
      return;
    }

    const labRows = await db.select().from(labyrinthsTable).where(eq(labyrinthsTable.id, id)).limit(1);
    const lab = labRows[0];
    if (!lab) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    if (lab.ownerUserId !== userId) {
      res.status(403).json({ error: "You do not own this labyrinth" });
      return;
    }

    const currentLevels = await getUpgradeLevels(id);
    const currentLevel = currentLevels[upgradeKey] ?? 0;
    if (currentLevel >= def.maxLevel) {
      res.status(400).json({ error: "Upgrade already at max level" });
      return;
    }
    const cost = upgradeCostForLevel(def, currentLevel);
    const bal = await ensureBalances(userId);
    if (bal.gold < cost) {
      res.status(402).json({ error: `Insufficient gold. Need ${cost}, have ${bal.gold}.` });
      return;
    }

    const result = await db.transaction(async (tx) => {
      await addCurrency(userId, { gold: -cost }, tx);
      await writeLedger(tx, {
        userId,
        type: "upgrade_purchase_debit",
        direction: "debit",
        amount: cost,
        currency: "gold",
        reason: `Upgraded ${lab.name}: ${def.name} (Lv.${currentLevel + 1})`,
        labyrinthId: id,
      });
      const existing = await tx
        .select()
        .from(labyrinthUpgradesTable)
        .where(
          and(
            eq(labyrinthUpgradesTable.labyrinthId, id),
            eq(labyrinthUpgradesTable.upgradeKey, upgradeKey),
          ),
        )
        .limit(1);
      if (existing[0]) {
        await tx
          .update(labyrinthUpgradesTable)
          .set({ level: existing[0].level + 1 })
          .where(eq(labyrinthUpgradesTable.id, existing[0].id));
      } else {
        await tx
          .insert(labyrinthUpgradesTable)
          .values({ labyrinthId: id, upgradeKey, level: 1 });
      }

      const effect = applyUpgradeEffect(lab, upgradeKey);
      const newLevels = await getUpgradeLevels(id, tx);
      const totalLevels = Object.values(newLevels).reduce((a, b) => a + b, 0);
      const newLabLevel = 1 + Math.floor(totalLevels / 2);
      const updated = await tx
        .update(labyrinthsTable)
        .set({ ...effect, level: newLabLevel })
        .where(eq(labyrinthsTable.id, id))
        .returning();

      await tx.insert(activityLogTable).values({
        type: "upgrade",
        message: `${req.user!.displayName} upgraded ${lab.name}: ${def.name} (Lv.${currentLevel + 1})`,
        actorUserId: userId,
        labyrinthId: id,
        value: cost,
      });

      const labyrinth = await buildLabyrinthDto(updated[0]!, userId, tx);
      const balances = await getBalancesDto(userId, tx);
      const upgrade = buildUpgradeDto(def, currentLevel + 1);
      return { labyrinth, balances, upgrade };
    });

    await saveIdempotentResponse(idempotencyKey, userId, "buy_upgrade", result);
    res.json(result);
  },
);

export default router;
