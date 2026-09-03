import type { CoopParty } from "@workspace/api-client-react";

// ---------------------------------------------------------------------------
// CoopRunClient — live connection to the co-op session layer for an in-progress
// run. Mirrors the overworld PresenceClient's transport strategy: try a
// WebSocket first (`/api/coop/ws`), and transparently fall back to HTTP polling
// (`/api/coop/sync` + `/api/coop/combat`) when the proxy cannot upgrade.
//
// In-run responsibilities:
//   - broadcast our position/health so teammates can render us;
//   - broadcast our reward events (enemy/node/chest/boss) and status
//     (down/revive) so the server keeps the authoritative shared tally and
//     teammates' clients can mark the same entities cleared;
//   - expose teammates' latest telemetry (pull-style, read each frame) and a
//     drainable queue of incoming combat relays.
// ---------------------------------------------------------------------------

export type CoopCombatKind = "enemy" | "node" | "chest" | "boss" | "down" | "revive";

export interface CoopTeammate {
  userId: number;
  displayName: string;
  avatarUrl: string;
  x: number;
  y: number;
  facing: number;
  moving: boolean;
  chamberIndex: number;
  hp: number;
  maxHp: number;
}

export interface CoopTelemetry {
  x: number;
  y: number;
  facing: number;
  moving: boolean;
  chamberIndex: number;
  hp: number;
  maxHp: number;
}

interface CombatRelay {
  userId: number;
  kind: CoopCombatKind;
  id: string;
}

type Transport = "connecting" | "websocket" | "polling";

const WS_CONNECT_TIMEOUT = 3000;
const POLL_INTERVAL = 500;
const WS_HEARTBEAT = 5000;

