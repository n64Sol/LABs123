import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { labyrinthsTable, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth } from "../lib/auth";
import { coop, MAX_PARTY } from "../lib/coop";
import { assembleChambers } from "../lib/chambers";
import { applyDailyReset } from "../lib/game";
import { startRunForMember, canAffordEntry } from "../lib/runStart";

const router: IRouter = Router();

function parseId(raw: unknown): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

async function lookupUser(userId: number): Promise<{ id: number; displayName: string; avatarUrl: string } | null> {
  const rows = await db
    .select({ id: usersTable.id, displayName: usersTable.displayName, avatarUrl: usersTable.avatarUrl })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);
  return rows[0] ?? null;
}

// GET /coop/party — the caller's current party (or null) plus any pending
// invitations addressed to them (so invitees can discover invites by polling).
router.get("/coop/party", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const raw = coop.invitationsFor(req.user!.id);
  const invitations = await Promise.all(
    raw.map(async (inv) => {
      const labRows = await db
        .select({ name: labyrinthsTable.name })
        .from(labyrinthsTable)
        .where(eq(labyrinthsTable.id, inv.labyrinthId))
        .limit(1);
      const hostRows = await db
        .select({ name: usersTable.displayName })
        .from(usersTable)
        .where(eq(usersTable.id, inv.hostUserId))
        .limit(1);
      return {
        partyId: inv.partyId,
        hostUserId: inv.hostUserId,
        hostName: hostRows[0]?.name ?? "Someone",
        labyrinthId: inv.labyrinthId,
        labyrinthName: labRows[0]?.name ?? "a labyrinth",
        memberCount: inv.memberCount,
      };
    }),
  );
  res.json({ party: coop.partyOf(req.user!.id), invitations });
});

// POST /coop/parties — create a party for a labyrinth, hosted by the caller.
router.post("/coop/parties", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const labyrinthId = parseId(req.body?.labyrinthId);
  if (labyrinthId == null) {
    res.status(400).json({ error: "labyrinthId is required" });
    return;
  }
  const labRows = await db.select().from(labyrinthsTable).where(eq(labyrinthsTable.id, labyrinthId)).limit(1);
  const lab = labRows[0];
  if (!lab) {
    res.status(404).json({ error: "Labyrinth not found" });
    return;
  }
  const isOwner = lab.ownerUserId === req.user!.id;
  if (!isOwner && !lab.published) {
    res.status(403).json({ error: "This labyrinth is not published" });
    return;
  }
  const party = coop.createParty(
    { id: req.user!.id, displayName: req.user!.displayName, avatarUrl: req.user!.avatarUrl },
    labyrinthId,
  );
  res.status(201).json({ party });
});

// POST /coop/parties/:id/invite — invite another user by id.
router.post("/coop/parties/:id/invite", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const targetUserId = parseId(req.body?.targetUserId);
  if (targetUserId == null) {
    res.status(400).json({ error: "targetUserId is required" });
    return;
  }
  const target = await lookupUser(targetUserId);
  if (!target) {
    res.status(404).json({ error: "That player does not exist" });
    return;
  }
  const result = coop.invite(req.user!.id, target);
  if (!result.ok) {
    res.status(409).json({ error: result.error });
    return;
  }
  res.json({ party: result.party });
});

// POST /coop/parties/:id/accept — accept an outstanding invite.
router.post("/coop/parties/:id/accept", requireAuth, (req: Request, res: Response): void => {
  const partyId = String(req.params.id);
  const result = coop.acceptInvite(
    { id: req.user!.id, displayName: req.user!.displayName, avatarUrl: req.user!.avatarUrl },
    partyId,
  );
  if (!result.ok) {
    res.status(409).json({ error: result.error });
    return;
  }
  res.json({ party: result.party });
});

// POST /coop/parties/:id/decline — decline an invite.
router.post("/coop/parties/:id/decline", requireAuth, (req: Request, res: Response): void => {
  coop.declineInvite(req.user!.id, String(req.params.id));
  res.json({ ok: true });
});

// POST /coop/parties/:id/ready — toggle your ready flag.
router.post("/coop/parties/:id/ready", requireAuth, (req: Request, res: Response): void => {
  coop.setReady(req.user!.id, !!req.body?.ready);
  res.json({ party: coop.partyOf(req.user!.id) });
});

