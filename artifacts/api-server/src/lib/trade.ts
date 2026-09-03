import { randomBytes } from "node:crypto";

// ---------------------------------------------------------------------------
// Peer-to-peer trade sessions (in-memory).
//
// A trade is an ephemeral escrow negotiation between exactly two users who
// encounter each other in the overworld. The negotiation state (who offered
// what, who has confirmed) lives here, in memory, mirroring the ephemeral
// presence layer. The ACTUAL asset swap is settled separately in a DB
// transaction (see routes/trade.ts) which re-validates everything — this store
// is never the source of truth for ownership, only for the in-flight offer.
//
// Security model: a session is only actionable by its two participants, keyed
// by authenticated userId (never by a client-supplied id). At most one live
// (non-terminal) session may involve a given user at a time.
// ---------------------------------------------------------------------------

export type TradeCurrencyKey = "gold" | "ore" | "dust" | "keys" | "labToken";
export const TRADE_CURRENCIES: TradeCurrencyKey[] = [
  "gold",
  "ore",
  "dust",
  "keys",
  "labToken",
];

export type CurrencyBag = Record<TradeCurrencyKey, number>;

export function emptyBag(): CurrencyBag {
  return { gold: 0, ore: 0, dust: 0, keys: 0, labToken: 0 };
}

export interface TradeSide {
  userId: number;
  displayName: string;
  avatarUrl: string;
  itemIds: number[];
  currency: CurrencyBag;
  confirmed: boolean;
}

export type TradeStatus =
  | "pending" // invite sent, awaiting recipient accept/decline
  | "active" // both parties staging offers
  | "settled" // swap completed
  | "cancelled" // a participant cancelled
  | "declined"; // recipient declined the invite

export interface TradeSession {
  id: string;
  initiator: TradeSide;
  recipient: TradeSide;
  status: TradeStatus;
  createdAt: number;
  updatedAt: number;
  /** Bumps on every mutation so clients can cheaply detect changes. */
  version: number;
  /** Set once settlement begins, to guard against double-settling. */
  settling: boolean;
  /** Human-readable note for a terminal outcome (e.g. failed validation). */
  note?: string;
}

const PENDING_TTL = 60_000; // unaccepted invite expires
const ACTIVE_TTL = 10 * 60_000; // idle negotiation expires
const TERMINAL_TTL = 20_000; // keep a finished session briefly so both poll it
const SWEEP_MS = 5_000;

function isTerminal(s: TradeSession): boolean {
  return s.status === "settled" || s.status === "cancelled" || s.status === "declined";
}

function makeSide(user: {
  id: number;
  displayName: string;
  avatarUrl: string;
}): TradeSide {
  return {
    userId: user.id,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
    itemIds: [],
    currency: emptyBag(),
    confirmed: false,
  };
}

export class TradeStore {
  private sessions = new Map<string, TradeSession>();

  constructor() {
    const timer = setInterval(() => this.sweep(), SWEEP_MS);
    if (typeof timer.unref === "function") timer.unref();
  }

  get(id: string): TradeSession | undefined {
    return this.sessions.get(id);
  }

  /** The single live (non-terminal) session a user is part of, if any. */
  liveSessionFor(userId: number): TradeSession | undefined {
    for (const s of this.sessions.values()) {
      if (isTerminal(s)) continue;
      if (s.initiator.userId === userId || s.recipient.userId === userId) return s;
    }
    return undefined;
  }

  /**
   * Most relevant session to surface to a user when polling: a live session if
   * present, otherwise the most recent terminal one (so both parties can observe
   * the final outcome before it is swept).
   */
  visibleSessionFor(userId: number): TradeSession | undefined {
    const live = this.liveSessionFor(userId);
    if (live) return live;
    let best: TradeSession | undefined;
    for (const s of this.sessions.values()) {
      if (!isTerminal(s)) continue;
      if (s.initiator.userId !== userId && s.recipient.userId !== userId) continue;
      if (!best || s.updatedAt > best.updatedAt) best = s;
    }
    return best;
  }

  sideOf(s: TradeSession, userId: number): TradeSide | null {
    if (s.initiator.userId === userId) return s.initiator;
    if (s.recipient.userId === userId) return s.recipient;
    return null;
  }

  otherSide(s: TradeSession, userId: number): TradeSide | null {
    if (s.initiator.userId === userId) return s.recipient;
    if (s.recipient.userId === userId) return s.initiator;
    return null;
  }

