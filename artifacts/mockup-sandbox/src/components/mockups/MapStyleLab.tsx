import React, { useEffect, useMemo, useRef, useState } from "react";

/* ===================================================================== *
 * Labyrinths — Pixel Overworld Mockup
 * ---------------------------------------------------------------------
 * A polished pixel-art top-down overworld, rendered ENTIRELY in code —
 * no PNGs, no sprites, no AI art. Uses the real pixel-art pipeline:
 * the whole scene is drawn to a small low-resolution canvas, then
 * upscaled with nearest-neighbour sampling for crisp chunky pixels.
 * Detailed structures, lush textured grass, trees, heroes, a bestiary
 * pen and a chunky game HUD. Three atmospheric MOODS of the same world
 * let you pick a direction. Switch with the tabs · deep-link ?mood=.
 * ===================================================================== */

type MoodId = "dawn" | "dusk" | "night";

/* ------------------------------ rng/hash ------------------------------ */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hash(x: number, y: number) {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/* ------------------------------ layout -------------------------------- */
type BType = "market" | "forge" | "hall" | "arena" | "vault";
type Building = { id: string; type: BType; nx: number; ny: number; label: string; accent: string };
type Hero = { nx: number; ny: number; accent: string; you?: boolean; name: string };

const BUILDINGS: Building[] = [
  { id: "market", type: "market", nx: 0.205, ny: 0.34, label: "GLOOM BAZAAR", accent: "#e8c24a" },
  { id: "vault", type: "vault", nx: 0.5, ny: 0.215, label: "CRYSTAL VAULT", accent: "#a99cf0" },
  { id: "forge", type: "forge", nx: 0.8, ny: 0.32, label: "EMBER FORGE", accent: "#ff8a3a" },
  { id: "hall", type: "hall", nx: 0.175, ny: 0.74, label: "WARDEN'S HALL", accent: "#74c46e" },
  { id: "arena", type: "arena", nx: 0.83, ny: 0.72, label: "THE ARENA", accent: "#e2554a" },
];
const MONUMENT = { nx: 0.5, ny: 0.52 };
const PEN = { nx: 0.62, ny: 0.6, label: "BESTIARY" };
const HEROES: Hero[] = [
  { nx: 0.5, ny: 0.62, accent: "#ffd24a", you: true, name: "WARDEN" },
  { nx: 0.565, ny: 0.565, accent: "#74c46e", name: "Hexbane" },
  { nx: 0.405, ny: 0.47, accent: "#3fb6d6", name: "Nullspire" },
];

/* --------------------------- mood palettes ---------------------------- */
type Mood = {
  id: MoodId;
  label: string;
  tag: string;
  page: string;
  accent: string;
  panel: string;
  panelBorder: string;
  panelText: string;
  panelSub: string;
  window: string; // lit window glow
  grade: (ctx: CanvasRenderingContext2D, W: number, H: number, t: number) => void;
};

const MOODS: Record<MoodId, Mood> = {
  dawn: {
    id: "dawn",
    label: "Verdant Dawn",
    tag: "Bright morning light over the realms",
    page: "#0e1410",
    accent: "#7fd06a",
    panel: "rgba(20,40,28,0.82)",
    panelBorder: "#3f7a4a",
    panelText: "#eaf6e6",
    panelSub: "#9fc7a0",
    window: "#ffe9a8",
    grade: (ctx, W, H, t) => {
      let g = ctx.createRadialGradient(W * 0.32, H * 0.12, 40, W * 0.5, H * 0.5, Math.max(W, H) * 0.9);
      g.addColorStop(0, "rgba(255,246,214,0.20)");
      g.addColorStop(1, "rgba(255,246,214,0)");
      ctx.globalCompositeOperation = "lighter";
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
      ctx.globalCompositeOperation = "source-over";
      const v = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.42, W / 2, H / 2, Math.max(W, H) * 0.72);
      v.addColorStop(0, "rgba(20,40,30,0)");
      v.addColorStop(1, "rgba(18,40,55,0.28)");
      ctx.fillStyle = v;
      ctx.fillRect(0, 0, W, H);
    },
  },
  dusk: {
    id: "dusk",
    label: "Emberfall Dusk",
    tag: "Golden-hour sun sinking, embers adrift",
    page: "#160d0a",
    accent: "#ff9a3a",
    panel: "rgba(48,24,16,0.82)",
    panelBorder: "#9a4f2a",
    panelText: "#ffe9d6",
    panelSub: "#d59f7a",
    window: "#ffb347",
    grade: (ctx, W, H, t) => {
      const g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, "rgba(255,150,60,0.34)");
      g.addColorStop(0.5, "rgba(220,90,70,0.16)");
      g.addColorStop(1, "rgba(70,30,80,0.30)");
      ctx.globalCompositeOperation = "overlay";
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
      ctx.globalCompositeOperation = "lighter";
      const sun = ctx.createRadialGradient(W * 0.5, H * -0.05, 30, W * 0.5, H * -0.05, H * 0.8);
      sun.addColorStop(0, "rgba(255,180,90,0.5)");
      sun.addColorStop(1, "rgba(255,180,90,0)");
      ctx.fillStyle = sun;
      ctx.fillRect(0, 0, W, H);
      ctx.globalCompositeOperation = "source-over";
      const v = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.34, W / 2, H / 2, Math.max(W, H) * 0.72);
      v.addColorStop(0, "rgba(40,15,10,0)");
      v.addColorStop(1, "rgba(30,8,20,0.5)");
      ctx.fillStyle = v;
      ctx.fillRect(0, 0, W, H);
    },
  },
  night: {
    id: "night",
    label: "Moonlit Hollow",
    tag: "Cold moonlight, glowing windows, fireflies",
    page: "#070a14",
    accent: "#6fa8ff",
    panel: "rgba(14,22,44,0.84)",
    panelBorder: "#33508c",
    panelText: "#dfeaff",
    panelSub: "#8fa6cf",
    window: "#ffd86a",
    grade: (ctx, W, H, t) => {
      ctx.globalCompositeOperation = "multiply";
      const g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, "rgba(40,55,110,0.86)");
      g.addColorStop(1, "rgba(18,26,60,0.92)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
      ctx.globalCompositeOperation = "lighter";
      const moon = ctx.createRadialGradient(W * 0.82, H * 0.1, 20, W * 0.82, H * 0.1, H * 0.7);
      moon.addColorStop(0, "rgba(150,180,255,0.34)");
      moon.addColorStop(1, "rgba(150,180,255,0)");
      ctx.fillStyle = moon;
      ctx.fillRect(0, 0, W, H);
      ctx.globalCompositeOperation = "source-over";
      const v = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.28, W / 2, H / 2, Math.max(W, H) * 0.7);
      v.addColorStop(0, "rgba(0,0,10,0)");
      v.addColorStop(1, "rgba(0,0,15,0.66)");
      ctx.fillStyle = v;
      ctx.fillRect(0, 0, W, H);
    },
  },
};