// POST /coop/leave — leave your current party.
router.post("/coop/leave", requireAuth, (req: Request, res: Response): void => {
  coop.leave(req.user!.id);
  res.json({ ok: true });
});

// POST /coop/parties/:id/start — host launches the shared run.
router.post("/coop/parties/:id/start", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!.id;
  const party = coop.partyOf(userId);
  if (!party) {
    res.status(404).json({ error: "You are not in a party" });
    return;
  }
  if (party.partyId !== String(req.params.id)) {
    res.status(409).json({ error: "Party mismatch" });
    return;
  }
  if (party.hostUserId !== userId) {
    res.status(403).json({ error: "Only the host can start the run" });
    return;
  }
  if (party.status !== "forming") {
    res.status(409).json({ error: "Run already started" });
    return;
  }

  let labRows = await db.select().from(labyrinthsTable).where(eq(labyrinthsTable.id, party.labyrinthId)).limit(1);
  let lab = labRows[0];
  if (!lab) {
    res.status(404).json({ error: "Labyrinth not found" });
    return;
  }
  lab = await applyDailyReset(lab);

  // Only ready members participate. The host always participates.
  const participants = party.members.filter((m) => m.ready || m.userId === party.hostUserId);
  const partySize = Math.min(MAX_PARTY, Math.max(1, participants.length));

  // Assemble ONE shared, party-scaled chamber layout every member fights.
  const chambers = await assembleChambers(lab, db, partySize);
  if (chambers.length === 0) {
    res.status(500).json({ error: "Could not assemble chambers" });
    return;
  }

  const result = await db.transaction(async (tx) => {
    const labRow = (await tx.select().from(labyrinthsTable).where(eq(labyrinthsTable.id, lab!.id)).limit(1))[0]!;
    const runIdByUser = new Map<number, number>();
    const excluded: number[] = [];
    for (const m of participants) {
      const isOwnerRun = labRow.ownerUserId === m.userId;
      // Each member pays their own entry; if they cannot afford it they are
      // dropped from the launch and the run proceeds for the rest.
      const affordable = await canAffordEntry(m.userId, labRow, isOwnerRun, tx);
      if (!affordable) {
        excluded.push(m.userId);
        continue;
      }
      const run = await startRunForMember({
        tx,
        user: { id: m.userId, displayName: m.displayName },
        lab: labRow,
        isOwnerRun,
        chambers,
        coopPartyId: party.partyId,
        partySize,
      });
      runIdByUser.set(m.userId, run.id);
    }
    return { runIdByUser, excluded };
  });

  if (result.runIdByUser.size === 0) {
    res.status(402).json({ error: "No party members could afford entry" });
    return;
  }

  const started = coop.startRun(party.partyId, result.runIdByUser, chambers);
  res.json({ party: started, excluded: result.excluded });
});

// POST /coop/sync — HTTP polling fallback for the in-run session relay.
router.post("/coop/sync", requireAuth, (req: Request, res: Response): void => {
  const b = req.body ?? {};
  const hasTelemetry = typeof b.x === "number" && typeof b.y === "number";
  const telemetry = hasTelemetry
    ? {
        x: Number(b.x),
        y: Number(b.y),
        facing: Number(b.facing) || 1,
        moving: !!b.moving,
        chamberIndex: Number(b.chamberIndex) || 0,
        hp: Number(b.hp) || 0,
        maxHp: Number(b.maxHp) || 1,
      }
    : null;
  const since = Number(b.since ?? 0);
  res.json(coop.pollSync(req.user!.id, telemetry, since));
});

// POST /coop/combat — HTTP polling fallback for reporting a combat event.
router.post("/coop/combat", requireAuth, (req: Request, res: Response): void => {
  const kind = String(req.body?.kind ?? "");
  const allowed = ["enemy", "node", "chest", "boss", "down", "revive"];
  if (!allowed.includes(kind)) {
    res.status(400).json({ error: "invalid kind" });
    return;
  }
  const credited = coop.recordCombat(req.user!.id, kind as never, String(req.body?.id ?? ""));
  res.json({ ok: true, credited });
});

export default router;
