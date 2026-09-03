import { EventEmitter } from "node:events";
import { randomBytes } from "node:crypto";
import type { ChamberLayoutData } from "@workspace/db";

// ---------------------------------------------------------------------------
// Co-op party + run session layer.
//
// Like presence.ts this is in-memory and ephemeral: a party is a "who is teaming
// up right now" signal, and an in-run session is the real-time relay that keeps
// teammates' positions and shared enemy clears in sync. None of it is persisted;
// the durable artifacts (the per-member run rows and their settled economy) live
// in Postgres. This module is the reusable real-time session foundation that PvP
// duels will build on later.
//
// Authority model: combat is client-simulated (matching the rest of the game),
// but the shared reward tally kept here IS server-authoritative — every kill /
// harvest / chest a teammate reports is validated against the run's actual
// chamber content and deduplicated by spawn id, so the party can never be
// credited for more content than the dungeon holds, no matter what a client
// claims. Reward settlement reads this tally, never the raw client counters.
// ---------------------------------------------------------------------------

export const MAX_PARTY = 4;
const STALE_MS = 30_000; // forming members not heard from this long are dropped
const SWEEP_MS = 8_000;
const EMPTY_PARTY_TTL_MS = 60_000; // disband a finished/empty party after this

export type PartyStatus = "forming" | "in_run" | "finished";
export type MemberStatus = "joined" | "in_run" | "finished" | "downed";

export interface PartyMember {
  userId: number;
  displayName: string;
  avatarUrl: string;
  ready: boolean;
  status: MemberStatus;
  runId: number | null;
  // Live in-run telemetry (relayed to teammates; not authoritative).
  x: number;
  y: number;
  facing: number;
  moving: boolean;
  chamberIndex: number;
  hp: number;
  maxHp: number;
  lastSeen: number;
}

interface SharedTally {
  enemies: Set<string>;
  nodes: Set<string>;
  chests: Set<string>;
  boss: boolean;
}

interface ValidIds {
  enemies: Set<string>;
  nodes: Set<string>;
  chests: Set<string>;
  hasBoss: boolean;
}

interface Party {
  partyId: string;
  hostUserId: number;
  labyrinthId: number;
  status: PartyStatus;
  members: Map<number, PartyMember>;
  invites: Map<number, { displayName: string; at: number }>;
  chambers: ChamberLayoutData[] | null;
  tally: SharedTally;
  valid: ValidIds | null;
  // Frozen at run start so reward splits stay deterministic even if a member
  // disconnects mid-run.
  startOrder: number[];
  startPartySize: number;
  createdAt: number;
  finishedAt: number | null;
}

export interface MemberDto {
  userId: number;
  displayName: string;
  avatarUrl: string;
  ready: boolean;
  status: MemberStatus;
  runId: number | null;
  chamberIndex: number;
  x: number;
  y: number;
  facing: number;
  moving: boolean;
  hp: number;
  maxHp: number;
}

export interface InviteDto {
  userId: number;
  displayName: string;
}

export interface PartyDto {
  partyId: string;
  hostUserId: number;
  labyrinthId: number;
  status: PartyStatus;
  members: MemberDto[];
  invites: InviteDto[];
  partySize: number;
}

// Lean relay event the socket layer fans out to a party's connected members.
export type CoopRelay =
  | { t: "party"; party: PartyDto }
  | { t: "run_start"; party: PartyDto }
  | { t: "disbanded"; partyId: string }
  | { t: "pos"; userId: number; x: number; y: number; facing: number; moving: boolean; chamberIndex: number; hp: number; maxHp: number }
  | { t: "combat"; userId: number; kind: CombatKind; id: string };

export type CombatKind = "enemy" | "node" | "chest" | "boss" | "down" | "revive";

// What the socket/route layer receives and routes. `party` events go to all
// current party members; `user` events go to a single (possibly not-yet-member)
// recipient — used for invites.
export type CoopBroadcast =
  | { scope: "party"; partyId: string; relay: CoopRelay }
  | { scope: "user"; userId: number; relay: CoopRelay };

function newPartyId(): string {
  return `party_${randomBytes(6).toString("hex")}`;
}

