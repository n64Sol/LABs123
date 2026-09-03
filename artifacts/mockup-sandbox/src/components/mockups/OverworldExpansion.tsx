import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Overworld expansion mockup for Labyrinths — rendered in the REAL 16-bit game
 * art (the same ground textures, scenery sprites, hub stone and portals the live
 * overworld uses) so it looks like the actual map, not an abstract diagram.
 *
 * It reproduces the live renderer's draw path (grass ground → per-biome floor
 * circles → hub → scattered objects → portals) and lets you compare:
 *   • TODAY     — current spacing + object density (biomes overlap near the hub,
 *                 scenery packed in tight → you "run into everything").
 *   • PROPOSED  — bigger, well-spaced biomes radiating off a clear spawn circle,
 *                 lower object density, a landmark at each biome, roads out from
 *                 spawn, and rings that keep growing outward as players join.
 */

// ----- Biome catalog (keys/names/accents match the live game) ------------------

interface BiomeDef {
  key: string;
  name: string;
  landmark: string;
  accent: string;
}

const BIOMES: BiomeDef[] = [
  { key: "verdant_grove", name: "Verdant Grove", landmark: "The Heartwood", accent: "#5fd97a" },
  { key: "sunlit_ruins", name: "Sunlit Ruins", landmark: "Sunspire Temple", accent: "#f5b942" },
  { key: "tidecaller", name: "Tidecaller Hollow", landmark: "Tidewatch Beacon", accent: "#5fe0d4" },
  { key: "crystal_caverns", name: "Crystal Caverns", landmark: "The Geode Spire", accent: "#5fc9f5" },
  { key: "emberforge", name: "Emberforge Depths", landmark: "The Great Forge", accent: "#f57c5f" },
  { key: "astral_spire", name: "Astral Spire", landmark: "The Observatory", accent: "#b98cf5" },
];

// ----- Geometry (TODAY = live world.ts constants; PROPOSED = the fix) ----------

interface Geo {
  INNER: number;
  STEP: number;
  SPACING: number;
  FILL: number;
  HUB_CLEAR: number;
  densityScale: number;
  /** Region radius as a function of ring-span; PROPOSED scales with distance. */
  regionRadius: (rings: number, midR: number) => number;
  roads: boolean;
}

const TODAY: Geo = {
  INNER: 1100,
  STEP: 420,
  SPACING: 420,
  FILL: 0.78,
  HUB_CLEAR: 170,
  densityScale: 1,
  regionRadius: (rings) => Math.max(900, 1100 * 0.55 + rings * 420 * 0.85),
  roads: false,
};

const PROPOSED: Geo = {
  INNER: 2200,
  STEP: 560,
  SPACING: 480,
  FILL: 0.82,
  HUB_CLEAR: 260,
  densityScale: 0.42,
  // Radius proportional to distance from the hub → biomes never overlap, no
  // matter how far the world grows outward.
  regionRadius: (_rings, midR) => midR * 0.44,
  roads: true,
};

const N = BIOMES.length;
const FULL = (Math.PI * 2) / N;
const TILE = 32; // world px per logical tile (object grid)
const FLOOR_TILE = 256; // world px per ground-texture tile

const GROUND_KEYS = [
  "g_field",
  "g_verdant_grove",
  "g_sunlit_ruins",
  "g_tidecaller",
  "g_crystal_caverns",
  "g_emberforge",
  "g_astral_spire",
  "g_road",
  "g_hub",
];
const OBJECT_KEYS = [
  "o_tree",
  "o_bush",
  "o_rock",
  "o_cactus",
  "o_ruin_pillar",
  "o_crystal",
  "o_lava_rock",
  "o_rune_stone",
  "o_reed",
];

// Per-biome object palettes + base densities (mirrors the live tileMap.ts).
interface ObjectDef {
  kind: string;
  w: number;
  h: number;
  weight: number;
}
const PALETTES: Record<string, ObjectDef[]> = {
  field: [
    { kind: "o_tree", w: 88, h: 116, weight: 2 },
    { kind: "o_bush", w: 48, h: 42, weight: 3 },
    { kind: "o_rock", w: 44, h: 38, weight: 2 },
  ],
  verdant_grove: [
    { kind: "o_tree", w: 92, h: 122, weight: 4 },
    { kind: "o_bush", w: 50, h: 44, weight: 3 },
    { kind: "o_rock", w: 44, h: 38, weight: 1 },
  ],
  sunlit_ruins: [
    { kind: "o_cactus", w: 54, h: 80, weight: 3 },
    { kind: "o_ruin_pillar", w: 56, h: 88, weight: 2 },
    { kind: "o_rock", w: 46, h: 40, weight: 3 },
  ],
  tidecaller: [
    { kind: "o_reed", w: 46, h: 50, weight: 4 },
    { kind: "o_rock", w: 46, h: 40, weight: 3 },
  ],
  crystal_caverns: [
    { kind: "o_crystal", w: 58, h: 64, weight: 4 },
    { kind: "o_rock", w: 46, h: 40, weight: 3 },
  ],
  emberforge: [
    { kind: "o_lava_rock", w: 52, h: 46, weight: 4 },
    { kind: "o_rock", w: 46, h: 40, weight: 2 },
  ],
  astral_spire: [
    { kind: "o_rune_stone", w: 56, h: 84, weight: 3 },
    { kind: "o_rock", w: 46, h: 40, weight: 2 },
  ],
};
const DENSITY: Record<string, number> = {
  field: 0.045,
  verdant_grove: 0.1,
  sunlit_ruins: 0.085,
  tidecaller: 0.07,
  crystal_caverns: 0.09,
  emberforge: 0.08,
  astral_spire: 0.07,
};

// Per-biome landmark composition (drawn from real sprites, scaled up).
interface LandmarkPiece {
  kind: string;
  dx: number;
  dy: number;
  h: number;
}
const LANDMARKS: Record<string, LandmarkPiece[]> = {
  verdant_grove: [
    { kind: "o_tree", dx: 0, dy: 0, h: 420 },
    { kind: "o_tree", dx: -150, dy: 40, h: 280 },
    { kind: "o_tree", dx: 150, dy: 40, h: 280 },
  ],
  sunlit_ruins: [
    { kind: "o_ruin_pillar", dx: -130, dy: 20, h: 320 },
    { kind: "o_ruin_pillar", dx: 0, dy: 0, h: 380 },
    { kind: "o_ruin_pillar", dx: 130, dy: 20, h: 320 },
  ],
  tidecaller: [
    { kind: "o_rock", dx: 0, dy: 30, h: 200 },
    { kind: "o_reed", dx: -110, dy: 20, h: 230 },
    { kind: "o_reed", dx: 110, dy: 20, h: 230 },
    { kind: "o_crystal", dx: 0, dy: -90, h: 260 },
  ],
  crystal_caverns: [
    { kind: "o_crystal", dx: 0, dy: 0, h: 400 },
    { kind: "o_crystal", dx: -140, dy: 50, h: 250 },
    { kind: "o_crystal", dx: 140, dy: 50, h: 250 },
  ],
  emberforge: [
    { kind: "o_lava_rock", dx: 0, dy: 0, h: 300 },
    { kind: "o_lava_rock", dx: -140, dy: 30, h: 220 },
    { kind: "o_lava_rock", dx: 140, dy: 30, h: 220 },
    { kind: "o_ruin_pillar", dx: 0, dy: -40, h: 300 },
  ],
  astral_spire: [
    { kind: "o_rune_stone", dx: 0, dy: 0, h: 400 },
    { kind: "o_rune_stone", dx: -150, dy: 40, h: 250 },
    { kind: "o_rune_stone", dx: 150, dy: 40, h: 250 },
  ],
};
const LANDMARK_CLEAR = 280; // keep scattered objects off the landmark footprint

