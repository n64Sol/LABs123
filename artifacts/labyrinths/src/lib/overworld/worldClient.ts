// ---------------------------------------------------------------------------
// worldClient — talks to the raw (non-openapi) overworld streaming endpoints
// and manages a client-side chunk cache for the unbounded world.
//
// The world is a sprawling plane centered on the origin hub. Land-plot
// entrances are streamed per spatial chunk as the camera moves, cached by chunk
// key, and evicted when they drift far from view so memory stays bounded no
// matter how large the world grows.
// ---------------------------------------------------------------------------

export interface BiomeRegion {
  key: string;
  name: string;
  accent: string;
  cx: number;
  cy: number;
  radius: number;
  count: number;
}

export interface WorldMeta {
  chunkSize: number;
  worldLimit: number;
  regions: BiomeRegion[];
}

export interface WorldEntrance {
  id: number;
  name: string;
  ownerUserId: number;
  ownerName: string;
  level: number;
  biome: string;
  accent: string;
  x: number;
  y: number;
  published: boolean;
  entryFee: number;
  tollGateUnlocked: boolean;
}

export interface SpawnInfo {
  x: number;
  y: number;
  labyrinthId: number | null;
}

export interface LeaderRow {
  rank: number;
  name: string;
  avatarUrl: string;
  rewardValue: number;
  timeSeconds: number;
  bossDefeated: boolean;
  clearedAt: string | null;
}

function apiUrl(path: string): string {
  return `/api/overworld${path}`;
}

export async function fetchWorldMeta(): Promise<WorldMeta> {
  const res = await fetch(apiUrl("/meta"), { credentials: "include" });
  if (!res.ok) throw new Error("meta failed");
  const data = (await res.json()) as Partial<WorldMeta>;
  return {
    chunkSize: data.chunkSize ?? 1024,
    worldLimit: data.worldLimit ?? 250_000,
    regions: data.regions ?? [],
  };
}

/**
 * Look up labyrinths by name or owner across the whole world (not just the
 * chunks streamed near the camera). Returns plotted entrances so the caller can
 * recenter the camera on a chosen match. Empty/blank queries yield no results.
 */
export async function searchLabyrinths(q: string): Promise<WorldEntrance[]> {
  const term = q.trim();
  if (!term) return [];
  try {
    const res = await fetch(apiUrl(`/search?q=${encodeURIComponent(term)}`), {
      credentials: "include",
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { results?: WorldEntrance[] };
    return data.results ?? [];
  } catch {
    return [];
  }
}

export async function fetchSpawn(): Promise<SpawnInfo> {
  try {
    const res = await fetch(apiUrl("/spawn"), { credentials: "include" });
    if (!res.ok) return { x: 0, y: 0, labyrinthId: null };
    return (await res.json()) as SpawnInfo;
  } catch {
    return { x: 0, y: 0, labyrinthId: null };
  }
}

export async function fetchLeaderboard(id: number): Promise<LeaderRow[]> {
  try {
    const res = await fetch(apiUrl(`/labyrinth/${id}/leaderboard`), { credentials: "include" });
    if (!res.ok) return [];
    return (await res.json()) as LeaderRow[];
  } catch {
    return [];
  }
}

async function fetchChunks(keys: string[]): Promise<WorldEntrance[]> {
  if (keys.length === 0) return [];
  const res = await fetch(apiUrl(`/chunks?keys=${encodeURIComponent(keys.join(","))}`), {
    credentials: "include",
  });
  if (!res.ok) return [];
  const data = (await res.json()) as { entrances: WorldEntrance[] };
  return data.entrances ?? [];
}

/** Maximum number of chunks held in cache before far ones are evicted. */
const CACHE_CAP = 280;
/** Max chunks fetched in one request batch. */
const BATCH = 48;

/**
 * Streams and caches land-plot entrances per spatial chunk. The render loop
 * calls `requestWindow` each tick with the chunk keys currently in view (plus a
 * margin); missing chunks are fetched (batched, deduped) and far chunks are
 * evicted. `entrances` exposes the flattened, loaded set for drawing.
 */
export class ChunkStreamer {
  private chunkSize: number;
  private cache = new Map<string, WorldEntrance[]>();
  private inflight = new Set<string>();
  private flat: WorldEntrance[] = [];
  private lastWindow = "";

  constructor(chunkSize: number) {
    this.chunkSize = Math.max(1, chunkSize);
  }

  setChunkSize(size: number): void {
    if (size > 0 && size !== this.chunkSize) {
      this.chunkSize = size;
      this.cache.clear();
      this.inflight.clear();
      this.flat = [];
    }
  }

  keyOf(x: number, y: number): string {
    return `${Math.floor(x / this.chunkSize)}_${Math.floor(y / this.chunkSize)}`;
  }

  /** Chunk keys covering a world rectangle (with optional cell margin). */
  windowKeys(vx0: number, vy0: number, vx1: number, vy1: number, margin = 1): string[] {
    const cs = this.chunkSize;
    const cx0 = Math.floor(vx0 / cs) - margin;
    const cy0 = Math.floor(vy0 / cs) - margin;
    const cx1 = Math.floor(vx1 / cs) + margin;
    const cy1 = Math.floor(vy1 / cs) + margin;
    const keys: string[] = [];
    for (let cx = cx0; cx <= cx1; cx++) {
      for (let cy = cy0; cy <= cy1; cy++) keys.push(`${cx}_${cy}`);
    }
    return keys;
  }

  /** Request a set of chunk keys be resident; fetches missing, evicts far. */
  requestWindow(keys: string[]): void {
    const sig = keys.length + ":" + (keys[0] ?? "") + (keys[keys.length - 1] ?? "");
    const windowSet = new Set(keys);
    const missing = keys.filter((k) => !this.cache.has(k) && !this.inflight.has(k));
    if (missing.length) {
      for (let i = 0; i < missing.length; i += BATCH) {
        void this.load(missing.slice(i, i + BATCH));
      }
    }
    // Evict chunks far outside the current window when over the cap.
    if (this.cache.size > CACHE_CAP) {
      let removed = false;
      for (const k of this.cache.keys()) {
        if (!windowSet.has(k)) {
          this.cache.delete(k);
          removed = true;
        }
      }
      if (removed) this.rebuild();
    }
    this.lastWindow = sig;
  }

  private async load(keys: string[]): Promise<void> {
    for (const k of keys) this.inflight.add(k);
    try {
      const entrances = await fetchChunks(keys);
      const buckets = new Map<string, WorldEntrance[]>();
      for (const e of entrances) {
        const k = this.keyOf(e.x, e.y);
        const arr = buckets.get(k);
        if (arr) arr.push(e);
        else buckets.set(k, [e]);
      }
      // Mark every requested key resident (empty array when it has no plots).
      for (const k of keys) this.cache.set(k, buckets.get(k) ?? []);
      this.rebuild();
    } catch {
      /* transient — will retry on a later tick */
    } finally {
      for (const k of keys) this.inflight.delete(k);
    }
  }

  private rebuild(): void {
    const out: WorldEntrance[] = [];
    const seen = new Set<number>();
    for (const arr of this.cache.values()) {
      for (const e of arr) {
        if (!seen.has(e.id)) {
          seen.add(e.id);
          out.push(e);
        }
      }
    }
    this.flat = out;
  }

  get entrances(): WorldEntrance[] {
    return this.flat;
  }

  /** Force a re-fetch of currently resident chunks (e.g. after a new claim). */
  invalidate(): void {
    this.cache.clear();
    this.inflight.clear();
    this.flat = [];
    this.lastWindow = "";
  }
}
