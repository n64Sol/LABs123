import { EventEmitter } from "node:events";

// ---------------------------------------------------------------------------
// Ephemeral overworld presence.
//
// All state here is in-memory and intentionally NOT persisted: presence is a
// "who is on the map right now" signal, not durable game state. A single
// designed overworld means there is one global room. Players are keyed by a
// per-connection clientId so the same user can open multiple tabs.
// ---------------------------------------------------------------------------

/**
 * A character appearance is a flat `{ lpcLayerKey -> relativeAssetPath }` map of
 * the layers composed over the base body. It is cosmetic and client-supplied, so
 * it is sanitized at the transport boundary (see {@link sanitizeSpriteLayers}).
 */
export type SpriteLayers = Record<string, string>;

export interface PresencePlayer {
  clientId: string;
  userId: number;
  displayName: string;
  avatarUrl: string;
  spriteLayers?: SpriteLayers;
  x: number;
  y: number;
  facing: number; // -1 = left, 1 = right (for label/orientation hints)
  moving: boolean;
  lastSeen: number;
}

export interface PublicPlayer {
  clientId: string;
  userId: number;
  displayName: string;
  avatarUrl: string;
  spriteLayers?: SpriteLayers;
  x: number;
  y: number;
  facing: number;
  moving: boolean;
}

export type OverworldEvent =
  | { seq: number; t: "join"; player: PublicPlayer }
  | { seq: number; t: "move"; clientId: string; x: number; y: number; facing: number; moving: boolean }
  | { seq: number; t: "emote"; clientId: string; emote: string; at: number }
  | { seq: number; t: "chat"; clientId: string; text: string; at: number }
  | { seq: number; t: "appearance"; clientId: string; spriteLayers: SpriteLayers }
  | { seq: number; t: "leave"; clientId: string };

// Distributive Omit so the discriminated union survives stripping `seq`.
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
type OverworldEventInput = DistributiveOmit<OverworldEvent, "seq">;

const STALE_MS = 12_000; // remove a player not heard from in this window
const SWEEP_MS = 4_000;
const EVENT_BUFFER = 250; // ring buffer size for polling clients
export const EMOTES = ["wave", "laugh", "love", "wow", "angry", "party"] as const;
export type Emote = (typeof EMOTES)[number];
const MAX_CHAT_LEN = 160;
// Legacy designed-canvas dimensions, retained for the /meta backward-compat
// fields. The overworld is now unbounded; positions are clamped to ±WORLD_LIMIT
// (a sane abuse guard, far beyond any land plot) rather than these bounds.
export const WORLD_W = 2400;
export const WORLD_H = 1600;
const WORLD_LIMIT = 250_000;

function toPublic(p: PresencePlayer): PublicPlayer {
  return {
    clientId: p.clientId,
    userId: p.userId,
    displayName: p.displayName,
    avatarUrl: p.avatarUrl,
    spriteLayers: p.spriteLayers,
    x: p.x,
    y: p.y,
    facing: p.facing,
    moving: p.moving,
  };
}

function clamp(v: number, lo: number, hi: number): number {
  if (Number.isNaN(v)) return lo;
  return Math.max(lo, Math.min(hi, v));
}

const MAX_SPRITE_LAYERS = 24;
const MAX_LAYER_KEY_LEN = 40;
// Cosmetic appearance paths are client-supplied, so only accept relative asset
// paths under public/game/*.png — never absolute/remote URLs or traversal. This
// keeps a spoofed presence message from pointing other players' browsers at
// arbitrary resources.
const SAFE_LAYER_PATH = /^game\/[A-Za-z0-9_./-]+\.png$/;

/**
 * Validate an untrusted sprite-layer map from a presence client. Returns a
 * sanitized copy (dropping any unsafe/oversized entries) or `undefined` when the
 * input is not an object. An empty object is returned for "no layers".
 */
export function sanitizeSpriteLayers(input: unknown): SpriteLayers | undefined {
  if (input == null || typeof input !== "object" || Array.isArray(input)) return undefined;
  const out: SpriteLayers = {};
  let n = 0;
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (n >= MAX_SPRITE_LAYERS) break;
    if (typeof k !== "string" || k.length === 0 || k.length > MAX_LAYER_KEY_LEN) continue;
    if (typeof v !== "string" || v.includes("..") || !SAFE_LAYER_PATH.test(v)) continue;
    out[k] = v;
    n += 1;
  }
  return out;
}

/** Stable signature of an appearance map, for cheap change detection. */
function layersSig(layers: SpriteLayers | undefined): string {
  if (!layers) return "";
  const keys = Object.keys(layers).sort();
  return keys.map((k) => `${k}=${layers[k]}`).join("|");
}

class PresenceStore {
  private players = new Map<string, PresencePlayer>();
  private events: OverworldEvent[] = [];
  private seq = 0;
  /** Emits ("event", OverworldEvent) for live (WebSocket) subscribers. */
  readonly emitter = new EventEmitter();

