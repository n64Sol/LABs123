import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import {
  labyrinthsTable,
  ratingsTable,
  usersTable,
  activityLogTable,
  type Labyrinth,
} from "@workspace/db";
import { eq, desc, and, ilike } from "drizzle-orm";
import { requireAuth, getUserFromRequest } from "../lib/auth";
import { buildLabyrinthDto, toRatingDto } from "../lib/dto";
import {
  applyDailyReset,
  computeAppealScore,
  getLabRatingStats,
  getUpgradeLevels,
  difficultyLabel,
} from "../lib/game";
import { biomeAccent, BIOMES } from "../lib/catalog";
import { ensurePlot } from "../lib/plots";
import { assembleChambers, summarizeChambers, buildLootTable } from "../lib/chambers";
import { ensureStarterUnlocks } from "../lib/roomPool";

const router: IRouter = Router();

function parseId(raw: string | string[] | undefined): number | null {
  const v = Array.isArray(raw) ? raw[0] : raw;
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}

async function labById(id: number): Promise<Labyrinth | null> {
  const rows = await db.select().from(labyrinthsTable).where(eq(labyrinthsTable.id, id)).limit(1);
  return rows[0] ?? null;
}

// GET /labyrinths — browse the published overworld
router.get("/labyrinths", async (req: Request, res: Response): Promise<void> => {
  const viewer = await getUserFromRequest(req);
  const sort = String(req.query.sort ?? "trending");
  const entry = String(req.query.entry ?? "all");
  const biome = req.query.biome ? String(req.query.biome) : null;
  const search = req.query.search ? String(req.query.search) : null;

  const conditions = [eq(labyrinthsTable.published, true)];
  if (biome) conditions.push(eq(labyrinthsTable.biome, biome));
  if (search) conditions.push(ilike(labyrinthsTable.name, `%${search}%`));
  if (entry === "free") conditions.push(eq(labyrinthsTable.entryFee, 0));

  let rows = await db
    .select()
    .from(labyrinthsTable)
    .where(and(...conditions));

  if (entry === "paid") {
    rows = rows.filter((l) => l.tollGateUnlocked && l.entryFee > 0);
  }

  let dtos = [];
  for (const lab of rows) dtos.push(await buildLabyrinthDto(lab, viewer?.id ?? null));

  switch (sort) {
    case "top_rated":
      dtos.sort((a, b) => b.ratingAverage - a.ratingAverage || b.ratingCount - a.ratingCount);
      break;
    case "newest":
      dtos.sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
      break;
    case "most_run":
      dtos.sort((a, b) => b.runsAllTime - a.runsAllTime);
      break;
    case "highest_reward":
      dtos.sort((a, b) => b.rewardValueToday - a.rewardValueToday);
      break;
    default: // trending
      dtos.sort((a, b) => b.runsToday - a.runsToday || b.appealScore - a.appealScore);
  }

  res.json(dtos);
});

// POST /labyrinths/claim
router.post("/labyrinths/claim", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!.id;
  const existing = await db
    .select()
    .from(labyrinthsTable)
    .where(eq(labyrinthsTable.ownerUserId, userId))
    .limit(1);
  if (existing[0]) {
    res.status(409).json({ error: "You already own a labyrinth" });
    return;
  }
  const biome = String(req.body?.biome ?? BIOMES[Math.floor(Math.random() * BIOMES.length)]!.key);
  const name = String(req.body?.name ?? `${req.user!.displayName}'s Labyrinth`).trim() ||
    `${req.user!.displayName}'s Labyrinth`;

  const inserted = await db
    .insert(labyrinthsTable)
    .values({
      ownerUserId: userId,
      name,
      description: "A freshly claimed labyrinth, waiting to be shaped.",
      biome,
      accentColor: biomeAccent(biome),
      level: 1,
      depth: 2,
      chamberCount: 2,
      rareNodeCount: 0,
    })
    .returning();
  const lab = inserted[0]!;
  await ensureStarterUnlocks(lab.id);
  // Anchor a permanent land plot the moment the labyrinth is claimed so the
  // owner spawns next to their own entrance in the world.
  await ensurePlot(lab);
  await db.insert(activityLogTable).values({
    type: "claim",
    message: `${req.user!.displayName} claimed a new labyrinth: ${lab.name}`,
    actorUserId: userId,
    labyrinthId: lab.id,
  });
  res.status(201).json(await buildLabyrinthDto(lab, userId));
});

