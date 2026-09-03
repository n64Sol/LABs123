import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useParams, useLocation } from "wouter";
import { useGetLoadout } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { DoorOpen, MessageCircle, ArrowLeft } from "lucide-react";
import { composeSpriteFromLayers, layersFromSlots } from "@/lib/sprite";
import { drawLpcAvatar, lpcRowFor } from "@/lib/overworld/render";
import { INTERIORS, doorReturn, type InteriorDef } from "@/lib/overworld/town";
import {
  paintCobbleField,
  paintWoodFloor,
  paintInteriorWall,
  INTERIOR_STONE_PAL,
  INTERIOR_WALL_PAL,
} from "@/lib/overworld/ground";

const PLAYER_R = 18;
const PLAYER_SIZE = 104;
const NPC_W = 116;
const NPC_H = 150;
const WALL_H = 132;
const SPEED = 280;
const TALK_RADIUS = 120;
const EXIT_RADIUS = 90;

type Interact = { kind: "npc"; label: string } | { kind: "exit"; label: string } | null;

function rectsFor(def: InteriorDef) {
  return def.props
    .filter((p) => p.solid)
    .map((p) => ({ x0: p.x - p.w * 0.42, y0: p.y - p.h * 0.5, x1: p.x + p.w * 0.42, y1: p.y }));
}

