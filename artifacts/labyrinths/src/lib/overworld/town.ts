// ---------------------------------------------------------------------------
// Town — the classic-RPG settlement that sits in the clear plaza at the world
// origin (0,0). Buildings ring a central fountain; each has a solid footprint
// and a door the player can enter to walk into a drawn interior scene. Paths
// radiate out along the six biome wedge angles toward the surrounding lands.
//
// Pure data + geometry: no React, no canvas. The overworld renderer draws from
// TOWN_BUILDINGS / TOWN_PROPS; movement uses resolveTownMove; the door prompt
// uses nearestDoor. Interior scenes are described by INTERIORS.
// ---------------------------------------------------------------------------

const DEG = Math.PI / 180;

/** Half-width of the square cobblestone courtyard. */
export const PLAZA_HALF = 760;

/** Half-width of the enclosing square fort wall. */
export const WALL_HALF = 840;

/** Width of the gate openings cut into the wall (world px). */
export const GATE_WIDTH_HALF = 160;

/** Where the player materialises: on the south road, just inside the front gate. */
export const TOWN_SPAWN = { x: 0, y: 720 };

/** Player collision radius used for town footprints (matches overworld). */
const PLAYER_R = 16;

/** Biome wedge angles (must match BIOME_ORDER in api-server/src/lib/world.ts). */
export const BIOME_ANGLES: number[] = Array.from(
  { length: 6 },
  (_, i) => -Math.PI / 2 + i * ((Math.PI * 2) / 6),
);

export interface TownBuilding {
  id: string;
  label: string;
  sprite: string;
  /** Foot anchor (bottom-centre) in world coords. */
  fx: number;
  fy: number;
  /** Draw size in world px (sprite bottom sits at fy, centred on fx). */
  drawW: number;
  drawH: number;
  /** Solid footprint size (centred on fx, bottom edge at fy). */
  cw: number;
  ch: number;
  /** Interaction point in front of the door. */
  door: { x: number; y: number };
}

export interface TownProp {
  id: string;
  sprite: string;
  fx: number;
  fy: number;
  drawW: number;
  drawH: number;
  /** Optional solid footprint (centred on fx, bottom at fy). */
  solid?: { cw: number; ch: number };
}

// Buildings ring the fortified square courtyard evenly — one in each gap BETWEEN the six
// biome roads — so the roads stay clear and the settlement never reads as clustered.
// All face IN toward the central fountain. The isometric sprites bake a fixed 3/4
// angle lit from the top-left, so the LEFT half uses dedicated down-right-facing
// variants (…_r) while the RIGHT half reuses the base down-left sprites — one
// consistent light direction across the plaza instead of mirror-flipping.
const PLACEMENT: { id: string; label: string; sprite: string; fx: number; fy: number }[] = [
  // Right half — entrances face down-left toward the centre (base sprites).
  { id: "shop", label: "Trade Post", sprite: "t_shop", fx: 500, fy: -500 }, // N-NE gap
  { id: "forge", label: "The Forge", sprite: "t_forge", fx: 660, fy: 0 },   // NE-SE gap
  { id: "bank", label: "Exchange", sprite: "t_bank", fx: 500, fy: 500 },    // SE-S gap
  // Left half — entrances face down-right toward the centre (SE-door variants).
  { id: "inn", label: "Wayfarer's Inn", sprite: "t_inn_r", fx: -500, fy: 500 }, // S-SW gap
  { id: "library", label: "Grand Archive", sprite: "t_library_r", fx: -660, fy: 0 }, // SW-NW gap
  { id: "armory", label: "Armory", sprite: "t_armory_r", fx: -500, fy: -500 }, // NW-N gap
];

// Native (transparent-trimmed) pixel size of each isometric building sprite in
// public/game/overworld16. drawW/drawH are these scaled uniformly, so buildings
// keep their true relative proportions rather than all sharing one square box.
const SPRITE_PX: Record<string, { w: number; h: number }> = {
  t_library: { w: 743, h: 806 },
  t_bank: { w: 723, h: 679 },
  t_forge: { w: 828, h: 753 },
  t_armory: { w: 735, h: 809 },
  t_shop: { w: 748, h: 796 },
  t_inn: { w: 640, h: 829 },
  t_library_r: { w: 777, h: 980 },
  t_armory_r: { w: 745, h: 920 },
  t_inn_r: { w: 643, h: 933 },
};
const BUILDING_SCALE = 0.42;

export const TOWN_BUILDINGS: TownBuilding[] = PLACEMENT.map((b) => {
  const px = SPRITE_PX[b.sprite] ?? { w: 720, h: 760 };
  return {
    id: b.id,
    label: b.label,
    sprite: b.sprite,
    fx: b.fx,
    fy: b.fy,
    drawW: Math.round(px.w * BUILDING_SCALE),
    drawH: Math.round(px.h * BUILDING_SCALE),
    cw: 188,
    ch: 120,
    door: { x: b.fx, y: b.fy + 12 },
  };
});