// ----- Deterministic helpers (mirror the live geometry/scatter) ---------------

function hash32(n: number): number {
  let h = (n ^ 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}
function hashTile(tx: number, ty: number, salt: number): number {
  let h = (Math.imul(tx | 0, 374761393) ^ Math.imul(ty | 0, 668265263) ^ Math.imul(salt | 0, 2246822519)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 2246822519) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 3266489917) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 0xffffffff;
}

// Smooth value noise + fbm — gives a coherent low-frequency field so scatter forms
// intentional clusters (groves/patches) with bare clearings, not uniform per-tile noise.
function vnoise(x: number, y: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const tl = hashTile(xi, yi, 91);
  const tr = hashTile(xi + 1, yi, 91);
  const bl = hashTile(xi, yi + 1, 91);
  const br = hashTile(xi + 1, yi + 1, 91);
  const u = xf * xf * (3 - 2 * xf);
  const w = yf * yf * (3 - 2 * yf);
  const top = tl + (tr - tl) * u;
  const bot = bl + (br - bl) * u;
  return top + (bot - top) * w;
}
function fbm(x: number, y: number): number {
  let sum = 0;
  let amp = 0.5;
  let freq = 1;
  let norm = 0;
  for (let o = 0; o < 3; o++) {
    sum += amp * vnoise(x * freq, y * freq);
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}

function wedgeCenter(i: number): number {
  return -Math.PI / 2 + i * FULL;
}
function ringCapacity(radius: number, width: number, spacing: number): number {
  return Math.max(1, Math.floor((radius * width) / spacing));
}
function ringsForCount(count: number, g: Geo): number {
  if (count <= 0) return 1;
  const width = FULL * g.FILL;
  let remaining = count;
  let ring = 0;
  while (remaining > 0 && ring < 4000) {
    const radius = g.INNER + ring * g.STEP;
    remaining -= ringCapacity(radius, width, g.SPACING);
    ring += 1;
  }
  return ring;
}
function plotPosition(i: number, indexInBiome: number, g: Geo): { x: number; y: number } {
  const center = wedgeCenter(i);
  const width = FULL * g.FILL;
  let k = Math.max(0, Math.floor(indexInBiome));
  let ring = 0;
  for (let guard = 0; guard < 100000; guard++) {
    const radius = g.INNER + ring * g.STEP;
    const cap = ringCapacity(radius, width, g.SPACING);
    if (k < cap) {
      const t = cap === 1 ? 0.5 : k / (cap - 1);
      const ang = center + (t - 0.5) * width;
      const jitter = ((hash32(i * 99991 + indexInBiome * 6271) % 1000) / 1000 - 0.5) * g.STEP * 0.28;
      const r = radius + jitter;
      return { x: Math.cos(ang) * r, y: Math.sin(ang) * r };
    }
    k -= cap;
    ring += 1;
  }
  return { x: Math.cos(center) * g.INNER, y: Math.sin(center) * g.INNER };
}

interface Region {
  key: string;
  name: string;
  landmark: string;
  accent: string;
  cx: number;
  cy: number;
  radius: number;
  count: number;
  rings: number;
  center: number;
}

function buildRegions(population: number, g: Geo): Region[] {
  return BIOMES.map((b, i) => {
    const count = population;
    const center = wedgeCenter(i);
    const rings = ringsForCount(count, g);
    const midR = g.INNER + (rings / 2) * g.STEP;
    const radius = g.regionRadius(rings, midR);
    return {
      key: b.key,
      name: b.name,
      landmark: b.landmark,
      accent: b.accent,
      cx: Math.cos(center) * midR,
      cy: Math.sin(center) * midR,
      radius,
      count,
      rings,
      center,
    };
  });
}

function biomeAt(x: number, y: number, regions: Region[]): Region | null {
  let best: Region | null = null;
  let bestScore = Infinity;
  for (const r of regions) {
    const d = Math.hypot(r.cx - x, r.cy - y);
    if (d < r.radius) {
      const score = d / r.radius;
      if (score < bestScore) {
        bestScore = score;
        best = r;
      }
    }
  }
  return best;
}

// ----- Component --------------------------------------------------------------

type Mode = "after" | "before";
type View = "world" | "ground";

export default function OverworldExpansion(): React.JSX.Element {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const imgsRef = useRef<Record<string, HTMLImageElement>>({});
  const camRef = useRef({ x: 0, y: 0, scale: 0.08 });
  const dragRef = useRef<{ x: number; y: number } | null>(null);
  const rafRef = useRef(0);
  const dirtyRef = useRef(true);

  const params = new URLSearchParams(typeof window !== "undefined" ? window.location.search : "");
  const [loaded, setLoaded] = useState(0);
  const [mode, setMode] = useState<Mode>(params.get("mode") === "before" ? "before" : "after");
  const [view, setView] = useState<View>(params.get("view") === "ground" ? "ground" : "world");
  const [population, setPopulation] = useState(() => {
    const p = Number(params.get("pop"));
    return Number.isFinite(p) && p > 0 ? Math.min(60, Math.max(1, Math.round(p))) : 10;
  });
  const [biome, setBiome] = useState<string>(() => {
    const b = params.get("biome");
    return b && BIOMES.some((x) => x.key === b) ? b : "verdant_grove";
  });

  const modeRef = useRef(mode);
  const popRef = useRef(population);
  modeRef.current = mode;
  popRef.current = population;

  const geo = mode === "after" ? PROPOSED : TODAY;
  const regionsForHud = buildRegions(population, geo);
  const ringCount = regionsForHud[0]?.rings ?? 1;

  // Preload all ground + object sprites (plus the portal).
  useEffect(() => {
    const base = import.meta.env.BASE_URL.replace(/\/?$/, "/");
    const map: Record<string, HTMLImageElement> = {};
    let alive = true;
    const all = [...GROUND_KEYS.map((k) => [k, `${base}game/overworld16/${k}.png`]), ...OBJECT_KEYS.map((k) => [k, `${base}game/overworld16/${k}.png`]), ["portal", `${base}game/portal.png`]];
    for (const [key, src] of all) {
      const img = new Image();
      img.onload = () => {
        if (alive) setLoaded((n) => n + 1);
      };
      img.src = src;
      map[key] = img;
    }
    imgsRef.current = map;
    return () => {
      alive = false;
    };
  }, []);

  const schedule = useCallback(() => {
    dirtyRef.current = true;
  }, []);

  // Fit the camera to the whole current world (or zoom into one biome).
  const fit = useCallback((v: View, m: Mode, pop: number, biomeKey: string) => {
    const g = m === "after" ? PROPOSED : TODAY;
    const regions = buildRegions(pop, g);
    const cam = camRef.current;
    const wrap = wrapRef.current;
    const cssW = wrap?.clientWidth ?? 1200;
    const cssH = wrap?.clientHeight ?? 700;
    if (v === "world") {
      let ext = g.INNER;
      for (const r of regions) ext = Math.max(ext, Math.hypot(r.cx, r.cy) + r.radius);
      const viewR = ext * 1.12;
      cam.scale = Math.min(cssW, cssH) / 2 / viewR;
      cam.x = 0;
      cam.y = 0;
    } else {
      // Ground-level: drop the camera into the chosen biome so you see its own
      // ground cover, scenery mix, landmark and effects up close.
      const r = regions.find((x) => x.key === biomeKey) ?? regions[0]!;
      cam.x = r.cx;
      cam.y = r.cy + r.radius * 0.18;
      cam.scale = 0.62;
    }
    dirtyRef.current = true;
  }, []);

  // Refit whenever the mode, view, population or chosen biome changes.
  useEffect(() => {
    fit(view, mode, population, biome);
  }, [fit, view, mode, population, biome]);

  // Single coalesced render loop — only repaints when something changed.
  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let dpr = Math.min(2, window.devicePixelRatio || 1);
    const resize = () => {
      dpr = Math.min(2, window.devicePixelRatio || 1);
      const cssW = wrap.clientWidth;
      const cssH = wrap.clientHeight;
      canvas.width = Math.max(1, Math.floor(cssW * dpr));
      canvas.height = Math.max(1, Math.floor(cssH * dpr));
      canvas.style.width = `${cssW}px`;
      canvas.style.height = `${cssH}px`;
      dirtyRef.current = true;
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);

    const loop = (t: number) => {
      // Continuous repaint so water, glows, embers and sway animate.
      dirtyRef.current = false;
      draw(ctx, canvas, dpr, imgsRef.current, camRef.current, modeRef.current, popRef.current, t);
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(rafRef.current);
      ro.disconnect();
    };
  }, []);

  // Repaint when textures finish loading.
  useEffect(() => {
    dirtyRef.current = true;
  }, [loaded]);

  // ----- Interaction: drag to pan, wheel to zoom -----
  const onDown = useCallback((e: React.MouseEvent) => {
    dragRef.current = { x: e.clientX, y: e.clientY };
  }, []);
  const onMove = useCallback(
    (e: React.MouseEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const cam = camRef.current;
      cam.x -= (e.clientX - d.x) / cam.scale;
      cam.y -= (e.clientY - d.y) / cam.scale;
      dragRef.current = { x: e.clientX, y: e.clientY };
      schedule();
    },
    [schedule],
  );
  const onUp = useCallback(() => {
    dragRef.current = null;
  }, []);
  const onWheel = useCallback(
    (e: React.WheelEvent) => {
      const cam = camRef.current;
      const factor = e.deltaY < 0 ? 1.18 : 1 / 1.18;
      cam.scale = Math.max(0.02, Math.min(2.4, cam.scale * factor));
      schedule();
    },
    [schedule],
  );
  const zoomBy = useCallback(
    (f: number) => {
      const cam = camRef.current;
      cam.scale = Math.max(0.02, Math.min(2.4, cam.scale * f));
      schedule();
    },
    [schedule],
  );

  const ui: React.CSSProperties = { fontFamily: "ui-sans-serif, system-ui, sans-serif" };

  return (
    <div style={{ position: "absolute", inset: 0, background: "#0b0f0a", color: "#e6ebf2", ...ui }}>
      <div ref={wrapRef} style={{ position: "absolute", inset: 0 }}>
        <canvas
          ref={canvasRef}
          onMouseDown={onDown}
          onMouseMove={onMove}
          onMouseUp={onUp}
          onMouseLeave={onUp}
          onWheel={onWheel}
          style={{ display: "block", cursor: dragRef.current ? "grabbing" : "grab" }}
        />
      </div>

      {/* Title */}
      <div style={{ position: "absolute", left: 24, top: 18, pointerEvents: "none" }}>
        <div style={{ fontSize: 11, letterSpacing: 3, color: "#9aa6bd", fontWeight: 700 }}>LABYRINTHS · OVERWORLD</div>
        <div style={{ fontSize: 26, fontWeight: 800, marginTop: 2, textShadow: "0 2px 8px rgba(0,0,0,0.6)" }}>
          {mode === "after" ? "Proposed World" : "Today's World"}
        </div>
        <div style={{ fontSize: 12, color: "#9aa6bd", marginTop: 4, maxWidth: 360 }}>
          Rendered in the real game art. Drag to pan · scroll to zoom.
        </div>
      </div>

      {/* Mode toggle */}
      <div style={{ position: "absolute", right: 24, top: 18, display: "flex", gap: 8, alignItems: "center" }}>
        <Toggle active={mode === "after"} onClick={() => setMode("after")} label="Proposed" color="#5fd97a" />
        <Toggle active={mode === "before"} onClick={() => setMode("before")} label="Today" color="#f57c5f" />
      </div>

      {/* View toggle */}
      <div style={{ position: "absolute", right: 24, top: 64, display: "flex", gap: 8, alignItems: "center" }}>
        <Toggle active={view === "world"} onClick={() => setView("world")} label="World view" color="#5fc9f5" small />
        <Toggle active={view === "ground"} onClick={() => setView("ground")} label="Ground level" color="#5fc9f5" small />
      </div>

      {/* Biome picker (ground view only) — each biome has its own scenery + effects */}
      {view === "ground" && (
        <div
          style={{
            position: "absolute",
            left: "50%",
            top: 18,
            transform: "translateX(-50%)",
            display: "flex",
            gap: 6,
            flexWrap: "wrap",
            justifyContent: "center",
            maxWidth: 560,
          }}
        >
          {BIOMES.map((b) => (
            <Toggle key={b.key} active={biome === b.key} onClick={() => setBiome(b.key)} label={b.name} color={b.accent} small />
          ))}
        </div>
      )}

      {/* Population panel */}
      <div
        style={{
          position: "absolute",
          right: 24,
          top: 112,
          width: 248,
          background: "rgba(14,18,26,0.82)",
          border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: 12,
          padding: 14,
          backdropFilter: "blur(6px)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <span style={{ fontSize: 12, color: "#9aa6bd" }}>Labyrinths per biome</span>
          <span style={{ fontSize: 15, fontWeight: 700 }}>{population}</span>
        </div>
        <input
          type="range"
          min={1}
          max={60}
          value={population}
          onChange={(e) => setPopulation(Number(e.target.value))}
          style={{ width: "100%", accentColor: "#5fc9f5", marginTop: 8 }}
        />
        <div style={{ fontSize: 11, color: "#7f8aa3", marginTop: 8, lineHeight: 1.5 }}>
          {ringCount} ring{ringCount === 1 ? "" : "s"} per biome · {population * N} total ·
          {mode === "after" ? " biomes stay separated as the world grows" : " biomes overlap near the hub"}
        </div>
      </div>

      {/* Zoom buttons */}
      <div style={{ position: "absolute", right: 24, bottom: 96, display: "flex", flexDirection: "column", gap: 8 }}>
        <RoundBtn onClick={() => zoomBy(1.25)}>+</RoundBtn>
        <RoundBtn onClick={() => zoomBy(1 / 1.25)}>−</RoundBtn>
        <RoundBtn onClick={() => fit(view, mode, population, biome)} title="Fit">⤢</RoundBtn>
      </div>

      {/* Caption */}
      <div
        style={{
          position: "absolute",
          left: 24,
          bottom: 22,
          maxWidth: 440,
          background: "rgba(14,18,26,0.82)",
          border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: 12,
          padding: "12px 14px",
          backdropFilter: "blur(6px)",
        }}
      >
        <div style={{ fontSize: 13, fontWeight: 700, color: mode === "after" ? "#7be39a" : "#f79b86" }}>
          {view === "ground"
            ? `Ground level · ${BIOMES.find((b) => b.key === biome)?.name ?? ""}`
            : mode === "after"
              ? "Proposed layout"
              : "Today (congested)"}
        </div>
        <div style={{ fontSize: 12.5, color: "#c3ccdd", marginTop: 4, lineHeight: 1.55 }}>
          {view === "ground"
            ? "Each biome has its own living look — biome-appropriate scenery (grove trees & flowers, desert cactus & ruins, glowing crystals, lava rocks, marsh reeds, astral runes) plus ground cover, animated water with shimmer & ripples, and effects on props (crystal/rune glow, rising embers, gentle sway, pulsing portals). Pick a biome above."
            : mode === "after"
              ? "Six large biomes radiate off a clear spawn circle, each spaced apart with open field (and roads) between them and a landmark at its heart. Far fewer trees/rocks so you can actually move. New labyrinths fill each biome ring-by-ring and the world keeps growing outward."
              : "Biomes sit close to the hub and overlap into one cluttered blob, with scenery packed in tight — so you bump into everything and there's no breathing room or sense of place."}
        </div>
      </div>
    </div>
  );
}

// ----- UI bits ----------------------------------------------------------------

function Toggle({ active, onClick, label, color, small }: { active: boolean; onClick: () => void; label: string; color: string; small?: boolean }): React.JSX.Element {
  return (
    <button
      onClick={onClick}
      style={{
        cursor: "pointer",
        border: "1px solid " + (active ? color : "rgba(255,255,255,0.14)"),
        background: active ? color + "22" : "rgba(14,18,26,0.7)",
        color: active ? "#fff" : "#9aa6bd",
        fontWeight: 700,
        fontSize: small ? 11 : 13,
        padding: small ? "5px 10px" : "7px 14px",
        borderRadius: 9,
        backdropFilter: "blur(6px)",
      }}
    >
      {label}
    </button>
  );
}

function RoundBtn({ onClick, children, title }: { onClick: () => void; children: React.ReactNode; title?: string }): React.JSX.Element {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        width: 38,
        height: 38,
        borderRadius: 10,
        border: "1px solid rgba(255,255,255,0.12)",
        background: "rgba(14,18,26,0.82)",
        color: "#e6ebf2",
        fontSize: 18,
        cursor: "pointer",
        backdropFilter: "blur(6px)",
      }}
    >
      {children}
    </button>
  );
}

