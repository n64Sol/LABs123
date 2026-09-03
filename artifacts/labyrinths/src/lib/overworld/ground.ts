// Procedural ground/surface painters shared by the overworld (OverworldMap) and
// the interiors (InteriorScene). Everything here is drawn brick-by-brick / plank-by
// -plank in canvas with a deterministic per-cell hash, so surfaces never visibly
// repeat and contain no baked-in subjects. We do NOT tile AI-generated "floor/wall"
// PNGs: those are one-off illustrations (baked characters, lighting, white bg) that
// stamp the same sprite + seams across the whole surface.

// Cosmetic deterministic hash (visual only). Stable for a given integer pair.
export function sandHash(x: number, y: number): number {
  let h = (Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 2246822519) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 0xffffffff;
}

export interface CobblePalette {
  mortar: string;
  tones: string[];
  moss: string;
  hi: string;
  lo: string;
}

export const PLAZA_PAL: CobblePalette = {
  mortar: "#322c22",
  tones: ["#cdc3a6", "#c3b997", "#d6ccac", "#b8ae8c", "#c8bd9c"],
  moss: "#7e6d49", // Dirt/dust instead of moss
  hi: "rgba(255,250,232,0.22)",
  lo: "rgba(42,34,22,0.34)",
};

export const PATH_PAL: CobblePalette = {
  mortar: "#241c12",
  tones: ["#9c8a63", "#8c7a54", "#a99873", "#7e6d49", "#92805a"],
  moss: "#5a4d33", // Darker dirt instead of moss
  hi: "rgba(255,244,214,0.16)",
  lo: "rgba(28,20,12,0.42)",
};

// Warm, lamp-lit flagstone for building interiors.
export const INTERIOR_STONE_PAL: CobblePalette = {
  mortar: "#2c241b",
  tones: ["#c6b896", "#bcae8b", "#d0c3a0", "#b1a382", "#c2b491"],
  moss: "#7c7048",
  hi: "rgba(255,247,222,0.20)",
  lo: "rgba(34,26,16,0.40)",
};

// Procedural cobblestone, painted brick-by-brick. Each stone's tone/jitter/wear is
// a deterministic hash of its brick coordinate, so the pattern never visibly repeats
// and there are no seams. Caller must clip to the target shape; only the visible
// bounds (x0..x1, y0..y1) are painted.
export function paintCobbleField(
  ctx: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  pal: CobblePalette,
  seed: number,
): void {
  if (x1 <= x0 || y1 <= y0) return;
  ctx.fillStyle = pal.mortar;
  ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
  const RH = 24;
  const BW = 40;
  const GAP = 3;
  const r0 = Math.floor(y0 / RH) - 1;
  const r1 = Math.ceil(y1 / RH) + 1;
  for (let r = r0; r <= r1; r++) {
    const stagger = r & 1 ? BW / 2 : 0;
    const c0 = Math.floor((x0 - stagger) / BW) - 1;
    const c1 = Math.ceil((x1 - stagger) / BW) + 1;
    for (let c = c0; c <= c1; c++) {
      const h = sandHash(c * 7 + seed, r * 13 + seed);
      const h2 = sandHash(c * 31 + seed * 3, r * 17 + seed);
      const bx = c * BW + stagger + (h - 0.5) * 6;
      const by = r * RH + (h2 - 0.5) * 3;
      const bw = BW - GAP + (h2 - 0.5) * 8;
      const bh = RH - GAP;
      ctx.fillStyle = pal.tones[(h * pal.tones.length) | 0] ?? pal.tones[0]!;
      ctx.fillRect(bx, by, bw, bh);
      ctx.fillStyle = pal.hi;
      ctx.fillRect(bx, by, bw, 2);
      ctx.fillRect(bx, by, 2, bh);
      ctx.fillStyle = pal.lo;
      ctx.fillRect(bx, by + bh - 2, bw, 2);
      ctx.fillRect(bx + bw - 2, by, 2, bh);
      if (h2 > 0.9) {
        ctx.fillStyle = pal.moss;
        ctx.fillRect(bx + 2, by + bh - 4, Math.max(4, bw * 0.4), 4);
      } else if (h < 0.05) {
        ctx.fillStyle = pal.mortar;
        ctx.fillRect(bx + bw * 0.28, by + bh * 0.28, bw * 0.44, bh * 0.44);
      }
    }
  }
}

const PLANK_TONES = ["#8a5a30", "#7d5029", "#925f33", "#86542b", "#774b25", "#9a6738"];
const PLANK_GAP = "#3f2814";
const PLANK_KNOT = "#37230f";