// GET /labyrinths/mine
router.get("/labyrinths/mine", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const rows = await db
    .select()
    .from(labyrinthsTable)
    .where(eq(labyrinthsTable.ownerUserId, req.user!.id))
    .limit(1);
  if (!rows[0]) {
    res.json(null);
    return;
  }
  res.json(await buildLabyrinthDto(rows[0], req.user!.id));
});

// GET /labyrinths/:id
router.get("/labyrinths/:id", async (req: Request, res: Response): Promise<void> => {
  const id = parseId(req.params.id);
  if (id == null) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const lab = await labById(id);
  if (!lab) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const viewer = await getUserFromRequest(req);
  res.json(await buildLabyrinthDto(lab, viewer?.id ?? null));
});

// PATCH /labyrinths/:id
router.patch("/labyrinths/:id", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const id = parseId(req.params.id);
  if (id == null) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const lab = await labById(id);
  if (!lab) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  if (lab.ownerUserId !== req.user!.id) {
    res.status(403).json({ error: "You do not own this labyrinth" });
    return;
  }
  const patch: Partial<typeof labyrinthsTable.$inferInsert> = {};
  if (typeof req.body?.name === "string" && req.body.name.trim()) patch.name = req.body.name.trim();
  if (typeof req.body?.description === "string") patch.description = req.body.description;
  if (typeof req.body?.biome === "string") {
    patch.biome = req.body.biome;
    patch.accentColor = biomeAccent(req.body.biome);
  }
  const updated = await db
    .update(labyrinthsTable)
    .set(patch)
    .where(eq(labyrinthsTable.id, id))
    .returning();
  res.json(await buildLabyrinthDto(updated[0]!, req.user!.id));
});

// GET /labyrinths/:id/preview
router.get("/labyrinths/:id/preview", async (req: Request, res: Response): Promise<void> => {
  const id = parseId(req.params.id);
  if (id == null) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  let lab = await labById(id);
  if (!lab) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  lab = await applyDailyReset(lab);
  const viewer = await getUserFromRequest(req);
  const chambers = await assembleChambers(lab);
  const { ratingAverage, ratingCount } = await getLabRatingStats(lab.id);
  const upgradeLevels = await getUpgradeLevels(lab.id);
  const appealScore = computeAppealScore(lab, ratingAverage, ratingCount, upgradeLevels);
  const estimatedClearSeconds = 45 + lab.chamberCount * 30 + (lab.bossActive ? 40 : 0);
  res.json({
    labyrinth: await buildLabyrinthDto(lab, viewer?.id ?? null),
    chambers: summarizeChambers(chambers, lab),
    lootTable: buildLootTable(lab),
    estimatedClearSeconds,
    difficulty: difficultyLabel(appealScore),
  });
});

// POST /labyrinths/:id/publish
router.post("/labyrinths/:id/publish", requireAuth, async (req: Request, res: Response): Promise<void> => {
  await setPublished(req, res, true);
});

// POST /labyrinths/:id/unpublish
router.post("/labyrinths/:id/unpublish", requireAuth, async (req: Request, res: Response): Promise<void> => {
  await setPublished(req, res, false);
});

async function setPublished(req: Request, res: Response, published: boolean): Promise<void> {
  const id = parseId(req.params.id);
  if (id == null) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const lab = await labById(id);
  if (!lab) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  if (lab.ownerUserId !== req.user!.id) {
    res.status(403).json({ error: "You do not own this labyrinth" });
    return;
  }
  const updated = await db
    .update(labyrinthsTable)
    .set({ published })
    .where(eq(labyrinthsTable.id, id))
    .returning();
  if (published) {
    await db.insert(activityLogTable).values({
      type: "publish",
      message: `${req.user!.displayName} published ${lab.name} to the overworld`,
      actorUserId: req.user!.id,
      labyrinthId: id,
    });
  }
  res.json(await buildLabyrinthDto(updated[0]!, req.user!.id));
}

// GET /labyrinths/:id/ratings
router.get("/labyrinths/:id/ratings", async (req: Request, res: Response): Promise<void> => {
  const id = parseId(req.params.id);
  if (id == null) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const rows = await db
    .select({ rating: ratingsTable, rater: usersTable })
    .from(ratingsTable)
    .leftJoin(usersTable, eq(ratingsTable.raterUserId, usersTable.id))
    .where(eq(ratingsTable.labyrinthId, id))
    .orderBy(desc(ratingsTable.createdAt))
    .limit(50);
  res.json(rows.map((r) => toRatingDto(r.rating, r.rater)));
});

export default router;