export default function InteriorScene() {
  const params = useParams();
  const id = params.id ?? "";
  const def = INTERIORS[id];
  const [, setLocation] = useLocation();
  const { data: loadout } = useGetLoadout();
  const localLayers = useMemo(() => layersFromSlots(loadout?.slots), [loadout?.slots]);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const spritesRef = useRef<Record<string, HTMLImageElement>>({});
  const playerSheetRef = useRef<CanvasImageSource | null>(null);
  const rafRef = useRef(0);
  const keysRef = useRef<Record<string, boolean>>({});
  const [interact, setInteract] = useState<Interact>(null);
  const interactRef = useRef<Interact>(null);
  const [resting, setResting] = useState(false);
  const restingRef = useRef(false);

  const leave = useCallback(() => {
    try {
      const r = doorReturn(id);
      sessionStorage.setItem("townReturn", JSON.stringify(r));
    } catch {
      /* ignore */
    }
    setLocation("/");
  }, [id, setLocation]);

  const doInteract = useCallback(() => {
    const cur = interactRef.current;
    if (!cur || !def) return;
    if (cur.kind === "exit") {
      leave();
      return;
    }
    // NPC
    const a = def.npc.action;
    if (a.rest) {
      setResting(true);
      restingRef.current = true;
      return;
    }
    if (a.route) setLocation(a.route);
  }, [def, leave, setLocation]);

  // Bad id -> bounce home.
  useEffect(() => {
    if (!def) setLocation("/");
  }, [def, setLocation]);

  // Preload interior + npc art and compose the player's geared sprite.
  useEffect(() => {
    if (!def) return;
    const base = import.meta.env.BASE_URL;
    const names = new Set<string>([def.npc.sprite]);
    for (const p of def.props) names.add(p.sprite);
    const map: Record<string, HTMLImageElement> = {};
    for (const n of names) {
      const img = new Image();
      img.src = `${base}game/overworld16/${n}.png`;
      map[n] = img;
    }
    spritesRef.current = map;

    const fallback = new Image();
    fallback.src = `${base}game/player_full.png`;
    playerSheetRef.current = fallback;
    let cancelled = false;
    composeSpriteFromLayers(localLayers, base)
      .then((canvas) => {
        if (!cancelled && canvas) playerSheetRef.current = canvas;
      })
      .catch(() => {
        /* keep fallback */
      });
    return () => {
      cancelled = true;
    };
  }, [def, localLayers]);

  // Input.
  useEffect(() => {
    if (!def) return;
    const down = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      keysRef.current[k] = true;
      if (["arrowup", "arrowdown", "arrowleft", "arrowright"].includes(k)) e.preventDefault();
      if (k === "e" || k === "enter") {
        if (restingRef.current) {
          setResting(false);
          restingRef.current = false;
        } else {
          doInteract();
        }
      }
      if (k === "escape") {
        if (restingRef.current) {
          setResting(false);
          restingRef.current = false;
        } else {
          leave();
        }
      }
    };
    const up = (e: KeyboardEvent) => {
      keysRef.current[e.key.toLowerCase()] = false;
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [def, doInteract, leave]);

  // Game loop.
  useEffect(() => {
    if (!def) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const colliders = rectsFor(def);
    const px0 = PLAYER_R + 24;
    const py0 = WALL_H + PLAYER_R + 10;
    const px1 = def.w - PLAYER_R - 24;
    const py1 = def.h - PLAYER_R - 16;
    const exit = { x: def.w / 2, y: def.h - 26 };

    const isWoodFloor = def.floor.includes("wood");
    let floorSeed = 0;
    for (let i = 0; i < def.title.length; i++) floorSeed = (floorSeed * 31 + def.title.charCodeAt(i)) | 0;

    const state = { px: def.w / 2, py: def.h - 110, dirX: 0, dirY: 1, moving: false, frame: 0 };
    let lastInteractKey = "";
    let last = performance.now();

    const hits = (x: number, y: number) => {
      if (x < px0 || x > px1 || y < py0 || y > py1) return true;
      for (const c of colliders) {
        if (x > c.x0 - PLAYER_R && x < c.x1 + PLAYER_R && y > c.y0 - PLAYER_R && y < c.y1 + PLAYER_R) return true;
      }
      // NPC body
      if (Math.hypot(x - def.npc.x, y - (def.npc.y - 20)) < PLAYER_R + 28) return true;
      return false;
    };

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const rect = canvas.getBoundingClientRect();
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);

    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const k = keysRef.current;
      const rest = restingRef.current;

      let mx = 0;
      let my = 0;
      if (!rest) {
        if (k["w"] || k["arrowup"]) my -= 1;
        if (k["s"] || k["arrowdown"]) my += 1;
        if (k["a"] || k["arrowleft"]) mx -= 1;
        if (k["d"] || k["arrowright"]) mx += 1;
      }
      const mag = Math.hypot(mx, my);
      state.moving = mag > 0.01;
      if (state.moving) {
        mx /= mag;
        my /= mag;
        const nx = state.px + mx * SPEED * dt;
        const ny = state.py + my * SPEED * dt;
        if (!hits(nx, state.py)) state.px = nx;
        if (!hits(state.px, ny)) state.py = ny;
        state.dirX = mx;
        state.dirY = my;
        state.frame += dt * 9;
      } else {
        state.frame = 0;
      }

      // Nearest interactable.
      let next: Interact = null;
      const dNpc = Math.hypot(state.px - def.npc.x, state.py - def.npc.y);
      const dExit = Math.hypot(state.px - exit.x, state.py - exit.y);
      if (dNpc < TALK_RADIUS && dNpc <= dExit) next = { kind: "npc", label: def.npc.action.label };
      else if (dExit < EXIT_RADIUS) next = { kind: "exit", label: "Leave" };
      const ikey = next ? next.kind + next.label : "";
      if (ikey !== lastInteractKey) {
        lastInteractKey = ikey;
        interactRef.current = next;
        setInteract(next);
      }

      // === DRAW ===
      const cssW = canvas.clientWidth;
      const cssH = canvas.clientHeight;
      ctx.clearRect(0, 0, cssW, cssH);
      ctx.fillStyle = "#0c0a09";
      ctx.fillRect(0, 0, cssW, cssH);

      const scale = Math.min(cssW / def.w, cssH / def.h) * 0.98;
      const ox = (cssW - def.w * scale) / 2;
      const oy = (cssH - def.h * scale) / 2;
      ctx.save();
      ctx.translate(ox, oy);
      ctx.scale(scale, scale);
      ctx.imageSmoothingEnabled = false;

      const sprites = spritesRef.current;
      // Floor — painted procedurally (plank or flagstone), never a tiled illustration.
      if (isWoodFloor) {
        paintWoodFloor(ctx, 0, WALL_H, def.w, def.h, floorSeed);
      } else {
        paintCobbleField(ctx, 0, WALL_H, def.w, def.h, INTERIOR_STONE_PAL, floorSeed);
      }
      // Warm light pooling from the top of the room into shadowed corners.
      const lg = ctx.createLinearGradient(0, WALL_H, 0, def.h);
      lg.addColorStop(0, "rgba(255,221,150,0.10)");
      lg.addColorStop(1, "rgba(10,7,4,0.30)");
      ctx.fillStyle = lg;
      ctx.fillRect(0, WALL_H, def.w, def.h - WALL_H);
      // Back wall — procedural timber-framed paneling tinted by the room accent.
      paintInteriorWall(ctx, 0, 0, def.w, WALL_H, INTERIOR_WALL_PAL, def.accent);

      // Exit mat.
      ctx.save();
      ctx.fillStyle = next?.kind === "exit" ? "rgba(251,191,36,0.85)" : "rgba(120,90,50,0.7)";
      ctx.beginPath();
      ctx.ellipse(exit.x, exit.y, 70, 26, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#1b1410";
      ctx.font = "700 16px ui-sans-serif, system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("EXIT", exit.x, exit.y + 5);
      ctx.restore();

      // Y-sorted entities: props + npc + player.
      type D = { ry: number; draw: () => void };
      const draws: D[] = [];
      for (const p of def.props) {
        const sp = sprites[p.sprite];
        draws.push({
          ry: p.y,
          draw: () => {
            if (sp && sp.complete && sp.naturalWidth > 0) ctx.drawImage(sp, p.x - p.w / 2, p.y - p.h, p.w, p.h);
          },
        });
      }
      const npcSp = sprites[def.npc.sprite];
      draws.push({
        ry: def.npc.y,
        draw: () => {
          if (npcSp && npcSp.complete && npcSp.naturalWidth > 0) {
            ctx.drawImage(npcSp, def.npc.x - NPC_W / 2, def.npc.y - NPC_H, NPC_W, NPC_H);
          } else {
            ctx.fillStyle = def.accent;
            ctx.fillRect(def.npc.x - 30, def.npc.y - 90, 60, 90);
          }
          // name tag
          ctx.save();
          ctx.font = "700 14px ui-sans-serif, system-ui, sans-serif";
          ctx.textAlign = "center";
          const tw = ctx.measureText(def.npc.name).width;
          ctx.fillStyle = "rgba(20,16,12,0.78)";
          ctx.fillRect(def.npc.x - tw / 2 - 8, def.npc.y - NPC_H - 22, tw + 16, 20);
          ctx.fillStyle = "#f3ead2";
          ctx.fillText(def.npc.name, def.npc.x, def.npc.y - NPC_H - 8);
          ctx.restore();
        },
      });
      const sheet = playerSheetRef.current;
      draws.push({
        ry: state.py,
        draw: () => {
          if (!sheet) return;
          const row = state.moving ? lpcRowFor(state.dirX, state.dirY) : 10;
          const frame = state.moving ? Math.floor(state.frame) % 9 : 0;
          drawLpcAvatar(ctx, sheet, state.px, state.py, PLAYER_SIZE, row, frame, 1);
        },
      });
      draws.sort((a, b) => a.ry - b.ry);
      for (const d of draws) d.draw();

      ctx.restore();
      ctx.textAlign = "left";

      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener("resize", resize);
    };
  }, [def]);

  if (!def) return null;

  return (
    <div className="relative h-full w-full overflow-hidden bg-stone-950">
      <canvas ref={canvasRef} className="block h-full w-full touch-none" />

      {/* Title */}
      <div className="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 rounded-md bg-black/55 px-4 py-1.5 text-sm font-bold tracking-wide text-amber-100 shadow">
        {def.title}
      </div>

      {/* Interaction prompt */}
      {interact && !resting && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2">
          <Button onClick={doInteract} className="gap-2 shadow-lg" size="lg">
            {interact.kind === "exit" ? <DoorOpen className="h-4 w-4" /> : <MessageCircle className="h-4 w-4" />}
            {interact.label} <span className="opacity-70">(E)</span>
          </Button>
        </div>
      )}

      {/* Always-available leave button */}
      <div className="absolute left-3 top-3">
        <Button onClick={leave} variant="secondary" size="sm" className="gap-2 shadow">
          <ArrowLeft className="h-4 w-4" />
          Town
        </Button>
      </div>

      {/* Rest dialog (Inn) */}
      {resting && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/60 p-6">
          <div className="max-w-md rounded-xl border border-amber-700/40 bg-stone-900 p-6 text-center shadow-2xl">
            <p className="mb-1 text-lg font-bold text-amber-100">{def.npc.name}</p>
            <p className="mb-5 text-stone-300">
              You rest by the hearth. Warmth seeps back into your bones — you feel ready for the labyrinths again.
            </p>
            <Button
              onClick={() => {
                setResting(false);
                restingRef.current = false;
              }}
            >
              Continue
            </Button>
          </div>
        </div>
      )}

      {/* Hint */}
      <div className="pointer-events-none absolute bottom-3 right-3 rounded bg-black/45 px-2.5 py-1 text-xs text-stone-300">
        WASD to move · E to interact · Esc to leave
      </div>
    </div>
  );
}