/* ------------------------------ palettes ------------------------------ */
const GRASS = { base: "#5aa23a", dark: "#458030", light: "#79c14e", blade: "#3c722a" };
const DIRT = { base: "#bd9357", light: "#d4ac6e", dark: "#8f6a3a", edge: "#6f4f2a" };

function injectFonts() {
  const id = "pixel-overworld-fonts";
  if (document.getElementById(id)) return;
  const link = document.createElement("link");
  link.id = id;
  link.rel = "stylesheet";
  link.href = "https://fonts.googleapis.com/css2?family=Press+Start+2P&family=Pixelify+Sans:wght@400;500;600;700&display=swap";
  document.head.appendChild(link);
}

const PIXEL = 3; // low-res pixel -> screen px

/* ============================== component ============================== */
export default function MapStyleLab() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const offRef = useRef<HTMLCanvasElement | null>(null);
  const miniRef = useRef<HTMLCanvasElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [mood, setMood] = useState<MoodId>(() => {
    if (typeof window !== "undefined") {
      const q = new URLSearchParams(window.location.search).get("mood");
      if (q === "dawn" || q === "dusk" || q === "night") return q;
    }
    return "dusk";
  });
  const moodRef = useRef(mood);
  moodRef.current = mood;

  // deterministic scatter (stable across frames)
  const scatter = useMemo(() => {
    const rng = mulberry32(0x5eed);
    const blocked = (nx: number, ny: number, pad: number) => {
      if (Math.hypot(nx - MONUMENT.nx, ny - MONUMENT.ny) < pad + 0.04) return true;
      if (Math.hypot(nx - PEN.nx, ny - PEN.ny) < pad + 0.08) return true;
      for (const b of BUILDINGS) if (Math.hypot(nx - b.nx, ny - b.ny) < pad + 0.07) return true;
      // avoid the two main roads
      if (Math.abs(nx - 0.5) < pad * 0.6 || Math.abs(ny - 0.52) < pad * 0.6) return true;
      return false;
    };
    const trees: { nx: number; ny: number; s: number; v: number }[] = [];
    let guard = 0;
    while (trees.length < 26 && guard++ < 800) {
      const nx = 0.04 + rng() * 0.92;
      const ny = 0.08 + rng() * 0.88;
      if (blocked(nx, ny, 0.05)) continue;
      if (trees.some((p) => Math.hypot(p.nx - nx, p.ny - ny) < 0.07)) continue;
      trees.push({ nx, ny, s: 0.85 + rng() * 0.5, v: Math.floor(rng() * 3) });
    }
    const decor: { nx: number; ny: number; kind: number }[] = [];
    guard = 0;
    while (decor.length < 70 && guard++ < 1600) {
      const nx = 0.03 + rng() * 0.94;
      const ny = 0.06 + rng() * 0.9;
      if (blocked(nx, ny, 0.02)) continue;
      decor.push({ nx, ny, kind: Math.floor(rng() * 4) });
    }
    return { trees, decor };
  }, []);

  useEffect(() => {
    injectFonts();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    if (!offRef.current) offRef.current = document.createElement("canvas");
    const off = offRef.current;
    const octx = off.getContext("2d")!;
    let raf = 0;
    const start = performance.now();

    const render = () => {
      const stage = stageRef.current!;
      const cssW = stage.clientWidth;
      const cssH = stage.clientHeight;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      if (canvas.width !== Math.round(cssW * dpr) || canvas.height !== Math.round(cssH * dpr)) {
        canvas.width = Math.round(cssW * dpr);
        canvas.height = Math.round(cssH * dpr);
      }
      const iW = Math.max(120, Math.ceil(cssW / PIXEL));
      const iH = Math.max(80, Math.ceil(cssH / PIXEL));
      if (off.width !== iW || off.height !== iH) {
        off.width = iW;
        off.height = iH;
      }
      const t = (performance.now() - start) / 1000;
      const m = MOODS[moodRef.current];

      drawScene(octx, iW, iH, t, m, scatter);

      // upscale crisp
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.imageSmoothingEnabled = false;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(off, 0, 0, iW, iH, 0, 0, canvas.width, canvas.height);

      // full-res mood grade + particles
      ctx.save();
      ctx.scale(dpr, dpr);
      m.grade(ctx, cssW, cssH, t);
      drawParticles(ctx, cssW, cssH, t, m);
      ctx.restore();

      const mini = miniRef.current;
      if (mini) drawMinimap(mini.getContext("2d")!, mini, m, t);

      raf = requestAnimationFrame(render);
    };
    raf = requestAnimationFrame(render);
    return () => cancelAnimationFrame(raf);
  }, [scatter]);

  const m = MOODS[mood];

  return (
    <div className="min-h-screen w-full flex flex-col" style={{ background: m.page, fontFamily: "'Pixelify Sans', sans-serif", transition: "background .4s" }}>
      {/* chooser */}
      <div className="flex flex-wrap items-center gap-3 px-5 py-3 border-b" style={{ borderColor: "rgba(255,255,255,0.08)", background: "rgba(0,0,0,0.4)" }}>
        <span className="text-white" style={{ fontFamily: "'Press Start 2P'", fontSize: 13, letterSpacing: 1 }}>
          LABYRINTHS
        </span>
        <span className="text-white/40" style={{ fontFamily: "'Press Start 2P'", fontSize: 8 }}>
          PIXEL OVERWORLD
        </span>
        <div className="flex gap-1.5 ml-auto">
          {(Object.keys(MOODS) as MoodId[]).map((k) => {
            const active = k === mood;
            return (
              <button
                key={k}
                onClick={() => setMood(k)}
                className="px-3 py-2 transition-all"
                style={{
                  fontFamily: "'Press Start 2P'",
                  fontSize: 8,
                  color: active ? "#0a0a0a" : "rgba(255,255,255,0.8)",
                  background: active ? MOODS[k].accent : "transparent",
                  border: `2px solid ${active ? MOODS[k].accent : "rgba(255,255,255,0.22)"}`,
                  boxShadow: active ? `0 3px 0 rgba(0,0,0,0.4)` : "none",
                }}
              >
                {MOODS[k].label}
              </button>
            );
          })}
        </div>
      </div>
      <div className="px-5 py-1.5 text-[12px]" style={{ color: "rgba(255,255,255,0.5)" }}>
        <span style={{ color: m.accent }}>●</span> {m.tag} — pixel-art rendered in code, zero image assets.
      </div>

      {/* stage */}
      <div ref={stageRef} className="relative flex-1 mx-3 mb-3 overflow-hidden" style={{ minHeight: 620, borderRadius: 8, border: "2px solid rgba(0,0,0,0.5)", boxShadow: "inset 0 0 0 2px rgba(255,255,255,0.05)" }}>
        <canvas ref={canvasRef} className="absolute inset-0 w-full h-full block" style={{ imageRendering: "pixelated" }} />

        {/* in-world structure labels */}
        {BUILDINGS.map((b) => (
          <WorldLabel key={b.id} nx={b.nx} ny={b.ny} dy={-58} color={b.accent}>
            {b.label}
          </WorldLabel>
        ))}
        <WorldLabel nx={PEN.nx} ny={PEN.ny} dy={-46} color="#ffce54">
          {PEN.label}
        </WorldLabel>
        {HEROES.filter((h) => h.you).map((h) => (
          <WorldLabel key={h.name} nx={h.nx} ny={h.ny} dy={-30} color="#fff" small>
            {h.name}
          </WorldLabel>
        ))}

        {/* HUD: top-left contracts */}
        <div className="absolute top-3 left-3 flex flex-col gap-2">
          <Panel m={m} className="px-3 py-2">
            <div className="flex items-center gap-2" style={{ fontFamily: "'Press Start 2P'", fontSize: 8, color: m.panelText }}>
              <span style={{ color: "#46d27a" }}>◍</span> 1 ONLINE
            </div>
          </Panel>
          <Panel m={m} className="w-[188px]">
            <PanelHead m={m}>⚑ CONTRACTS</PanelHead>
            <div className="px-2.5 py-2 flex flex-col gap-2">
              <Quest m={m} name="Cull the Gloom" pct={0.62} />
              <Quest m={m} name="Forge a Wyrmkey" pct={0.3} />
            </div>
          </Panel>
        </div>

        {/* HUD: top-right adventurers */}
        <div className="absolute top-3 right-3 w-[206px] flex flex-col gap-2">
          <Panel m={m}>
            <PanelHead m={m}>⚔ ADVENTURERS</PanelHead>
            <div className="px-2 py-1.5 flex flex-col gap-1.5">
              {["Hexbane", "Nullspire", "Glasswing", "Voidcaller", "Emberkin"].map((n, i) => (
                <div key={n} className="flex items-center justify-between">
                  <span className="flex items-center gap-1.5" style={{ fontSize: 13, color: m.panelText }}>
                    <span style={{ width: 7, height: 7, borderRadius: 1, background: i < 3 ? "#46d27a" : "#7a7a7a", display: "inline-block" }} />
                    {n}
                  </span>
                  <span style={{ fontFamily: "'Press Start 2P'", fontSize: 7, color: "#0a0a0a", background: m.accent, padding: "3px 5px" }}>HAIL</span>
                </div>
              ))}
            </div>
          </Panel>
        </div>

        {/* HUD: bottom-right minimap */}
        <div className="absolute bottom-3 right-3">
          <Panel m={m} className="overflow-hidden">
            <PanelHead m={m}>▣ MAP</PanelHead>
            <canvas ref={miniRef} width={168} height={120} className="block" style={{ imageRendering: "pixelated", width: 168, height: 120 }} />
          </Panel>
        </div>

        {/* HUD: bottom-left emotes */}
        <div className="absolute bottom-3 left-3 flex gap-1.5">
          {["♥", "✦", "!", "?"].map((g) => (
            <div key={g} className="flex items-center justify-center" style={{ width: 30, height: 30, background: m.panel, border: `2px solid ${m.panelBorder}`, color: m.accent, fontSize: 14 }}>
              {g}
            </div>
          ))}
        </div>

        {/* HUD: bottom-center action bar + item */}
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex flex-col items-center gap-1.5">
          <div className="flex gap-1.5">
            {["⚔", "✷", "◈", "❖"].map((g, i) => (
              <div key={i} className="flex items-center justify-center relative" style={{ width: 38, height: 38, background: m.panel, border: `2px solid ${i === 0 ? m.accent : m.panelBorder}`, color: i === 0 ? m.accent : m.panelSub, fontSize: 17 }}>
                {g}
                <span style={{ position: "absolute", bottom: 1, right: 2, fontFamily: "'Press Start 2P'", fontSize: 6, color: m.panelSub }}>{i + 1}</span>
              </div>
            ))}
          </div>
          <div className="flex items-center gap-2 px-3 py-1.5" style={{ background: m.panel, border: `2px solid ${m.panelBorder}` }}>
            <span style={{ color: m.accent, fontSize: 14 }}>◈</span>
            <span style={{ fontFamily: "'Press Start 2P'", fontSize: 8, color: m.panelText }}>WYRMSTEEL KEY</span>
            <span style={{ fontSize: 12, color: m.panelSub }}>×3</span>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ----------------------------- HUD helpers ---------------------------- */
function Panel({ m, className, children }: { m: Mood; className?: string; children: React.ReactNode }) {
  return (
    <div className={className} style={{ background: m.panel, border: `2px solid ${m.panelBorder}`, boxShadow: "0 4px 0 rgba(0,0,0,0.35)" }}>
      {children}
    </div>
  );
}
function PanelHead({ m, children }: { m: Mood; children: React.ReactNode }) {
  return (
    <div className="px-2.5 py-1.5" style={{ fontFamily: "'Press Start 2P'", fontSize: 8, color: "#0a0a0a", background: m.accent, letterSpacing: 0.5 }}>
      {children}
    </div>
  );
}
function Quest({ m, name, pct }: { m: Mood; name: string; pct: number }) {
  return (
    <div>
      <div style={{ fontSize: 13, color: m.panelText, lineHeight: 1.1 }}>{name}</div>
      <div style={{ height: 6, background: "rgba(0,0,0,0.45)", marginTop: 3, border: `1px solid ${m.panelBorder}` }}>
        <div style={{ width: `${pct * 100}%`, height: "100%", background: m.accent }} />
      </div>
    </div>
  );
}
function WorldLabel({ nx, ny, dy, color, small, children }: { nx: number; ny: number; dy: number; color: string; small?: boolean; children: React.ReactNode }) {
  return (
    <div
      className="absolute pointer-events-none"
      style={{
        left: `${nx * 100}%`,
        top: `${ny * 100}%`,
        transform: `translate(-50%, -100%) translateY(${dy}px)`,
        fontFamily: "'Press Start 2P'",
        fontSize: small ? 7 : 9,
        color,
        textShadow: "0 1px 0 #000, 0 2px 3px rgba(0,0,0,0.8), 1px 0 0 #000, -1px 0 0 #000",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </div>
  );
}

/* ============================ SCENE DRAW ============================ */
function drawScene(ctx: CanvasRenderingContext2D, W: number, H: number, t: number, m: Mood, scatter: { trees: { nx: number; ny: number; s: number; v: number }[]; decor: { nx: number; ny: number; kind: number }[] }) {
  drawGround(ctx, W, H);
  drawRoads(ctx, W, H);
  drawDecorFlat(ctx, W, H, scatter.decor);

  // depth-sorted entities
  type Ent = { y: number; draw: () => void };
  const ents: Ent[] = [];
  ents.push({ y: MONUMENT.ny, draw: () => drawMonument(ctx, MONUMENT.nx * W, MONUMENT.ny * H, W, t, m) });
  ents.push({ y: PEN.ny, draw: () => drawPen(ctx, PEN.nx * W, PEN.ny * H, W, t, m) });
  for (const b of BUILDINGS) ents.push({ y: b.ny, draw: () => drawBuilding(ctx, b, b.nx * W, b.ny * H, W, t, m) });
  for (const tr of scatter.trees) ents.push({ y: tr.ny, draw: () => drawTree(ctx, tr.nx * W, tr.ny * H, W * 0.05 * tr.s, tr.v, t) });
  for (const h of HEROES) ents.push({ y: h.ny, draw: () => drawHero(ctx, h.nx * W, h.ny * H, W, t, h) });
  ents.sort((a, b) => a.y - b.y);
  for (const e of ents) e.draw();
}

/* ------------------------------- ground ------------------------------- */
function drawGround(ctx: CanvasRenderingContext2D, W: number, H: number) {
  ctx.fillStyle = GRASS.base;
  ctx.fillRect(0, 0, W, H);
  const tile = 8;
  for (let ty = 0; ty < H; ty += tile) {
    for (let tx = 0; tx < W; tx += tile) {
      const h = hash(tx, ty);
      if (h < 0.34) {
        ctx.fillStyle = h < 0.17 ? GRASS.dark : GRASS.light;
        ctx.globalAlpha = 0.35;
        ctx.fillRect(tx, ty, tile, tile);
        ctx.globalAlpha = 1;
      }
      // blades
      const hb = hash(tx * 3 + 1, ty * 7 + 5);
      if (hb < 0.5) {
        ctx.fillStyle = hb < 0.25 ? GRASS.blade : GRASS.light;
        const bx = tx + Math.floor(hb * tile);
        const by = ty + Math.floor(hash(tx, ty * 2) * tile);
        ctx.fillRect(bx, by, 1, 2);
      }
    }
  }
}

/* -------------------------------- roads ------------------------------- */
function drawRoads(ctx: CanvasRenderingContext2D, W: number, H: number) {
  const cx = MONUMENT.nx * W;
  const cy = MONUMENT.ny * H;
  const main = Math.max(8, Math.round(W * 0.026));
  roadLine(ctx, cx, -10, cx, H + 10, main);
  roadLine(ctx, -10, cy, W + 10, cy, main);
  const branch = Math.max(6, Math.round(W * 0.018));
  for (const b of BUILDINGS) roadLine(ctx, cx, cy, b.nx * W, b.ny * H + H * 0.02, branch);
  roadLine(ctx, cx, cy, PEN.nx * W, PEN.ny * H, branch);
}
function roadLine(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, w: number) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  const steps = Math.ceil(len);
  for (let i = 0; i <= steps; i++) {
    const px = x1 + (dx * i) / steps;
    const py = y1 + (dy * i) / steps;
    // edge
    ctx.fillStyle = DIRT.edge;
    ctx.fillRect(Math.round(px - w / 2 - 1), Math.round(py - w / 2 - 1), w + 2, w + 2);
  }
  for (let i = 0; i <= steps; i++) {
    const px = x1 + (dx * i) / steps;
    const py = y1 + (dy * i) / steps;
    const h = hash(Math.round(px), Math.round(py));
    ctx.fillStyle = h < 0.2 ? DIRT.dark : h > 0.85 ? DIRT.light : DIRT.base;
    ctx.fillRect(Math.round(px - w / 2), Math.round(py - w / 2), w, w);
  }
}

/* ------------------------------- decor -------------------------------- */
function drawDecorFlat(ctx: CanvasRenderingContext2D, W: number, H: number, decor: { nx: number; ny: number; kind: number }[]) {
  for (const d of decor) {
    const x = Math.round(d.nx * W);
    const y = Math.round(d.ny * H);
    if (d.kind === 0) {
      // flower
      const col = ["#f4f4f4", "#ffd84a", "#e2554a", "#c98bf0"][Math.floor(hash(x, y) * 4)];
      ctx.fillStyle = col;
      ctx.fillRect(x, y, 1, 1);
      ctx.fillRect(x + 1, y, 1, 1);
      ctx.fillRect(x, y + 1, 1, 1);
      ctx.fillStyle = "#ffe98a";
      ctx.fillRect(x, y, 1, 1);
    } else if (d.kind === 1) {
      // grass tuft
      ctx.fillStyle = GRASS.dark;
      ctx.fillRect(x, y + 2, 1, 2);
      ctx.fillRect(x + 2, y + 1, 1, 3);
      ctx.fillStyle = GRASS.light;
      ctx.fillRect(x + 1, y, 1, 4);
    } else if (d.kind === 2) {
      // small rock
      ctx.fillStyle = "#3a3f33";
      ctx.fillRect(x, y + 1, 4, 2);
      ctx.fillStyle = "#7c8270";
      ctx.fillRect(x, y, 3, 2);
      ctx.fillStyle = "#a7ad99";
      ctx.fillRect(x, y, 1, 1);
    } else {
      // bush
      ctx.fillStyle = GRASS.dark;
      ctx.fillRect(x, y + 1, 6, 3);
      ctx.fillStyle = "#3f8a36";
      ctx.fillRect(x + 1, y, 5, 3);
      ctx.fillStyle = GRASS.light;
      ctx.fillRect(x + 1, y, 2, 1);
    }
  }
}

/* ------------------------------- trees -------------------------------- */
function drawTree(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, variant: number, t: number) {
  r = Math.max(6, r);
  const sway = Math.sin(t * 1.3 + x * 0.1) * (r * 0.05);
  // shadow
  ctx.fillStyle = "rgba(0,0,0,0.22)";
  ellipse(ctx, x, y + 1, r * 1.05, r * 0.34);
  // trunk
  ctx.fillStyle = "#5a3b22";
  ctx.fillRect(Math.round(x - r * 0.13), Math.round(y - r * 0.55), Math.max(2, Math.round(r * 0.26)), Math.round(r * 0.6));
  ctx.fillStyle = "#3f2814";
  ctx.fillRect(Math.round(x + r * 0.02), Math.round(y - r * 0.55), Math.max(1, Math.round(r * 0.11)), Math.round(r * 0.6));
  const greens =
    variant === 0
      ? ["#2f6a2a", "#3f8a32", "#5fb441"]
      : variant === 1
      ? ["#2c5f3a", "#3a8050", "#57b06e"]
      : ["#46622a", "#638e34", "#8fc24a"];
  const cx = x + sway;
  const cy = y - r * 0.95;
  // outline
  ctx.fillStyle = "#1f3a1c";
  ellipse(ctx, cx, cy, r * 1.06, r * 1.0);
  // base
  ctx.fillStyle = greens[0];
  ellipse(ctx, cx, cy, r, r * 0.94);
  // mid blobs
  ctx.fillStyle = greens[1];
  ellipse(ctx, cx - r * 0.32, cy + r * 0.1, r * 0.6, r * 0.58);
  ellipse(ctx, cx + r * 0.34, cy + r * 0.06, r * 0.58, r * 0.56);
  ellipse(ctx, cx, cy - r * 0.34, r * 0.6, r * 0.56);
  // highlight
  ctx.fillStyle = greens[2];
  ellipse(ctx, cx - r * 0.28, cy - r * 0.3, r * 0.42, r * 0.4);
  ellipse(ctx, cx + r * 0.1, cy - r * 0.1, r * 0.3, r * 0.3);
}

/* ----------------------------- buildings ------------------------------ */
function drawBuilding(ctx: CanvasRenderingContext2D, b: Building, x: number, y: number, W: number, t: number, m: Mood) {
  const bw = Math.round(W * 0.092);
  const wallH = Math.round(bw * 0.62);
  const left = Math.round(x - bw / 2);
  const top = Math.round(y - wallH);
  // shadow
  ctx.fillStyle = "rgba(0,0,0,0.28)";
  ellipse(ctx, x, y + 2, bw * 0.62, bw * 0.2);

  const lit = m.window;
  const litPulse = 0.7 + 0.3 * Math.sin(t * 2 + x);

  if (b.type === "arena") {
    drawArena(ctx, x, y, bw, wallH, lit, litPulse);
  } else if (b.type === "vault") {
    drawVault(ctx, x, y, bw, wallH, t);
  } else {
    // generic walls
    const pal =
      b.type === "forge"
        ? { wall: "#5b5560", wd: "#403b46", roof: "#7a3b2a", rd: "#54281c" }
        : b.type === "hall"
        ? { wall: "#a9824f", wd: "#7d5e36", roof: "#3f6f3a", rd: "#2c5028" }
        : { wall: "#cbb78f", wd: "#a08a64", roof: "#3f6cae", rd: "#2c4f86" };
    // wall outline
    ctx.fillStyle = "#000";
    ctx.fillRect(left - 1, top - 1, bw + 2, wallH + 2);
    // wall body w/ vertical shading
    ctx.fillStyle = pal.wall;
    ctx.fillRect(left, top, bw, wallH);
    ctx.fillStyle = pal.wd;
    ctx.fillRect(left + Math.round(bw * 0.66), top, Math.round(bw * 0.34), wallH);
    ctx.fillStyle = "rgba(255,255,255,0.10)";
    ctx.fillRect(left, top, Math.round(bw * 0.12), wallH);
    // brick lines
    ctx.fillStyle = "rgba(0,0,0,0.14)";
    for (let yy = top + 6; yy < top + wallH; yy += 6) ctx.fillRect(left, yy, bw, 1);
    // door
    const dw = Math.round(bw * 0.22);
    const dh = Math.round(wallH * 0.55);
    const dx = Math.round(x - dw / 2);
    const dy = top + wallH - dh;
    ctx.fillStyle = "#23170d";
    ctx.fillRect(dx - 1, dy - 1, dw + 2, dh + 1);
    ctx.fillStyle = "#3a2614";
    ctx.fillRect(dx, dy, dw, dh);
    ctx.fillStyle = b.accent;
    ctx.fillRect(dx, dy, dw, 1);
    // windows (lit)
    const ww = Math.round(bw * 0.16);
    const wh = Math.round(wallH * 0.26);
    const wy = top + Math.round(wallH * 0.22);
    for (const wx of [left + Math.round(bw * 0.14), left + bw - Math.round(bw * 0.14) - ww]) {
      ctx.fillStyle = "#1a120a";
      ctx.fillRect(wx - 1, wy - 1, ww + 2, wh + 2);
      ctx.fillStyle = lit;
      ctx.globalAlpha = litPulse;
      ctx.fillRect(wx, wy, ww, wh);
      ctx.globalAlpha = 1;
      ctx.fillStyle = "rgba(0,0,0,0.4)";
      ctx.fillRect(wx + Math.floor(ww / 2), wy, 1, wh);
      ctx.fillRect(wx, wy + Math.floor(wh / 2), ww, 1);
    }
    // roof (trapezoid)
    const over = Math.round(bw * 0.1);
    const roofH = Math.round(wallH * 0.5);
    const rows = roofH;
    for (let i = 0; i < rows; i++) {
      const f = i / rows;
      const rw = bw + over * 2 - Math.round((bw + over * 2) * 0.42 * f);
      const rx = Math.round(x - rw / 2);
      ctx.fillStyle = i < 2 ? "#000" : f < 0.3 ? pal.roof : pal.rd;
      ctx.fillRect(rx, top - 1 - i, rw, 1);
    }
    // ridge highlight
    ctx.fillStyle = "rgba(255,255,255,0.25)";
    ctx.fillRect(Math.round(x - bw * 0.18), top - roofH, Math.round(bw * 0.36), 1);
    // banner
    ctx.fillStyle = b.accent;
    ctx.fillRect(Math.round(x - 1), top - roofH - 5, 2, 5);
    ctx.fillRect(Math.round(x + 1), top - roofH - 5, Math.round(bw * 0.1), 3);

    if (b.type === "forge") drawForgeExtras(ctx, x, top, bw, roofH, t);
    if (b.type === "hall") drawChimneySmoke(ctx, left + bw - 4, top - roofH, t);
  }
}

function drawArena(ctx: CanvasRenderingContext2D, x: number, y: number, bw: number, wallH: number, lit: string, pulse: number) {
  const left = Math.round(x - bw / 2);
  const top = Math.round(y - wallH);
  ctx.fillStyle = "#000";
  ctx.fillRect(left - 1, top - 1, bw + 2, wallH + 2);
  ctx.fillStyle = "#d8c9a0";
  ctx.fillRect(left, top, bw, wallH);
  ctx.fillStyle = "#b3a479";
  ctx.fillRect(left + Math.round(bw * 0.66), top, Math.round(bw * 0.34), wallH);
  // columns
  ctx.fillStyle = "#efe6cb";
  const cols = 5;
  for (let i = 0; i < cols; i++) {
    const cx = left + Math.round((bw / cols) * (i + 0.5)) - 1;
    ctx.fillRect(cx, top + 2, 3, wallH - 2);
    ctx.fillStyle = "rgba(0,0,0,0.18)";
    ctx.fillRect(cx + 2, top + 2, 1, wallH - 2);
    ctx.fillStyle = "#efe6cb";
  }
  // dome
  const domeR = Math.round(bw * 0.5);
  ctx.fillStyle = "#000";
  ellipseTop(ctx, x, top, domeR + 1);
  ctx.fillStyle = "#b65b3a";
  ellipseTop(ctx, x, top, domeR);
  ctx.fillStyle = "#d27a4f";
  ellipseTop(ctx, x - domeR * 0.25, top - domeR * 0.1, domeR * 0.55);
  // banners
  ctx.fillStyle = "#e2554a";
  ctx.fillRect(left + 2, top + 1, 2, Math.round(wallH * 0.5));
  ctx.fillRect(left + bw - 4, top + 1, 2, Math.round(wallH * 0.5));
  // gate
  const dw = Math.round(bw * 0.26);
  ctx.fillStyle = "#241008";
  ctx.fillRect(Math.round(x - dw / 2), top + wallH - Math.round(wallH * 0.6), dw, Math.round(wallH * 0.6));
  ctx.fillStyle = lit;
  ctx.globalAlpha = 0.5 * pulse;
  ctx.fillRect(Math.round(x - dw / 2) + 1, top + wallH - Math.round(wallH * 0.6) + 1, dw - 2, 2);
  ctx.globalAlpha = 1;
}

function drawVault(ctx: CanvasRenderingContext2D, x: number, y: number, bw: number, wallH: number, t: number) {
  const left = Math.round(x - bw / 2);
  const top = Math.round(y - wallH);
  ctx.fillStyle = "#000";
  ctx.fillRect(left - 1, top - 1, bw + 2, wallH + 2);
  ctx.fillStyle = "#5b5f86";
  ctx.fillRect(left, top, bw, wallH);
  ctx.fillStyle = "#474a6b";
  ctx.fillRect(left + Math.round(bw * 0.62), top, Math.round(bw * 0.38), wallH);
  // crystals
  const shards = [
    { dx: -0.36, h: 1.1, c: "#7fd0ff" },
    { dx: 0.0, h: 1.5, c: "#b59cff" },
    { dx: 0.34, h: 1.0, c: "#8affd0" },
  ];
  for (const s of shards) {
    const sx = Math.round(x + bw * s.dx);
    const sh = Math.round(wallH * s.h);
    const sw = Math.max(3, Math.round(bw * 0.14));
    const sy = top - sh + Math.round(wallH * 0.2);
    const glow = 0.6 + 0.4 * Math.sin(t * 2.5 + s.dx * 5);
    ctx.fillStyle = "#000";
    triUp(ctx, sx, sy, sw + 1, sh);
    ctx.fillStyle = s.c;
    ctx.globalAlpha = 0.5 + 0.3 * glow;
    triUp(ctx, sx, sy, sw, sh);
    ctx.globalAlpha = 1;
    ctx.fillStyle = "rgba(255,255,255,0.7)";
    ctx.fillRect(sx - 1, sy + 2, 1, Math.round(sh * 0.5));
  }
  // door
  const dw = Math.round(bw * 0.22);
  ctx.fillStyle = "#15182a";
  ctx.fillRect(Math.round(x - dw / 2), top + wallH - Math.round(wallH * 0.55), dw, Math.round(wallH * 0.55));
  ctx.fillStyle = "#9a8cf0";
  ctx.globalAlpha = 0.6 + 0.3 * Math.sin(t * 3);
  ctx.fillRect(Math.round(x - dw / 2) + 1, top + wallH - Math.round(wallH * 0.55) + 1, dw - 2, 2);
  ctx.globalAlpha = 1;
}

function drawForgeExtras(ctx: CanvasRenderingContext2D, x: number, top: number, bw: number, roofH: number, t: number) {
  // chimney
  const cxp = Math.round(x + bw * 0.28);
  ctx.fillStyle = "#3a3640";
  ctx.fillRect(cxp, top - roofH - 6, 5, 8);
  // ember glow
  ctx.globalCompositeOperation = "lighter";
  for (let i = 0; i < 6; i++) {
    const p = (t * 0.6 + i / 6) % 1;
    const ex = cxp + 2 + Math.sin((p + i) * 6) * 3;
    const ey = top - roofH - 6 - p * 16;
    ctx.fillStyle = `rgba(255,${120 + Math.floor(p * 100)},40,${(1 - p) * 0.9})`;
    ctx.fillRect(Math.round(ex), Math.round(ey), 1, 1);
  }
  ctx.globalCompositeOperation = "source-over";
}
function drawChimneySmoke(ctx: CanvasRenderingContext2D, x: number, top: number, t: number) {
  ctx.fillStyle = "#3a3640";
  ctx.fillRect(Math.round(x), top - 4, 4, 6);
  for (let i = 0; i < 4; i++) {
    const p = (t * 0.4 + i / 4) % 1;
    ctx.fillStyle = `rgba(200,200,200,${(1 - p) * 0.4})`;
    ctx.fillRect(Math.round(x + 1 + Math.sin((p + i) * 5) * 3), Math.round(top - 4 - p * 14), 2, 2);
  }
}

/* ----------------------------- monument ------------------------------- */
function drawMonument(ctx: CanvasRenderingContext2D, x: number, y: number, W: number, t: number, m: Mood) {
  const r = Math.round(W * 0.03);
  ctx.fillStyle = "rgba(0,0,0,0.3)";
  ellipse(ctx, x, y + 2, r * 1.2, r * 0.4);
  // stone base rings
  ctx.fillStyle = "#6e6a60";
  ellipse(ctx, x, y, r, r * 0.42);
  ctx.fillStyle = "#86826f";
  ellipse(ctx, x, y - 1, r * 0.78, r * 0.32);
  ctx.fillStyle = "#9b977f";
  ellipse(ctx, x, y - 2, r * 0.5, r * 0.2);
  // obelisk
  const ow = Math.max(3, Math.round(r * 0.3));
  const oh = Math.round(r * 1.5);
  ctx.fillStyle = "#000";
  ctx.fillRect(Math.round(x - ow / 2) - 1, Math.round(y - oh) - 1, ow + 2, oh + 1);
  ctx.fillStyle = "#7d8aa0";
  ctx.fillRect(Math.round(x - ow / 2), Math.round(y - oh), ow, oh);
  ctx.fillStyle = "#9fb0c8";
  ctx.fillRect(Math.round(x - ow / 2), Math.round(y - oh), Math.max(1, Math.round(ow * 0.4)), oh);
  // floating glow rune
  const gy = y - oh - 5 + Math.sin(t * 1.5) * 2;
  ctx.globalCompositeOperation = "lighter";
  const g = ctx.createRadialGradient(x, gy, 0, x, gy, 6);
  g.addColorStop(0, m.accent);
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g;
  ctx.fillRect(x - 6, gy - 6, 12, 12);
  ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = "#fff";
  ctx.fillRect(Math.round(x), Math.round(gy) - 1, 1, 3);
  ctx.fillRect(Math.round(x) - 1, Math.round(gy), 3, 1);
}

/* ------------------------------- pen ---------------------------------- */
function drawPen(ctx: CanvasRenderingContext2D, x: number, y: number, W: number, t: number, m: Mood) {
  const pw = Math.round(W * 0.13);
  const ph = Math.round(pw * 0.62);
  const left = Math.round(x - pw / 2);
  const top = Math.round(y - ph / 2);
  // dirt floor
  ctx.fillStyle = DIRT.base;
  ctx.fillRect(left, top, pw, ph);
  ctx.fillStyle = DIRT.dark;
  for (let i = 0; i < pw * ph * 0.04; i++) {
    ctx.fillRect(left + Math.floor(hash(i, 1) * pw), top + Math.floor(hash(i, 2) * ph), 1, 1);
  }
  // fence
  const post = (px: number, py: number) => {
    ctx.fillStyle = "#000";
    ctx.fillRect(px - 1, py - 5, 3, 7);
    ctx.fillStyle = "#7d5a32";
    ctx.fillRect(px, py - 5, 2, 6);
    ctx.fillStyle = "#5a3f22";
    ctx.fillRect(px, py - 2, 2, 1);
  };
  ctx.fillStyle = "#6e4f2c";
  ctx.fillRect(left, top - 2, pw, 1);
  ctx.fillRect(left, top + ph - 2, pw, 1);
  ctx.fillRect(left, top - 2, 1, ph);
  ctx.fillRect(left + pw - 1, top - 2, 1, ph);
  for (let px = left; px <= left + pw; px += 7) {
    post(px, top);
    post(px, top + ph);
  }
  // eggs
  const eggs = [
    { dx: 0.3, dy: 0.4, c: "#e8e0cf" },
    { dx: 0.55, dy: 0.45, c: "#d8c0a0" },
    { dx: 0.45, dy: 0.68, c: "#cfe0e8" },
  ];
  for (const e of eggs) {
    const ex = left + Math.round(pw * e.dx);
    const ey = top + Math.round(ph * e.dy);
    ctx.fillStyle = "rgba(0,0,0,0.25)";
    ellipse(ctx, ex, ey + 2, 3, 1.2);
    ctx.fillStyle = "#000";
    ellipse(ctx, ex, ey, 3.2, 4.2);
    ctx.fillStyle = e.c;
    ellipse(ctx, ex, ey, 2.6, 3.6);
    ctx.fillStyle = "rgba(255,255,255,0.6)";
    ctx.fillRect(ex - 1, ey - 2, 1, 2);
  }
}

/* ------------------------------- hero --------------------------------- */
function drawHero(ctx: CanvasRenderingContext2D, x: number, y: number, W: number, t: number, h: Hero) {
  const s = Math.max(1, Math.round(W * 0.0042));
  const bob = Math.round(Math.sin(t * 3 + x) * s);
  x = Math.round(x);
  y = Math.round(y) + bob;
  // shadow
  ctx.fillStyle = "rgba(0,0,0,0.3)";
  ellipse(ctx, x, y + 1, 4 * s, 1.6 * s);
  if (h.you) {
    ctx.strokeStyle = "rgba(255,210,74,0.9)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.ellipse(x, y + 1, 5 * s + Math.sin(t * 3) * s, 2.2 * s, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  const px = (dx: number, dy: number, w: number, hh: number, c: string) => {
    ctx.fillStyle = c;
    ctx.fillRect(x + dx * s, y + dy * s, Math.max(1, w * s), Math.max(1, hh * s));
  };
  // outline backing
  px(-3, -11, 6, 13, "#10100c");
  // legs
  px(-2, -2, 2, 3, "#2a2a30");
  px(0, -2, 2, 3, "#2a2a30");
  // body (cloak/tunic accent)
  px(-3, -8, 6, 6, h.accent);
  px(-3, -8, 2, 6, shade(h.accent, -0.18));
  px(-3, -8, 6, 1, shade(h.accent, 0.2));
  // belt
  px(-3, -3, 6, 1, "#3a2a16");
  // head
  px(-2, -12, 4, 4, "#e9c39a");
  px(-2, -12, 4, 1, "#d8a877");
  // hair/hood
  px(-2, -13, 4, 2, h.you ? "#d8a93a" : "#3a3340");
  px(-3, -12, 1, 2, h.you ? "#d8a93a" : "#3a3340");
  px(2, -12, 1, 2, h.you ? "#d8a93a" : "#3a3340");
}

/* ----------------------------- particles ------------------------------ */
function drawParticles(ctx: CanvasRenderingContext2D, W: number, H: number, t: number, m: Mood) {
  ctx.save();
  if (m.id === "dusk") {
    ctx.globalCompositeOperation = "lighter";
    for (let i = 0; i < 34; i++) {
      const seed = hash(i, 11);
      const x = (seed * 1.3 + Math.sin(t * 0.5 + i) * 0.02) % 1;
      const rise = (t * (0.04 + seed * 0.05) + seed) % 1;
      const px = x * W;
      const py = H - rise * H;
      const a = Math.sin(rise * Math.PI) * 0.9;
      ctx.fillStyle = `rgba(255,${150 + Math.floor(seed * 80)},60,${a})`;
      const sz = 1 + Math.round(seed * 2);
      ctx.fillRect(px, py, sz, sz);
    }
  } else if (m.id === "night") {
    ctx.globalCompositeOperation = "lighter";
    for (let i = 0; i < 28; i++) {
      const seed = hash(i, 7);
      const px = (seed + Math.sin(t * 0.4 + i * 2) * 0.04) * W;
      const py = (hash(i, 19) + Math.cos(t * 0.5 + i) * 0.03) * H * 0.92;
      const blink = Math.max(0, Math.sin(t * 2 + i * 1.7));
      ctx.fillStyle = `rgba(180,255,140,${blink * 0.9})`;
      ctx.fillRect(px, py, 2, 2);
    }
    // fog wisps
    ctx.globalCompositeOperation = "screen";
    for (let i = 0; i < 4; i++) {
      const fx = ((t * (8 + i * 4) + i * 400) % (W + 300)) - 150;
      const fy = H * (0.25 + i * 0.2);
      const g = ctx.createRadialGradient(fx, fy, 0, fx, fy, 160);
      g.addColorStop(0, "rgba(180,200,230,0.10)");
      g.addColorStop(1, "rgba(180,200,230,0)");
      ctx.fillStyle = g;
      ctx.fillRect(fx - 160, fy - 100, 320, 200);
    }
  } else {
    ctx.globalCompositeOperation = "lighter";
    for (let i = 0; i < 18; i++) {
      const seed = hash(i, 5);
      const px = (seed + Math.sin(t * 0.2 + i) * 0.03) * W;
      const py = (hash(i, 23) + t * 0.005 * (i % 3)) % 1 * H;
      ctx.fillStyle = `rgba(255,250,220,${0.2 + 0.2 * Math.sin(t + i)})`;
      ctx.fillRect(px, py, 2, 2);
    }
  }
  ctx.restore();
}

/* ----------------------------- minimap -------------------------------- */
function drawMinimap(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, m: Mood, t: number) {
  const W = canvas.width;
  const H = canvas.height;
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = "#2f5a2d";
  ctx.fillRect(0, 0, W, H);
  for (let i = 0; i < 60; i++) {
    ctx.fillStyle = hash(i, 3) > 0.5 ? "#3f7a2c" : "#5aa23a";
    ctx.fillRect(Math.floor(hash(i, 1) * W), Math.floor(hash(i, 2) * H), 2, 2);
  }
  // roads
  ctx.fillStyle = "#bd9357";
  ctx.fillRect(MONUMENT.nx * W - 1, 0, 3, H);
  ctx.fillRect(0, MONUMENT.ny * H - 1, W, 3);
  // buildings
  for (const b of BUILDINGS) {
    ctx.fillStyle = "#000";
    ctx.fillRect(Math.round(b.nx * W) - 2, Math.round(b.ny * H) - 2, 5, 5);
    ctx.fillStyle = b.accent;
    ctx.fillRect(Math.round(b.nx * W) - 1, Math.round(b.ny * H) - 1, 3, 3);
  }
  // pen
  ctx.fillStyle = "#8f6a3a";
  ctx.fillRect(Math.round(PEN.nx * W) - 2, Math.round(PEN.ny * H) - 1, 5, 3);
  // hero blink
  const blink = 0.5 + 0.5 * Math.sin(t * 4);
  ctx.fillStyle = `rgba(255,210,74,${blink})`;
  ctx.fillRect(Math.round(HEROES[0].nx * W) - 1, Math.round(HEROES[0].ny * H) - 1, 3, 3);
}

/* ------------------------------ helpers ------------------------------- */
function ellipse(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number) {
  ctx.beginPath();
  ctx.ellipse(x, y, Math.max(0.5, rx), Math.max(0.5, ry), 0, 0, Math.PI * 2);
  ctx.fill();
}
function ellipseTop(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  ctx.beginPath();
  ctx.ellipse(x, y, r, r, 0, Math.PI, Math.PI * 2);
  ctx.fill();
}
function triUp(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x - w / 2, y + h);
  ctx.lineTo(x + w / 2, y + h);
  ctx.closePath();
  ctx.fill();
}
function shade(hex: string, amt: number) {
  const h = hex.replace("#", "");
  let r = parseInt(h.substring(0, 2), 16);
  let g = parseInt(h.substring(2, 4), 16);
  let b = parseInt(h.substring(4, 6), 16);
  r = Math.max(0, Math.min(255, r + amt * 255));
  g = Math.max(0, Math.min(255, g + amt * 255));
  b = Math.max(0, Math.min(255, b + amt * 255));
  return `rgb(${r | 0},${g | 0},${b | 0})`;
}
