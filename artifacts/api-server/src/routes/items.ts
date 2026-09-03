import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import {
  itemTemplatesTable,
  playerItemsTable,
  activityLogTable,
} from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { requireAuth } from "../lib/auth";
import {
  toItemTemplateDto,
  toPlayerItemDto,
  templatesByKeys,
  equippedSlotMap,
} from "../lib/dto";
import {
  getBalancesDto,
  ensureBalances,
  getMaterialMap,
  addCurrency,
  addMaterial,
} from "../lib/balances";
import { getIdempotentResponse, saveIdempotentResponse } from "../lib/idempotency";
import { writeLedger } from "../lib/ledger";
import { MATERIALS, MATERIAL_BY_KEY } from "../lib/catalog";
import { itemValue } from "../lib/game";
import { listedItemIds, activeListingForItem } from "../lib/marketplace";
import type { MaterialCost, ItemTemplate, PlayerItem } from "@workspace/db";

const router: IRouter = Router();

function parseId(raw: string | string[] | undefined): number | null {
  const v = Array.isArray(raw) ? raw[0] : raw;
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}

// Fraction of an item's full value recovered when selling junk gear for gold.
const SELL_RATE = 0.4;

const RARITY_RANK: Record<string, number> = {
  common: 0,
  uncommon: 1,
  rare: 2,
  epic: 3,
  legendary: 4,
};

// Gold recovered from selling a single owned item (floored, minimum 1).
function sellGoldFor(template: ItemTemplate, level: number): number {
  return Math.max(1, Math.floor(itemValue(template.baseValue, level) * SELL_RATE));
}

// Crafting materials recovered from scrapping a single owned item. The primary
// material is chosen deterministically from the template key so a given item
// always scraps into the same material; rarer/higher-level gear yields more,
// and epic+ gear sheds a bonus Prism Shard.
function scrapMaterialsFor(
  template: ItemTemplate,
  level: number,
): { key: string; amount: number }[] {
  const rank = RARITY_RANK[template.rarity] ?? 0;
  const hash = Array.from(template.key).reduce((a, c) => a + c.charCodeAt(0), 0);
  const primary = MATERIALS[hash % MATERIALS.length]!;
  const amount = 1 + rank + Math.floor((level - 1) / 3);
  const out: { key: string; amount: number }[] = [{ key: primary.key, amount }];
  if (rank >= 3 && primary.key !== "prism_shard") {
    out.push({ key: "prism_shard", amount: rank - 2 });
  }
  return out;
}

// Cost to take an owned item from `level` to `level + 1`
function itemUpgradeCost(baseValue: number, level: number): { gold: number; materials: MaterialCost[] } {
  const gold = Math.floor(baseValue * 0.5 * level);
  const primary = MATERIALS[level % MATERIALS.length]!;
  const secondary = MATERIALS[(level + 2) % MATERIALS.length]!;
  const materials: MaterialCost[] = [
    { key: primary.key, name: primary.name, icon: primary.icon, amount: level },
    { key: secondary.key, name: secondary.name, icon: secondary.icon, amount: Math.max(1, Math.floor(level / 2)) },
  ];
  return { gold, materials };
}

router.get("/items/templates", async (_req: Request, res: Response): Promise<void> => {
  const rows = await db.select().from(itemTemplatesTable);
  res.json(rows.map(toItemTemplateDto));
});

router.get("/items/mine", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!.id;
  const items = await db.select().from(playerItemsTable).where(eq(playerItemsTable.userId, userId));
  const templates = await templatesByKeys(items.map((i) => i.templateKey));
  const equipped = await equippedSlotMap(userId);
  const listed = await listedItemIds(userId);
  res.json(
    items
      .filter((i) => templates[i.templateKey])
      .map((i) =>
        toPlayerItemDto(i, templates[i.templateKey]!, equipped[i.id] ?? null, listed.has(i.id)),
      ),
  );
});