function memberToDto(m: PartyMember): MemberDto {
  return {
    userId: m.userId,
    displayName: m.displayName,
    avatarUrl: m.avatarUrl,
    ready: m.ready,
    status: m.status,
    runId: m.runId,
    chamberIndex: m.chamberIndex,
    x: m.x,
    y: m.y,
    facing: m.facing,
    moving: m.moving,
    hp: m.hp,
    maxHp: m.maxHp,
  };
}

export interface UserInfo {
  id: number;
  displayName: string;
  avatarUrl: string;
}

const EVENT_BUFFER = 200;

class CoopStore {
  private parties = new Map<string, Party>();
  private userParty = new Map<number, string>();
  /** Emits ("broadcast", CoopBroadcast) for the socket/route layers. */
  readonly emitter = new EventEmitter();
  // Ring buffer of party-scoped relays for the HTTP polling fallback. Positions
  // are intentionally excluded (the latest is always in the party snapshot); we
  // only buffer discrete events polling clients would otherwise miss.
  private events: { seq: number; partyId: string; relay: CoopRelay }[] = [];
  private seq = 0;

  constructor() {
    this.emitter.setMaxListeners(0);
    const timer = setInterval(() => this.sweep(), SWEEP_MS);
    if (typeof timer.unref === "function") timer.unref();
  }

  private emit(b: CoopBroadcast): void {
    if (b.scope === "party" && b.relay.t !== "pos") {
      this.seq += 1;
      this.events.push({ seq: this.seq, partyId: b.partyId, relay: b.relay });
      if (this.events.length > EVENT_BUFFER) {
        this.events.splice(0, this.events.length - EVENT_BUFFER);
      }
    }
    this.emitter.emit("broadcast", b);
  }

  get currentSeq(): number {
    return this.seq;
  }

  relaysSince(partyId: string, since: number): CoopRelay[] {
    if (!Number.isFinite(since) || since < 0) return [];
    return this.events.filter((e) => e.partyId === partyId && e.seq > since).map((e) => e.relay);
  }

  private dto(p: Party): PartyDto {
    return {
      partyId: p.partyId,
      hostUserId: p.hostUserId,
      labyrinthId: p.labyrinthId,
      status: p.status,
      members: [...p.members.values()].map(memberToDto),
      invites: [...p.invites.entries()].map(([userId, v]) => ({ userId, displayName: v.displayName })),
      partySize: p.members.size,
    };
  }

  private broadcastParty(p: Party): void {
    this.emit({ scope: "party", partyId: p.partyId, relay: { t: "party", party: this.dto(p) } });
  }

  partyOf(userId: number): PartyDto | null {
    const id = this.userParty.get(userId);
    if (!id) return null;
    const p = this.parties.get(id);
    return p ? this.dto(p) : null;
  }

  getParty(partyId: string): PartyDto | null {
    const p = this.parties.get(partyId);
    return p ? this.dto(p) : null;
  }

  /**
   * Forming parties that have an outstanding invite addressed to `userId`. Lets
   * an invited player (who is not yet a member) discover and accept invites via
   * the GET /coop/party poll without needing a live socket.
   */
  invitationsFor(userId: number): { partyId: string; hostUserId: number; labyrinthId: number; memberCount: number }[] {
    const out: { partyId: string; hostUserId: number; labyrinthId: number; memberCount: number }[] = [];
    for (const p of this.parties.values()) {
      if (p.status === "forming" && p.invites.has(userId)) {
        out.push({ partyId: p.partyId, hostUserId: p.hostUserId, labyrinthId: p.labyrinthId, memberCount: p.members.size });
      }
    }
    return out;
  }

  /** userIds currently in a party — used by the socket layer to fan out. */
  memberIds(partyId: string): number[] {
    const p = this.parties.get(partyId);
    return p ? [...p.members.keys()] : [];
  }

  /** Create a fresh party hosted by `user` for `labyrinthId`. Leaves any prior party. */
  createParty(user: UserInfo, labyrinthId: number): PartyDto {
    this.leave(user.id);
    const party: Party = {
      partyId: newPartyId(),
      hostUserId: user.id,
      labyrinthId,
      status: "forming",
      members: new Map(),
      invites: new Map(),
      chambers: null,
      tally: { enemies: new Set(), nodes: new Set(), chests: new Set(), boss: false },
      valid: null,
      startOrder: [],
      startPartySize: 1,
      createdAt: Date.now(),
      finishedAt: null,
    };
    party.members.set(user.id, this.newMember(user, true));
    this.parties.set(party.partyId, party);
    this.userParty.set(user.id, party.partyId);
    const dto = this.dto(party);
    this.broadcastParty(party);
    return dto;
  }

