import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { labyrinthsTable, labyrinthRoomUnlocksTable, activityLogTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth } from "../lib/auth";
import { buildLabyrinthDto } from "../lib/dto";
import { getBalancesDto, ensureBalances, addCurrency } from "../lib/balances";
import { getIdempotentResponse, saveIdempotentResponse } from "../lib/idempotency";
import { writeLedger } from "../lib/ledger";
import {
  ROOM_TYPE_CATALOG,
  ROOM_TYPE_BY_KEY,
  getUnlockedRoomKeys,
  buildRoomTypeDto,
} from "../lib/roomPool";

const router: IRouter = Router();

function parseId(raw: string | string[] | undefined): number | null {
  const v = Array.isArray(raw) ? raw[0] : raw;
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}

// GET /labyrinths/:id/room-types — the full room-type catalog with each type's
// unlocked state for this labyrinth.
router.get(
  "/labyrinths/:id/room-types",
  async (req: Request, res: Response): Promise<void> => {
    const id = parseId(req.params.id);
    if (id == null) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const rows = await db
      .select()
      .from(labyrinthsTable)
      .where(eq(labyrinthsTable.id, id))
      .limit(1);
    if (!rows[0]) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const unlocked = await getUnlockedRoomKeys(id);
    res.json(
      ROOM_TYPE_CATALOG.map((e) => buildRoomTypeDto(e, unlocked.has(e.key))),
    );
  },
);

// POST /labyrinths/:id/room-types/unlock — buy a room type with gold, expanding
// the pool the labyrinth's runs are assembled from.
router.post(
  "/labyrinths/:id/room-types/unlock",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const id = parseId(req.params.id);
    if (id == null) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const userId = req.user!.id;
    const roomKey = String(req.body?.roomKey ?? "");
    const idempotencyKey = String(req.body?.idempotencyKey ?? "").trim();
    if (!idempotencyKey) {
      res.status(400).json({ error: "idempotencyKey is required" });
      return;
    }
    const entry = ROOM_TYPE_BY_KEY[roomKey];
    if (!entry) {
      res.status(400).json({ error: "Unknown room type" });
      return;
    }
    const cached = await getIdempotentResponse(idempotencyKey, userId, "unlock_room_type");
    if (cached) {
      res.json(cached);
      return;
    }

    const labRows = await db
      .select()
      .from(labyrinthsTable)
      .where(eq(labyrinthsTable.id, id))
      .limit(1);
    const lab = labRows[0];
    if (!lab) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    if (lab.ownerUserId !== userId) {
      res.status(403).json({ error: "You do not own this labyrinth" });
      return;
    }

    const unlocked = await getUnlockedRoomKeys(id);
    if (entry.starter || unlocked.has(roomKey)) {
      // Already available — return current state without charging.
      const labyrinth = await buildLabyrinthDto(lab, userId);
      const balances = await getBalancesDto(userId);
      const roomTypes = ROOM_TYPE_CATALOG.map((e) =>
        buildRoomTypeDto(e, unlocked.has(e.key) || e.starter),
      );
      res.json({ labyrinth, balances, roomTypes });
      return;
    }

    const cost = entry.cost;
    const bal = await ensureBalances(userId);
    if (bal.gold < cost) {
      res.status(402).json({ error: `Insufficient gold. Need ${cost}, have ${bal.gold}.` });
      return;
    }

    const result = await db.transaction(async (tx) => {
      await addCurrency(userId, { gold: -cost }, tx);
      await writeLedger(tx, {
        userId,
        type: "room_type_unlock_debit",
        direction: "debit",
        amount: cost,
        currency: "gold",
        reason: `Unlocked room type "${entry.name}" on ${lab.name}`,
        labyrinthId: id,
      });
      await tx
        .insert(labyrinthRoomUnlocksTable)
        .values({ labyrinthId: id, roomKey })
        .onConflictDoNothing();
      await tx.insert(activityLogTable).values({
        type: "room_unlock",
        message: `${req.user!.displayName} unlocked the ${entry.name} room type on ${lab.name}`,
        actorUserId: userId,
        labyrinthId: id,
        value: cost,
      });
      const nowUnlocked = await getUnlockedRoomKeys(id, tx);
      const labyrinth = await buildLabyrinthDto(lab, userId, tx);
      const balances = await getBalancesDto(userId, tx);
      const roomTypes = ROOM_TYPE_CATALOG.map((e) =>
        buildRoomTypeDto(e, nowUnlocked.has(e.key)),
      );
      return { labyrinth, balances, roomTypes };
    });

    await saveIdempotentResponse(idempotencyKey, userId, "unlock_room_type", result);
    res.json(result);
  },
);

export default router;