// Procedural wood-plank floor: vertical boards with staggered end-joints, per-board
// tone, grain streaks and the odd knot — deterministic per board cell, never repeats.
export function paintWoodFloor(
  ctx: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  seed: number,
): void {
  if (x1 <= x0 || y1 <= y0) return;
  ctx.fillStyle = PLANK_GAP;
  ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
  const PW = 46;
  const JOINT = 168;
  const c0 = Math.floor(x0 / PW) - 1;
  const c1 = Math.ceil(x1 / PW) + 1;
  for (let c = c0; c <= c1; c++) {
    const bx = c * PW + 1;
    const bw = PW - 2;
    const hc = sandHash(c * 7 + seed, 101);
    // staggered joints down the board
    const off = (sandHash(c * 19 + seed, 53) * JOINT) | 0;
    let jy = Math.floor((y0 - off) / JOINT) * JOINT + off;
    let bi = 0;
    while (jy < y1) {
      const top = Math.max(jy, y0);
      const bot = Math.min(jy + JOINT, y1);
      if (bot > top) {
        const hb = sandHash(c * 13 + seed, (jy / JOINT) | 0);
        ctx.fillStyle = PLANK_TONES[((hc + hb) * 0.5 * PLANK_TONES.length) | 0] ?? PLANK_TONES[0]!;
        ctx.fillRect(bx, top, bw, bot - top);
        // edge highlight / shadow for a beveled board
        ctx.fillStyle = "rgba(255,224,176,0.10)";
        ctx.fillRect(bx, top, 1, bot - top);
        ctx.fillStyle = "rgba(36,20,8,0.45)";
        ctx.fillRect(bx + bw - 1, top, 1, bot - top);
        // joint shadow line at the top of each board
        if (jy >= y0) {
          ctx.fillStyle = "rgba(26,14,6,0.55)";
          ctx.fillRect(bx - 1, jy, PW, 2);
        }
        // grain streaks
        ctx.fillStyle = "rgba(40,22,10,0.22)";
        for (let g = 0; g < 3; g++) {
          const gh = sandHash(c * 53 + g * 7 + seed, ((jy / JOINT) | 0) * 5 + g);
          const gx = bx + 3 + gh * (bw - 6);
          ctx.fillRect(gx, top + 2, 1, bot - top - 4);
        }
        // occasional knot
        if (hb > 0.82) {
          const kx = bx + 4 + sandHash(c, (jy / JOINT) | 0) * (bw - 12);
          const ky = top + 10 + hb * (bot - top - 24);
          ctx.fillStyle = PLANK_KNOT;
          ctx.beginPath();
          ctx.ellipse(kx + 3, ky, 3.5, 5, 0, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      jy += JOINT;
      bi++;
      if (bi > 200) break;
    }
  }
}

export interface WallPalette {
  plaster: string;
  plasterLo: string;
  beam: string;
  beamHi: string;
  beamLo: string;
  skirt: string;
}

export const INTERIOR_WALL_PAL: WallPalette = {
  plaster: "#d8c8a0",
  plasterLo: "#c2b288",
  beam: "#8a5a30",
  beamHi: "#a9743f",
  beamLo: "#5a3a20",
  skirt: "#6f4724",
};

// Procedural back wall: plaster upper with a timber-framed lower wainscot, top beam,
// chair rail and evenly spaced vertical studs (subtly varied), tinted by `accent`.
// No window illustration, so nothing repeats.
export function paintInteriorWall(
  ctx: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  pal: WallPalette,
  accent: string,
): void {
  const w = x1 - x0;
  const h = y1 - y0;
  if (w <= 0 || h <= 0) return;
  const wainscotH = Math.round(h * 0.4);
  const railY = y1 - wainscotH;
  // plaster upper
  ctx.fillStyle = pal.plaster;
  ctx.fillRect(x0, y0, w, h - wainscotH);
  // plaster speckle / mottling
  const CELL = 22;
  for (let yy = Math.floor(y0 / CELL) * CELL; yy < railY; yy += CELL) {
    for (let xx = Math.floor(x0 / CELL) * CELL; xx < x1; xx += CELL) {
      const hsh = sandHash(xx, yy + 7);
      if (hsh > 0.8) {
        ctx.fillStyle = pal.plasterLo;
        ctx.fillRect(xx + 2, yy + 2, CELL - 6, CELL - 8);
      }
    }
  }
  // gradient shade so the upper wall recedes
  const vg = ctx.createLinearGradient(0, y0, 0, railY);
  vg.addColorStop(0, "rgba(20,14,8,0.30)");
  vg.addColorStop(1, "rgba(20,14,8,0)");
  ctx.fillStyle = vg;
  ctx.fillRect(x0, y0, w, h - wainscotH);
  // wood wainscot
  ctx.fillStyle = pal.beam;
  ctx.fillRect(x0, railY, w, wainscotH);
  // vertical studs
  const BAT = 84;
  for (let bx = Math.floor(x0 / BAT) * BAT; bx < x1; bx += BAT) {
    const j = sandHash((bx / BAT) | 0, 3) * 6;
    const sx = bx + j;
    ctx.fillStyle = pal.beamLo;
    ctx.fillRect(sx, railY, 10, wainscotH);
    ctx.fillStyle = pal.beamHi;
    ctx.fillRect(sx, railY, 3, wainscotH);
  }
  // top beam
  ctx.fillStyle = pal.beam;
  ctx.fillRect(x0, y0, w, 14);
  ctx.fillStyle = pal.beamHi;
  ctx.fillRect(x0, y0, w, 4);
  ctx.fillStyle = pal.beamLo;
  ctx.fillRect(x0, y0 + 11, w, 3);
  // accent banner stripe just under the top beam
  ctx.fillStyle = accent;
  ctx.globalAlpha = 0.5;
  ctx.fillRect(x0, y0 + 16, w, 4);
  ctx.globalAlpha = 1;
  // chair rail
  ctx.fillStyle = pal.beamHi;
  ctx.fillRect(x0, railY - 5, w, 5);
  ctx.fillStyle = pal.beamLo;
  ctx.fillRect(x0, railY, w, 2);
  // skirting at the floor line
  ctx.fillStyle = pal.skirt;
  ctx.fillRect(x0, y1 - 6, w, 6);
}