  constructor() {
    this.emitter.setMaxListeners(0);
    const timer = setInterval(() => this.sweep(), SWEEP_MS);
    // Do not keep the process alive solely for the sweep loop.
    if (typeof timer.unref === "function") timer.unref();
  }

  private push(ev: OverworldEventInput): OverworldEvent {
    this.seq += 1;
    const full = { ...ev, seq: this.seq } as OverworldEvent;
    this.events.push(full);
    if (this.events.length > EVENT_BUFFER) {
      this.events.splice(0, this.events.length - EVENT_BUFFER);
    }
    this.emitter.emit("event", full);
    return full;
  }

  get currentSeq(): number {
    return this.seq;
  }

  /**
   * Returns the userId that owns a clientId, or undefined if unknown.
   * Used by the polling routes to reject identity spoofing: a clientId is only
   * actionable by the authenticated user who first claimed it.
   */
  ownerOf(clientId: string): number | undefined {
    return this.players.get(clientId)?.userId;
  }

  snapshot(): PublicPlayer[] {
    return [...this.players.values()].map(toPublic);
  }

  eventsSince(since: number): OverworldEvent[] {
    if (!Number.isFinite(since) || since <= 0) return [];
    return this.events.filter((e) => e.seq > since);
  }

  /**
   * Register or refresh a player. Emits `join` the first time a clientId
   * appears. When an already-present player supplies a *changed* appearance,
   * emits an `appearance` event so others can re-render the new look live.
   */
  join(input: {
    clientId: string;
    userId: number;
    displayName: string;
    avatarUrl: string;
    spriteLayers?: SpriteLayers;
    x?: number;
    y?: number;
  }): PublicPlayer {
    const existing = this.players.get(input.clientId);
    const now = Date.now();
    if (existing) {
      existing.lastSeen = now;
      existing.displayName = input.displayName;
      existing.avatarUrl = input.avatarUrl;
      if (input.spriteLayers !== undefined && layersSig(existing.spriteLayers) !== layersSig(input.spriteLayers)) {
        existing.spriteLayers = input.spriteLayers;
        this.push({ t: "appearance", clientId: existing.clientId, spriteLayers: input.spriteLayers });
      }
      return toPublic(existing);
    }
    const player: PresencePlayer = {
      clientId: input.clientId,
      userId: input.userId,
      displayName: input.displayName,
      avatarUrl: input.avatarUrl,
      spriteLayers: input.spriteLayers,
      x: clamp(input.x ?? 0, -WORLD_LIMIT, WORLD_LIMIT),
      y: clamp(input.y ?? 0, -WORLD_LIMIT, WORLD_LIMIT),
      facing: 1,
      moving: false,
      lastSeen: now,
    };
    this.players.set(player.clientId, player);
    this.push({ t: "join", player: toPublic(player) });
    return toPublic(player);
  }

  /** Update a player's cosmetic appearance and broadcast it if it changed. */
  setAppearance(clientId: string, spriteLayers: SpriteLayers): void {
    const p = this.players.get(clientId);
    if (!p) return;
    p.lastSeen = Date.now();
    if (layersSig(p.spriteLayers) === layersSig(spriteLayers)) return;
    p.spriteLayers = spriteLayers;
    this.push({ t: "appearance", clientId, spriteLayers });
  }

  move(clientId: string, x: number, y: number, facing: number, moving: boolean): void {
    const p = this.players.get(clientId);
    if (!p) return;
    p.x = clamp(x, -WORLD_LIMIT, WORLD_LIMIT);
    p.y = clamp(y, -WORLD_LIMIT, WORLD_LIMIT);
    p.facing = facing < 0 ? -1 : 1;
    p.moving = !!moving;
    p.lastSeen = Date.now();
    this.push({ t: "move", clientId, x: p.x, y: p.y, facing: p.facing, moving: p.moving });
  }

  emote(clientId: string, emote: string): void {
    const p = this.players.get(clientId);
    if (!p) return;
    if (!(EMOTES as readonly string[]).includes(emote)) return;
    p.lastSeen = Date.now();
    this.push({ t: "emote", clientId, emote, at: Date.now() });
  }

  chat(clientId: string, text: string): void {
    const p = this.players.get(clientId);
    if (!p) return;
    const clean = String(text ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_CHAT_LEN);
    if (!clean) return;
    p.lastSeen = Date.now();
    this.push({ t: "chat", clientId, text: clean, at: Date.now() });
  }

  /** Keep a polling client alive without changing position. */
  touch(clientId: string): void {
    const p = this.players.get(clientId);
    if (p) p.lastSeen = Date.now();
  }

  leave(clientId: string): void {
    if (this.players.delete(clientId)) {
      this.push({ t: "leave", clientId });
    }
  }

  private sweep(): void {
    const now = Date.now();
    for (const [id, p] of this.players) {
      if (now - p.lastSeen > STALE_MS) {
        this.players.delete(id);
        this.push({ t: "leave", clientId: id });
      }
    }
  }
}

export const presence = new PresenceStore();