  private newMember(user: UserInfo, ready: boolean): PartyMember {
    return {
      userId: user.id,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
      ready,
      status: "joined",
      runId: null,
      x: 0,
      y: 0,
      facing: 1,
      moving: false,
      chamberIndex: 0,
      hp: 100,
      maxHp: 100,
      lastSeen: Date.now(),
    };
  }

  /** Host (or any member) invites another user to a forming party. */
  invite(byUserId: number, targetUser: UserInfo): { ok: true; party: PartyDto } | { ok: false; error: string } {
    const partyId = this.userParty.get(byUserId);
    if (!partyId) return { ok: false, error: "You are not in a party" };
    const p = this.parties.get(partyId)!;
    if (p.status !== "forming") return { ok: false, error: "Run already started" };
    if (targetUser.id === byUserId) return { ok: false, error: "You cannot invite yourself" };
    if (p.members.has(targetUser.id)) return { ok: false, error: "Already in the party" };
    if (p.members.size + p.invites.size >= MAX_PARTY) return { ok: false, error: "Party is full" };
    if (this.userParty.has(targetUser.id)) return { ok: false, error: "That player is already in a party" };
    p.invites.set(targetUser.id, { displayName: targetUser.displayName, at: Date.now() });
    this.broadcastParty(p);
    // Notify the invited user directly so their client can surface the prompt.
    this.emit({ scope: "user", userId: targetUser.id, relay: { t: "party", party: this.dto(p) } });
    return { ok: true, party: this.dto(p) };
  }

  /** Invited user accepts and joins the party. */
  acceptInvite(user: UserInfo, partyId: string): { ok: true; party: PartyDto } | { ok: false; error: string } {
    const p = this.parties.get(partyId);
    if (!p) return { ok: false, error: "Party no longer exists" };
    if (!p.invites.has(user.id)) return { ok: false, error: "You were not invited" };
    if (p.status !== "forming") return { ok: false, error: "Run already started" };
    if (p.members.size >= MAX_PARTY) return { ok: false, error: "Party is full" };
    if (this.userParty.has(user.id)) this.leave(user.id);
    p.invites.delete(user.id);
    p.members.set(user.id, this.newMember(user, true));
    this.userParty.set(user.id, p.partyId);
    this.broadcastParty(p);
    return { ok: true, party: this.dto(p) };
  }

  declineInvite(userId: number, partyId: string): void {
    const p = this.parties.get(partyId);
    if (!p) return;
    if (p.invites.delete(userId)) {
      this.broadcastParty(p);
      this.emit({ scope: "user", userId, relay: { t: "disbanded", partyId } });
    }
  }

  setReady(userId: number, ready: boolean): void {
    const partyId = this.userParty.get(userId);
    if (!partyId) return;
    const p = this.parties.get(partyId)!;
    const m = p.members.get(userId);
    if (!m) return;
    m.ready = ready;
    m.lastSeen = Date.now();
    this.broadcastParty(p);
  }

  /** Remove a user from whatever party they are in. Handles host transfer / disband. */
  leave(userId: number): void {
    const partyId = this.userParty.get(userId);
    if (!partyId) return;
    const p = this.parties.get(partyId);
    this.userParty.delete(userId);
    if (!p) return;
    const wasMember = p.members.delete(userId);
    if (!wasMember) return;
    // Notify the leaver's own client that it is no longer in this party.
    this.emit({ scope: "user", userId, relay: { t: "disbanded", partyId } });
    if (p.members.size === 0) {
      this.disband(p);
      return;
    }
    if (p.hostUserId === userId) {
      // Transfer host to the earliest-joined remaining member.
      p.hostUserId = [...p.members.keys()][0]!;
    }
    this.broadcastParty(p);
  }

  private disband(p: Party): void {
    for (const id of p.members.keys()) this.userParty.delete(id);
    this.parties.delete(p.partyId);
    this.emit({ scope: "party", partyId: p.partyId, relay: { t: "disbanded", partyId: p.partyId } });
  }

