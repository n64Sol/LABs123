import type {
  ChamberSpawnData,
  ChamberObstacleData,
  ChamberTileGrid,
} from "@workspace/db";

// ---------------------------------------------------------------------------
// Handcrafted room library.
//
// Rooms are authored as compact ASCII maps and parsed into a tile grid plus
// spawns / collision rects. This keeps authoring readable while the runtime
// consumes structured data. The same parsed shape feeds both the seeded
// chamber templates (DB) and, through the assembler, the per-run layout the
// web renderer draws.
//
// Tile alphabet (terrain):
//   .  floor          #  wall (solid)        o  pit (solid)
//   ^  hazard floor   ~  water (decor)       +  door (solid until cleared)
//   ,  decor (floor)
// Spawn glyphs (rendered as floor, emit a spawn):
//   S  player start   E  melee enemy   A  ranged enemy   L  elite
//   B  boss           N  resource node C  chest          P  portal
// ---------------------------------------------------------------------------

export const ROOM_CELL = 56;

export type RoomRole =
  | "entry"
  | "combat"
  | "gauntlet"
  | "hazard"
  | "treasure"
  | "boss";
export type RoomSize = "small" | "medium" | "large";

export interface AuthoredRoom {
  name: string;
  role: RoomRole;
  size: RoomSize;
  map: string[];
}

export interface ParsedRoom {
  name: string;
  role: RoomRole;
  sizeClass: RoomSize;
  width: number;
  height: number;
  tiles: ChamberTileGrid;
  spawns: ChamberSpawnData[];
  obstacles: ChamberObstacleData[];
  hazardZones: ChamberObstacleData[];
  doors: ChamberObstacleData[];
}

type SpawnGlyph = Omit<ChamberSpawnData, "id" | "x" | "y">;

const SPAWN_GLYPHS: Record<string, SpawnGlyph> = {
  S: { type: "player_start" },
  E: { type: "enemy", variant: "grunt", hp: 30, damage: 6, speed: 1 },
  A: { type: "enemy", variant: "ranged", hp: 26, damage: 8, speed: 1 },
  L: { type: "elite", variant: "brute", hp: 80, damage: 14, speed: 0.8, lootTier: 3, label: "Elite Brute" },
  B: { type: "boss", variant: "guardian", hp: 300, damage: 18, speed: 1, lootTier: 5, label: "Guardian Boss" },
  N: { type: "node", lootTier: 1, label: "Resource Node" },
  C: { type: "chest", lootTier: 2, label: "Chest" },
  P: { type: "portal", label: "To Next Chamber" },
};

const TERRAIN_CHARS = ".#^~o+,";

function mergeRuns(
  lines: string[],
  pred: (ch: string) => boolean,
  cell: number,
  kind: string,
): ChamberObstacleData[] {
  const out: ChamberObstacleData[] = [];
  for (let r = 0; r < lines.length; r++) {
    const line = lines[r]!;
    let c = 0;
    while (c < line.length) {
      if (pred(line[c]!)) {
        const c0 = c;
        while (c < line.length && pred(line[c]!)) c++;
        out.push({ x: c0 * cell, y: r * cell, width: (c - c0) * cell, height: cell, kind });
      } else {
        c++;
      }
    }
  }
  return out;
}

