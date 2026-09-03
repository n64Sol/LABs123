import { Router, type IRouter, type Request, type Response } from "express";
import { requireAuth } from "../lib/auth";
import { userById, buildLoadoutDto } from "../lib/dto";
import { sanitizeSpriteLayers, type SpriteLayers } from "../lib/presence";
import { duelStore, type DuelSession, type DuelParticipant } from "../lib/duel";
import { simulateDuel, type DuelCombatantInput } from "../lib/duelSim";
import { recordDuelResult, buildDuelRecordDto } from "../lib/duelRecord";

const router: IRouter = Router();

// --- DTO --------------------------------------------------------------------

interface DuelParticipantDto {
  userId: number;
  displayName: string;
  avatarUrl: string;
  spriteLayers: SpriteLayers;
  maxHp: number;
}

interface DuelResultDto {
  winnerUserId: number;
  loserUserId: number;
  durationMs: number;
  events: {
    tMs: number;
    actorUserId: number;
    targetUserId: number;
    kind: string;
    damage: number;
    targetHp: number;
    abilityName?: string;
  }[];
}

interface DuelDto {
  id: string;
  status: DuelSession["status"];
  version: number;
  role: "challenger" | "opponent";
  challengerUserId: number;
  opponentUserId: number;
  challenger: DuelParticipantDto;
  opponent: DuelParticipantDto;
  result: DuelResultDto | null;
  note: string | null;
  createdAt: string;
  updatedAt: string;
}

function maxHpFor(s: DuelSession, userId: number): number {
  const row = s.result?.maxHpByUser.find((m) => m.userId === userId);
  return row?.maxHp ?? 0;
}

function participantDto(s: DuelSession, p: DuelParticipant): DuelParticipantDto {
  return {
    userId: p.userId,
    displayName: p.displayName,
    avatarUrl: p.avatarUrl,
    spriteLayers: p.spriteLayers,
    maxHp: maxHpFor(s, p.userId),
  };
}

function buildDuelDto(s: DuelSession, viewerUserId: number): DuelDto {
  const isChallenger = s.challenger.userId === viewerUserId;
  return {
    id: s.id,
    status: s.status,
    version: s.version,
    role: isChallenger ? "challenger" : "opponent",
    challengerUserId: s.challenger.userId,
    opponentUserId: s.opponent.userId,
    challenger: participantDto(s, s.challenger),
    opponent: participantDto(s, s.opponent),
    result: s.result
      ? {
          winnerUserId: s.result.winnerUserId,
          loserUserId: s.result.loserUserId,
          durationMs: s.result.durationMs,
          events: s.result.events.map((e) => ({
            tMs: e.tMs,
            actorUserId: e.actorUserId,
            targetUserId: e.targetUserId,
            kind: e.kind,
            damage: e.damage,
            targetHp: e.targetHp,
            ...(e.abilityName ? { abilityName: e.abilityName } : {}),
          })),
        }
      : null,
    note: s.note ?? null,
    createdAt: new Date(s.createdAt).toISOString(),
    updatedAt: new Date(s.updatedAt).toISOString(),
  };
}

function parsePositiveInt(v: unknown): number | null {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}

// Build a deterministic combatant input from a user's equipped loadout: combat
// stats + the ability keys on their equipped ability stones.
async function combatantFor(userId: number): Promise<DuelCombatantInput> {
  const loadout = await buildLoadoutDto(userId);
  const abilityKeys: string[] = [];
  for (const slot of [loadout.slots.abilityStone, loadout.slots.abilityStone2]) {
    const key = slot?.template?.abilityKey;
    if (key) abilityKeys.push(key);
  }
  return { userId, stats: loadout.combatStats, abilityKeys };
}

// --- Routes -----------------------------------------------------------------

// GET /duels/active — polling endpoint. Returns the caller's live or most recent
// terminal duel (so both parties observe the outcome), or null.
router.get("/duels/active", requireAuth, (req: Request, res: Response): void => {
  const userId = req.user!.id;
  const s = duelStore.visibleSessionFor(userId);
  res.json({ duel: s ? buildDuelDto(s, userId) : null });
});

// GET /duels/record — the caller's durable win/loss tally + recent duels.
router.get("/duels/record", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!.id;
  res.json(await buildDuelRecordDto(userId));
});

