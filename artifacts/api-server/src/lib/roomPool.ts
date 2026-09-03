import { db } from "@workspace/db";
import { labyrinthRoomUnlocksTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { ROOM_LIBRARY, type RoomRole, type RoomSize } from "./rooms";

import type { DbLike } from "./db";

// ---------------------------------------------------------------------------
// Owner room-type pool.
//
// A "room type" is a (role × size class) combination drawn from the handcrafted
// room library. Owners unlock room types to expand the pool their labyrinth's
// runs are assembled from. The assembler still auto-picks the run order from the
// unlocked pool (respecting role-arc, depth/size gating, and difficulty
// scaling), so reward/difficulty balance stays automatic and ungameable.
// ---------------------------------------------------------------------------

export const SIZE_RANK: Record<RoomSize, number> = { small: 0, medium: 1, large: 2 };

export function roomTypeKey(role: string, size: string): string {
  return `${role}:${size}`;
}

const ROLE_LABEL: Record<RoomRole, string> = {
  entry: "Entry",
  combat: "Combat",
  gauntlet: "Gauntlet",
  hazard: "Hazard",
  treasure: "Treasure",
  boss: "Boss",
};

const ROLE_NOUN: Record<RoomRole, string> = {
  entry: "Antechamber",
  combat: "Hall",
  gauntlet: "Gauntlet",
  hazard: "Crucible",
  treasure: "Vault",
  boss: "Sanctum",
};

const SIZE_LABEL: Record<RoomSize, string> = {
  small: "Small",
  medium: "Medium",
  large: "Grand",
};

const ROLE_DESCRIPTION: Record<RoomRole, string> = {
  entry: "Gentle on-ramp rooms where adventurers begin their descent.",
  combat: "Open arenas and chokepoints built for straight fights.",
  gauntlet: "Doored corridors packed with denser, relentless encounters.",
  hazard: "Damage-floor rooms that punish careless footing.",
  treasure: "Reward vaults stocked with chests and resource nodes.",
  boss: "Grand finale arenas built to frame a guardian boss.",
};

// Per-role base price; larger sizes cost a multiple of the role base.
const ROLE_BASE_COST: Record<RoomRole, number> = {
  entry: 150,
  combat: 220,
  hazard: 280,
  gauntlet: 320,
  treasure: 360,
  boss: 700,
};

const SIZE_COST_MUL: Record<RoomSize, number> = { small: 1, medium: 1.6, large: 2.4 };

export function roomTypeCost(role: RoomRole, size: RoomSize): number {
  // Small rooms are the free starter set; everything else is priced in gold.
  if (size === "small") return 0;
  const raw = ROLE_BASE_COST[role] * SIZE_COST_MUL[size];
  return Math.round(raw / 10) * 10;
}

export interface RoomTypeCatalogEntry {
  key: string;
  role: RoomRole;
  size: RoomSize;
  name: string;
  description: string;
  templateCount: number;
  sampleNames: string[];
  cost: number;
  starter: boolean;
}

// Distinct (role, size) combos present in the room library, with metadata.
function buildCatalog(): RoomTypeCatalogEntry[] {
  const byKey = new Map<string, RoomTypeCatalogEntry>();
  for (const room of ROOM_LIBRARY) {
    const key = roomTypeKey(room.role, room.size);
    let entry = byKey.get(key);
    if (!entry) {
      const cost = roomTypeCost(room.role, room.size);
      entry = {
        key,
        role: room.role,
        size: room.size,
        name: `${SIZE_LABEL[room.size]} ${ROLE_NOUN[room.role]}`,
        description: ROLE_DESCRIPTION[room.role],
        templateCount: 0,
        sampleNames: [],
        cost,
        starter: cost === 0,
      };
      byKey.set(key, entry);
    }
    entry.templateCount += 1;
    if (entry.sampleNames.length < 3) entry.sampleNames.push(room.name);
  }
  // Stable ordering: by role arc, then by size.
  const ROLE_ORDER: RoomRole[] = ["entry", "combat", "gauntlet", "hazard", "treasure", "boss"];
  return [...byKey.values()].sort((a, b) => {
    const r = ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role);
    if (r !== 0) return r;
    return SIZE_RANK[a.size] - SIZE_RANK[b.size];
  });
}

export const ROOM_TYPE_CATALOG: RoomTypeCatalogEntry[] = buildCatalog();

export const ROOM_TYPE_BY_KEY: Record<string, RoomTypeCatalogEntry> = Object.fromEntries(
  ROOM_TYPE_CATALOG.map((e) => [e.key, e]),
);

// Starter pool unlocked for every labyrinth: the free (small) room types. This
// always includes an entry and a treasure room, so a fresh 2-chamber labyrinth
// is immediately playable.
export const STARTER_ROOM_KEYS: string[] = ROOM_TYPE_CATALOG.filter((e) => e.starter).map(
  (e) => e.key,
);

// Read the set of room keys a labyrinth has unlocked. Labs with no rows yet
// (legacy / not-yet-ensured) fall back to the starter set so assembly is safe.
export async function getUnlockedRoomKeys(
  labyrinthId: number,
  tx: DbLike = db,
): Promise<Set<string>> {
  const rows = await tx
    .select()
    .from(labyrinthRoomUnlocksTable)
    .where(eq(labyrinthRoomUnlocksTable.labyrinthId, labyrinthId));
  if (rows.length === 0) return new Set(STARTER_ROOM_KEYS);
  return new Set(rows.map((r) => r.roomKey));
}

// Ensure the starter room types exist for a labyrinth (idempotent). Called on
// claim so newly created labs persist their starter pool.
export async function ensureStarterUnlocks(
  labyrinthId: number,
  tx: DbLike = db,
): Promise<void> {
  if (STARTER_ROOM_KEYS.length === 0) return;
  await tx
    .insert(labyrinthRoomUnlocksTable)
    .values(STARTER_ROOM_KEYS.map((roomKey) => ({ labyrinthId, roomKey })))
    .onConflictDoNothing();
}

export function buildRoomTypeDto(entry: RoomTypeCatalogEntry, unlocked: boolean) {
  return {
    key: entry.key,
    role: entry.role,
    size: entry.size,
    name: entry.name,
    description: entry.description,
    templateCount: entry.templateCount,
    sampleNames: entry.sampleNames,
    cost: entry.cost,
    starter: entry.starter,
    unlocked,
  };
}
