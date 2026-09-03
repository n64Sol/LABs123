import type { IncomingMessage, Server } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { getUserBySessionToken, parseCookieHeader, SESSION_COOKIE } from "./auth";
import { coop, type CoopBroadcast, type CombatKind } from "./coop";
import { logger } from "./logger";

const WS_PATH = "/api/coop/ws";
const HEARTBEAT_MS = 25_000;

interface SocketCtx {
  userId: number;
  alive: boolean;
}

const ctxFor = new WeakMap<WebSocket, SocketCtx>();
// userId -> live sockets (a user may have multiple tabs open).
const socketsByUser = new Map<number, Set<WebSocket>>();

function safeSend(ws: WebSocket, payload: unknown): void {
  if (ws.readyState !== WebSocket.OPEN) return;
  try {
    ws.send(JSON.stringify(payload));
  } catch {
    /* socket closed mid-send */
  }
}

function sendToUser(userId: number, payload: unknown): void {
  const set = socketsByUser.get(userId);
  if (!set) return;
  for (const ws of set) safeSend(ws, payload);
}

const COMBAT_KINDS: ReadonlySet<string> = new Set(["enemy", "node", "chest", "boss", "down", "revive"]);

/**
 * Attaches the co-op party / run-session WebSocket. Authentication reuses the
 * session cookie from the upgrade request (same as the overworld socket). When
 * the proxy cannot upgrade WebSockets, clients fall back to the HTTP polling
 * endpoints in routes/coop.ts, which operate on the same in-memory store.
 */
export function attachCoopSocket(server: Server): void {
  const wss = new WebSocketServer({ noServer: true });

  // Fan store broadcasts out to the right sockets.
  coop.emitter.on("broadcast", (b: CoopBroadcast) => {
    if (b.scope === "user") {
      sendToUser(b.userId, { kind: "coop", relay: b.relay });
    } else {
      for (const uid of coop.memberIds(b.partyId)) {
        sendToUser(uid, { kind: "coop", relay: b.relay });
      }
      // `disbanded` must still reach a member who was just removed (and is thus
      // no longer in memberIds); the store emits a per-user disbanded for that.
    }
  });

  server.on("upgrade", async (req, socket, head) => {
    let pathname: string;
    try {
      pathname = new URL(req.url ?? "", "http://localhost").pathname;
    } catch {
      return;
    }
    if (pathname !== WS_PATH) return; // not ours — leave for other handlers

    const cookies = parseCookieHeader(req.headers.cookie);
    const user = await getUserBySessionToken(cookies[SESSION_COOKIE]);
    if (!user) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req, user);
    });
  });

  wss.on(
    "connection",
    (ws: WebSocket, _req: IncomingMessage, user: { id: number; displayName: string; avatarUrl: string }) => {
      const ctx: SocketCtx = { userId: user.id, alive: true };
      ctxFor.set(ws, ctx);
      let set = socketsByUser.get(user.id);
      if (!set) {
        set = new Set();
        socketsByUser.set(user.id, set);
      }
      set.add(ws);

      // Initial snapshot of whatever party this user is already in (if any).
      safeSend(ws, { kind: "hello", party: coop.partyOf(user.id) });

      ws.on("message", (raw) => {
        let msg: Record<string, unknown>;
        try {
          msg = JSON.parse(String(raw));
        } catch {
          return;
        }
        const t = msg.t;
        if (t === "pos") {
          coop.updatePosition(user.id, {
            x: Number(msg.x) || 0,
            y: Number(msg.y) || 0,
            facing: Number(msg.facing) || 1,
            moving: !!msg.moving,
            chamberIndex: Number(msg.chamberIndex) || 0,
            hp: Number(msg.hp) || 0,
            maxHp: Number(msg.maxHp) || 1,
          });
        } else if (t === "combat") {
          const kind = String(msg.kind);
          if (COMBAT_KINDS.has(kind)) {
            coop.recordCombat(user.id, kind as CombatKind, String(msg.id ?? ""));
          }
        } else if (t === "ping") {
          ctx.alive = true;
          coop.touch(user.id);
        }
      });

      ws.on("pong", () => {
        ctx.alive = true;
        coop.touch(user.id);
      });

      const cleanup = () => {
        const s = socketsByUser.get(user.id);
        if (s) {
          s.delete(ws);
          if (s.size === 0) socketsByUser.delete(user.id);
        }
        ctxFor.delete(ws);
      };
      ws.on("close", cleanup);
      ws.on("error", cleanup);
    },
  );

  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      const ctx = ctxFor.get(ws);
      if (!ctx) continue;
      if (!ctx.alive) {
        ws.terminate();
        continue;
      }
      ctx.alive = false;
      try {
        ws.ping();
      } catch {
        /* ignore */
      }
    }
  }, HEARTBEAT_MS);
  if (typeof heartbeat.unref === "function") heartbeat.unref();

  logger.info({ path: WS_PATH }, "Co-op session WebSocket attached");
}
