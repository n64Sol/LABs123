import type { RemotePlayer, TransientEvent, Transport } from "./types";

// ---------------------------------------------------------------------------
// PresenceClient — manages the live connection to the overworld presence layer.
//
// Transport strategy: try a WebSocket first (lowest latency). If the socket
// cannot connect (e.g. the workspace proxy does not upgrade it) or drops after
// connecting, transparently fall back to HTTP polling against the same store.
// The renderer reads `getPlayers()` every animation frame and drains transient
// emote/chat events via `drainEvents()`, so this class exposes pull-style state
// rather than firing a callback on every position update.
// ---------------------------------------------------------------------------

interface Pos {
  x: number;
  y: number;
  facing: number;
  moving: boolean;
}

type SpriteLayers = Record<string, string>;

const WS_CONNECT_TIMEOUT = 3000;
const POLL_INTERVAL = 650;
const WS_HEARTBEAT = 5000;

function apiUrl(path: string): string {
  return `/api/overworld${path}`;
}

function wsUrl(): string {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}/api/overworld/ws`;
}

export class PresenceClient {
  private players = new Map<string, RemotePlayer>();
  private pending: TransientEvent[] = [];
  private myClientId: string | null = null;
  private pos: Pos = { x: 0, y: 0, facing: 1, moving: false };
  private layers: SpriteLayers | null = null;
  private since = 0;

  private ws: WebSocket | null = null;
  private wsTimer: number | null = null;
  private heartbeatTimer: number | null = null;
  private pollTimer: number | null = null;
  private pollInFlight = false;
  private stopped = false;
  private hadOpenSocket = false;

  transport: Transport = "connecting";
  onTransportChange?: (t: Transport) => void;

  start(initial: Pos, layers?: SpriteLayers | null): void {
    this.pos = { ...initial };
    this.layers = layers ?? null;
    this.connectWebSocket();
  }

  /**
   * Update the local player's cosmetic appearance and propagate it. Over a live
   * socket this sends an `appearance` message immediately; under polling the new
   * layers are picked up on the next `/sync` tick.
   */
  setAppearance(layers: SpriteLayers | null): void {
    this.layers = layers;
    if (this.transport === "websocket" && this.ws?.readyState === WebSocket.OPEN) {
      this.wsSend({ t: "appearance", spriteLayers: layers ?? {} });
    }
  }

  getPlayers(): RemotePlayer[] {
    const out: RemotePlayer[] = [];
    for (const p of this.players.values()) {
      if (p.clientId !== this.myClientId) out.push(p);
    }
    return out;
  }

  drainEvents(): TransientEvent[] {
    if (this.pending.length === 0) return [];
    const out = this.pending;
    this.pending = [];
    return out;
  }

  get myId(): string | null {
    return this.myClientId;
  }

  sendMove(x: number, y: number, facing: number, moving: boolean): void {
    this.pos = { x, y, facing, moving };
    if (this.transport === "websocket" && this.ws?.readyState === WebSocket.OPEN) {
      this.wsSend({ t: "move", x, y, facing, moving });
    }
    // Polling transport reads this.pos on its next tick.
  }

  sendEmote(emote: string): void {
    if (this.transport === "websocket" && this.ws?.readyState === WebSocket.OPEN) {
      this.wsSend({ t: "emote", emote });
    } else {
      void this.post("/emote", { emote });
    }
  }

  sendChat(text: string): void {
    const clean = text.trim().slice(0, 160);
    if (!clean) return;
    if (this.transport === "websocket" && this.ws?.readyState === WebSocket.OPEN) {
      this.wsSend({ t: "chat", text: clean });
    } else {
      void this.post("/chat", { text: clean });
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
    // Best-effort leave so others see us disappear promptly.
    if (this.myClientId) {
      const body = JSON.stringify({ clientId: this.myClientId });
      try {
        if (navigator.sendBeacon) {
          navigator.sendBeacon(apiUrl("/leave"), new Blob([body], { type: "application/json" }));
        } else {
          void fetch(apiUrl("/leave"), {
            method: "POST",
            headers: { "content-type": "application/json" },
            credentials: "include",
            body,
            keepalive: true,
          });
        }
      } catch {
        /* ignore */
      }
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
      this.hadOpenSocket = true;
      this.setTransport("websocket");
      this.wsSend({ t: "join", x: this.pos.x, y: this.pos.y, spriteLayers: this.layers ?? {} });
      this.heartbeatTimer = window.setInterval(() => {
        this.wsSend({ t: "ping" });
      }, WS_HEARTBEAT);
    };

    ws.onmessage = (ev) => {
      let data: Record<string, unknown>;
      try {
        data = JSON.parse(ev.data as string);
      } catch {
        return;
      }
      if (data.kind === "welcome") {
        this.myClientId = String(data.clientId);
        this.players.clear();
        const players = (data.players as RemotePlayer[]) ?? [];
        for (const p of players) this.players.set(p.clientId, p);
      } else if (data.kind === "event") {
        this.applyEvent(data.event as Record<string, unknown>);
      }
    };

    ws.onerror = () => {
      // onclose will follow; handle fallback there.
    };

    ws.onclose = () => {
      this.clearWsTimer();
      if (this.heartbeatTimer) {
        window.clearInterval(this.heartbeatTimer);
        this.heartbeatTimer = null;
      }
      if (this.stopped) return;
      // Whether the socket never opened or dropped later, fall back to polling
      // so presence keeps working.
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

  private applyEvent(ev: Record<string, unknown>): void {
    const t = ev.t;
    if (t === "join") {
      const p = ev.player as RemotePlayer;
      if (p && p.clientId !== this.myClientId) this.players.set(p.clientId, p);
    } else if (t === "move") {
      const id = String(ev.clientId);
      const p = this.players.get(id);
      if (p) {
        p.x = Number(ev.x);
        p.y = Number(ev.y);
        p.facing = Number(ev.facing) || 1;
        p.moving = !!ev.moving;
      } else if (id !== this.myClientId) {
        // Move for a player we haven't seen join (e.g. joined before us under
        // polling); create a stub that join/snapshot will enrich.
        this.players.set(id, {
          clientId: id,
          userId: 0,
          displayName: "Adventurer",
          avatarUrl: "",
          x: Number(ev.x),
          y: Number(ev.y),
          facing: Number(ev.facing) || 1,
          moving: !!ev.moving,
        });
      }
    } else if (t === "appearance") {
      const p = this.players.get(String(ev.clientId));
      if (p) p.spriteLayers = (ev.spriteLayers as SpriteLayers) ?? {};
    } else if (t === "leave") {
      this.players.delete(String(ev.clientId));
    } else if (t === "emote") {
      if (String(ev.clientId) !== this.myClientId) {
        this.pending.push({ t: "emote", clientId: String(ev.clientId), emote: String(ev.emote), at: Number(ev.at) });
      }
    } else if (t === "chat") {
      if (String(ev.clientId) !== this.myClientId) {
        this.pending.push({ t: "chat", clientId: String(ev.clientId), text: String(ev.text), at: Number(ev.at) });
      }
    }
  }

  // --- Polling transport -----------------------------------------------------

  private fallbackToPolling(): void {
    if (this.stopped || this.transport === "polling") return;
    if (!this.myClientId) {
      this.myClientId = `poll_${Math.random().toString(36).slice(2, 10)}`;
    }
    this.setTransport("polling");
    void this.pollOnce();
    this.pollTimer = window.setInterval(() => void this.pollOnce(), POLL_INTERVAL);
  }

  private async pollOnce(): Promise<void> {
    if (this.stopped || this.pollInFlight) return;
    this.pollInFlight = true;
    try {
      const res = await fetch(apiUrl("/sync"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          clientId: this.myClientId,
          x: this.pos.x,
          y: this.pos.y,
          facing: this.pos.facing,
          moving: this.pos.moving,
          spriteLayers: this.layers ?? {},
          since: this.since,
        }),
      });
      if (!res.ok) return;
      const data = (await res.json()) as {
        clientId: string;
        seq: number;
        players: RemotePlayer[];
        events: Record<string, unknown>[];
      };
      this.myClientId = data.clientId;
      // Rebuild snapshot, preserving objects so the renderer's interpolation
      // keeps continuity for surviving players.
      const next = new Map<string, RemotePlayer>();
      for (const p of data.players) {
        const existing = this.players.get(p.clientId);
        if (existing) {
          existing.x = p.x;
          existing.y = p.y;
          existing.facing = p.facing;
          existing.moving = p.moving;
          existing.displayName = p.displayName;
          existing.avatarUrl = p.avatarUrl;
          existing.spriteLayers = p.spriteLayers;
          next.set(p.clientId, existing);
        } else {
          next.set(p.clientId, p);
        }
      }
      this.players = next;
      for (const ev of data.events ?? []) {
        if (ev.t === "emote" || ev.t === "chat") this.applyEvent(ev);
      }
      this.since = data.seq;
    } catch {
      /* transient network error — try again next tick */
    } finally {
      this.pollInFlight = false;
    }
  }

  private async post(path: string, body: Record<string, unknown>): Promise<void> {
    if (!this.myClientId) return;
    try {
      await fetch(apiUrl(path), {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ ...body, clientId: this.myClientId }),
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

  // Suppress unused warning while keeping the field for future reconnect logic.
  get everConnected(): boolean {
    return this.hadOpenSocket;
  }
}