// GET /duels/:id — full duel detail (incl. resolved result + both appearances)
// for the arena playback page. Only participants may read it.
router.get("/duels/:id", requireAuth, (req: Request, res: Response): void => {
  const userId = req.user!.id;
  const s = duelStore.get(String(req.params.id));
  if (!s || !duelStore.isParticipant(s, userId)) {
    res.status(404).json({ error: "Duel not found" });
    return;
  }
  res.json({ duel: buildDuelDto(s, userId) });
});

// POST /duels/challenge — challenge an encountered player to a duel.
router.post("/duels/challenge", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!.id;
  const targetUserId = parsePositiveInt(req.body?.targetUserId);
  if (targetUserId == null) {
    res.status(400).json({ error: "targetUserId is required" });
    return;
  }
  const target = await userById(targetUserId);
  if (!target) {
    res.status(404).json({ error: "Player not found" });
    return;
  }
  const layers = sanitizeSpriteLayers(req.body?.spriteLayers) ?? {};
  const { session, error } = duelStore.challenge(
    { id: userId, displayName: req.user!.displayName, avatarUrl: req.user!.avatarUrl },
    { id: target.id, displayName: target.displayName, avatarUrl: target.avatarUrl },
    layers,
  );
  if (error || !session) {
    res.status(409).json({ error: error ?? "Could not start duel" });
    return;
  }
  res.json({ duel: buildDuelDto(session, userId) });
});

// POST /duels/:id/accept — opponent accepts; the server resolves the whole
// fight deterministically and stores it immutably.
router.post("/duels/:id/accept", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!.id;
  const id = String(req.params.id);
  const layers = sanitizeSpriteLayers(req.body?.spriteLayers) ?? {};

  const existing = duelStore.get(id);
  if (!existing) {
    res.status(404).json({ error: "Duel not found" });
    return;
  }
  if (existing.opponent.userId !== userId) {
    res.status(403).json({ error: "Only the challenged player can accept" });
    return;
  }
  if (existing.status !== "pending") {
    res.status(409).json({ error: "Challenge is no longer pending" });
    return;
  }

  // Resolve both loadouts BEFORE mutating store state (async DB work).
  const [challengerInput, opponentInput] = await Promise.all([
    combatantFor(existing.challenger.userId),
    combatantFor(existing.opponent.userId),
  ]);

  const { session, error } = duelStore.accept(id, userId, layers, (s) =>
    simulateDuel(s.id, challengerInput, opponentInput),
  );
  if (error || !session) {
    res.status(409).json({ error: error ?? "Could not accept duel" });
    return;
  }
  // Persist the server-authoritative outcome durably so wins/losses accumulate.
  // Idempotent on the session id, so a retried accept never double-counts.
  if (session.result) {
    await recordDuelResult({
      duelSessionId: session.id,
      winnerUserId: session.result.winnerUserId,
      loserUserId: session.result.loserUserId,
      durationMs: session.result.durationMs,
    });
  }
  res.json({ duel: buildDuelDto(session, userId) });
});

// POST /duels/:id/decline — opponent declines a pending challenge.
router.post("/duels/:id/decline", requireAuth, (req: Request, res: Response): void => {
  const userId = req.user!.id;
  const { session, error } = duelStore.decline(String(req.params.id), userId);
  if (error || !session) {
    res.status(400).json({ error: error ?? "Could not decline" });
    return;
  }
  res.json({ duel: buildDuelDto(session, userId) });
});

// POST /duels/:id/cancel — challenger withdraws a still-pending challenge.
router.post("/duels/:id/cancel", requireAuth, (req: Request, res: Response): void => {
  const userId = req.user!.id;
  const { session, error } = duelStore.cancel(String(req.params.id), userId);
  if (error || !session) {
    res.status(400).json({ error: error ?? "Could not cancel" });
    return;
  }
  res.json({ duel: buildDuelDto(session, userId) });
});

// POST /duels/:id/complete — a participant left the arena after watching the
// resolved fight; clean up the session so both can duel again immediately.
router.post("/duels/:id/complete", requireAuth, (req: Request, res: Response): void => {
  const userId = req.user!.id;
  const { session, error } = duelStore.complete(String(req.params.id), userId);
  if (error || !session) {
    res.status(400).json({ error: error ?? "Could not complete" });
    return;
  }
  res.json({ duel: buildDuelDto(session, userId) });
});

export default router;