// ----- Rendering (mirrors the live OverworldMap draw path) --------------------

interface Drawable {
  y: number;
  fn: () => void;
}

function draw(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  dpr: number,
  sprites: Record<string, HTMLImageElement>,
  cam: { x: number; y: number; scale: number },
  mode: Mode,
  population: number,
  time: number,
): void {
  const g = mode === "after" ? PROPOSED : TODAY;
  const regions = buildRegions(population, g);
  const cssW = canvas.width / dpr;
  const cssH = canvas.height / dpr;
  const scale = cam.scale;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);
  ctx.fillStyle = "#10160f";
  ctx.fillRect(0, 0, cssW, cssH);

  const hw = cssW / 2 / scale;
  const hh = cssH / 2 / scale;
  const v = { vx0: cam.x - hw, vy0: cam.y - hh, vx1: cam.x + hw, vy1: cam.y + hh };

  ctx.save();
  ctx.translate(cssW / 2, cssH / 2);
  ctx.scale(scale, scale);
  ctx.translate(-cam.x, -cam.y);
  ctx.imageSmoothingEnabled = false;

  drawGround(ctx, sprites, v);
  if (g.roads) drawRoads(ctx, sprites, regions, g);
  drawRegionFloors(ctx, sprites, regions, v);
  drawDecor(ctx, regions, g, v, scale, time);
  drawHub(ctx, sprites, g);

  // Y-sorted scatter + landmarks + portals so tall things occlude correctly.
  const drawables: Drawable[] = [];
  collectObjects(ctx, regions, g, v, sprites, drawables, time);
  collectLandmarks(ctx, regions, sprites, drawables, time);
  collectPortals(ctx, regions, g, population, v, sprites, drawables, time);
  drawables.sort((a, b) => a.y - b.y);
  for (const d of drawables) d.fn();

  // Per-biome atmosphere grade — pulls ground, props, and effects into one palette.
  drawAmbience(ctx, regions, v);

  drawHubMarker(ctx);
  ctx.restore();

  // Screen-space biome labels.
  drawLabels(ctx, regions, cam, scale, cssW, cssH);
}

