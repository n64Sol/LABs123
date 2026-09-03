import { Router, type IRouter, type Request, type Response } from "express";
import { randomBytes } from "node:crypto";
import { db } from "@workspace/db";
import { labyrinthsTable, usersTable, runsTable } from "@workspace/db";
import { and, desc, eq } from "drizzle-orm";
import { requireAuth } from "../lib/auth";
import { presence, sanitizeSpriteLayers, WORLD_W, WORLD_H, EMOTES } from "../lib/presence";
import { biomeAccent } from "../lib/catalog";
import { CHUNK_SIZE, WORLD_LIMIT, biomeRegions, chunkKey } from "../lib/world";
import { ensureAllPlots, ensurePlot } from "../lib/plots";

const router: IRouter = Router();

function parseId(raw: string | string[] | undefined): number | null {
  const v = Array.isArray(raw) ? raw[0] : raw;
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function clientIdOf(req: Request): string | null {
  const raw = req.body?.clientId;
  return typeof raw === "string" && raw.length > 0 && raw.length <= 80 ? raw : null;
}

function mintClientId(userId: number): string {
  return `poll_${userId}_${randomBytes(8).toString("hex")}`;
}

/**
 * Resolve the clientId a polling request is allowed to act as. A clientId is
 * owned by the user who first claimed it, so we only honor a caller-supplied id
 * when it is unclaimed or already owned by this same authenticated user. Any
 * attempt to reuse another player's id is ignored and a fresh, server-minted id
 * is returned instead — preventing identity spoofing across the polling API.
 */
function resolveOwnedClientId(req: Request, userId: number): string {
  const supplied = clientIdOf(req);
  if (supplied) {
    const owner = presence.ownerOf(supplied);
    if (owner === undefined || owner === userId) return supplied;
  }
  return mintClientId(userId);
}

// Broadcastable world metadata: streaming chunk size, world clamp, biome
// regions (symbolic level-of-detail), and the emote vocabulary. Regions are
// derived from live per-biome labyrinth counts so the zoomed-out view scales
// with how populated each territory is.
router.get("/overworld/meta", async (_req: Request, res: Response): Promise<void> => {
  const rows = await db.select({ biome: labyrinthsTable.biome }).from(labyrinthsTable);
  const counts: Record<string, number> = {};
  for (const r of rows) counts[r.biome] = (counts[r.biome] ?? 0) + 1;
  res.json({
    worldW: WORLD_W,
    worldH: WORLD_H,
    chunkSize: CHUNK_SIZE,
    worldLimit: WORLD_LIMIT,
    regions: biomeRegions(counts),
    emotes: EMOTES,
  });
});

/** A labyrinth land-plot entrance streamed to the client per visible chunk. */
interface EntranceDto {
  id: number;
  name: string;
  ownerUserId: number;
  ownerName: string;
  level: number;
  biome: string;
  accent: string;
  x: number;
  y: number;
  published: boolean;
  entryFee: number;
  tollGateUnlocked: boolean;
}

// GET /overworld/chunks?keys=cx_cy,cx_cy — stream the land-plot entrances whose
// plot falls inside any of the requested chunk cells. Plots are assigned lazily
// here so a newly claimed labyrinth always has a home the moment it's viewed.
router.get("/overworld/chunks", async (req: Request, res: Response): Promise<void> => {
  const raw = String(req.query.keys ?? "").trim();
  const wanted = new Set<string>();
  if (raw) {
    for (const part of raw.split(",")) {
      const [cx, cy] = part.split("_");
      const nx = Number(cx);
      const ny = Number(cy);
      if (Number.isInteger(nx) && Number.isInteger(ny)) wanted.add(`${nx},${ny}`);
    }
  }
  if (wanted.size === 0) {
    res.json({ chunkSize: CHUNK_SIZE, entrances: [] });
    return;
  }

  const labs = await ensureAllPlots();
  const owners = await db.select({ id: usersTable.id, displayName: usersTable.displayName }).from(usersTable);
  const ownerName = new Map(owners.map((u) => [u.id, u.displayName]));

  const entrances: EntranceDto[] = [];
  for (const lab of labs) {
    if (!wanted.has(chunkKey(lab.plotX, lab.plotY))) continue;
    entrances.push({
      id: lab.id,
      name: lab.name,
      ownerUserId: lab.ownerUserId,
      ownerName: ownerName.get(lab.ownerUserId) ?? "Unknown",
      level: lab.level,
      biome: lab.biome,
      accent: lab.accentColor || biomeAccent(lab.biome),
      x: lab.plotX,
      y: lab.plotY,
      published: lab.published,
      entryFee: lab.entryFee,
      tollGateUnlocked: lab.tollGateUnlocked,
    });
  }
  res.json({ chunkSize: CHUNK_SIZE, entrances });
});

// GET /overworld/search?q=… — look up labyrinths by name or owner across the
// whole (unbounded) world, regardless of what the client has streamed near the
// camera. Returns plotted entrances so the client can recenter on a match.
router.get("/overworld/search", async (req: Request, res: Response): Promise<void> => {
  const q = String(req.query.q ?? "").trim().toLowerCase();
  if (q.length < 1) {
    res.json({ results: [] });
    return;
  }

  const labs = await ensureAllPlots();
  const owners = await db.select({ id: usersTable.id, displayName: usersTable.displayName }).from(usersTable);
  const ownerName = new Map(owners.map((u) => [u.id, u.displayName]));

  const matches: EntranceDto[] = [];
  for (const lab of labs) {
    const owner = ownerName.get(lab.ownerUserId) ?? "Unknown";
    const nameHit = lab.name.toLowerCase().includes(q);
    const ownerHit = owner.toLowerCase().includes(q);
    if (!nameHit && !ownerHit) continue;
    matches.push({
      id: lab.id,
      name: lab.name,
      ownerUserId: lab.ownerUserId,
      ownerName: owner,
      level: lab.level,
      biome: lab.biome,
      accent: lab.accentColor || biomeAccent(lab.biome),
      x: lab.plotX,
      y: lab.plotY,
      published: lab.published,
      entryFee: lab.entryFee,
      tollGateUnlocked: lab.tollGateUnlocked,
    });
  }

  // Rank: name matches before owner-only matches, then prefix matches, then
  // alphabetical — keeps the most relevant result at the top.
  matches.sort((a, b) => {
    const an = a.name.toLowerCase();
    const bn = b.name.toLowerCase();
    const aName = an.includes(q) ? 0 : 1;
    const bName = bn.includes(q) ? 0 : 1;
    if (aName !== bName) return aName - bName;
    const aPre = an.startsWith(q) ? 0 : 1;
    const bPre = bn.startsWith(q) ? 0 : 1;
    if (aPre !== bPre) return aPre - bPre;
    return an.localeCompare(bn);
  });

  res.json({ results: matches.slice(0, 12) });
});

// GET /overworld/spawn — where this player should appear: anchored at their own
// labyrinth's plot if they own one, otherwise at the central hub.
router.get("/overworld/spawn", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const rows = await db
    .select()
    .from(labyrinthsTable)
    .where(eq(labyrinthsTable.ownerUserId, req.user!.id))
    .limit(1);
  const lab = rows[0];
  if (!lab) {
    res.json({ x: 0, y: 0, labyrinthId: null });
    return;
  }
  const pos = await ensurePlot(lab);
  res.json({ x: pos.x, y: pos.y, labyrinthId: lab.id });
});