  /**
   * Mark a party as started. Records the per-member run rows + the shared chamber
   * layout, freezes member order/size for deterministic reward splitting, and
   * derives the authoritative set of reward-bearing spawn ids from the content.
   */
  startRun(
    partyId: string,
    runIdByUser: Map<number, number>,
    chambers: ChamberLayoutData[],
  ): PartyDto | null {
    const p = this.parties.get(partyId);
    if (!p) return null;
    p.status = "in_run";
    p.chambers = chambers;
    p.valid = deriveValidIds(chambers);
    // Only members who actually received a run row participate.
    const started = [...p.members.values()].filter((m) => runIdByUser.has(m.userId));
    p.startOrder = started.map((m) => m.userId).sort((a, b) => a - b);
    p.startPartySize = Math.max(1, p.startOrder.length);
    for (const m of p.members.values()) {
      const rid = runIdByUser.get(m.userId);
      if (rid != null) {
        m.runId = rid;
        m.status = "in_run";
        m.chamberIndex = 0;
      }
    }
    this.emit({ scope: "party", partyId, relay: { t: "run_start", party: this.dto(p) } });
    return this.dto(p);
  }

  updatePosition(
    userId: number,
    pos: { x: number; y: number; facing: number; moving: boolean; chamberIndex: number; hp: number; maxHp: number },
  ): void {
    const partyId = this.userParty.get(userId);
    if (!partyId) return;
    const p = this.parties.get(partyId);
    if (!p) return;
    const m = p.members.get(userId);
    if (!m) return;
    m.x = pos.x;
    m.y = pos.y;
    m.facing = pos.facing < 0 ? -1 : 1;
    m.moving = !!pos.moving;
    m.chamberIndex = Math.max(0, pos.chamberIndex | 0);
    m.hp = Math.max(0, pos.hp | 0);
    m.maxHp = Math.max(1, pos.maxHp | 0);
    m.status = m.hp <= 0 ? "downed" : "in_run";
    m.lastSeen = Date.now();
    this.emit({
      scope: "party",
      partyId,
      relay: {
        t: "pos",
        userId,
        x: m.x,
        y: m.y,
        facing: m.facing,
        moving: m.moving,
        chamberIndex: m.chamberIndex,
        hp: m.hp,
        maxHp: m.maxHp,
      },
    });
  }

  /**
   * Record a combat event from a teammate. Returns true if it was a NEW,
   * content-valid reward event (so the caller may relay it). Kills/harvests are
   * validated against the run's actual spawn ids and deduplicated, which is what
   * keeps the shared reward tally honest.
   */
  recordCombat(userId: number, kind: CombatKind, id: string): boolean {
    const partyId = this.userParty.get(userId);
    if (!partyId) return false;
    const p = this.parties.get(partyId);
    if (!p || !p.valid) return false;
    const m = p.members.get(userId);
    if (m) m.lastSeen = Date.now();

    let newReward = false;
    if (kind === "enemy") {
      if (p.valid.enemies.has(id) && !p.tally.enemies.has(id)) {
        p.tally.enemies.add(id);
        newReward = true;
      }
    } else if (kind === "node") {
      if (p.valid.nodes.has(id) && !p.tally.nodes.has(id)) {
        p.tally.nodes.add(id);
        newReward = true;
      }
    } else if (kind === "chest") {
      if (p.valid.chests.has(id) && !p.tally.chests.has(id)) {
        p.tally.chests.add(id);
        newReward = true;
      }
    } else if (kind === "boss") {
      if (p.valid.hasBoss && !p.tally.boss) {
        p.tally.boss = true;
        newReward = true;
      }
    }
    // down / revive carry no reward but are always relayed for teammate UI.
    const relayable = newReward || kind === "down" || kind === "revive";
    if (relayable) {
      this.emit({ scope: "party", partyId, relay: { t: "combat", userId, kind, id } });
    }
    return newReward;
  }