export function parseRoom(room: AuthoredRoom): ParsedRoom {
  const cols = Math.max(1, ...room.map.map((r) => r.length));
  const rows = room.map.length;
  // Pad ragged rows with wall so the room always stays enclosed.
  const grid = room.map.map((r) => r.padEnd(cols, "#"));
  const cell = ROOM_CELL;

  const tileLines: string[] = [];
  const spawns: ChamberSpawnData[] = [];
  let idc = 0;
  const center = (i: number) => i * cell + cell / 2;

  // A cell is solid (blocks movement) if it is a wall, pit, or door — including
  // the wall padding added to ragged/out-of-bounds rows above.
  const cellChar = (rr: number, cc: number) =>
    rr < 0 || cc < 0 || rr >= rows || cc >= cols ? "#" : grid[rr]![cc] ?? "#";
  const isSolidCell = (rr: number, cc: number) => {
    const ch = cellChar(rr, cc);
    return ch === "#" || ch === "o" || ch === "+";
  };
  // A cell has clear room to move when it and all four orthogonal neighbours are
  // non-solid, so a spawned enemy can never start embedded in / flush against a
  // wall and is guaranteed at least one tile of slide space on every side.
  const isClearCell = (rr: number, cc: number) =>
    !isSolidCell(rr, cc) &&
    !isSolidCell(rr - 1, cc) &&
    !isSolidCell(rr + 1, cc) &&
    !isSolidCell(rr, cc - 1) &&
    !isSolidCell(rr, cc + 1);
  // Nudge an embedded/flush enemy spawn to the nearest clear floor cell via BFS.
  const nearestClearCell = (rr: number, cc: number): [number, number] => {
    if (isClearCell(rr, cc)) return [rr, cc];
    const seen = new Set<number>([rr * cols + cc]);
    const queue: Array<[number, number]> = [[rr, cc]];
    while (queue.length) {
      const [cr, cc2] = queue.shift()!;
      for (const [dr, dc] of [
        [-1, 0],
        [1, 0],
        [0, -1],
        [0, 1],
      ] as const) {
        const nr = cr + dr;
        const nc = cc2 + dc;
        if (nr < 0 || nc < 0 || nr >= rows || nc >= cols) continue;
        const key = nr * cols + nc;
        if (seen.has(key)) continue;
        seen.add(key);
        if (isClearCell(nr, nc)) return [nr, nc];
        if (!isSolidCell(nr, nc)) queue.push([nr, nc]);
      }
    }
    return [rr, cc];
  };

  for (let r = 0; r < rows; r++) {
    let line = "";
    for (let c = 0; c < cols; c++) {
      const ch = grid[r]![c] ?? "#";
      const glyph = SPAWN_GLYPHS[ch];
      if (glyph) {
        line += ".";
        let sr = r;
        let sc = c;
        // Only chasing enemies risk getting wall-stuck; keep them off walls.
        if (
          glyph.type === "enemy" ||
          glyph.type === "elite" ||
          glyph.type === "boss"
        ) {
          [sr, sc] = nearestClearCell(r, c);
        }
        spawns.push({
          id: `${glyph.type}-${idc++}`,
          type: glyph.type,
          x: center(sc),
          y: center(sr),
          variant: glyph.variant,
          hp: glyph.hp,
          damage: glyph.damage,
          speed: glyph.speed,
          lootTier: glyph.lootTier,
          label: glyph.label,
        });
      } else if (TERRAIN_CHARS.includes(ch)) {
        line += ch;
      } else {
        line += ".";
      }
    }
    tileLines.push(line);
  }

  const obstacles = mergeRuns(tileLines, (ch) => ch === "#" || ch === "o", cell, "wall");
  const hazardZones = mergeRuns(tileLines, (ch) => ch === "^", cell, "hazard");
  const doors = mergeRuns(tileLines, (ch) => ch === "+", cell, "door");

  return {
    name: room.name,
    role: room.role,
    sizeClass: room.size,
    width: cols * cell,
    height: rows * cell,
    tiles: { cols, rows, cell, data: tileLines.join("") },
    spawns,
    obstacles,
    hazardZones,
    doors,
  };
}

// ---------------------------------------------------------------------------
// The library. Rooms are biome-agnostic in layout; the assembler reskins them
// to a labyrinth's biome. Width is fixed per size class so authoring stays
// predictable: small 13x9, medium 16x11, large 19x13.
// ---------------------------------------------------------------------------

