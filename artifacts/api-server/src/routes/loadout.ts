import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { playerItemsTable, itemTemplatesTable, playerLoadoutsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { requireAuth } from "../lib/auth";
import { buildLoadoutDto, LOADOUT_SLOT_SET } from "../lib/dto";
import { templateSlotForLoadoutSlot } from "../lib/catalog";
import { activeListingForItem } from "../lib/marketplace";

const router: IRouter = Router();

router.get("/loadout", requireAuth, async (req: Request, res: Response): Promise<void> => {
  res.json(await buildLoadoutDto(req.user!.id));
});

router.post("/loadout/equip", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!.id;
  const playerItemId = Number(req.body?.playerItemId);
  const slot = String(req.body?.slot ?? "");
  if (!Number.isInteger(playerItemId) || playerItemId <= 0) {
    res.status(400).json({ error: "playerItemId is required" });
    return;
  }
  if (!LOADOUT_SLOT_SET.has(slot)) {
    res.status(400).json({ error: "Invalid slot" });
    return;
  }
  const itemRows = await db
    .select()
    .from(playerItemsTable)
    .where(eq(playerItemsTable.id, playerItemId))
    .limit(1);
  const item = itemRows[0];
  if (!item || item.userId !== userId) {
    res.status(404).json({ error: "Item not found" });
    return;
  }
  // Escrowed (listed) items cannot be equipped until the listing is resolved.
  if (await activeListingForItem(playerItemId)) {
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
  // The target slot must accept this item's template slot type
  if (templateSlotForLoadoutSlot(slot) !== template.slot) {
    res.status(400).json({ error: `A ${template.slot} cannot be equipped in the ${slot} slot.` });
    return;
  }

  await db.transaction(async (tx) => {
    // Remove this item from any slot it currently occupies
    await tx
      .update(playerLoadoutsTable)
      .set({ playerItemId: null })
      .where(and(eq(playerLoadoutsTable.userId, userId), eq(playerLoadoutsTable.playerItemId, playerItemId)));
    // Upsert the target slot
    const existing = await tx
      .select()
      .from(playerLoadoutsTable)
      .where(and(eq(playerLoadoutsTable.userId, userId), eq(playerLoadoutsTable.slotKey, slot)))
      .limit(1);
    if (existing[0]) {
      await tx
        .update(playerLoadoutsTable)
        .set({ playerItemId })
        .where(eq(playerLoadoutsTable.id, existing[0].id));
    } else {
      await tx.insert(playerLoadoutsTable).values({ userId, slotKey: slot, playerItemId });
    }
  });

  res.json(await buildLoadoutDto(userId));
});

router.post("/loadout/unequip", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!.id;
  const slot = String(req.body?.slot ?? "");
  if (!LOADOUT_SLOT_SET.has(slot)) {
    res.status(400).json({ error: "Invalid slot" });
    return;
  }
  await db
    .update(playerLoadoutsTable)
    .set({ playerItemId: null })
    .where(and(eq(playerLoadoutsTable.userId, userId), eq(playerLoadoutsTable.slotKey, slot)));
  res.json(await buildLoadoutDto(userId));
});

export default router;
