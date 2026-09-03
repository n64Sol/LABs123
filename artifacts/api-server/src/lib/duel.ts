import { randomBytes } from "node:crypto";
import type { SpriteLayers } from "./presence";
import type { DuelSimResult } from "./duelSim";

// ---------------------------------------------------------------------------
// Peer-to-peer PvP duel sessions (in-memory).
//
// A duel is an ephemeral 1v1 challenge between two players who encounter each
// other in the overworld, mirroring the trade-session lifecycle: at most one
// live (non-terminal) duel may involve a given user at a time, and a finished
// duel is retained briefly so BOTH participants can poll the outcome before it
// is swept.
//
// Security model: a duel is only actionable by its two participants, keyed by
// authenticated userId (never a client-supplied id). The combat OUTCOME is
// resolved server-side at accept time (see duelSim) and stored immutably here;
// clients only ever read it, so a player cannot influence or fake the result.
// ---------------------------------------------------------------------------

export interface DuelParticipant {
  userId: number;
  displayName: string;
  avatarUrl: string;
  /** Cosmetic appearance used to render this fighter in the arena. */
  spriteLayers: SpriteLayers;
}

export type DuelStatus =
  | "pending" // challenge sent, awaiting opponent accept/decline
  | "active" // accepted + resolved; both play back the timeline
  | "completed" // both players have left the arena; session cleaned up
  | "declined" // opponent declined the challenge
  | "cancelled"; // challenger withdrew before acceptance

export interface DuelSession {
  id: string;
  challenger: DuelParticipant;
  opponent: DuelParticipant;
  status: DuelStatus;
  /** Set once the duel is accepted and resolved. */
  result: DuelSimResult | null;
  createdAt: number;
  updatedAt: number;
  version: number;
  /** Human-readable note for a terminal outcome (e.g. "Challenge expired"). */
  note?: string;
}

const PENDING_TTL = 45_000; // an unanswered challenge expires
const ACTIVE_TTL = 90_000; // keep a resolved duel long enough to play it back
const TERMINAL_TTL = 20_000; // keep a finished session briefly so both poll it
const SWEEP_MS = 5_000;

function isTerminal(s: DuelSession): boolean {
  return (
    s.status === "declined" || s.status === "cancelled" || s.status === "completed"
  );
}

function makeParticipant(
  user: { id: number; displayName: string; avatarUrl: string },
  spriteLayers: SpriteLayers,
): DuelParticipant {
  return {
    userId: user.id,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
    spriteLayers,
  };
}

export class DuelStore {
  private sessions = new Map<string, DuelSession>();

  constructor() {
    const timer = setInterval(() => this.sweep(), SWEEP_MS);
    if (typeof timer.unref === "function") timer.unref();
  }

  get(id: string): DuelSession | undefined {
    return this.sessions.get(id);
  }

  isParticipant(s: DuelSession, userId: number): boolean {
    return s.challenger.userId === userId || s.opponent.userId === userId;
  }

  /** A user is "busy" while in a pending or active duel. */
  private liveSessionFor(userId: number): DuelSession | undefined {
    for (const s of this.sessions.values()) {
      if (isTerminal(s)) continue;
      if (this.isParticipant(s, userId)) return s;
    }
    return undefined;
  }

  /**
   * Most relevant duel to surface to a polling user: a live (pending/active)
   * duel if present, otherwise the most recent terminal one (so both parties
   * observe the final outcome before it is swept).
   */
  visibleSessionFor(userId: number): DuelSession | undefined {
    const live = this.liveSessionFor(userId);
    if (live) return live;
    let best: DuelSession | undefined;
    for (const s of this.sessions.values()) {
      if (!isTerminal(s)) continue;
      if (!this.isParticipant(s, userId)) continue;
      if (!best || s.updatedAt > best.updatedAt) best = s;
    }
    return best;
  }