function wsUrl(): string {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}/api/coop/ws`;
}

export class CoopRunClient {
  private readonly myUserId: number;
  private members = new Map<number, CoopTeammate>();
  private incomingCombat: CombatRelay[] = [];
  private tele: CoopTelemetry = { x: 0, y: 0, facing: 1, moving: false, chamberIndex: 0, hp: 1, maxHp: 1 };
  private since = 0;

  private ws: WebSocket | null = null;
  private wsTimer: number | null = null;
  private heartbeatTimer: number | null = null;
  private pollTimer: number | null = null;
  private pollInFlight = false;
  private stopped = false;

  transport: Transport = "connecting";
  onTransportChange?: (t: Transport) => void;
  /** Fired whenever the party snapshot changes (member join/leave/down). */
  onParty?: (party: CoopParty | null) => void;

  constructor(myUserId: number) {
    this.myUserId = myUserId;
  }

  start(initial: CoopTelemetry): void {
    this.tele = { ...initial };
    this.connectWebSocket();
  }

  /** Latest known telemetry of every OTHER party member. */
  getTeammates(): CoopTeammate[] {
    return [...this.members.values()].filter((m) => m.userId !== this.myUserId);
  }

  /** Drain combat relays received from teammates since the last call. */
  drainCombat(): CombatRelay[] {
    if (this.incomingCombat.length === 0) return [];
    const out = this.incomingCombat;
    this.incomingCombat = [];
    return out;
  }

  sendTelemetry(t: CoopTelemetry): void {
    this.tele = { ...t };
    if (this.transport === "websocket" && this.ws?.readyState === WebSocket.OPEN) {
      this.wsSend({ t: "pos", ...t });
    }
    // Polling transport reads this.tele on its next tick.
  }

  sendCombat(kind: CoopCombatKind, id: string): void {
    if (this.transport === "websocket" && this.ws?.readyState === WebSocket.OPEN) {
      this.wsSend({ t: "combat", kind, id });
    } else {
      void this.postCombat(kind, id);
    }
  }

  stop(): void {
    this.stopped = true;
    this.clearTimers();
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        /* ignore */
      }
      this.ws = null;
    }
  }

  // --- WebSocket transport ---------------------------------------------------

  private connectWebSocket(): void {
    if (this.stopped) return;
    let ws: WebSocket;
    try {
      ws = new WebSocket(wsUrl());
    } catch {
      this.fallbackToPolling();
      return;
    }
    this.ws = ws;

    this.wsTimer = window.setTimeout(() => {
      if (ws.readyState !== WebSocket.OPEN) {
        try {
          ws.close();
        } catch {
          /* ignore */
        }
        this.fallbackToPolling();
      }
    }, WS_CONNECT_TIMEOUT);

    ws.onopen = () => {
      if (this.stopped) {
        try {
          ws.close();
        } catch {
          /* ignore */
        }
        return;
      }
      this.clearWsTimer();
      this.setTransport("websocket");
      // Announce our presence immediately so teammates see us this chamber.
      this.wsSend({ t: "pos", ...this.tele });
      this.heartbeatTimer = window.setInterval(() => this.wsSend({ t: "ping" }), WS_HEARTBEAT);
    };

    ws.onmessage = (ev) => {
      let data: Record<string, unknown>;
      try {
        data = JSON.parse(ev.data as string);
      } catch {
        return;
      }
      if (data.kind === "hello") {
        this.applyParty(data.party as CoopParty | null);
      } else if (data.kind === "coop") {
        this.applyRelay(data.relay as Record<string, unknown>);
      }
    };

    ws.onerror = () => {
      // onclose handles the fallback.
    };

    ws.onclose = () => {
      this.clearWsTimer();
      if (this.heartbeatTimer) {
        window.clearInterval(this.heartbeatTimer);
        this.heartbeatTimer = null;
      }
      if (this.stopped) return;
      this.ws = null;
      this.fallbackToPolling();
    };
  }

  private wsSend(payload: Record<string, unknown>): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify(payload));
      } catch {
        /* ignore */
      }
    }
  }

  // --- Relay application -----------------------------------------------------

  private applyParty(party: CoopParty | null): void {
    if (!party) {
      this.members.clear();
      this.onParty?.(null);
      return;
    }
    const next = new Map<number, CoopTeammate>();
    for (const m of party.members) {
      const existing = this.members.get(m.userId);
      next.set(m.userId, {
        userId: m.userId,
        displayName: m.displayName,
        avatarUrl: m.avatarUrl,
        // Keep last known interpolation target if present.
        x: existing?.x ?? m.x,
        y: existing?.y ?? m.y,
        facing: existing?.facing ?? m.facing,
        moving: existing?.moving ?? m.moving,
        chamberIndex: existing?.chamberIndex ?? m.chamberIndex,
        hp: m.hp,
        maxHp: m.maxHp,
      });
    }
    this.members = next;
    this.onParty?.(party);
  }

  private applyRelay(ev: Record<string, unknown>): void {
    const t = ev.t;
    if (t === "pos") {
      const userId = Number(ev.userId);
      if (userId === this.myUserId) return;
      const m = this.members.get(userId);
      if (m) {
        m.x = Number(ev.x);
        m.y = Number(ev.y);
        m.facing = Number(ev.facing) || 1;
        m.moving = !!ev.moving;
        m.chamberIndex = Number(ev.chamberIndex) || 0;
        m.hp = Number(ev.hp) || 0;
        m.maxHp = Number(ev.maxHp) || 1;
      } else {
        this.members.set(userId, {
          userId,
          displayName: "Ally",
          avatarUrl: "",
          x: Number(ev.x),
          y: Number(ev.y),
          facing: Number(ev.facing) || 1,
          moving: !!ev.moving,
          chamberIndex: Number(ev.chamberIndex) || 0,
          hp: Number(ev.hp) || 0,
          maxHp: Number(ev.maxHp) || 1,
        });
      }
    } else if (t === "combat") {
      const userId = Number(ev.userId);
      if (userId === this.myUserId) return; // our own kills already applied locally
      this.incomingCombat.push({
        userId,
        kind: String(ev.kind) as CoopCombatKind,
        id: String(ev.id ?? ""),
      });
    } else if (t === "party" || t === "run_start") {
      this.applyParty(ev.party as CoopParty | null);
    } else if (t === "disbanded") {
      this.members.clear();
      this.onParty?.(null);
    }
  }

  // --- Polling transport -----------------------------------------------------

  private fallbackToPolling(): void {
    if (this.stopped || this.transport === "polling") return;
    this.setTransport("polling");
    void this.pollOnce();
    this.pollTimer = window.setInterval(() => void this.pollOnce(), POLL_INTERVAL);
  }

  private async pollOnce(): Promise<void> {
    if (this.stopped || this.pollInFlight) return;
    this.pollInFlight = true;
    try {
      const res = await fetch("/api/coop/sync", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ ...this.tele, since: this.since }),
      });
      if (!res.ok) return;
      const data = (await res.json()) as {
        party: CoopParty | null;
        seq: number;
        events: Record<string, unknown>[];
      };
      if (data.party) this.applyParty(data.party);
      for (const ev of data.events ?? []) {
        // pos relays are excluded from the buffer server-side; party snapshot
        // carries the latest positions instead. Apply discrete events here.
        this.applyRelay(ev);
      }
      this.since = data.seq;
    } catch {
      /* transient — retry next tick */
    } finally {
      this.pollInFlight = false;
    }
  }

  private async postCombat(kind: CoopCombatKind, id: string): Promise<void> {
    try {
      await fetch("/api/coop/combat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ kind, id }),
      });
    } catch {
      /* ignore */
    }
  }

  // --- helpers ---------------------------------------------------------------

  private setTransport(t: Transport): void {
    if (this.transport === t) return;
    this.transport = t;
    this.onTransportChange?.(t);
  }

  private clearWsTimer(): void {
    if (this.wsTimer) {
      window.clearTimeout(this.wsTimer);
      this.wsTimer = null;
    }
  }

  private clearTimers(): void {
    this.clearWsTimer();
    if (this.heartbeatTimer) {
      window.clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.pollTimer) {
      window.clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }
}