function tileFloor(ctx: CanvasRenderingContext2D, img: HTMLImageElement, x0: number, y0: number, x1: number, y1: number): void {
  if (!img.complete || img.naturalWidth === 0) return;
  const sx = Math.floor(x0 / FLOOR_TILE) * FLOOR_TILE;
  const sy = Math.floor(y0 / FLOOR_TILE) * FLOOR_TILE;
  for (let x = sx; x < x1; x += FLOOR_TILE) {
    for (let y = sy; y < y1; y += FLOOR_TILE) {
      ctx.drawImage(img, x, y, FLOOR_TILE, FLOOR_TILE);
    }
  }
}

function drawGround(ctx: CanvasRenderingContext2D, sprites: Record<string, HTMLImageElement>, v: { vx0: number; vy0: number; vx1: number; vy1: number }): void {
  const grass = sprites["g_field"];
  if (grass && grass.complete && grass.naturalWidth > 0) {
    tileFloor(ctx, grass, v.vx0, v.vy0, v.vx1 + FLOOR_TILE, v.vy1 + FLOOR_TILE);
  } else {
    ctx.fillStyle = "#2f4a32";
    ctx.fillRect(v.vx0, v.vy0, v.vx1 - v.vx0, v.vy1 - v.vy0);
  }
}

function drawRoads(ctx: CanvasRenderingContext2D, sprites: Record<string, HTMLImageElement>, regions: Region[], g: Geo): void {
  const road = sprites["g_road"];
  for (const r of regions) {
    const len = Math.hypot(r.cx, r.cy);
    const ang = Math.atan2(r.cy, r.cx);
    const halfW = 150;
    ctx.save();
    ctx.rotate(0); // identity; we translate/rotate manually below
    ctx.translate(0, 0);
    ctx.rotate(ang);
    ctx.beginPath();
    ctx.rect(g.HUB_CLEAR * 0.6, -halfW, len - r.radius * 0.4, halfW * 2);
    ctx.clip();
    if (road && road.complete && road.naturalWidth > 0) {
      tileFloor(ctx, road, 0, -halfW - FLOOR_TILE, len, halfW + FLOOR_TILE);
    } else {
      ctx.fillStyle = "#6b5a44";
      ctx.fillRect(0, -halfW, len, halfW * 2);
    }
    // Soft edges along the road band.
    const grd = ctx.createLinearGradient(0, -halfW, 0, halfW);
    grd.addColorStop(0, "rgba(16,22,16,0.55)");
    grd.addColorStop(0.5, "rgba(16,22,16,0)");
    grd.addColorStop(1, "rgba(16,22,16,0.55)");
    ctx.fillStyle = grd;
    ctx.fillRect(0, -halfW, len, halfW * 2);
    ctx.restore();
  }
}