// A lamp post lighting the inner mouth of each gate.
const LAMPS: TownProp[] = BIOME_ANGLES.map((a, i) => {
  let gx, gy;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  if (Math.abs(cos) > Math.abs(sin)) {
    gx = Math.sign(cos) * (WALL_HALF - 96);
    gy = gx * (sin / cos);
  } else {
    gy = Math.sign(sin) * (WALL_HALF - 96);
    gx = gy * (cos / sin);
  }
  return {
    id: `lamp${i}`,
    sprite: "t_lamp",
    fx: Math.round(gx),
    fy: Math.round(gy),
    drawW: 58,
    drawH: 112,
  };
});

export const TOWN_PROPS: TownProp[] = [
  {
    id: "fountain",
    sprite: "t_fountain",
    fx: 0,
    fy: 70,
    drawW: 250,
    drawH: 240,
    solid: { cw: 188, ch: 104 },
  },
  ...LAMPS,
];

// ---- Collision ------------------------------------------------------------

interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

function buildColliders(): Rect[] {
  const rects: Rect[] = [];
  for (const b of TOWN_BUILDINGS) {
    rects.push({ x0: b.fx - b.cw / 2, y0: b.fy - b.ch, x1: b.fx + b.cw / 2, y1: b.fy });
  }
  for (const p of TOWN_PROPS) {
    if (!p.solid) continue;
    rects.push({ x0: p.fx - p.solid.cw / 2, y0: p.fy - p.solid.ch, x1: p.fx + p.solid.cw / 2, y1: p.fy });
  }
  return rects;
}

const COLLIDERS = buildColliders();

function hits(x: number, y: number, r: number): boolean {
  for (const c of COLLIDERS) {
    if (x > c.x0 - r && x < c.x1 + r && y > c.y0 - r && y < c.y1 + r) return true;
  }
  return false;
}

/** Half-thickness of the solid perimeter wall band. */
const WALL_BAND = 34;

function angDist(a: number, b: number): number {
  let d = Math.abs(a - b) % (Math.PI * 2);
  if (d > Math.PI) d = Math.PI * 2 - d;
  return d;
}

/** True if (x,y) is inside the solid part of the perimeter wall (i.e. not a gate gap). */
function wallBlocks(x: number, y: number): boolean {
  const absX = Math.abs(x);
  const absY = Math.abs(y);

  if (absX < WALL_HALF - WALL_BAND - PLAYER_R && absY < WALL_HALF - WALL_BAND - PLAYER_R) return false;
  if (absX > WALL_HALF + WALL_BAND + PLAYER_R || absY > WALL_HALF + WALL_BAND + PLAYER_R) return false;

  for (const a of BIOME_ANGLES) {
    let gx, gy;
    const cos = Math.cos(a);
    const sin = Math.sin(a);
    if (Math.abs(cos) > Math.abs(sin)) {
      gx = Math.sign(cos) * WALL_HALF;
      gy = gx * (sin / cos);
    } else {
      gy = Math.sign(sin) * WALL_HALF;
      gx = gy * (cos / sin);
    }
    const dist = Math.hypot(x - gx, y - gy);
    if (dist < GATE_WIDTH_HALF) return false;
  }

  return true;
}

/**
 * Axis-separated collision against town footprints and the perimeter wall. `px,py`
 * is the position before the move, `nx,ny` the desired position (already scenery/
 * clamp-resolved by tileMap.resolveMove). Reverts whichever axis would tunnel into
 * a building or the wall; gate gaps stay open so roads lead out to the biomes.
 */
export function resolveTownMove(px: number, py: number, nx: number, ny: number): { x: number; y: number } {
  let x = nx;
  let y = ny;
  if (hits(x, py, PLAYER_R) || wallBlocks(x, py)) x = px;
  if (hits(x, y, PLAYER_R) || wallBlocks(x, y)) y = py;
  return { x, y };
}

/** Nearest building whose door is within `radius` of the player, else null. */
export function nearestDoor(px: number, py: number, radius: number): TownBuilding | null {
  let best: TownBuilding | null = null;
  let bd = radius;
  for (const b of TOWN_BUILDINGS) {
    const d = Math.hypot(b.door.x - px, b.door.y - py);
    if (d < bd) {
      bd = d;
      best = b;
    }
  }
  return best;
}

// ---- Interiors ------------------------------------------------------------

export interface InteriorProp {
  sprite: string;
  /** Foot anchor (bottom-centre) in room coords. */
  x: number;
  y: number;
  w: number;
  h: number;
  solid?: boolean;
}

export interface InteriorNpc {
  sprite: string;
  name: string;
  x: number;
  y: number;
  greeting: string;
  action: { label: string; route?: string; rest?: boolean };
}

export interface InteriorDef {
  id: string;
  title: string;
  floor: string;
  wall: string;
  accent: string;
  /** Room interior size in scene units. */
  w: number;
  h: number;
  props: InteriorProp[];
  npc: InteriorNpc;
}

