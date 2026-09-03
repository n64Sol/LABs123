import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { labyrinthsTable, usersTable } from "@workspace/db";
import { eq, desc, and, gt, sql } from "drizzle-orm";
import { getUserFromRequest } from "../lib/auth";
import { buildLabyrinthDto, type LabyrinthDto } from "../lib/dto";
import { getLabRatingStats } from "../lib/game";
import { ensureTreasury } from "./economy";

const router: IRouter = Router();

async function mapLabs(
  labs: (typeof labyrinthsTable.$inferSelect)[],
  viewerUserId: number | null,
): Promise<LabyrinthDto[]> {
  const out: LabyrinthDto[] = [];
  for (const lab of labs) out.push(await buildLabyrinthDto(lab, viewerUserId));
  return out;
}

router.get("/discovery/featured", async (req: Request, res: Response): Promise<void> => {
  const viewer = await getUserFromRequest(req);
  const labs = await db
    .select()
    .from(labyrinthsTable)
    .where(and(eq(labyrinthsTable.published, true), eq(labyrinthsTable.featured, true)))
    .orderBy(desc(labyrinthsTable.runsAllTime))
    .limit(6);
  res.json(await mapLabs(labs, viewer?.id ?? null));
});

router.get("/discovery/trending", async (req: Request, res: Response): Promise<void> => {
  const viewer = await getUserFromRequest(req);
  const labs = await db
    .select()
    .from(labyrinthsTable)
    .where(eq(labyrinthsTable.published, true))
    .orderBy(desc(labyrinthsTable.runsToday), desc(labyrinthsTable.runsAllTime))
    .limit(12);
  res.json(await mapLabs(labs, viewer?.id ?? null));
});

router.get("/discovery/top-paid", async (req: Request, res: Response): Promise<void> => {
  const viewer = await getUserFromRequest(req);
  const labs = await db
    .select()
    .from(labyrinthsTable)
    .where(
      and(
        eq(labyrinthsTable.published, true),
        eq(labyrinthsTable.tollGateUnlocked, true),
        gt(labyrinthsTable.entryFee, 0),
      ),
    )
    .orderBy(desc(labyrinthsTable.lifetimeEntryShare))
    .limit(10);
  res.json(await mapLabs(labs, viewer?.id ?? null));
});

router.get("/discovery/top-free", async (req: Request, res: Response): Promise<void> => {
  const viewer = await getUserFromRequest(req);
  const labs = await db
    .select()
    .from(labyrinthsTable)
    .where(and(eq(labyrinthsTable.published, true), eq(labyrinthsTable.entryFee, 0)))
    .orderBy(desc(labyrinthsTable.runsAllTime))
    .limit(10);
  res.json(await mapLabs(labs, viewer?.id ?? null));
});

router.get("/discovery/leaderboard", async (_req: Request, res: Response): Promise<void> => {
  const labs = await db
    .select()
    .from(labyrinthsTable)
    .where(eq(labyrinthsTable.published, true));
  const entries = [];
  for (const lab of labs) {
    const owner = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, lab.ownerUserId))
      .limit(1);
    const { ratingAverage } = await getLabRatingStats(lab.id);
    entries.push({
      ownerName: owner[0]?.displayName ?? "Unknown",
      ownerAvatarUrl: owner[0]?.avatarUrl ?? "",
      labyrinthName: lab.name,
      lifetimeEarnings: lab.lifetimeDropShareValue + lab.lifetimeEntryShare,
      runsHosted: lab.runsAllTime,
      ratingAverage,
    });
  }
  entries.sort((a, b) => b.lifetimeEarnings - a.lifetimeEarnings);
  res.json(entries.slice(0, 20).map((e, i) => ({ rank: i + 1, ...e })));
});

router.get("/discovery/world-stats", async (_req: Request, res: Response): Promise<void> => {
  const treasury = await ensureTreasury();
  const totals = await db
    .select({
      total: sql<number>`count(*)`,
      published: sql<number>`count(*) filter (where ${labyrinthsTable.published} = true)`,
      runsAllTime: sql<number>`coalesce(sum(${labyrinthsTable.runsAllTime}), 0)`,
      runsToday: sql<number>`coalesce(sum(${labyrinthsTable.runsToday}), 0)`,
      valueDropped: sql<number>`coalesce(sum(${labyrinthsTable.rewardValueAllTime}), 0)`,
      activeOwners: sql<number>`count(distinct ${labyrinthsTable.ownerUserId})`,
    })
    .from(labyrinthsTable);
  const t = totals[0];
  res.json({
    totalLabyrinths: Number(t?.total ?? 0),
    publishedLabyrinths: Number(t?.published ?? 0),
    totalRuns: Number(t?.runsAllTime ?? 0),
    runsToday: Number(t?.runsToday ?? 0),
    treasuryBalance: treasury.labTokenBalance,
    activeOwners: Number(t?.activeOwners ?? 0),
    totalValueDropped: Number(t?.valueDropped ?? 0),
  });
});

export default router;
