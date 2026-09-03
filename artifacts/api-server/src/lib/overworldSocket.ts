import type { IncomingMessage, Server } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { getUserBySessionToken, parseCookieHeader, SESSION_COOKIE } from "./auth";
import { presence, sanitizeSpriteLayers, type OverworldEvent } from "./presence";
import { logger } from "./logger";

const WS_PATH = "/api/overworld/ws";
const HEARTBEAT_MS = 25_000;

interface SocketCtx {
  clientId: string;
  userId: number;
  alive: boolean;
}

const ctxFor = new WeakMap<WebSocket, SocketCtx>();

function safeSend(ws: WebSocket, payload: unknown): void {
  if (ws.readyState !== WebSocket.OPEN) return;
  try {
    ws.send(JSON.stringify(payload));
  } catch {
    // socket may have closed mid-send; ignore
  }
}

/**
 * Attaches the ephemeral overworld presence WebSocket to the existing HTTP
 * server. Authentication reuses the session cookie from the upgrade request, so
 * no new auth surface is introduced. If WebSockets cannot traverse the proxy,
 * clients fall back to the HTTP polling endpoints (see routes/overworld.ts),
 * which operate on the same in-memory store.
 */
export function attachOverworldSocket(server: Server): void {
  const wss = new WebSocketServer({ noServer: true });

  // Broadcast every store event to all connected live sockets. Clients filter
  // out their own clientId where appropriate.
  presence.emitter.on("event", (ev: OverworldEvent) => {
    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN) {
        safeSend(client, { kind: "event", event: ev });
      }
    }
  });

  server.on("upgrade", async (req, socket, head) => {
    let pathname: string;
    try {
      pathname = new URL(req.url ?? "", "http://localhost").pathname;
    } catch {
      socket.destroy();
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

  wss.on("connection", (ws: WebSocket, _req: IncomingMessage, user: { id: number; displayName: string; avatarUrl: string }) => {
    const clientId = `ws_${user.id}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const ctx: SocketCtx = { clientId, userId: user.id, alive: true };
    ctxFor.set(ws, ctx);

    // Initial snapshot so the new client sees everyone already present.
    safeSend(ws, {
      kind: "welcome",
      clientId,
      seq: presence.currentSeq,
      players: presence.snapshot(),
    });

    ws.on("message", (raw) => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return;
      }
      const t = msg.t;
      if (t === "join") {
        presence.join({
          clientId,
          userId: user.id,
          displayName: user.displayName,
          avatarUrl: user.avatarUrl,
          spriteLayers: sanitizeSpriteLayers(msg.spriteLayers),
          x: typeof msg.x === "number" ? msg.x : undefined,
          y: typeof msg.y === "number" ? msg.y : undefined,
        });
      } else if (t === "appearance") {
        const layers = sanitizeSpriteLayers(msg.spriteLayers);
        if (layers) presence.setAppearance(clientId, layers);
      } else if (t === "move") {
        presence.move(
          clientId,
          Number(msg.x),
          Number(msg.y),
          Number(msg.facing) || 1,
          !!msg.moving,
        );
      } else if (t === "emote") {
        presence.emote(clientId, String(msg.emote ?? ""));
      } else if (t === "chat") {
        presence.chat(clientId, String(msg.text ?? ""));
      } else if (t === "ping") {
        // App-level heartbeat: keeps an idle (non-moving) player from being
        // swept as stale while their socket is still open.
        ctx.alive = true;
        presence.touch(clientId);
      }
    });

    ws.on("pong", () => {
      ctx.alive = true;
      presence.touch(clientId);
    });

    ws.on("close", () => {
      presence.leave(clientId);
      ctxFor.delete(ws);
    });

    ws.on("error", () => {
      presence.leave(clientId);
    });
  });

  // Drop sockets that stop responding to heartbeats.
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
        // ignore
      }
    }
  }, HEARTBEAT_MS);
  if (typeof heartbeat.unref === "function") heartbeat.unref();

  logger.info({ path: WS_PATH }, "Overworld presence WebSocket attached");
}
