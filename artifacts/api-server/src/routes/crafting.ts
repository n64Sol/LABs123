import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import {
  craftingRecipesTable,
  itemTemplatesTable,
  playerItemsTable,
  activityLogTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth } from "../lib/auth";
import {
  toItemTemplateDto,
  toPlayerItemDto,
  templatesByKeys,
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
import { MATERIAL_BY_KEY } from "../lib/catalog";

const router: IRouter = Router();

router.get("/crafting/recipes", async (_req: Request, res: Response): Promise<void> => {
  const recipes = await db.select().from(craftingRecipesTable);
  const templates = await templatesByKeys(recipes.map((r) => r.resultTemplateKey));
  res.json(
    recipes
      .filter((r) => templates[r.resultTemplateKey])
      .map((r) => ({
        id: r.id,
        name: r.name,
        description: r.description,
        resultTemplate: toItemTemplateDto(templates[r.resultTemplateKey]!),
        costGold: r.costGold,
        costMaterials: r.costMaterials,
      })),
  );
});

router.post("/crafting/craft", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!.id;
  const recipeId = Number(req.body?.recipeId);
  const idempotencyKey = String(req.body?.idempotencyKey ?? "").trim();
  if (!Number.isInteger(recipeId) || recipeId <= 0) {
    res.status(400).json({ error: "recipeId is required" });
    return;
  }
  if (!idempotencyKey) {
    res.status(400).json({ error: "idempotencyKey is required" });
    return;
  }
  const cached = await getIdempotentResponse(idempotencyKey, userId, "craft_item");
  if (cached) {
    res.json(cached);
    return;
  }

  const recipeRows = await db
    .select()
    .from(craftingRecipesTable)
    .where(eq(craftingRecipesTable.id, recipeId))
    .limit(1);
  const recipe = recipeRows[0];
  if (!recipe) {
    res.status(404).json({ error: "Recipe not found" });
    return;
  }
  const tplRows = await db
    .select()
    .from(itemTemplatesTable)
    .where(eq(itemTemplatesTable.key, recipe.resultTemplateKey))
    .limit(1);
  const template = tplRows[0];
  if (!template) {
    res.status(404).json({ error: "Result template not found" });
    return;
  }

  const bal = await ensureBalances(userId);
  const mats = await getMaterialMap(userId);
  if (bal.gold < recipe.costGold) {
    res.status(402).json({ error: `Insufficient gold. Need ${recipe.costGold}, have ${bal.gold}.` });
    return;
  }
  for (const m of recipe.costMaterials) {
    if ((mats[m.key] ?? 0) < m.amount) {
      res.status(402).json({ error: `Insufficient ${MATERIAL_BY_KEY[m.key]?.name ?? m.key}.` });
      return;
    }
  }

  const result = await db.transaction(async (tx) => {
    if (recipe.costGold > 0) {
      await addCurrency(userId, { gold: -recipe.costGold }, tx);
      await writeLedger(tx, {
        userId,
        type: "craft_item_debit",
        direction: "debit",
        amount: recipe.costGold,
        currency: "gold",
        reason: `Crafted ${template.name}`,
      });
    }
    for (const m of recipe.costMaterials) {
      await addMaterial(userId, m.key, -m.amount, tx);
      await writeLedger(tx, {
        userId,
        type: "craft_item_debit",
        direction: "debit",
        amount: m.amount,
        currency: m.key,
        reason: `Crafted ${template.name} (${MATERIAL_BY_KEY[m.key]?.name ?? m.key})`,
      });
    }
    const ins = await tx
      .insert(playerItemsTable)
      .values({ userId, templateKey: recipe.resultTemplateKey, level: 1 })
      .returning();
    await tx.insert(activityLogTable).values({
      type: "craft",
      message: `${req.user!.displayName} crafted ${template.name}`,
      actorUserId: userId,
    });
    const itemDto = toPlayerItemDto(ins[0]!, template, null);
    const balances = await getBalancesDto(userId, tx);
    return { item: itemDto, balances };
  });

  await saveIdempotentResponse(idempotencyKey, userId, "craft_item", result);
  res.json(result);
});

export default router;