  /**
   * Create a pending challenge from `challenger` to `opponent`. Returns an error
   * string if either party is already busy in a live duel.
   */
  challenge(
    challenger: { id: number; displayName: string; avatarUrl: string },
    opponent: { id: number; displayName: string; avatarUrl: string },
    challengerLayers: SpriteLayers,
  ): { session?: DuelSession; error?: string } {
    if (challenger.id === opponent.id) {
      return { error: "You cannot duel yourself" };
    }
    if (this.liveSessionFor(challenger.id)) {
      return { error: "You are already in a duel" };
    }
    if (this.liveSessionFor(opponent.id)) {
      return { error: "That player is already in a duel" };
    }
    const now = Date.now();
    const session: DuelSession = {
      id: `duel_${randomBytes(10).toString("hex")}`,
      challenger: makeParticipant(challenger, challengerLayers),
      opponent: makeParticipant(opponent, {}),
      status: "pending",
      result: null,
      createdAt: now,
      updatedAt: now,
      version: 1,
    };
    this.sessions.set(session.id, session);
    return { session };
  }

  /**
   * Opponent accepts a pending challenge. The caller supplies the opponent's
   * appearance and a `resolve` function (which runs the server-authoritative
   * combat sim); on success the duel transitions to "active" with an immutable
   * result. Returns an error string if the duel is not acceptable.
   */
  accept(
    id: string,
    userId: number,
    opponentLayers: SpriteLayers,
    resolve: (s: DuelSession) => DuelSimResult,
  ): { session?: DuelSession; error?: string } {
    const s = this.sessions.get(id);
    if (!s) return { error: "Duel not found" };
    if (s.opponent.userId !== userId) {
      return { error: "Only the challenged player can accept" };
    }
    if (s.status !== "pending") return { error: "Challenge is no longer pending" };
    s.opponent.spriteLayers = opponentLayers;
    s.result = resolve(s);
    s.status = "active";
    this.bump(s);
    return { session: s };
  }

  /** Opponent declines a pending challenge (terminal). */
  decline(id: string, userId: number): { session?: DuelSession; error?: string } {
    const s = this.sessions.get(id);
    if (!s) return { error: "Duel not found" };
    if (s.opponent.userId !== userId) {
      return { error: "Only the challenged player can decline" };
    }
    if (s.status !== "pending") return { error: "Challenge is no longer pending" };
    s.status = "declined";
    this.bump(s);
    return { session: s };
  }

  /** Challenger cancels a still-pending challenge (terminal). */
  cancel(id: string, userId: number): { session?: DuelSession; error?: string } {
    const s = this.sessions.get(id);
    if (!s) return { error: "Duel not found" };
    if (!this.isParticipant(s, userId)) {
      return { error: "You are not part of this duel" };
    }
    if (isTerminal(s)) return { session: s };
    if (s.status !== "pending") {
      return { error: "Duel is already underway" };
    }
    s.status = "cancelled";
    this.bump(s);
    return { session: s };
  }

  /**
   * A participant has finished watching the resolved fight and returned to the
   * overworld. Transition the duel to a terminal "completed" state so the
   * single-live-duel guard frees up immediately (both players can duel again
   * right away) while the immutable result stays briefly pollable. Idempotent:
   * calling it on an already-terminal duel is a no-op.
   */
  complete(id: string, userId: number): { session?: DuelSession; error?: string } {
    const s = this.sessions.get(id);
    if (!s) return { error: "Duel not found" };
    if (!this.isParticipant(s, userId)) {
      return { error: "You are not part of this duel" };
    }
    if (isTerminal(s)) return { session: s };
    if (s.status !== "active") {
      return { error: "Duel has not finished" };
    }
    s.status = "completed";
    this.bump(s);
    return { session: s };
  }

  remove(id: string): void {
    this.sessions.delete(id);
  }

  private bump(s: DuelSession): void {
    s.version += 1;
    s.updatedAt = Date.now();
  }

  private sweep(): void {
    const now = Date.now();
    for (const [id, s] of this.sessions) {
      const age = now - s.updatedAt;
      if (isTerminal(s)) {
        if (age > TERMINAL_TTL) this.sessions.delete(id);
      } else if (s.status === "pending") {
        if (age > PENDING_TTL) {
          s.status = "declined";
          s.note = "Challenge expired";
          this.bump(s);
        }
      } else if (s.status === "active") {
        // A resolved duel lingers long enough for both clients to play it back,
        // then is removed outright (it has no terminal "observe" phase beyond
        // the active window — the result is already shown in the arena).
        if (age > ACTIVE_TTL) this.sessions.delete(id);
      }
    }
  }
}

export const duelStore = new DuelStore();