function drawRegionFloors(ctx: CanvasRenderingContext2D, sprites: Record<string, HTMLImageElement>, regions: Region[], v: { vx0: number; vy0: number; vx1: number; vy1: number }): void {
  for (const z of regions) {
    if (z.cx + z.radius < v.vx0 || z.cx - z.radius > v.vx1 || z.cy + z.radius < v.vy0 || z.cy - z.radius > v.vy1) continue;
    // Tidecaller's raw tile bakes a water channel into the art; tiling it scatters
    // disconnected "cut-off river" bits that fight the coherent procedural ponds.
    // Paint a clean pixel-sand shore instead and let drawWater own all the water.
    const isTide = z.key === "tidecaller";
    const floor = sprites[`g_${z.key}`];
    if (!isTide && (!floor || !floor.complete || floor.naturalWidth === 0)) continue;
    ctx.save();
    ctx.beginPath();
    ctx.arc(z.cx, z.cy, z.radius, 0, Math.PI * 2);
    ctx.clip();
    if (isTide) {
      paintSandFloor(ctx, z);
    } else {
      tileFloor(ctx, floor!, z.cx - z.radius, z.cy - z.radius, z.cx + z.radius + FLOOR_TILE, z.cy + z.radius + FLOOR_TILE);
    }
    const vg = ctx.createRadialGradient(z.cx, z.cy, z.radius * 0.74, z.cx, z.cy, z.radius);
    vg.addColorStop(0, "rgba(16,22,16,0)");
    vg.addColorStop(1, "rgba(16,22,16,0.5)");
    ctx.fillStyle = vg;
    ctx.fillRect(z.cx - z.radius, z.cy - z.radius, z.radius * 2, z.radius * 2);
    ctx.restore();
  }
}

/** Flat pixel-sand shore for Tidecaller (no baked river). Caller has clipped to the region. */
function paintSandFloor(ctx: CanvasRenderingContext2D, z: Region): void {
  const x0 = z.cx - z.radius;
  const y0 = z.cy - z.radius;
  const size = z.radius * 2;
  ctx.fillStyle = "#d3a05f";
  ctx.fillRect(x0, y0, size, size);
  const CELL = 16;
  const gx0 = Math.floor(x0 / CELL) * CELL;
  const gy0 = Math.floor(y0 / CELL) * CELL;
  for (let yy = gy0; yy < z.cy + z.radius; yy += CELL) {
    for (let xx = gx0; xx < z.cx + z.radius; xx += CELL) {
      const h = hashTile(xx, yy, 71);
      if (h > 0.84) ctx.fillStyle = "#e6c486";
      else if (h < 0.18) ctx.fillStyle = "#bd8a4c";
      else continue;
      ctx.fillRect(xx, yy, CELL, CELL);
    }
  }
}

function drawHub(ctx: CanvasRenderingContext2D, sprites: Record<string, HTMLImageElement>, g: Geo): void {
  const R = g === PROPOSED ? 200 : 96;
  const stone = sprites["g_hub"];
  if (stone && stone.complete && stone.naturalWidth > 0) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(0, 0, R, 0, Math.PI * 2);
    ctx.clip();
    tileFloor(ctx, stone, -R, -R, R + FLOOR_TILE, R + FLOOR_TILE);
    const vg = ctx.createRadialGradient(0, 0, R * 0.7, 0, 0, R);
    vg.addColorStop(0, "rgba(16,16,18,0)");
    vg.addColorStop(1, "rgba(16,16,18,0.5)");
    ctx.fillStyle = vg;
    ctx.fillRect(-R, -R, R * 2, R * 2);
    ctx.restore();
  }
  const rock = sprites["o_rock"];
  if (rock && rock.complete && rock.naturalWidth > 0) {
    const rh = R * 0.32;
    const rw = rh * (rock.naturalWidth / rock.naturalHeight);
    const ringN = 8;
    for (let i = 0; i < ringN; i++) {
      const a = (i / ringN) * Math.PI * 2;
      ctx.drawImage(rock, Math.cos(a) * (R - 8) - rw / 2, Math.sin(a) * (R - 8) - rh, rw, rh);
    }
  }
}