const ROOM_W = 960;
const ROOM_H = 600;

function npc(
  sprite: string,
  name: string,
  greeting: string,
  action: InteriorNpc["action"],
): InteriorNpc {
  return { sprite, name, x: ROOM_W / 2, y: 210, greeting, action };
}

export const INTERIORS: Record<string, InteriorDef> = {
  shop: {
    id: "shop",
    title: "Trade Post",
    floor: "i_floor_wood",
    wall: "i_wall",
    accent: "#e0a23c",
    w: ROOM_W,
    h: ROOM_H,
    props: [
      { sprite: "i_shelf", x: 180, y: 250, w: 150, h: 210, solid: true },
      { sprite: "i_shelf", x: 780, y: 250, w: 150, h: 210, solid: true },
      { sprite: "i_counter", x: 480, y: 300, w: 240, h: 130, solid: true },
    ],
    npc: npc("n_merchant", "Marda the Merchant", "Welcome, traveller! Browse my wares?", {
      label: "Browse the Market",
      route: "/marketplace",
    }),
  },
  forge: {
    id: "forge",
    title: "The Forge",
    floor: "i_floor_stone",
    wall: "i_wall",
    accent: "#f0792f",
    w: ROOM_W,
    h: ROOM_H,
    props: [
      { sprite: "i_hearth", x: 760, y: 240, w: 200, h: 200, solid: true },
      { sprite: "i_anvil", x: 250, y: 330, w: 170, h: 150, solid: true },
      { sprite: "i_counter", x: 480, y: 300, w: 240, h: 130, solid: true },
    ],
    npc: npc("n_smith", "Brann the Smith", "Bring me steel and I'll make it sing.", {
      label: "Open the Forge",
      route: "/forge",
    }),
  },
  armory: {
    id: "armory",
    title: "Armory",
    floor: "i_floor_stone",
    wall: "i_wall",
    accent: "#9bb0c9",
    w: ROOM_W,
    h: ROOM_H,
    props: [
      { sprite: "i_shelf", x: 190, y: 250, w: 150, h: 210, solid: true },
      { sprite: "i_shelf", x: 770, y: 250, w: 150, h: 210, solid: true },
      { sprite: "i_counter", x: 480, y: 300, w: 240, h: 130, solid: true },
    ],
    npc: npc("n_armorer", "Quartermaster Vael", "Suit up before you march, soldier.", {
      label: "Manage Loadout",
      route: "/loadout",
    }),
  },
  library: {
    id: "library",
    title: "Grand Archive",
    floor: "i_floor_wood",
    wall: "i_wall",
    accent: "#5fbf9b",
    w: ROOM_W,
    h: ROOM_H,
    props: [
      { sprite: "i_bookshelf", x: 160, y: 250, w: 150, h: 220, solid: true },
      { sprite: "i_bookshelf", x: 330, y: 250, w: 150, h: 220, solid: true },
      { sprite: "i_bookshelf", x: 640, y: 250, w: 150, h: 220, solid: true },
      { sprite: "i_bookshelf", x: 810, y: 250, w: 150, h: 220, solid: true },
    ],
    npc: npc("n_scholar", "Archivist Ollin", "Knowledge is the sharpest blade. Read on.", {
      label: "Open the Codex",
      route: "/codex",
    }),
  },
  bank: {
    id: "bank",
    title: "Exchange",
    floor: "i_floor_stone",
    wall: "i_wall",
    accent: "#e7c64a",
    w: ROOM_W,
    h: ROOM_H,
    props: [
      { sprite: "i_vault", x: 740, y: 260, w: 200, h: 200, solid: true },
      { sprite: "i_counter", x: 420, y: 300, w: 240, h: 130, solid: true },
    ],
    npc: npc("n_banker", "Banker Crest", "Your coin is safe with the Exchange.", {
      label: "Manage Treasury",
      route: "/economy",
    }),
  },
  inn: {
    id: "inn",
    title: "Wayfarer's Inn",
    floor: "i_floor_wood",
    wall: "i_wall",
    accent: "#d98a5a",
    w: ROOM_W,
    h: ROOM_H,
    props: [
      { sprite: "i_hearth", x: 160, y: 240, w: 200, h: 200, solid: true },
      { sprite: "i_bed", x: 790, y: 220, w: 170, h: 140, solid: true },
      { sprite: "i_bed", x: 790, y: 400, w: 170, h: 140, solid: true },
      { sprite: "i_counter", x: 430, y: 300, w: 240, h: 130, solid: true },
    ],
    npc: npc("n_innkeeper", "Innkeeper Pell", "Rest your boots, friend — the fire's warm.", {
      label: "Rest a while",
      rest: true,
    }),
  },
};

/** Door return position in the overworld for a given building id. */
export function doorReturn(id: string): { x: number; y: number } {
  const b = TOWN_BUILDINGS.find((x) => x.id === id);
  return b ? { x: b.door.x, y: b.door.y + 24 } : { ...TOWN_SPAWN };
}