router.post("/items/:id/upgrade", requireAuth, async (req: Request, res: Response): Promise<void> => {
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
  const cached = await getIdempotentResponse(idempotencyKey, userId, "upgrade_item");
  if (cached) {
    res.json(cached);
    return;
  }

  const itemRows = await db.select().from(playerItemsTable).where(eq(playerItemsTable.id, id)).limit(1);
  const item = itemRows[0];
  if (!item || item.userId !== userId) {
    res.status(404).json({ error: "Item not found" });
    return;
  }
  // Escrowed (listed) items are locked until the listing is cancelled or sold.
  if (await activeListingForItem(id)) {
    res.status(409).json({ error: "This item is listed on the marketplace. Cancel the listing first." });
    return;
  }
  const tplRows = await db
    .select()
    .from(itemTemplatesTable)
    .where(eq(itemTemplatesTable.key, item.templateKey))
    .limit(1);
  const template = tplRows[0];
  if (!template) {
    res.status(404).json({ error: "Template not found" });
    return;
  }

  const cost = itemUpgradeCost(template.baseValue, item.level);
  const bal = await ensureBalances(userId);
  const mats = await getMaterialMap(userId);
  if (bal.gold < cost.gold) {
    res.status(402).json({ error: `Insufficient gold. Need ${cost.gold}, have ${bal.gold}.` });
    return;
  }
  for (const m of cost.materials) {
    if ((mats[m.key] ?? 0) < m.amount) {
      res.status(402).json({ error: `Insufficient ${MATERIAL_BY_KEY[m.key]?.name ?? m.key}.` });
      return;
    }
  }

  const result = await db.transaction(async (tx) => {
    await addCurrency(userId, { gold: -cost.gold }, tx);
    if (cost.gold > 0) {
      await writeLedger(tx, {
        userId,
        type: "item_upgrade_debit",
        direction: "debit",
        amount: cost.gold,
        currency: "gold",
        reason: `Upgraded ${template.name} to Lv.${item.level + 1}`,
      });
    }
    for (const m of cost.materials) {
      await addMaterial(userId, m.key, -m.amount, tx);
      await writeLedger(tx, {
        userId,
        type: "item_upgrade_debit",
        direction: "debit",
        amount: m.amount,
        currency: m.key,
        reason: `Upgraded ${template.name} (${MATERIAL_BY_KEY[m.key]?.name ?? m.key})`,
      });
    }
    const updated = await tx
      .update(playerItemsTable)
      .set({ level: item.level + 1 })
      .where(eq(playerItemsTable.id, id))
      .returning();
    const equipped = await equippedSlotMap(userId, tx);
    const itemDto = toPlayerItemDto(updated[0]!, template, equipped[id] ?? null);
    const balances = await getBalancesDto(userId, tx);
    return { item: itemDto, balances };
  });

  await saveIdempotentResponse(idempotencyKey, userId, "upgrade_item", result);
  res.json(result);
});