  /**
   * Reward-settlement view for a single member at completion. Splits the shared
   * tally evenly across the frozen party size (floor + remainder by stable
   * index) so the whole party's credited content sums to the tally exactly.
   */
  settlementFor(
    partyId: string,
    userId: number,
  ): { partySize: number; enemies: number; nodes: number; chests: number; boss: boolean; cleared: boolean } | null {
    const p = this.parties.get(partyId);
    if (!p || p.startPartySize <= 0) return null;
    const order = p.startOrder.length > 0 ? p.startOrder : [...p.members.keys()].sort((a, b) => a - b);
    const idx = order.indexOf(userId);
    const size = p.startPartySize;
    const share = (total: number): number => {
      const base = Math.floor(total / size);
      const rem = total % size;
      const i = idx < 0 ? 0 : idx;
      return base + (i < rem ? 1 : 0);
    };
    // The boss is a single indivisible kill: credit it to the first member slot.
    const bossForMe = p.tally.boss && idx <= 0;
    // The party cleared when its deduped kills cover every enemy spawn and (if
    // there is a boss) the boss is down.
    const partyCleared =
      p.valid != null &&
      p.tally.enemies.size >= p.valid.enemies.size &&
      (!p.valid.hasBoss || p.tally.boss);
    return {
      partySize: size,
      enemies: share(p.tally.enemies.size),
      nodes: share(p.tally.nodes.size),
      chests: share(p.tally.chests.size),
      boss: bossForMe,
      cleared: partyCleared,
    };
  }

  markFinished(userId: number): void {
    const partyId = this.userParty.get(userId);
    if (!partyId) return;
    const p = this.parties.get(partyId);
    if (!p) return;
    const m = p.members.get(userId);
    if (m) {
      m.status = "finished";
      m.lastSeen = Date.now();
    }
    const allDone = [...p.members.values()].every((mm) => mm.status === "finished");
    if (allDone) {
      p.status = "finished";
      p.finishedAt = Date.now();
    }
    this.broadcastParty(p);
  }

  touch(userId: number): void {
    const partyId = this.userParty.get(userId);
    if (!partyId) return;
    const m = this.parties.get(partyId)?.members.get(userId);
    if (m) m.lastSeen = Date.now();
  }

  /**
   * HTTP polling-fallback workhorse: optionally applies the caller's in-run
   * telemetry, refreshes presence, and returns the latest party snapshot plus
   * any discrete relays (combat/run_start/...) since the caller's cursor.
   */
  pollSync(
    userId: number,
    telemetry: { x: number; y: number; facing: number; moving: boolean; chamberIndex: number; hp: number; maxHp: number } | null,
    since: number,
  ): { party: PartyDto | null; seq: number; events: CoopRelay[] } {
    const partyId = this.userParty.get(userId);
    if (!partyId) return { party: null, seq: this.seq, events: [] };
    if (telemetry) this.updatePosition(userId, telemetry);
    else this.touch(userId);
    return {
      party: this.partyOf(userId),
      seq: this.seq,
      events: this.relaysSince(partyId, since),
    };
  }

  private sweep(): void {
    const now = Date.now();
    for (const p of [...this.parties.values()]) {
      // While forming, drop members who have gone silent (closed tab without a
      // clean leave). In-run members are kept; their run continues regardless.
      if (p.status === "forming") {
        for (const m of [...p.members.values()]) {
          if (now - m.lastSeen > STALE_MS) this.leave(m.userId);
        }
      }
      // Expire stale invites.
      let invitesChanged = false;
      for (const [uid, inv] of [...p.invites.entries()]) {
        if (now - inv.at > STALE_MS * 2) {
          p.invites.delete(uid);
          invitesChanged = true;
        }
      }
      const fresh = this.parties.get(p.partyId);
      if (fresh && invitesChanged) this.broadcastParty(fresh);
      // Disband finished/empty parties after a grace period.
      if (fresh && (fresh.status === "finished" || fresh.members.size === 0)) {
        const since = fresh.finishedAt ?? fresh.createdAt;
        if (now - since > EMPTY_PARTY_TTL_MS) this.disband(fresh);
      }
    }
  }
}

function deriveValidIds(chambers: ChamberLayoutData[]): ValidIds {
  const enemies = new Set<string>();
  const nodes = new Set<string>();
  const chests = new Set<string>();
  let hasBoss = false;
  for (const c of chambers) {
    for (const s of c.spawns ?? []) {
      const sid = String(s.id);
      if (s.type === "enemy" || s.type === "elite") enemies.add(sid);
      else if (s.type === "node") nodes.add(sid);
      else if (s.type === "chest") chests.add(sid);
      else if (s.type === "boss") hasBoss = true;
    }
  }
  return { enemies, nodes, chests, hasBoss };
}

export const coop = new CoopStore();