export const ROOM_LIBRARY: AuthoredRoom[] = [
  // ---- ENTRY (gentle on-ramps) ----
  {
    name: "Quiet Threshold", role: "entry", size: "small",
    map: [
      "#############",
      "#S.........N#",
      "#...##......#",
      "#...##..E...#",
      "#...........#",
      "#..E....##..#",
      "#.......##..#",
      "#..C.......P#",
      "#############",
    ],
  },
  {
    name: "Mossy Foyer", role: "entry", size: "small",
    map: [
      "#############",
      "#S....,.....#",
      "#..#.....#..#",
      "#..#..E..#..#",
      "#...........#",
      "#.N..,,,..C.#",
      "#....E......#",
      "#.........,P#",
      "#############",
    ],
  },
  {
    name: "Broken Antehall", role: "entry", size: "medium",
    map: [
      "################",
      "#S............N#",
      "#...####.......#",
      "#......#...E...#",
      "#..E...#.......#",
      "#......#...##..#",
      "#..........##..#",
      "#...,,,........#",
      "#.E.....##....C#",
      "#.......##....P#",
      "################",
    ],
  },

  // ---- COMBAT (open fights, chokepoints) ----
  {
    name: "Pillar Crossing", role: "combat", size: "small",
    map: [
      "#############",
      "#S..........#",
      "#..#..E..#..#",
      "#...........#",
      "#.E..#.#..A.#",
      "#...........#",
      "#..#..E..#.N#",
      "#..........P#",
      "#############",
    ],
  },
  {
    name: "The Pincer", role: "combat", size: "medium",
    map: [
      "################",
      "#S.....##.....A#",
      "#......##......#",
      "#..E...........#",
      "#......##......#",
      "#...L..##...E..#",
      "#......##......#",
      "#..A...........#",
      "#......##....N.#",
      "#......##....P.#",
      "################",
    ],
  },
  {
    name: "Crossfire Court", role: "combat", size: "medium",
    map: [
      "################",
      "#S...........A.#",
      "#..####...###..#",
      "#.....E........#",
      "#..............#",
      "#.A...####...E.#",
      "#.....#..#.....#",
      "#.....#..#...A.#",
      "#.E............#",
      "#...........N.P#",
      "################",
    ],
  },
  {
    name: "Serpentine Hall", role: "combat", size: "large",
    map: [
      "###################",
      "#S...#.......#...N#",
      "#....#..E....#....#",
      "#.E..#.......#..A.#",
      "#....+.......+....#",
      "#....#...A...#....#",
      "#..E.#.......#..E.#",
      "#....#...E...#....#",
      "#....+.......+....#",
      "#.A..#.......#..A.#",
      "#....#...E...#...C#",
      "#....#.......#...P#",
      "###################",
    ],
  },
  {
    name: "Twin Galleries", role: "combat", size: "large",
    map: [
      "###################",
      "#S................#",
      "#..####....####...#",
      "#..#..E....A..#...#",
      "#..#..........#..N#",
      "#.....L....L......#",
      "#..#..........#...#",
      "#..#..A....E..#...#",
      "#..####....####...#",
      "#.................#",
      "#..E...........E..#",
      "#..............C.P#",
      "###################",
    ],
  },

  // ---- GAUNTLET (corridors + doors, denser fights) ----
  {
    name: "The Choke", role: "gauntlet", size: "medium",
    map: [
      "################",
      "#S....######...#",
      "#.....#....#...#",
      "#..E..+....#.A.#",
      "#.....#....#...#",
      "#.....#.E..+...#",
      "#..A..#....#...#",
      "#.....######...#",
      "#.....L.......N#",
      "#.............P#",
      "################",
    ],
  },
  {
    name: "Warded Corridor", role: "gauntlet", size: "large",
    map: [
      "###################",
      "#S..#.........#...#",
      "#...#..E...A..#...#",
      "#...+.........+...#",
      "#...#.........#...#",
      "#...#...L..E..#..N#",
      "#...#.........#...#",
      "#...+....A....+...#",
      "#...#.........#...#",
      "#...#..E...A..#...#",
      "#...#.........#...#",
      "#...#.......C.#..P#",
      "###################",
    ],
  },
  {
    name: "Lockstep Maze", role: "gauntlet", size: "large",
    map: [
      "###################",
      "#S....#####.......#",
      "#.....#...#...E...#",
      "#..E..+...#.......#",
      "#.....#...+...#####",
      "#.....#...#.......#",
      "#####.#...#..A....#",
      "#.....#...#.......#",
      "#..A..+...#####.+.#",
      "#.....#.......#...#",
      "#.....#..L....#..N#",
      "#.....#.......#..P#",
      "###################",
    ],
  },

  // ---- HAZARD (damage floors front and center) ----
  {
    name: "Scorched Walk", role: "hazard", size: "small",
    map: [
      "#############",
      "#S..........#",
      "#...^^^^....#",
      "#...^^^^.E..#",
      "#...........#",
      "#.E....^^^..#",
      "#......^^^.N#",
      "#..........P#",
      "#############",
    ],
  },
  {
    name: "The Searing Path", role: "hazard", size: "medium",
    map: [
      "################",
      "#S.....^^^.....#",
      "#......^^^.....#",
      "#..E...^^^..E..#",
      "#......^^^.....#",
      "#.............N#",
      "#.^^^.....^^^..#",
      "#.^^^..A..^^^..#",
      "#.^^^.....^^^..#",
      "#............P.#",
      "################",
    ],
  },
  {
    name: "Cinder Crucible", role: "hazard", size: "large",
    map: [
      "###################",
      "#S................#",
      "#..^^^^.....^^^^..#",
      "#..^^^^..A..^^^^..#",
      "#..^^^^.....^^^^..#",
      "#.......E.E.......#",
      "#..oo...........oo#",
      "#..oo....L......oo#",
      "#.......E.E.....N.#",
      "#..^^^^.....^^^^..#",
      "#..^^^^..A..^^^^..#",
      "#..^^^^.....^^^^.P#",
      "###################",
    ],
  },

  // ---- TREASURE (reward rooms; light guards, doored vaults) ----
  {
    name: "Glittering Alcove", role: "treasure", size: "small",
    map: [
      "#############",
      "#S..........#",
      "#...#####...#",
      "#...#N.C#...#",
      "#...+...#...#",
      "#...#C.N#...#",
      "#...#####...#",
      "#..........P#",
      "#############",
    ],
  },
  {
    name: "The Hoard", role: "treasure", size: "medium",
    map: [
      "################",
      "#S.............#",
      "#..##########..#",
      "#..#C..N..C.#..#",
      "#..+........#..#",
      "#..#N..,,..N#..#",
      "#..#........#..#",
      "#..#C..N..C.+..#",
      "#..##########..#",
      "#.............P#",
      "################",
    ],
  },
  {
    name: "Wardens' Reliquary", role: "treasure", size: "large",
    map: [
      "###################",
      "#S................#",
      "#...###########...#",
      "#...#C...N...C#...#",
      "#...#.........#...#",
      "#...+...L.....+...#",
      "#...#.........#...#",
      "#...#N..,,,..N#...#",
      "#...#.........#...#",
      "#...#C...N...C#...#",
      "#...###########...#",
      "#................P#",
      "###################",
    ],
  },

  // ---- BOSS (final arenas) ----
  {
    name: "Guardian's Sanctum", role: "boss", size: "large",
    map: [
      "###################",
      "#S................#",
      "#.....#######.....#",
      "#.....#.....#.....#",
      "#.....#..B..#.....#",
      "#.....+.....+.....#",
      "#.................#",
      "#..E...........E..#",
      "#.................#",
      "#.....#.....#.....#",
      "#..C..#.....#..C..#",
      "#.............N..P#",
      "###################",
    ],
  },
  {
    name: "The Molten Throne", role: "boss", size: "large",
    map: [
      "###################",
      "#S................#",
      "#..^^^.......^^^..#",
      "#..^^^...B...^^^..#",
      "#..^^^.......^^^..#",
      "#.................#",
      "#....E.......E....#",
      "#.................#",
      "#..oo.........oo..#",
      "#..oo...,,,...oo..#",
      "#.....C.....C.....#",
      "#...........N....P#",
      "###################",
    ],
  },
  {
    name: "Collapsing Vault", role: "boss", size: "large",
    map: [
      "###################",
      "#S................#",
      "#..#####...#####..#",
      "#..#...........#..#",
      "#..#....B......#..#",
      "#.....+.....+.....#",
      "#.................#",
      "#..A...........A..#",
      "#.................#",
      "#..#####...#####..#",
      "#..C...........C..#",
      "#........N......P.#",
      "###################",
    ],
  },
];

export function parsedRoomLibrary(): ParsedRoom[] {
  return ROOM_LIBRARY.map(parseRoom);
}