router.post("/items/bulk-dispose", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!.id;
  const mode = String(req.body?.mode ?? "");
  const idempotencyKey = String(req.body?.idempotencyKey ?? "").trim();
  const rawIds = req.body?.playerItemIds;

  if (mode !== "sell" && mode !== "scrap") {
    res.status(400).json({ error: "mode must be 'sell' or 'scrap'" });
    return;
  }
  if (!idempotencyKey) {
    res.status(400).json({ error: "idempotencyKey is required" });
    return;
  }
  if (!Array.isArray(rawIds) || rawIds.length === 0) {
    res.status(400).json({ error: "playerItemIds must be a non-empty array" });
    return;
  }
  const ids = Array.from(
    new Set(
      rawIds
        .map((v) => Number(v))
        .filter((n) => Number.isInteger(n) && n > 0),
    ),
  );
  if (ids.length === 0) {
    res.status(400).json({ error: "playerItemIds must contain valid item ids" });
    return;
  }

  const cached = await getIdempotentResponse(idempotencyKey, userId, "bulk_dispose");
  if (cached) {
    res.json(cached);
    return;
  }

  // Only the caller's own items are eligible, and equipped items are never
  // disposed in bulk (any item referenced by a loadout slot is excluded).
  const owned = await db
    .select()
    .from(playerItemsTable)
    .where(inArray(playerItemsTable.id, ids));
  const mine = owned.filter((i) => i.userId === userId);
  const equipped = await equippedSlotMap(userId);
  const listed = await listedItemIds(userId);
  // Equipped and escrowed (listed) items are never disposed in bulk.
  const eligible: PlayerItem[] = mine.filter(
    (i) => equipped[i.id] == null && !listed.has(i.id),
  );

  if (eligible.length === 0) {
    res.status(400).json({
      error: "No eligible items to dispose (equipped or listed items are excluded).",
    });
    return;
  }

  const templates = await templatesByKeys(eligible.map((i) => i.templateKey));
  const disposable = eligible.filter((i) => templates[i.templateKey]);
  if (disposable.length === 0) {
    res.status(400).json({ error: "No eligible items to dispose." });
    return;
  }

  let goldEarned = 0;
  const materialTotals: Record<string, number> = {};
  for (const item of disposable) {
    const tpl = templates[item.templateKey]!;
    if (mode === "sell") {
      goldEarned += sellGoldFor(tpl, item.level);
    } else {
      for (const m of scrapMaterialsFor(tpl, item.level)) {
        materialTotals[m.key] = (materialTotals[m.key] ?? 0) + m.amount;
      }
    }
  }

  const removedIds = disposable.map((i) => i.id);
  const disposedCount = disposable.length;

  const result = await db.transaction(async (tx) => {
    await tx.delete(playerItemsTable).where(inArray(playerItemsTable.id, removedIds));

    if (mode === "sell" && goldEarned > 0) {
      await addCurrency(userId, { gold: goldEarned }, tx);
      await writeLedger(tx, {
        userId,
        type: "bulk_sell_credit",
        direction: "credit",
        amount: goldEarned,
        currency: "gold",
        reason: `Sold ${disposedCount} item${disposedCount === 1 ? "" : "s"}`,
        metadata: { disposedCount },
      });
    }
    if (mode === "scrap") {
      for (const [key, amount] of Object.entries(materialTotals)) {
        if (amount <= 0) continue;
        await addMaterial(userId, key, amount, tx);
        await writeLedger(tx, {
          userId,
          type: "bulk_scrap_credit",
          direction: "credit",
          amount,
          currency: key,
          reason: `Scrapped ${disposedCount} item${disposedCount === 1 ? "" : "s"} (${MATERIAL_BY_KEY[key]?.name ?? key})`,
          metadata: { disposedCount },
        });
      }
    }

    await tx.insert(activityLogTable).values({
      type: mode === "sell" ? "sell" : "scrap",
      message:
        mode === "sell"
          ? `${req.user!.displayName} sold ${disposedCount} item${disposedCount === 1 ? "" : "s"} for ${goldEarned} gold`
          : `${req.user!.displayName} scrapped ${disposedCount} item${disposedCount === 1 ? "" : "s"} for materials`,
      actorUserId: userId,
    });

    const balances = await getBalancesDto(userId, tx);
    return {
      mode,
      disposedCount,
      removedIds,
      goldEarned: mode === "sell" ? goldEarned : 0,
      materialsEarned:
        mode === "scrap"
          ? Object.entries(materialTotals).map(([key, amount]) => ({
              key,
              name: MATERIAL_BY_KEY[key]?.name ?? key,
              icon: MATERIAL_BY_KEY[key]?.icon ?? "",
              amount,
            }))
          : [],
      balances,
    };
  });

  await saveIdempotentResponse(idempotencyKey, userId, "bulk_dispose", result);
  res.json(result);
});

export default router;