// GET /overworld/labyrinth/:id/leaderboard — top cleared runs for a labyrinth.
router.get("/overworld/labyrinth/:id/leaderboard", async (req: Request, res: Response): Promise<void> => {
  const id = parseId(req.params.id);
  if (id == null) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const rows = await db
    .select({ run: runsTable, visitor: usersTable })
    .from(runsTable)
    .leftJoin(usersTable, eq(runsTable.visitorUserId, usersTable.id))
    .where(and(eq(runsTable.labyrinthId, id), eq(runsTable.cleared, true)))
    .orderBy(desc(runsTable.rewardValue))
    .limit(8);
  res.json(
    rows.map((r, i) => ({
      rank: i + 1,
      name: r.visitor?.displayName ?? "Adventurer",
      avatarUrl: r.visitor?.avatarUrl ?? "",
      rewardValue: r.run.rewardValue,
      timeSeconds: r.run.timeSeconds,
      bossDefeated: r.run.bossDefeated,
      clearedAt: r.run.completedAt ? r.run.completedAt.toISOString() : null,
    })),
  );
});

// POST /overworld/sync — the polling-fallback workhorse.
// Joins (idempotently) or refreshes the caller's presence, applies a position
// update, and returns the current snapshot plus events since the caller's
// cursor. Clients call this on an interval when WebSockets are unavailable and
// must adopt the returned clientId for subsequent calls.
router.post("/overworld/sync", requireAuth, (req: Request, res: Response): void => {
  const user = req.user!;
  const clientId = resolveOwnedClientId(req, user.id);
  presence.join({
    clientId,
    userId: user.id,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
    spriteLayers: sanitizeSpriteLayers(req.body?.spriteLayers),
    x: typeof req.body?.x === "number" ? req.body.x : undefined,
    y: typeof req.body?.y === "number" ? req.body.y : undefined,
  });
  if (typeof req.body?.x === "number" && typeof req.body?.y === "number") {
    presence.move(
      clientId,
      req.body.x,
      req.body.y,
      Number(req.body.facing) || 1,
      !!req.body.moving,
    );
  } else {
    presence.touch(clientId);
  }
  const since = Number(req.body?.since ?? 0);
  res.json({
    clientId,
    seq: presence.currentSeq,
    players: presence.snapshot(),
    events: presence.eventsSince(since),
  });
});

/**
 * For mutating actions there is no clientId to hand back, so a caller must
 * already own the id. Returns the owned clientId or null (after sending a 4xx).
 */
function requireOwnedClientId(req: Request, res: Response, userId: number): string | null {
  const clientId = clientIdOf(req);
  if (!clientId) {
    res.status(400).json({ error: "clientId is required" });
    return null;
  }
  if (presence.ownerOf(clientId) !== userId) {
    res.status(403).json({ error: "clientId is not owned by this session" });
    return null;
  }
  return clientId;
}

router.post("/overworld/emote", requireAuth, (req: Request, res: Response): void => {
  const clientId = requireOwnedClientId(req, res, req.user!.id);
  if (!clientId) return;
  presence.emote(clientId, String(req.body?.emote ?? ""));
  res.json({ ok: true, seq: presence.currentSeq });
});

router.post("/overworld/chat", requireAuth, (req: Request, res: Response): void => {
  const clientId = requireOwnedClientId(req, res, req.user!.id);
  if (!clientId) return;
  presence.chat(clientId, String(req.body?.text ?? ""));
  res.json({ ok: true, seq: presence.currentSeq });
});

router.post("/overworld/leave", requireAuth, (req: Request, res: Response): void => {
  const clientId = clientIdOf(req);
  // Only allow leaving your own presence; silently no-op otherwise so a stray
  // beacon can't evict another player.
  if (clientId && presence.ownerOf(clientId) === req.user!.id) {
    presence.leave(clientId);
  }
  res.json({ ok: true });
});

export default router;