  isParticipant(s: TradeSession, userId: number): boolean {
    return s.initiator.userId === userId || s.recipient.userId === userId;
  }

  /**
   * Create a pending invite from `initiator` to `recipient`. Returns an error
   * string if either party is already busy in a live trade.
   */
  invite(
    initiator: { id: number; displayName: string; avatarUrl: string },
    recipient: { id: number; displayName: string; avatarUrl: string },
  ): { session?: TradeSession; error?: string } {
    if (initiator.id === recipient.id) {
      return { error: "You cannot trade with yourself" };
    }
    if (this.liveSessionFor(initiator.id)) {
      return { error: "You are already in a trade" };
    }
    if (this.liveSessionFor(recipient.id)) {
      return { error: "That player is already in a trade" };
    }
    const now = Date.now();
    const session: TradeSession = {
      id: `trade_${randomBytes(10).toString("hex")}`,
      initiator: makeSide(initiator),
      recipient: makeSide(recipient),
      status: "pending",
      createdAt: now,
      updatedAt: now,
      version: 1,
      settling: false,
    };
    this.sessions.set(session.id, session);
    return { session };
  }

  /** Recipient accepts (→ active) or declines (→ declined) a pending invite. */
  respond(
    id: string,
    userId: number,
    accept: boolean,
  ): { session?: TradeSession; error?: string } {
    const s = this.sessions.get(id);
    if (!s) return { error: "Trade not found" };
    if (s.recipient.userId !== userId) {
      return { error: "Only the invited player can respond" };
    }
    if (s.status !== "pending") return { error: "Invite is no longer pending" };
    s.status = accept ? "active" : "declined";
    this.bump(s);
    return { session: s };
  }

  /**
   * Replace a participant's full offer. Any change resets BOTH confirmations so
   * neither party can sneak an edit past an already-confirmed counterpart.
   */
  setOffer(
    id: string,
    userId: number,
    itemIds: number[],
    currency: CurrencyBag,
  ): { session?: TradeSession; error?: string } {
    const s = this.sessions.get(id);
    if (!s) return { error: "Trade not found" };
    if (s.status !== "active") return { error: "Trade is not active" };
    const side = this.sideOf(s, userId);
    if (!side) return { error: "You are not part of this trade" };
    side.itemIds = Array.from(new Set(itemIds.filter((n) => Number.isInteger(n) && n > 0)));
    side.currency = currency;
    s.initiator.confirmed = false;
    s.recipient.confirmed = false;
    this.bump(s);
    return { session: s };
  }

  /** Set a participant's confirmation flag. */
  setConfirm(
    id: string,
    userId: number,
    confirmed: boolean,
  ): { session?: TradeSession; error?: string } {
    const s = this.sessions.get(id);
    if (!s) return { error: "Trade not found" };
    if (s.status !== "active") return { error: "Trade is not active" };
    const side = this.sideOf(s, userId);
    if (!side) return { error: "You are not part of this trade" };
    side.confirmed = confirmed;
    this.bump(s);
    return { session: s };
  }

  bothConfirmed(s: TradeSession): boolean {
    return s.initiator.confirmed && s.recipient.confirmed;
  }

  /** Cancel a live trade, returning everything (terminal state). */
  cancel(id: string, userId: number): { session?: TradeSession; error?: string } {
    const s = this.sessions.get(id);
    if (!s) return { error: "Trade not found" };
    if (!this.isParticipant(s, userId)) {
      return { error: "You are not part of this trade" };
    }
    if (isTerminal(s)) return { session: s };
    if (s.settling) return { error: "Trade is settling" };
    s.status = "cancelled";
    this.bump(s);
    return { session: s };
  }

  /** Mark settlement complete; sets terminal status and clears the busy flag. */
  markSettled(s: TradeSession): void {
    s.status = "settled";
    s.settling = false;
    this.bump(s);
  }

  /** Roll back a failed settlement attempt to a cancelled terminal state. */
  markFailed(s: TradeSession, note: string): void {
    s.status = "cancelled";
    s.settling = false;
    s.note = note;
    this.bump(s);
  }

  remove(id: string): void {
    this.sessions.delete(id);
  }

  private bump(s: TradeSession): void {
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
          s.note = "Invite expired";
          this.bump(s);
        }
      } else if (s.status === "active") {
        if (age > ACTIVE_TTL && !s.settling) {
          s.status = "cancelled";
          s.note = "Trade timed out";
          this.bump(s);
        }
      }
    }
  }
}

export const tradeStore = new TradeStore();