function drawHubMarker(ctx: CanvasRenderingContext2D): void {
  ctx.save();
  ctx.fillStyle = "#fbbf24";
  ctx.strokeStyle = "rgba(0,0,0,0.6)";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(0, 0, 18, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function objectAt(tx: number, ty: number, regions: Region[], g: Geo): { kind: string; x: number; y: number; w: number; h: number } | null {
  const cx = tx * TILE + TILE / 2;
  const cy = ty * TILE + TILE / 2;
  if (cx * cx + cy * cy < g.HUB_CLEAR * g.HUB_CLEAR) return null;
  const region = biomeAt(cx, cy, regions);
  const biome = region?.key ?? "field";
  if (region && Math.hypot(region.cx - cx, region.cy - cy) < LANDMARK_CLEAR) return null;
  // Coherent cluster field: dense "groves" with bare clearings between them so the
  // landscape reads as composed, not sprinkled. Outside a cluster = intentional negative space.
  const cf = 1 / (TILE * 4.8);
  const field = fbm(cx * cf + 11.3, cy * cf + 4.7);
  const THRESH = 0.55;
  if (field < THRESH) return null;
  const core = (field - THRESH) / (1 - THRESH); // 0 at cluster edge → 1 at its core
  const density = (DENSITY[biome] ?? DENSITY.field) * g.densityScale;
  if (hashTile(tx, ty, 1) > density * (0.2 + 3.4 * core * core)) return null;
  // Kind chosen mostly per cluster cell, so each grove shares a species with a few accents.
  const ck = TILE * 3;
  const cellX = Math.floor(cx / ck);
  const cellY = Math.floor(cy / ck);
  const palette = PALETTES[biome] ?? PALETTES.field;
  const total = palette.reduce((a, d) => a + d.weight, 0);
  const useCluster = hashTile(tx, ty, 5) < 0.8;
  let roll = (useCluster ? hashTile(cellX, cellY, 2) : hashTile(tx, ty, 2)) * total;
  let def = palette[palette.length - 1]!;
  for (const d of palette) {
    roll -= d.weight;
    if (roll <= 0) {
      def = d;
      break;
    }
  }
  const jx = (hashTile(tx, ty, 3) - 0.5) * TILE * 0.7;
  const jy = (hashTile(tx, ty, 4) - 0.5) * TILE * 0.7;
  return { kind: def.kind, x: cx + jx, y: cy + jy, w: def.w, h: def.h };
}

function collectObjects(
  ctx: CanvasRenderingContext2D,
  regions: Region[],
  g: Geo,
  v: { vx0: number; vy0: number; vx1: number; vy1: number },
  sprites: Record<string, HTMLImageElement>,
  out: Drawable[],
  time: number,
): void {
  const tx0 = Math.floor((v.vx0 - TILE) / TILE);
  const ty0 = Math.floor((v.vy0 - 16) / TILE);
  const tx1 = Math.ceil((v.vx1 + TILE) / TILE);
  const ty1 = Math.ceil((v.vy1 + 140) / TILE);
  // Cap the scan so a full zoom-out can't stall the frame.
  if ((tx1 - tx0) * (ty1 - ty0) > 240000) return;
  let budget = 9000;
  for (let ty = ty0; ty <= ty1 && budget > 0; ty++) {
    for (let tx = tx0; tx <= tx1 && budget > 0; tx++) {
      const obj = objectAt(tx, ty, regions, g);
      if (!obj) continue;
      const sp = sprites[obj.kind];
      if (!sp || !sp.complete || sp.naturalWidth === 0) continue;
      budget--;
      const dh = obj.h;
      const dw = dh * (sp.naturalWidth / sp.naturalHeight);
      const seed = hashTile(tx, ty, 7) * Math.PI * 2;
      out.push({ y: obj.y, fn: () => drawObject(ctx, sp, obj.kind, obj.x, obj.y, dw, dh, time, seed) });
    }
  }
}

// Emissive props: a soft, pulsing colored halo behind the sprite.
const GLOW: Record<string, { color: string; rad: number }> = {
  o_crystal: { color: "#63d6ff", rad: 1.05 },
  o_lava_rock: { color: "#ff7a36", rad: 0.95 },
  o_rune_stone: { color: "#b98cf5", rad: 1.0 },
};
// Foliage that gently sways (radians of rotation about the base).
const SWAY: Record<string, number> = {
  o_tree: 0.02,
  o_bush: 0.05,
  o_reed: 0.13,
  o_cactus: 0.01,
};

// Per-biome color grade: a soft multiply (mood/shadow) + screen (light haze) wash
// applied over the whole biome so tiles, sprites, and effects read as ONE place.
const GRADE: Record<string, { mul: string; mulA: number; add: string; addA: number }> = {
  field: { mul: "#23311d", mulA: 0.1, add: "#e8f0c0", addA: 0.04 },
  verdant_grove: { mul: "#1f3a1b", mulA: 0.18, add: "#d8efa0", addA: 0.06 },
  sunlit_ruins: { mul: "#5e431d", mulA: 0.16, add: "#ffe6ad", addA: 0.1 },
  tidecaller: { mul: "#143138", mulA: 0.22, add: "#a9eaff", addA: 0.08 },
  crystal_caverns: { mul: "#271a3e", mulA: 0.24, add: "#d6b6ff", addA: 0.08 },
  emberforge: { mul: "#2a130e", mulA: 0.28, add: "#ff9352", addA: 0.06 },
  astral_spire: { mul: "#120d2e", mulA: 0.32, add: "#b6a0ff", addA: 0.05 },
};

function drawAmbience(
  ctx: CanvasRenderingContext2D,
  regions: Region[],
  v: { vx0: number; vy0: number; vx1: number; vy1: number },
): void {
  for (const z of regions) {
    if (z.cx + z.radius < v.vx0 || z.cx - z.radius > v.vx1 || z.cy + z.radius < v.vy0 || z.cy - z.radius > v.vy1) continue;
    const grade = GRADE[z.key] ?? GRADE.field!;
    const x = z.cx - z.radius;
    const y = z.cy - z.radius;
    const s = z.radius * 2;
    ctx.save();
    ctx.beginPath();
    ctx.arc(z.cx, z.cy, z.radius, 0, Math.PI * 2);
    ctx.clip();
    ctx.globalCompositeOperation = "multiply";
    ctx.globalAlpha = grade.mulA;
    ctx.fillStyle = grade.mul;
    ctx.fillRect(x, y, s, s);
    ctx.globalCompositeOperation = "screen";
    ctx.globalAlpha = grade.addA;
    ctx.fillStyle = grade.add;
    ctx.fillRect(x, y, s, s);
    ctx.restore();
  }
}

/** Draw a scenery sprite with a ground shadow plus per-kind effects. */
function drawObject(
  ctx: CanvasRenderingContext2D,
  sp: HTMLImageElement,
  kind: string,
  x: number,
  baseY: number,
  w: number,
  h: number,
  time: number,
  seed: number,
): void {
  // Ground shadow.
  ctx.save();
  ctx.globalAlpha = 0.22;
  ctx.fillStyle = "#000";
  ctx.beginPath();
  ctx.ellipse(x, baseY - 2, w * 0.32, h * 0.06, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Emissive halo behind the sprite.
  const glow = GLOW[kind];
  if (glow) {
    const gy = baseY - h * 0.5;
    const gr = h * glow.rad;
    const pulse = 0.3 + 0.14 * Math.sin(time * 0.003 + seed);
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = pulse;
    const grad = ctx.createRadialGradient(x, gy, gr * 0.1, x, gy, gr);
    grad.addColorStop(0, glow.color);
    grad.addColorStop(1, glow.color + "00");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(x, gy, gr, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // Sprite (with a gentle sway for foliage, pivoting at its base).
  const sway = SWAY[kind];
  ctx.save();
  if (sway) {
    ctx.translate(x, baseY);
    ctx.rotate(Math.sin(time * 0.0014 + seed) * sway);
    ctx.translate(-x, -baseY);
  }
  ctx.drawImage(sp, x - w / 2, baseY - h, w, h);
  ctx.restore();

  // Foreground particles / sparkles for emissive props.
  if (kind === "o_lava_rock") {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (let i = 0; i < 4; i++) {
      const ph = (((time * 0.0006 + seed * 0.37 + i * 0.27) % 1) + 1) % 1;
      const ey = baseY - h * 0.35 - ph * h * 1.05;
      const ex = x + Math.sin(time * 0.002 + i * 1.7 + seed) * w * 0.18;
      ctx.globalAlpha = (1 - ph) * 0.9;
      ctx.fillStyle = i % 2 ? "#ffd27a" : "#ff7a36";
      ctx.beginPath();
      ctx.arc(ex, ey, 2 + (1 - ph) * 2.4, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  } else if (kind === "o_rune_stone") {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (let i = 0; i < 3; i++) {
      const ang = time * 0.0011 + seed + i * 2.094;
      const rr = h * 0.3;
      const ex = x + Math.cos(ang) * rr;
      const ey = baseY - h * 0.62 + Math.sin(ang) * rr * 0.45;
      ctx.globalAlpha = 0.45 + 0.5 * (0.5 + 0.5 * Math.sin(time * 0.004 + i * 2 + seed));
      ctx.fillStyle = "#dcc7ff";
      ctx.beginPath();
      ctx.arc(ex, ey, 2.2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  } else if (kind === "o_crystal") {
    const tw = 0.5 + 0.5 * Math.sin(time * 0.005 + seed);
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = 0.3 + 0.6 * tw;
    sparkle(ctx, x, baseY - h * 0.78, 4 + tw * 4, "#bff2ff");
    ctx.restore();
  }
}

function sparkle(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(x - r, y);
  ctx.lineTo(x + r, y);
  ctx.moveTo(x, y - r);
  ctx.lineTo(x, y + r);
  ctx.stroke();
}

function collectLandmarks(ctx: CanvasRenderingContext2D, regions: Region[], sprites: Record<string, HTMLImageElement>, out: Drawable[], time: number): void {
  for (const r of regions) {
    const pieces = LANDMARKS[r.key];
    if (!pieces) continue;
    pieces.forEach((p, idx) => {
      const sp = sprites[p.kind];
      if (!sp || !sp.complete || sp.naturalWidth === 0) return;
      const dh = p.h;
      const dw = dh * (sp.naturalWidth / sp.naturalHeight);
      const bx = r.cx + p.dx;
      const by = r.cy + p.dy;
      const seed = r.center + idx * 1.7;
      out.push({ y: by, fn: () => drawObject(ctx, sp, p.kind, bx, by, dw, dh, time, seed) });
    });
  }
}

function collectPortals(
  ctx: CanvasRenderingContext2D,
  regions: Region[],
  g: Geo,
  population: number,
  v: { vx0: number; vy0: number; vx1: number; vy1: number },
  sprites: Record<string, HTMLImageElement>,
  out: Drawable[],
  time: number,
): void {
  const portal = sprites["portal"];
  const cap = Math.min(population, 60);
  regions.forEach((r, i) => {
    const accent = r.accent;
    for (let k = 0; k < cap; k++) {
      const p = plotPosition(i, k, g);
      if (p.x < v.vx0 - 80 || p.x > v.vx1 + 80 || p.y < v.vy0 - 120 || p.y > v.vy1 + 80) continue;
      const phase = i * 1.7 + k * 0.9;
      out.push({
        y: p.y,
        fn: () => {
          const pulse = 0.4 + 0.2 * Math.sin(time * 0.004 + phase);
          const grad = ctx.createRadialGradient(p.x, p.y, 4, p.x, p.y, 44);
          grad.addColorStop(0, accent + "aa");
          grad.addColorStop(1, accent + "00");
          ctx.save();
          ctx.globalCompositeOperation = "lighter";
          ctx.globalAlpha = pulse;
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.ellipse(p.x, p.y, 42 + pulse * 6, 23 + pulse * 4, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
          const bob = Math.sin(time * 0.003 + phase) * 3;
          if (portal && portal.complete && portal.naturalWidth > 0) {
            const sz = 70;
            ctx.drawImage(portal, p.x - sz / 2, p.y - sz * 0.86 + bob, sz, sz);
          } else {
            ctx.fillStyle = accent;
            ctx.beginPath();
            ctx.arc(p.x, p.y - 20 + bob, 22, 0, Math.PI * 2);
            ctx.fill();
          }
        },
      });
    }
  });
}

// ----- Procedural ground cover + water (no extra sprite assets) ---------------

function drawDecor(
  ctx: CanvasRenderingContext2D,
  regions: Region[],
  g: Geo,
  v: { vx0: number; vy0: number; vx1: number; vy1: number },
  scale: number,
  time: number,
): void {
  for (const z of regions) {
    if (z.cx + z.radius < v.vx0 || z.cx - z.radius > v.vx1 || z.cy + z.radius < v.vy0 || z.cy - z.radius > v.vy1) continue;
    ctx.save();
    ctx.beginPath();
    ctx.arc(z.cx, z.cy, z.radius, 0, Math.PI * 2);
    ctx.clip();
    if (z.key === "tidecaller") drawWater(ctx, z, time);
    // Fine ground-cover decals only matter when zoomed in (skip at world scale).
    if (scale > 0.18) {
      const STEP = 70;
      const x0 = Math.max(v.vx0, z.cx - z.radius);
      const y0 = Math.max(v.vy0, z.cy - z.radius);
      const x1 = Math.min(v.vx1, z.cx + z.radius);
      const y1 = Math.min(v.vy1, z.cy + z.radius);
      const tx0 = Math.floor(x0 / STEP);
      const ty0 = Math.floor(y0 / STEP);
      const tx1 = Math.ceil(x1 / STEP);
      const ty1 = Math.ceil(y1 / STEP);
      let budget = 4000;
      for (let ty = ty0; ty <= ty1 && budget > 0; ty++) {
        for (let tx = tx0; tx <= tx1 && budget > 0; tx++) {
          const hx = tx * STEP + (hashTile(tx, ty, 11) - 0.5) * STEP * 0.8;
          const hy = ty * STEP + (hashTile(tx, ty, 12) - 0.5) * STEP * 0.8;
          if (Math.hypot(hx - z.cx, hy - z.cy) > z.radius * 0.97) continue;
          if (hx * hx + hy * hy < g.HUB_CLEAR * g.HUB_CLEAR) continue;
          // Cluster ground cover into coherent patches (meadows/veins) with bare ground between.
          const df = 1 / (STEP * 5);
          const dfield = fbm(hx * df - 6.1, hy * df + 9.4);
          if (dfield < 0.5) continue;
          const dcore = (dfield - 0.5) / 0.5;
          if (hashTile(tx, ty, 13) > 0.2 + 0.65 * dcore) continue;
          budget--;
          drawDecal(ctx, z.key, hx, hy, time, hashTile(tx, ty, 14));
        }
      }
    }
    ctx.restore();
  }
}

function drawDecal(ctx: CanvasRenderingContext2D, key: string, x: number, y: number, time: number, h: number): void {
  switch (key) {
    case "verdant_grove":
    case "field":
      if (h < 0.68) grassTuft(ctx, x, y, "#3f7a3a", time, h);
      else flower(ctx, x, y, h);
      break;
    case "sunlit_ruins":
      if (h < 0.55) grassTuft(ctx, x, y, "#9c8b4e", time, h);
      else pebble(ctx, x, y, "#b9a06a");
      break;
    case "tidecaller":
      if (h < 0.6) grassTuft(ctx, x, y, "#4f9e7e", time, h);
      else pebble(ctx, x, y, "#6f8aa0");
      break;
    case "crystal_caverns":
      shard(ctx, x, y, time, h);
      break;
    case "emberforge":
      emberCrack(ctx, x, y, time, h);
      break;
    case "astral_spire":
      starMote(ctx, x, y, time, h);
      break;
    default:
      grassTuft(ctx, x, y, "#3f7a3a", time, h);
  }
}

function grassTuft(ctx: CanvasRenderingContext2D, x: number, y: number, color: string, time: number, seed: number): void {
  const sway = Math.sin(time * 0.002 + seed * 7) * 2.2;
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let i = -1; i <= 1; i++) {
    ctx.moveTo(x + i * 4, y);
    ctx.lineTo(x + i * 4 + sway * (1 + i * 0.2), y - 12);
  }
  ctx.stroke();
}

function flower(ctx: CanvasRenderingContext2D, x: number, y: number, seed: number): void {
  const px = Math.round(x);
  const py = Math.round(y);
  ctx.fillStyle = "#3c6e37";
  ctx.fillRect(px - 1, py - 10, 2, 10);
  // Muted, palette-friendly blooms (no neon confetti) drawn as blocky pixels.
  const colors = ["#d99fb4", "#e7cf86", "#bfb0dd"];
  ctx.fillStyle = colors[Math.floor(seed * 997) % colors.length]!;
  const bx = px - 3;
  const by = py - 15;
  ctx.fillRect(bx, by, 6, 6);
  ctx.fillStyle = "#f3e4ad";
  ctx.fillRect(bx + 2, by + 2, 2, 2);
}

function pebble(ctx: CanvasRenderingContext2D, x: number, y: number, color: string): void {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.ellipse(x, y, 5, 3.4, 0, 0, Math.PI * 2);
  ctx.fill();
}

function shard(ctx: CanvasRenderingContext2D, x: number, y: number, time: number, seed: number): void {
  const tw = 0.5 + 0.5 * Math.sin(time * 0.004 + seed * 9);
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.globalAlpha = 0.22 + 0.4 * tw;
  const grad = ctx.createRadialGradient(x, y, 0, x, y, 9);
  grad.addColorStop(0, "#7fe6ff");
  grad.addColorStop(1, "#7fe6ff00");
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(x, y, 9, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  ctx.fillStyle = "#bff2ff";
  ctx.beginPath();
  ctx.moveTo(x, y - 7);
  ctx.lineTo(x + 3, y + 2);
  ctx.lineTo(x - 3, y + 2);
  ctx.closePath();
  ctx.fill();
}

function emberCrack(ctx: CanvasRenderingContext2D, x: number, y: number, time: number, seed: number): void {
  const fl = 0.5 + 0.5 * Math.sin(time * 0.006 + seed * 11);
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.globalAlpha = 0.22 + 0.4 * fl;
  const grad = ctx.createRadialGradient(x, y, 0, x, y, 9);
  grad.addColorStop(0, "#ff8a3c");
  grad.addColorStop(1, "#ff8a3c00");
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(x, y, 9, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#ff6a2c";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x - 6, y + 2);
  ctx.lineTo(x - 1, y - 2);
  ctx.lineTo(x + 2, y + 1);
  ctx.lineTo(x + 7, y - 1);
  ctx.stroke();
  ctx.restore();
}

function starMote(ctx: CanvasRenderingContext2D, x: number, y: number, time: number, seed: number): void {
  const tw = 0.5 + 0.5 * Math.sin(time * 0.005 + seed * 13);
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.globalAlpha = 0.18 + 0.5 * tw;
  const grad = ctx.createRadialGradient(x, y, 0, x, y, 7);
  grad.addColorStop(0, "#e7d6ff");
  grad.addColorStop(1, "#b98cf500");
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(x, y, 7, 0, Math.PI * 2);
  ctx.fill();
  const r = 2 + tw * 2.4;
  sparkle(ctx, x, y, r, "#f2ecff");
  ctx.restore();
}

function drawWater(ctx: CanvasRenderingContext2D, z: Region, time: number): void {
  const ponds = [
    { dx: -0.28, dy: 0.22, rx: 0.42, ry: 0.3 },
    { dx: 0.3, dy: -0.18, rx: 0.32, ry: 0.24 },
  ];
  for (let pi = 0; pi < ponds.length; pi++) {
    const p = ponds[pi]!;
    const cx = z.cx + p.dx * z.radius;
    const cy = z.cy + p.dy * z.radius;
    const rx = p.rx * z.radius;
    const ry = p.ry * z.radius;
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    ctx.clip();
    // Blocky water cells: depth-shaded body + animated caustic sparkle — pixel-art,
    // not a smooth vector blob, so it sits with the tile art.
    const CELL = 14;
    const DEEP = "#123f5b";
    const MID = "#1c6e8d";
    const LITE = "#3aa7b8";
    const gx0 = Math.floor((cx - rx) / CELL) * CELL;
    const gy0 = Math.floor((cy - ry) / CELL) * CELL;
    for (let yy = gy0; yy < cy + ry; yy += CELL) {
      for (let xx = gx0; xx < cx + rx; xx += CELL) {
        const nx = (xx + CELL / 2 - cx) / rx;
        const ny = (yy + CELL / 2 - cy) / ry;
        const d = nx * nx + ny * ny;
        let col = d > 0.72 ? DEEP : MID;
        const wv = Math.sin(xx * 0.05 + yy * 0.04 + time * 0.0022) + Math.sin(xx * 0.03 - yy * 0.06 + time * 0.0016);
        if (d < 0.7 && wv > 1.25) col = LITE;
        ctx.fillStyle = col;
        ctx.fillRect(xx, yy, CELL, CELL);
      }
    }
    // Expanding ripple rings (kept subtle, riding on the cells).
    ctx.globalCompositeOperation = "lighter";
    for (let i = 0; i < 2; i++) {
      const ph = (((time * 0.0004 + pi * 0.5 + i * 0.5) % 1) + 1) % 1;
      const rr = ph * rx * 0.8;
      ctx.globalAlpha = (1 - ph) * 0.3;
      ctx.strokeStyle = "rgba(190,238,252,0.8)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(cx + rx * 0.1, cy - ry * 0.1, rr, rr * (ry / rx), 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.restore();
    // Blocky foam dabs around the shoreline (breaks the smooth ellipse edge).
    ctx.fillStyle = "#cdeffb";
    const steps = 56;
    for (let i = 0; i < steps; i++) {
      const a = (i / steps) * Math.PI * 2;
      if (Math.sin(a * 3 + time * 0.002 + pi * 1.3) < 0.25) continue;
      const fx = Math.round((cx + Math.cos(a) * rx) / 4) * 4;
      const fy = Math.round((cy + Math.sin(a) * ry) / 4) * 4;
      ctx.fillRect(fx - 2, fy - 2, 5, 5);
    }
  }
}

function drawLabels(ctx: CanvasRenderingContext2D, regions: Region[], cam: { x: number; y: number }, scale: number, cssW: number, cssH: number): void {
  const toScreen = (wx: number, wy: number): [number, number] => [(wx - cam.x) * scale + cssW / 2, (wy - cam.y) * scale + cssH / 2];
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (const z of regions) {
    const [sx, sy] = toScreen(z.cx, z.cy);
    const ry = sy - z.radius * scale + 26;
    if (sx < -160 || sx > cssW + 160 || ry < -40 || ry > cssH + 40) continue;
    // Plate.
    ctx.font = "800 15px ui-sans-serif, system-ui, sans-serif";
    const w = Math.max(120, ctx.measureText(z.name.toUpperCase()).width + 28);
    ctx.fillStyle = "rgba(8,11,16,0.7)";
    roundRect(ctx, sx - w / 2, ry - 16, w, 44, 9);
    ctx.fill();
    ctx.fillStyle = z.accent;
    ctx.fillRect(sx - w / 2, ry - 16, 4, 44);
    ctx.fillStyle = "#fff";
    ctx.fillText(z.name.toUpperCase(), sx + 2, ry);
    ctx.font = "600 11px ui-sans-serif, system-ui, sans-serif";
    ctx.fillStyle = z.accent;
    ctx.fillText(`${z.landmark} · ${z.count} labyrinth${z.count === 1 ? "" : "s"}`, sx + 2, ry + 16);
  }
  // Spawn label.
  const [hx, hy] = toScreen(0, 0);
  if (hx > -60 && hx < cssW + 60 && hy > -40 && hy < cssH + 40) {
    ctx.font = "800 13px ui-sans-serif, system-ui, sans-serif";
    ctx.fillStyle = "rgba(8,11,16,0.7)";
    const w = 74;
    roundRect(ctx, hx - w / 2, hy - 44, w, 22, 7);
    ctx.fill();
    ctx.fillStyle = "#fde68a";
    ctx.fillText("SPAWN", hx, hy - 33);
  }
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}
