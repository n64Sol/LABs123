import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { useLocation } from "wouter";
import { useGetCurrentPlayer, useGetLoadout } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Send, Wifi, Radio, DoorOpen, Map as MapIcon, X, Shirt, Plus, Minus, Search, Loader2 } from "lucide-react";
import { PresenceClient } from "@/lib/overworld/presenceClient";
import CoopPanel from "@/components/overworld/CoopPanel";
import { composeSpriteFromLayers, layersFromSlots } from "@/lib/sprite";
import { EMOTES, emoteGlyph, type Transport } from "@/lib/overworld/types";
import { drawLpcAvatar, lpcRowFor, playerColor } from "@/lib/overworld/render";
import { collectTileObjects, resolveMove } from "@/lib/overworld/tileMap";
import {
  TOWN_BUILDINGS,
  TOWN_PROPS,
  PLAZA_HALF,
  WALL_HALF,
  GATE_WIDTH_HALF,
  TOWN_SPAWN,
  BIOME_ANGLES,
  resolveTownMove,
  nearestDoor,
  type TownBuilding,
} from "@/lib/overworld/town";
import {
  ChunkStreamer,
  fetchWorldMeta,
  fetchSpawn,
  searchLabyrinths,
  type WorldEntrance,
  type BiomeRegion,
} from "@/lib/overworld/worldClient";
import { sandHash, paintCobbleField, PLAZA_PAL, PATH_PAL } from "@/lib/overworld/ground";
import { ROAD_HALF } from "@/lib/overworld/roads";
import LabyrinthPopup from "./LabyrinthPopup";
import EntranceChamber from "./EntranceChamber";
import TradePanel, { type NearbyPlayer } from "@/components/overworld/TradePanel";
import DuelPanel from "@/components/overworld/DuelPanel";

const LOCAL_SPRITE_KEY = "__local__";

const SPEED = 330; // world px / second
const AVATAR_SIZE = 104;
const INTERACT_RADIUS = 92;
const TRADE_RADIUS = 90;
const EMOTE_MS = 2600;
const CHAT_MS = 5200;
const MOVE_SEND_MS = 80;

// Zoom + level-of-detail thresholds.
const MIN_SCALE = 0.05;
const MAX_SCALE = 1.8;
const DETAIL_SCALE = 0.34; // below this we render symbolically
const NAMEPLATE_SCALE = 0.55; // below this only the active entrance shows its name
const ZOOM_STEP = 1.25;

// Beyond this many in-view chunks we stop streaming individual plots and rely on
// the symbolic biome regions instead (keeps requests bounded when zoomed way out).
const CHUNK_CAP = 160;
const CHUNK_REQ_MS = 180;

const DEFAULT_WORLD_LIMIT = 250_000;
const DEFAULT_CHUNK = 1024;

// 16-bit overworld ground textures + scenery object sprites (public/game/overworld16/).
const GROUND_TILES = [
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
const OBJECT_TILES = [
  "o_tree",
  "o_bush",
  "o_rock",
  "o_cactus",
  "o_ruin_pillar",
  "o_crystal",
  "o_lava_rock",
  "o_rune_stone",
  "o_reed",
  "o_flowers",
  "o_fern",
  "o_elder_tree",
  "o_sunlit_temple",
  "o_lighthouse",
  "o_crystal_spire",
  "o_ember_spire",
  "o_astral_obelisk",
];
const TOWN_TILES = [
  "t_inn",
  "t_shop",
  "t_forge",
  "t_armory",
  "t_library",
  "t_bank",
  "t_inn_r",
  "t_library_r",
  "t_armory_r",
  "t_fountain",
  "t_lamp",
];

interface LocalState {
  px: number;
  py: number;
  target: { x: number; y: number } | null;
  dirX: number;
  dirY: number;
  facing: number;
  moving: boolean;
}

interface Overlay {
  emoteGlyph?: string;
  emoteUntil?: number;
  chatText?: string;
  chatUntil?: number;
}

interface ChatLine {
  id: number;
  name: string;
  text: string;
  color: string;
}

interface BiomeGate {
  region: BiomeRegion;
  x: number;
  y: number;
  angle: number;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function biomeGates(regions: BiomeRegion[]): BiomeGate[] {
  const out: BiomeGate[] = [];
  for (let i = 0; i < BIOME_ANGLES.length; i++) {
    const region = regions[i];
    if (!region) continue;
    const angle = BIOME_ANGLES[i]!;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    let x: number;
    let y: number;
    if (Math.abs(cos) > Math.abs(sin)) {
      x = Math.sign(cos) * WALL_HALF;
      y = x * (sin / cos);
    } else {
      y = Math.sign(sin) * WALL_HALF;
      x = y * (cos / sin);
    }
    out.push({ region, x, y, angle });
  }
  return out;
}

export default function OverworldMap() {
  const [, setLocation] = useLocation();
  const { data: player } = useGetCurrentPlayer();
  const { data: loadout } = useGetLoadout();

  // Flat appearance map for the local player, derived from equipped gear.
  const localLayers = useMemo(() => layersFromSlots(loadout?.slots), [loadout?.slots]);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const minimapRef = useRef<HTMLCanvasElement | null>(null);

  const stateRef = useRef<LocalState>({
    px: 0,
    py: 0,
    target: null,
    dirX: 0,
    dirY: 1,
    facing: 1,
    moving: false,
  });
  const keysRef = useRef<Record<string, boolean>>({});
  const camRef = useRef({ x: 0, y: 0, scale: 1 });
  const spritesRef = useRef<Record<string, HTMLImageElement>>({});

  const streamerRef = useRef<ChunkStreamer | null>(null);
  const regionsRef = useRef<BiomeRegion[]>([]);
  const worldLimitRef = useRef(DEFAULT_WORLD_LIMIT);
  const lastChunkReqRef = useRef(0);

  const presenceRef = useRef<PresenceClient | null>(null);
  const spriteCacheRef = useRef<
    Map<string, { wantSig: string; doneSig: string; canvas: OffscreenCanvas | null; pending: boolean }>
  >(new Map());
  const localLayersRef = useRef<Record<string, string>>(localLayers);
  const renderPosRef = useRef<Map<string, { rx: number; ry: number; frame: number }>>(new Map());
  const overlaysRef = useRef<Map<string, Overlay>>(new Map());
  const localOverlayRef = useRef<Overlay>({});
  const lastSendRef = useRef(0);
  const chatFocusedRef = useRef(false);
  const popupOpenRef = useRef(false);
  const chamberOpenRef = useRef(false);
  const rafRef = useRef(0);
  const chatIdRef = useRef(0);
  const pinchRef = useRef<{ dist: number; scale: number } | null>(null);
  // When set, the camera smoothly eases toward this world point instead of
  // tracking the player — used to jump to a searched labyrinth. Cleared once the
  // player moves or the popup closes.
  const focusRef = useRef<{ x: number; y: number } | null>(null);
  const doorIdRef = useRef("");

  const [nearby, setNearby] = useState<WorldEntrance | null>(null);
  const [chamber, setChamber] = useState<{ runId: string; accent: string; biomeName: string } | null>(null);
  const [nearbyDoor, setNearbyDoor] = useState<TownBuilding | null>(null);
  const [nearbyGate, setNearbyGate] = useState<BiomeRegion | null>(null);
  const gateIdRef = useRef("");
  const [nearbyPlayer, setNearbyPlayer] = useState<NearbyPlayer | null>(null);
  const nearbyPlayerTickRef = useRef(0);
  const [nearbyAlly, setNearbyAlly] = useState<{ userId: number; displayName: string } | null>(null);
  const [transport, setTransport] = useState<Transport>("connecting");
  const [chatInput, setChatInput] = useState("");
  const [chatFeed, setChatFeed] = useState<ChatLine[]>([]);
  const [onlineCount, setOnlineCount] = useState(1);
  const [showMinimap, setShowMinimap] = useState(true);
  const [popupId, setPopupId] = useState<number | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<WorldEntrance[]>([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    popupOpenRef.current = popupId !== null;
  }, [popupId]);

  // Suspend overworld input while the entrance chamber overlay owns the screen.
  useEffect(() => {
    chamberOpenRef.current = chamber !== null;
  }, [chamber]);

  // ---- Init: world meta + spawn + presence lifecycle ----
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const meta = await fetchWorldMeta();
        if (cancelled) return;
        regionsRef.current = meta.regions;
        worldLimitRef.current = meta.worldLimit || DEFAULT_WORLD_LIMIT;
        streamerRef.current = new ChunkStreamer(meta.chunkSize || DEFAULT_CHUNK);
      } catch {
        streamerRef.current = new ChunkStreamer(DEFAULT_CHUNK);
      }
      await fetchSpawn();
      if (cancelled) return;
      // The overworld's start zone is the town: spawn in the plaza, unless we're
      // returning from a building interior (then land back at that door).
      let sx = TOWN_SPAWN.x;
      let sy = TOWN_SPAWN.y;
      try {
        const raw = sessionStorage.getItem("townReturn");
        if (raw) {
          const r = JSON.parse(raw) as { x?: number; y?: number };
          if (Number.isFinite(r?.x) && Number.isFinite(r?.y)) {
            sx = r.x as number;
            sy = r.y as number;
          }
          sessionStorage.removeItem("townReturn");
        }
      } catch {
        /* ignore malformed return marker */
      }
      stateRef.current.px = sx;
      stateRef.current.py = sy;
      camRef.current.x = sx;
      camRef.current.y = sy;

      const pc = new PresenceClient();
      pc.onTransportChange = (t) => setTransport(t);
      pc.start({ x: sx, y: sy, facing: 1, moving: false }, localLayersRef.current);
      presenceRef.current = pc;
    })();

    const onUnload = () => presenceRef.current?.stop();
    window.addEventListener("beforeunload", onUnload);
    return () => {
      cancelled = true;
      window.removeEventListener("beforeunload", onUnload);
      presenceRef.current?.stop();
      presenceRef.current = null;
    };
  }, []);

  // Preload sprites.
  useEffect(() => {
    const map: Record<string, HTMLImageElement> = {};
    for (const n of ["player_full", "rock", "portal"]) {
      const img = new Image();
      img.src = `${import.meta.env.BASE_URL}game/${n}.png`;
      map[n] = img;
    }
    for (const n of [...GROUND_TILES, ...OBJECT_TILES, ...TOWN_TILES]) {
      const img = new Image();
      img.src = `${import.meta.env.BASE_URL}game/overworld16/${n}.png`;
      map[n] = img;
    }
    spritesRef.current = map;
  }, []);

  // Propagate the local player's appearance to others whenever gear changes.
  useEffect(() => {
    localLayersRef.current = localLayers;
    presenceRef.current?.setAppearance(localLayers);
  }, [localLayers]);

  const enterPopup = useCallback((id: number) => {
    setPopupId(id);
  }, []);

  const closePopup = useCallback(() => {
    setPopupId(null);
    focusRef.current = null; // hand the camera back to the player
  }, []);

  // Smoothly recenter the camera on a chosen labyrinth and open its popup. Works
  // at any zoom — we bump out of the symbolic LOD so the plot is visible.
  const jumpToLabyrinth = useCallback((en: WorldEntrance) => {
    focusRef.current = { x: en.x, y: en.y };
    if (camRef.current.scale < 0.6) camRef.current.scale = 0.85;
    setPopupId(en.id);
    setSearchOpen(false);
    setSearchQuery("");
    setSearchResults([]);
  }, []);

  // Debounced labyrinth search (name/owner) against the world-wide lookup.
  useEffect(() => {
    const q = searchQuery.trim();
    if (!searchOpen || !q) {
      setSearchResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    let cancelled = false;
    const t = setTimeout(async () => {
      const results = await searchLabyrinths(q);
      if (cancelled) return;
      setSearchResults(results);
      setSearching(false);
    }, 220);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [searchQuery, searchOpen]);

  const enterTown = useCallback(
    (id: string) => {
      presenceRef.current?.stop();
      setLocation(`/town/${id}`);
    },
    [setLocation],
  );

  // Enter a co-op run row the host just launched (each member has their own).
  const enterRun = useCallback(
    (runId: number) => {
      presenceRef.current?.stop();
      setLocation(`/run/${runId}`);
    },
    [setLocation],
  );

  const openAppearance = useCallback(() => {
    presenceRef.current?.stop();
    setLocation("/loadout");
  }, [setLocation]);

  const zoomBy = useCallback((factor: number) => {
    camRef.current.scale = clamp(camRef.current.scale * factor, MIN_SCALE, MAX_SCALE);
  }, []);

  // Compose (and cache) a player's LPC sprite from their appearance layers.
  const ensureSprite = useCallback(
    (key: string, layers: Record<string, string> | undefined): OffscreenCanvas | null => {
      const sig = layers && Object.keys(layers).length ? JSON.stringify(Object.entries(layers).sort()) : "";
      const cache = spriteCacheRef.current;
      if (!sig) {
        cache.delete(key);
        return null;
      }
      let e = cache.get(key);
      if (!e) {
        e = { wantSig: sig, doneSig: "", canvas: null, pending: false };
        cache.set(key, e);
      }
      e.wantSig = sig;
      if (e.doneSig !== sig && !e.pending) {
        e.pending = true;
        const entry = e;
        composeSpriteFromLayers(layers, import.meta.env.BASE_URL).then((canvas) => {
          entry.pending = false;
          if (entry.wantSig === sig) {
            entry.canvas = canvas;
            entry.doneSig = sig;
          }
        });
      }
      return e.canvas;
    },
    [],
  );

  const teleportToGate = useCallback((r: BiomeRegion) => {
    const len = Math.max(1, Math.hypot(r.cx, r.cy));
    const inward = Math.min(340, r.radius * 0.42);
    const tx = r.cx - (r.cx / len) * inward;
    const ty = r.cy - (r.cy / len) * inward;
    stateRef.current.px = tx;
    stateRef.current.py = ty;
    stateRef.current.target = null;
    focusRef.current = null;
    camRef.current.x = tx;
    camRef.current.y = ty;
    if (camRef.current.scale < 0.6) camRef.current.scale = 0.85;
  }, []);

  // Keyboard input.
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (chatFocusedRef.current || popupOpenRef.current || chamberOpenRef.current) return;
      const key = e.key.toLowerCase();
      keysRef.current[key] = true;
      if (["arrowup", "arrowdown", "arrowleft", "arrowright"].includes(key)) e.preventDefault();
      if (key === "w" || key === "a" || key === "s" || key === "d" || key.startsWith("arrow")) {
        stateRef.current.target = null;
      }
      if (key === "e" || key === "enter") {
        if (nearbyDoor) enterTown(nearbyDoor.id);
        else if (nearbyGate) teleportToGate(nearbyGate);
        else if (nearby) enterPopup(nearby.id);
      }
      if (key === "+" || key === "=") zoomBy(ZOOM_STEP);
      if (key === "-" || key === "_") zoomBy(1 / ZOOM_STEP);
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
  }, [nearby, nearbyDoor, nearbyGate, enterPopup, enterTown, teleportToGate, zoomBy]);

  const triggerEmote = useCallback((key: string) => {
    presenceRef.current?.sendEmote(key);
    localOverlayRef.current.emoteGlyph = emoteGlyph(key);
    localOverlayRef.current.emoteUntil = performance.now() + EMOTE_MS;
  }, []);

  const sendChat = useCallback(() => {
    const text = chatInput.trim();
    if (!text) return;
    presenceRef.current?.sendChat(text);
    localOverlayRef.current.chatText = text.slice(0, 160);
    localOverlayRef.current.chatUntil = performance.now() + CHAT_MS;
    setChatFeed((f) => [
      ...f.slice(-4),
      { id: chatIdRef.current++, name: player?.displayName ?? "You", text: text.slice(0, 160), color: "#fbbf24" },
    ]);
    setChatInput("");
  }, [chatInput, player?.displayName]);

  const onlineTickRef = useRef(0);
  const setOnlineCountThrottled = (n: number) => {
    const now = performance.now();
    if (now - onlineTickRef.current > 500) {
      onlineTickRef.current = now;
      setOnlineCount(n);
    }
  };

  // Throttle nearby-player updates to ~3/s, only committing on actual change.
  const lastNearbyIdRef = useRef<number | null>(null);
  const setNearbyPlayerThrottled = (p: NearbyPlayer | null) => {
    const now = performance.now();
    if (now - nearbyPlayerTickRef.current < 300) return;
    nearbyPlayerTickRef.current = now;
    const id = p?.userId ?? null;
    if (id === lastNearbyIdRef.current) return;
    lastNearbyIdRef.current = id;
    setNearbyPlayer(p);
  };

  // Main render loop.
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let dpr = Math.min(2, window.devicePixelRatio || 1);
    let cssW = container.clientWidth;
    let cssH = container.clientHeight;
    const resize = () => {
      dpr = Math.min(2, window.devicePixelRatio || 1);
      cssW = container.clientWidth;
      cssH = container.clientHeight;
      canvas.width = Math.max(1, Math.floor(cssW * dpr));
      canvas.height = Math.max(1, Math.floor(cssH * dpr));
      canvas.style.width = `${cssW}px`;
      canvas.style.height = `${cssH}px`;
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(container);

    let last = performance.now();
    let lastNearbyId = -1;
    let lastAllyId = -1;
    let stuckFrames = 0;

    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const s = stateRef.current;
      const k = keysRef.current;
      const pc = presenceRef.current;
      const cam = camRef.current;
      const lim = worldLimitRef.current;
      const streamer = streamerRef.current;
      const regions = regionsRef.current;

      // --- input → movement direction ---
      let mx = 0;
      let my = 0;
      if (!popupOpenRef.current) {
        if (k["w"] || k["arrowup"]) my -= 1;
        if (k["s"] || k["arrowdown"]) my += 1;
        if (k["a"] || k["arrowleft"]) mx -= 1;
        if (k["d"] || k["arrowright"]) mx += 1;
      }
      if (mx !== 0 || my !== 0) {
        s.target = null;
        focusRef.current = null; // any manual movement breaks a search focus
      }
      if (mx === 0 && my === 0 && s.target) {
        const dx = s.target.x - s.px;
        const dy = s.target.y - s.py;
        const d = Math.hypot(dx, dy);
        if (d < 6) {
          s.target = null;
        } else {
          mx = dx / d;
          my = dy / d;
        }
      }
      const mag = Math.hypot(mx, my);
      s.moving = mag > 0.01;
      if (s.moving) {
        mx /= mag;
        my /= mag;
        const prevX = s.px;
        const prevY = s.py;
        const moved = resolveMove(s.px, s.py, mx * SPEED * dt, my * SPEED * dt, regions, streamer?.entrances ?? [], lim);
        const tm = resolveTownMove(prevX, prevY, moved.x, moved.y);
        s.px = tm.x;
        s.py = tm.y;
        s.dirX = mx;
        s.dirY = my;
        if (Math.abs(mx) > 0.1) s.facing = mx >= 0 ? 1 : -1;
        // Abandon a click-to-move target if we're wedged against a solid object.
        if (s.target && Math.hypot(s.px - prevX, s.py - prevY) < 0.5) {
          if (++stuckFrames > 8) {
            s.target = null;
            stuckFrames = 0;
          }
        } else {
          stuckFrames = 0;
        }
      }

      // --- send position (throttled) ---
      if (pc && now - lastSendRef.current > MOVE_SEND_MS) {
        lastSendRef.current = now;
        pc.sendMove(Math.round(s.px), Math.round(s.py), s.facing, s.moving);
      }

      // --- drain transient events ---
      if (pc) {
        for (const ev of pc.drainEvents()) {
          if (ev.t === "emote") {
            const o = overlaysRef.current.get(ev.clientId) ?? {};
            o.emoteGlyph = emoteGlyph(ev.emote);
            o.emoteUntil = now + EMOTE_MS;
            overlaysRef.current.set(ev.clientId, o);
          } else if (ev.t === "chat") {
            const o = overlaysRef.current.get(ev.clientId) ?? {};
            o.chatText = ev.text;
            o.chatUntil = now + CHAT_MS;
            overlaysRef.current.set(ev.clientId, o);
            const rp = pc.getPlayers().find((p) => p.clientId === ev.clientId);
            setChatFeed((f) => [
              ...f.slice(-4),
              {
                id: chatIdRef.current++,
                name: rp?.displayName ?? "Adventurer",
                text: ev.text,
                color: playerColor(ev.clientId),
              },
            ]);
          }
        }
      }

      // --- camera: normally tracks the player, but eases toward a search focus
      // point when one is set; scale persists across frames ---
      const focus = focusRef.current;
      if (focus) {
        const ease = 1 - Math.pow(0.0009, dt);
        cam.x += (focus.x - cam.x) * ease;
        cam.y += (focus.y - cam.y) * ease;
        if (Math.hypot(focus.x - cam.x, focus.y - cam.y) < 2) {
          cam.x = focus.x;
          cam.y = focus.y;
        }
      } else {
        cam.x = s.px;
        cam.y = s.py;
      }
      const scale = cam.scale;
      const detailed = scale >= DETAIL_SCALE;

      // Visible world rectangle.
      const hw = cssW / 2 / scale;
      const hh = cssH / 2 / scale;
      const vx0 = cam.x - hw;
      const vy0 = cam.y - hh;
      const vx1 = cam.x + hw;
      const vy1 = cam.y + hh;

      // --- stream chunks near the viewport (skip when zoomed way out) ---
      let entrances: WorldEntrance[] = [];
      if (streamer) {
        if (now - lastChunkReqRef.current > CHUNK_REQ_MS) {
          lastChunkReqRef.current = now;
          const keys = streamer.windowKeys(vx0, vy0, vx1, vy1, 1);
          if (keys.length <= CHUNK_CAP) streamer.requestWindow(keys);
        }
        entrances = streamer.entrances;
      }

      // --- proximity to nearest entrance (detailed mode only) ---
      let near: WorldEntrance | null = null;
      if (detailed) {
        let nbest = INTERACT_RADIUS;
        for (const en of entrances) {
          const d = Math.hypot(en.x - s.px, en.y - s.py);
          if (d < nbest) {
            nbest = d;
            near = en;
          }
        }
      }
      if ((near?.id ?? -1) !== lastNearbyId) {
        lastNearbyId = near?.id ?? -1;
        setNearby(near);
      }

      // --- proximity to a town building door (detailed mode only) ---
      const door = detailed ? nearestDoor(s.px, s.py, INTERACT_RADIUS) : null;
      if ((door?.id ?? "") !== doorIdRef.current) {
        doorIdRef.current = door?.id ?? "";
        setNearbyDoor(door);
      }

      // --- proximity to a biome gate ---
      let nearGate: BiomeRegion | null = null;
      if (detailed) {
        for (const gate of biomeGates(regions)) {
          if (Math.hypot(s.px - gate.x, s.py - gate.y) < INTERACT_RADIUS * 1.5) {
            nearGate = gate.region;
            break;
          }
        }
      }
      if ((nearGate?.key ?? "") !== gateIdRef.current) {
        gateIdRef.current = nearGate?.key ?? "";
        setNearbyGate(nearGate);
      }

      // === DRAW ===
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, cssW, cssH);
      // Deep backdrop (sky / void beyond the painted ground).
      ctx.fillStyle = "#10160f";
      ctx.fillRect(0, 0, cssW, cssH);

      ctx.save();
      ctx.translate(cssW / 2, cssH / 2);
      ctx.scale(scale, scale);
      ctx.translate(-cam.x, -cam.y);

      const sprites = spritesRef.current;
      const vis = { vx0, vy0, vx1, vy1 };

      if (detailed) {
        drawGround(ctx, sprites, vis);
        drawRegionFloors(ctx, regions, sprites, vis);
        drawRegionWater(ctx, regions, vis, now);
        drawRoads(ctx, vis);
        drawTownGround(ctx, sprites, vis);
        for (const en of entrances) {
          if (en.x < vx0 - 120 || en.x > vx1 + 120 || en.y < vy0 - 160 || en.y > vy1 + 120) continue;
          drawEntrance(ctx, en, sprites, now, en.id === (near?.id ?? -1), scale);
        }
      } else {
        drawRegionsSymbolic(ctx, regions, vis, now);
        drawHubSymbolic(ctx, vis);
      }

      // Players.
      const sheet = sprites["player_full"];
      const sheetReady = sheet && sheet.complete && sheet.naturalWidth > 0;
      const remote = pc?.getPlayers() ?? [];
      setOnlineCountThrottled(remote.length + 1);

      type Drawable = { ry: number; draw: () => void };
      const drawables: Drawable[] = [];
      const seen = new Set<string>();

      // Deterministic 16-bit scenery objects, y-sorted with players so tall
      // trees/pillars correctly occlude characters standing behind them.
      if (detailed) {
        for (const obj of collectTileObjects(regions, vx0, vy0, vx1, vy1, entrances)) {
          const sp = sprites[obj.kind];
          if (!sp || !sp.complete || sp.naturalWidth === 0) continue;
          const dh = obj.h;
          const dw = dh * (sp.naturalWidth / sp.naturalHeight);
          drawables.push({
            ry: obj.y,
            draw: () => {
              if (obj.solid && obj.solidR > 0) {
                ctx.save();
                ctx.fillStyle = "rgba(10,8,6,0.3)";
                ctx.beginPath();
                ctx.ellipse(obj.x, obj.y, obj.solidR * 1.5, obj.solidR * 0.6, 0, 0, Math.PI * 2);
                ctx.fill();
                ctx.restore();
              }
              ctx.drawImage(sp, obj.x - dw / 2, obj.y - dh, dw, dh);
            },
          });
        }
      }

      // Town buildings + props, y-sorted with players so the player passes
      // behind tall roofs and in front of foundations naturally.
      if (detailed) {
        for (const b of TOWN_BUILDINGS) {
          if (b.fx - b.drawW / 2 > vx1 || b.fx + b.drawW / 2 < vx0 || b.fy < vy0 || b.fy - b.drawH > vy1) continue;
          const isNear = b.id === doorIdRef.current;
          const bsp = sprites[b.sprite];
          drawables.push({ ry: b.fy, draw: () => drawBuilding(ctx, b, bsp, isNear) });
        }
        for (const p of TOWN_PROPS) {
          if (p.fx - p.drawW / 2 > vx1 || p.fx + p.drawW / 2 < vx0 || p.fy < vy0 || p.fy - p.drawH > vy1) continue;
          const sp = sprites[p.sprite];
          if (!sp || !sp.complete || sp.naturalWidth === 0) continue;
          drawables.push({
            ry: p.fy,
            draw: () => ctx.drawImage(sp, p.fx - p.drawW / 2, p.fy - p.drawH, p.drawW, p.drawH),
          });
        }
        for (const gate of biomeGates(regions)) {
          if (gate.x < vx0 - 130 || gate.x > vx1 + 130 || gate.y < vy0 - 190 || gate.y > vy1 + 80) continue;
          drawables.push({
            ry: gate.y,
            draw: () => drawBiomeGate(ctx, gate, now, gate.region.key === nearGate?.key),
          });
        }
      }

      // Track the nearest remote player within trade range for the trade prompt.
      let tradeBest: NearbyPlayer | null = null;
      let tradeBestDist = TRADE_RADIUS;

      // --- nearest invitable ally (real account only) ---
      let ally: { userId: number; displayName: string } | null = null;
      let abest = INTERACT_RADIUS * 1.6;
      for (const rp of remote) {
        if (!rp.userId) continue;
        const d = Math.hypot(rp.x - s.px, rp.y - s.py);
        if (d < abest) {
          abest = d;
          ally = { userId: rp.userId, displayName: rp.displayName };
        }
      }
      if ((ally?.userId ?? -1) !== lastAllyId) {
        lastAllyId = ally?.userId ?? -1;
        setNearbyAlly(ally);
      }

      for (const rp of remote) {
        seen.add(rp.clientId);
        const pd = Math.hypot(rp.x - s.px, rp.y - s.py);
        if (pd < tradeBestDist) {
          tradeBestDist = pd;
          tradeBest = { userId: rp.userId, displayName: rp.displayName };
        }
        let rs = renderPosRef.current.get(rp.clientId);
        if (!rs) {
          rs = { rx: rp.x, ry: rp.y, frame: 0 };
          renderPosRef.current.set(rp.clientId, rs);
        }
        const lerp = 1 - Math.pow(0.0015, dt);
        rs.rx += (rp.x - rs.rx) * lerp;
        rs.ry += (rp.y - rs.ry) * lerp;
        if (rp.moving) rs.frame += dt * 9;
        else rs.frame = 0;
        const rrx = rs.rx;
        const rry = rs.ry;
        if (detailed) {
          const o = overlaysRef.current.get(rp.clientId);
          const col = playerColor(rp.clientId);
          const composed = ensureSprite(rp.clientId, rp.spriteLayers);
          const src = composed ?? (sheetReady ? sheet : undefined);
          drawables.push({
            ry: rry,
            draw: () => {
              const dir = rp.moving
                ? lpcRowFor(rp.x - rrx === 0 ? rp.facing : rp.x - rrx, rp.y - rry)
                : rp.facing >= 0
                  ? 11
                  : 9;
              drawAvatar(ctx, src, rrx, rry, AVATAR_SIZE, dir, rp.moving ? Math.floor(rs!.frame) % 9 : 0, col, rp.displayName, o, now);
            },
          });
        } else {
          drawPlayerDot(ctx, rrx, rry, playerColor(rp.clientId), scale, false);
        }
      }
      for (const id of [...renderPosRef.current.keys()]) {
        if (!seen.has(id)) {
          renderPosRef.current.delete(id);
          overlaysRef.current.delete(id);
          spriteCacheRef.current.delete(id);
        }
      }
      setNearbyPlayerThrottled(tradeBest);

      if (detailed) {
        const localDir = s.moving ? lpcRowFor(s.dirX, s.dirY) : s.facing >= 0 ? 11 : 9;
        const localFrame = s.moving ? Math.floor(now / 100) % 9 : 0;
        const localComposed = ensureSprite(LOCAL_SPRITE_KEY, localLayersRef.current);
        const localSrc = localComposed ?? (sheetReady ? sheet : undefined);
        drawables.push({
          ry: s.py,
          draw: () => {
            drawAvatar(ctx, localSrc, s.px, s.py, AVATAR_SIZE, localDir, localFrame, "#fbbf24", player?.displayName ?? "You", localOverlayRef.current, now, true);
          },
        });
        drawables.sort((a, b) => a.ry - b.ry);
        for (const d of drawables) d.draw();
      } else {
        drawPlayerDot(ctx, s.px, s.py, "#fbbf24", scale, true);
      }

      ctx.restore();

      // Screen-space labels for symbolic regions + entrance dots.
      if (!detailed) {
        drawSymbolicLabels(ctx, regions, entrances, cam, scale, cssW, cssH);
      }

      drawMinimap(minimapRef.current, regions, entrances, { x: s.px, y: s.py }, remote, worldLimitRef.current);

      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(rafRef.current);
      ro.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [player?.displayName]);

  // Pointer: click-to-move + click an entrance to open its popup.
  const handlePointer = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const cam = camRef.current;
    const rect = canvas.getBoundingClientRect();
    const scale = cam.scale;
    const wx = (e.clientX - rect.left - rect.width / 2) / scale + cam.x;
    const wy = (e.clientY - rect.top - rect.height / 2) / scale + cam.y;

    for (const gate of biomeGates(regionsRef.current)) {
      if (Math.hypot(gate.x - wx, gate.y - wy) < 90) {
        teleportToGate(gate.region);
        return;
      }
    }

    const streamer = streamerRef.current;
    if (streamer) {
      const hitWorld = scale >= DETAIL_SCALE ? 64 : 40 / scale;
      let best: WorldEntrance | null = null;
      let bd = hitWorld;
      for (const en of streamer.entrances) {
        const d = Math.hypot(en.x - wx, en.y - wy);
        if (d < bd) {
          bd = d;
          best = en;
        }
      }
      if (best) {
        setPopupId(best.id);
        return;
      }
    }
    const lim = worldLimitRef.current;
    stateRef.current.target = { x: clamp(wx, -lim, lim), y: clamp(wy, -lim, lim) };
  }, [teleportToGate]);

  const handleWheel = useCallback((e: React.WheelEvent<HTMLCanvasElement>) => {
    const factor = e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
    camRef.current.scale = clamp(camRef.current.scale * factor, MIN_SCALE, MAX_SCALE);
  }, []);

  // Basic pinch-to-zoom.
  const handleTouchMove = useCallback((e: React.TouchEvent<HTMLCanvasElement>) => {
    if (e.touches.length !== 2) {
      pinchRef.current = null;
      return;
    }
    const dx = e.touches[0]!.clientX - e.touches[1]!.clientX;
    const dy = e.touches[0]!.clientY - e.touches[1]!.clientY;
    const dist = Math.hypot(dx, dy);
    if (!pinchRef.current) {
      pinchRef.current = { dist, scale: camRef.current.scale };
    } else {
      const ratio = dist / pinchRef.current.dist;
      camRef.current.scale = clamp(pinchRef.current.scale * ratio, MIN_SCALE, MAX_SCALE);
    }
  }, []);
  const endPinch = useCallback(() => {
    pinchRef.current = null;
  }, []);

  return (
    <div
      ref={containerRef}
      className="relative w-full overflow-hidden rounded-xl border border-border bg-black/40"
      style={{ height: "calc(100vh - 220px)", minHeight: 420 }}
    >
      <canvas
        ref={canvasRef}
        onClick={handlePointer}
        onWheel={handleWheel}
        onTouchMove={handleTouchMove}
        onTouchEnd={endPinch}
        className="absolute inset-0 cursor-pointer touch-none"
      />

      {/* Top status bar */}
      <div className="pointer-events-none absolute left-3 top-3 flex items-center gap-2 text-xs">
        <div className="flex items-center gap-1.5 rounded-full bg-background/80 px-3 py-1.5 font-medium text-foreground backdrop-blur-sm">
          {transport === "websocket" ? (
            <Wifi className="h-3.5 w-3.5 text-emerald-500" />
          ) : transport === "polling" ? (
            <Radio className="h-3.5 w-3.5 text-amber-500" />
          ) : (
            <Radio className="h-3.5 w-3.5 animate-pulse text-muted-foreground" />
          )}
          <span>{onlineCount} online</span>
        </div>
      </div>

      {/* Appearance + search entry points */}
      <div className="absolute left-3 top-12 flex items-center gap-2">
        <Button
          onClick={openAppearance}
          size="sm"
          variant="secondary"
          className="h-8 gap-1.5 bg-background/80 text-xs backdrop-blur-sm"
        >
          <Shirt className="h-3.5 w-3.5" />
          Appearance
        </Button>
        {!searchOpen && (
          <Button
            onClick={() => setSearchOpen(true)}
            size="sm"
            variant="secondary"
            className="h-8 gap-1.5 bg-background/80 text-xs backdrop-blur-sm"
          >
            <Search className="h-3.5 w-3.5" />
            Find labyrinth
          </Button>
        )}
      </div>

      {/* Labyrinth search panel */}
      {searchOpen && (
        <div className="absolute left-3 top-12 z-20 w-72 max-w-[calc(100vw-1.5rem)]">
          <div className="overflow-hidden rounded-lg border border-border bg-background/95 shadow-xl backdrop-blur-sm">
            <div className="flex items-center gap-1.5 border-b border-border px-2.5">
              <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <Input
                autoFocus
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onFocus={() => (chatFocusedRef.current = true)}
                onBlur={() => (chatFocusedRef.current = false)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    setSearchOpen(false);
                    setSearchQuery("");
                  } else if (e.key === "Enter" && searchResults[0]) {
                    jumpToLabyrinth(searchResults[0]);
                  }
                }}
                placeholder="Search by name or owner…"
                maxLength={60}
                className="h-9 border-0 bg-transparent px-1 text-sm shadow-none focus-visible:ring-0"
              />
              {searching ? (
                <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" />
              ) : (
                <button
                  onClick={() => {
                    setSearchOpen(false);
                    setSearchQuery("");
                    chatFocusedRef.current = false;
                  }}
                  title="Close search"
                  className="rounded p-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            {searchQuery.trim() && (
              <div className="max-h-72 overflow-y-auto">
                {searchResults.length === 0 && !searching ? (
                  <div className="px-3 py-3 text-xs text-muted-foreground">No labyrinths found.</div>
                ) : (
                  searchResults.map((en) => (
                    <button
                      key={en.id}
                      onClick={() => jumpToLabyrinth(en)}
                      className="flex w-full items-center gap-2.5 px-2.5 py-2 text-left transition-colors hover:bg-muted"
                    >
                      <span
                        className="h-7 w-1.5 shrink-0 rounded-full"
                        style={{ backgroundColor: en.accent }}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-foreground">{en.name}</span>
                        <span className="block truncate text-[11px] text-muted-foreground">
                          {en.ownerName} · Lv {en.level}
                        </span>
                      </span>
                      <DoorOpen className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Help hint */}
      <div className="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 rounded-full bg-background/80 px-3 py-1.5 text-xs text-muted-foreground backdrop-blur-sm">
        WASD / click to move · scroll to zoom
      </div>

      {/* Zoom controls */}
      <div className="absolute bottom-28 right-3 flex flex-col gap-1.5">
        <button
          onClick={() => zoomBy(ZOOM_STEP)}
          title="Zoom in"
          className="flex h-9 w-9 items-center justify-center rounded-lg bg-background/80 text-foreground shadow backdrop-blur-sm transition-colors hover:bg-background"
        >
          <Plus className="h-4 w-4" />
        </button>
        <button
          onClick={() => zoomBy(1 / ZOOM_STEP)}
          title="Zoom out"
          className="flex h-9 w-9 items-center justify-center rounded-lg bg-background/80 text-foreground shadow backdrop-blur-sm transition-colors hover:bg-background"
        >
          <Minus className="h-4 w-4" />
        </button>
      </div>

      {/* Minimap */}
      <div className="absolute right-3 top-3">
        {showMinimap ? (
          <div className="overflow-hidden rounded-lg border border-border bg-background/70 shadow-lg backdrop-blur-sm">
            <div className="flex items-center justify-between gap-2 px-2 py-1">
              <span className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
                <MapIcon className="h-3 w-3" /> Local Map
              </span>
              <button
                onClick={() => setShowMinimap(false)}
                title="Hide map"
                className="rounded p-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            <canvas ref={minimapRef} className="block h-[150px] w-[150px]" />
          </div>
        ) : (
          <button
            onClick={() => setShowMinimap(true)}
            title="Show map"
            className="flex items-center gap-1.5 rounded-full bg-background/80 px-3 py-1.5 text-xs font-medium text-foreground shadow-lg backdrop-blur-sm transition-colors hover:bg-background"
          >
            <MapIcon className="h-3.5 w-3.5" /> Map
          </button>
        )}

        {/* Co-op party panel */}
        <div className="mt-2 flex justify-end">
          <CoopPanel
            nearbyId={nearby?.id ?? null}
            nearbyName={nearby?.name ?? null}
            nearbyAlly={nearbyAlly}
            myUserId={player?.id}
            onEnterRun={enterRun}
          />
        </div>
      </div>

      {/* Chat feed */}
      {chatFeed.length > 0 && (
        <div className="pointer-events-none absolute bottom-24 left-3 flex max-w-xs flex-col gap-1">
          {chatFeed.map((c) => (
            <div key={c.id} className="rounded-lg bg-background/75 px-2.5 py-1 text-xs backdrop-blur-sm">
              <span className="font-semibold" style={{ color: c.color }}>
                {c.name}:
              </span>{" "}
              <span className="text-foreground">{c.text}</span>
            </div>
          ))}
        </div>
      )}

      {/* Interaction prompt */}
      {nearbyDoor && !popupId && (
        <div className="absolute left-1/2 top-4 -translate-x-1/2">
          <Button onClick={() => enterTown(nearbyDoor.id)} className="gap-2 shadow-lg" size="sm">
            <DoorOpen className="h-4 w-4" />
            Enter {nearbyDoor.label} <span className="opacity-70">(E)</span>
          </Button>
        </div>
      )}
      {nearbyGate && !nearbyDoor && !popupId && (
        <div className="absolute left-1/2 top-4 -translate-x-1/2">
          <Button onClick={() => teleportToGate(nearbyGate)} className="gap-2 shadow-lg" size="sm">
            <DoorOpen className="h-4 w-4" />
            Travel to {nearbyGate.name} <span className="opacity-70">(E)</span>
          </Button>
        </div>
      )}
      {nearby && !nearbyDoor && !nearbyGate && !popupId && (
        <div className="absolute left-1/2 top-4 -translate-x-1/2">
          <Button onClick={() => enterPopup(nearby.id)} className="gap-2 shadow-lg" size="sm">
            <DoorOpen className="h-4 w-4" />
            View {nearby.name} <span className="opacity-70">(E)</span>
          </Button>
        </div>
      )}

      <TradePanel nearby={nearbyPlayer} />

      <DuelPanel nearby={nearbyPlayer} myLayers={localLayers} />

      {/* Bottom controls: emotes + chat */}
      <div className="absolute inset-x-0 bottom-0 flex flex-col gap-2 bg-gradient-to-t from-black/60 to-transparent p-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {EMOTES.map((em) => (
            <button
              key={em.key}
              onClick={() => triggerEmote(em.key)}
              title={em.label}
              className="flex h-9 w-9 items-center justify-center rounded-lg bg-background/80 text-lg backdrop-blur-sm transition-transform hover:scale-110 hover:bg-background"
            >
              {em.glyph}
            </button>
          ))}
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            sendChat();
          }}
          className="flex max-w-md items-center gap-2"
        >
          <Input
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            onFocus={() => (chatFocusedRef.current = true)}
            onBlur={() => (chatFocusedRef.current = false)}
            placeholder="Say something…"
            maxLength={160}
            className="h-9 bg-background/85 backdrop-blur-sm"
          />
          <Button type="submit" size="icon" className="h-9 w-9 shrink-0" disabled={!chatInput.trim()}>
            <Send className="h-4 w-4" />
          </Button>
        </form>
      </div>

      {/* In-world labyrinth popup */}
      {popupId !== null && (
        <LabyrinthPopup
          id={popupId}
          onClose={closePopup}
          onEnter={(runId) => {
            // Hand off to the seamless walk-in entrance chamber instead of cutting
            // straight to the run page. Capture the entrance's theme for the chamber.
            const en = nearby;
            setChamber({
              runId,
              accent: en?.accent ?? "#7c5cff",
              biomeName: en?.name ?? "the labyrinth",
            });
            setPopupId(null);
          }}
        />
      )}

      {/* Seamless descent: themed walk-in chamber bridging town -> run. The run was
          already created (and any fee charged) in the popup, so this is a one-way
          cinematic transition — there is no cancel/refund path. */}
      {chamber && (
        <EntranceChamber
          runId={chamber.runId}
          accent={chamber.accent}
          biomeName={chamber.biomeName}
          onBegin={() => {
            presenceRef.current?.stop();
            setLocation(`/run/${chamber.runId}`);
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Canvas drawing helpers (module-scope; operate in world coordinates).
// ---------------------------------------------------------------------------

type Vis = { vx0: number; vy0: number; vx1: number; vy1: number };

function tileFloor(ctx: CanvasRenderingContext2D, img: HTMLImageElement, x0: number, y0: number, x1: number, y1: number): void {
  const tile = 256;
  const sx = Math.floor(x0 / tile) * tile;
  const sy = Math.floor(y0 / tile) * tile;
  for (let x = sx; x < x1; x += tile) {
    for (let y = sy; y < y1; y += tile) {
      ctx.drawImage(img, x, y, tile, tile);
    }
  }
}

/** Flat pixel-sand shore for Tidecaller (no baked river). Caller has clipped to the region. */
function paintSandFloor(ctx: CanvasRenderingContext2D, z: BiomeRegion): void {
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
      const h = sandHash(xx, yy);
      if (h > 0.84) ctx.fillStyle = "#e6c486";
      else if (h < 0.18) ctx.fillStyle = "#bd8a4c";
      else continue;
      ctx.fillRect(xx, yy, CELL, CELL);
    }
  }
}

/** Procedural shallow ponds for one Tidecaller region (decorative). Caller clips to the region. */
function drawWater(ctx: CanvasRenderingContext2D, z: BiomeRegion, time: number): void {
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

/** Paint procedural ponds inside each visible Tidecaller region. */
function drawRegionWater(ctx: CanvasRenderingContext2D, regions: BiomeRegion[], v: Vis, time: number): void {
  for (const z of regions) {
    if (z.key !== "tidecaller") continue;
    if (z.cx + z.radius < v.vx0 || z.cx - z.radius > v.vx1 || z.cy + z.radius < v.vy0 || z.cy - z.radius > v.vy1) continue;
    ctx.save();
    ctx.beginPath();
    ctx.arc(z.cx, z.cy, z.radius, 0, Math.PI * 2);
    ctx.clip();
    drawWater(ctx, z, time);
    ctx.restore();
  }
}

function drawGround(ctx: CanvasRenderingContext2D, sprites: Record<string, HTMLImageElement>, v: Vis): void {
  void sprites;
  ctx.fillStyle = "#4a3e31";
  ctx.fillRect(v.vx0, v.vy0, v.vx1 - v.vx0, v.vy1 - v.vy0);
  const CELL = 28;
  const x0 = Math.floor(v.vx0 / CELL) * CELL;
  const y0 = Math.floor(v.vy0 / CELL) * CELL;
  for (let y = y0; y < v.vy1; y += CELL) {
    for (let x = x0; x < v.vx1; x += CELL) {
      const h = sandHash(x / CELL, y / CELL);
      if (h > 0.9) {
        ctx.fillStyle = "rgba(186,154,112,0.13)";
        ctx.fillRect(x + 4, y + 5, 12, 7);
      } else if (h < 0.08) {
        ctx.fillStyle = "rgba(34,27,20,0.16)";
        ctx.fillRect(x + 7, y + 10, 16, 9);
      }
    }
  }
}

function drawRegionFloors(
  ctx: CanvasRenderingContext2D,
  regions: BiomeRegion[],
  sprites: Record<string, HTMLImageElement>,
  v: Vis,
): void {
  for (const z of regions) {
    if (z.cx + z.radius < v.vx0 || z.cx - z.radius > v.vx1 || z.cy + z.radius < v.vy0 || z.cy - z.radius > v.vy1) continue;
    const isTide = z.key === "tidecaller";
    const floor = sprites[`g_${z.key}`];
    // Tidecaller paints clean pixel-sand instead of its baked-river tile (which repeats
    // and cuts off at every seam); procedural ponds own all the water (see drawRegionWater).
    if (!isTide && (!floor || !floor.complete || floor.naturalWidth === 0)) continue;
    ctx.save();
    ctx.beginPath();
    ctx.arc(z.cx, z.cy, z.radius, 0, Math.PI * 2);
    ctx.clip();
    if (isTide) {
      paintSandFloor(ctx, z);
    } else {
      tileFloor(ctx, floor!, z.cx - z.radius, z.cy - z.radius, z.cx + z.radius + 256, z.cy + z.radius + 256);
    }
    // Soft edge so biomes melt into the surrounding field instead of hard rings.
    const vg = ctx.createRadialGradient(z.cx, z.cy, z.radius * 0.74, z.cx, z.cy, z.radius);
    vg.addColorStop(0, "rgba(30,24,18,0)");
    vg.addColorStop(1, "rgba(30,24,18,0.46)");
    ctx.fillStyle = vg;
    ctx.fillRect(z.cx - z.radius, z.cy - z.radius, z.radius * 2, z.radius * 2);
    ctx.restore();
  }
}

// Exact square clip path for the fortified town plaza.
function plazaEdgePath(ctx: CanvasRenderingContext2D, sizeHalf: number): void {
  // A clean, sharp square plaza instead of an organic circle.
  ctx.beginPath();
  ctx.rect(-sizeHalf, -sizeHalf, sizeHalf * 2, sizeHalf * 2);
}

/** Low stone perimeter wall enclosing the courtyard, with a pair
 *  of pillars flanking each of the six biome gates. Drawn on the ground layer so the
 *  player and buildings render over it naturally. */
function drawSanctuaryWall(ctx: CanvasRenderingContext2D): void {
  const inner = WALL_HALF - 16;
  const outer = WALL_HALF + 16;

  // Find all gate center points along the square perimeter
  const gates = BIOME_ANGLES.map(a => {
    const cos = Math.cos(a);
    const sin = Math.sin(a);
    let x, y;
    if (Math.abs(cos) > Math.abs(sin)) {
      x = Math.sign(cos) * WALL_HALF;
      y = x * (sin / cos);
    } else {
      y = Math.sign(sin) * WALL_HALF;
      x = y * (cos / sin);
    }
    return { x, y, ang: a };
  });

  // A helper to draw a solid wall block segment between (x0,y0) and (x1,y1).
  const drawWallSegment = (x0: number, y0: number, x1: number, y1: number) => {
    // Only draw if length is positive
    const len = Math.hypot(x1 - x0, y1 - y0);
    if (len < 1) return;

    // Normal vector pointing "outward" from the courtyard center
    let nx = 0, ny = 0;
    if (Math.abs(y0 - y1) < 1) { // horizontal
      ny = Math.sign(y0);
    } else { // vertical
      nx = Math.sign(x0);
    }

    const t0x = x0 + nx * 16, t0y = y0 + ny * 16;
    const b0x = x0 - nx * 16, b0y = y0 - ny * 16;
    const t1x = x1 + nx * 16, t1y = y1 + ny * 16;
    const b1x = x1 - nx * 16, b1y = y1 - ny * 16;

    // Base stone shadow / grounding
    ctx.fillStyle = "rgba(0,0,0,0.15)";
    ctx.beginPath();
    ctx.moveTo(b0x, b0y); ctx.lineTo(b1x, b1y);
    ctx.lineTo(b1x + nx * 4, b1y + ny * 4);
    ctx.lineTo(b0x + nx * 4, b0y + ny * 4);
    ctx.fill();

    // Main wall body
    ctx.beginPath();
    ctx.moveTo(t0x, t0y); ctx.lineTo(t1x, t1y);
    ctx.lineTo(b1x, b1y); ctx.lineTo(b0x, b0y);
    ctx.closePath();
    ctx.fillStyle = "#6d645d"; // dirt/stone based, less green
    ctx.fill();

    // Capstone edge
    ctx.lineWidth = 6;
    ctx.strokeStyle = "#867d74";
    ctx.beginPath();
    ctx.moveTo(t0x - nx * 4, t0y - ny * 4);
    ctx.lineTo(t1x - nx * 4, t1y - ny * 4);
    ctx.stroke();

    // Block seams
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = "rgba(40,34,28,0.5)";
    const steps = Math.floor(len / 48);
    for (let i = 1; i <= steps; i++) {
      const f = i / steps;
      const px = x0 + (x1 - x0) * f;
      const py = y0 + (y1 - y0) * f;
      ctx.beginPath();
      ctx.moveTo(px + nx * 16, py + ny * 16);
      ctx.lineTo(px - nx * 16, py - ny * 16);
      ctx.stroke();
    }
  };

  // We trace the 4 edges of the square. For each edge, we collect the gates that fall on it.
  const edges = [
    { x0: -WALL_HALF, y0: -WALL_HALF, x1: WALL_HALF, y1: -WALL_HALF }, // Top
    { x0: WALL_HALF, y0: -WALL_HALF, x1: WALL_HALF, y1: WALL_HALF },   // Right
    { x0: WALL_HALF, y0: WALL_HALF, x1: -WALL_HALF, y1: WALL_HALF },   // Bottom
    { x0: -WALL_HALF, y0: WALL_HALF, x1: -WALL_HALF, y1: -WALL_HALF }  // Left
  ];

  for (const edge of edges) {
    const isHoriz = edge.y0 === edge.y1;
    // Find gates on this edge
    const onEdge = gates.filter(g =>
      isHoriz ? Math.abs(g.y - edge.y0) < 1 : Math.abs(g.x - edge.x0) < 1
    );
    // Sort gates by position along the edge
    onEdge.sort((a, b) => isHoriz
      ? (Math.sign(edge.x1 - edge.x0) * (a.x - b.x))
      : (Math.sign(edge.y1 - edge.y0) * (a.y - b.y))
    );

    let cx = edge.x0;
    let cy = edge.y0;
    const dx = isHoriz ? Math.sign(edge.x1 - edge.x0) : 0;
    const dy = isHoriz ? 0 : Math.sign(edge.y1 - edge.y0);

    for (const g of onEdge) {
      // Wall segment before the gate
      const gStartx = g.x - dx * GATE_WIDTH_HALF;
      const gStarty = g.y - dy * GATE_WIDTH_HALF;
      drawWallSegment(cx, cy, gStartx, gStarty);
      cx = g.x + dx * GATE_WIDTH_HALF;
      cy = g.y + dy * GATE_WIDTH_HALF;
    }
    // Final segment to edge corner
    drawWallSegment(cx, cy, edge.x1, edge.y1);
  }

  // Pillars flanking each gate opening.
  for (const g of gates) {
    let nx = 0, ny = 0;
    if (Math.abs(Math.abs(g.y) - WALL_HALF) < 1) { // horizontal edge
      nx = 1;
    } else {
      ny = 1;
    }
    drawGatePost(ctx, g.x - nx * GATE_WIDTH_HALF, g.y - ny * GATE_WIDTH_HALF);
    drawGatePost(ctx, g.x + nx * GATE_WIDTH_HALF, g.y + ny * GATE_WIDTH_HALF);
  }
}

function drawGatePost(ctx: CanvasRenderingContext2D, px: number, py: number): void {
  const pw = 30;
  const ph = 64;
  ctx.save();
  // base shadow
  ctx.fillStyle = "rgba(8,10,8,0.34)";
  ctx.beginPath();
  ctx.ellipse(px, py + 2, 20, 9, 0, 0, Math.PI * 2);
  ctx.fill();
  // shaft
  ctx.fillStyle = "#8c8174";
  roundRect(ctx, px - pw / 2, py - ph, pw, ph, 5);
  ctx.fill();
  // lit edge
  ctx.fillStyle = "#a89c8b";
  roundRect(ctx, px - pw / 2, py - ph, pw * 0.42, ph, 5);
  ctx.fill();
  // cap
  ctx.fillStyle = "#b4a994";
  roundRect(ctx, px - pw / 2 - 3, py - ph - 9, pw + 6, 11, 3);
  ctx.fill();
  ctx.restore();
}

/** Contact shadow and raised foundation grounding an isometric building. */
function drawFoundation(ctx: CanvasRenderingContext2D, b: TownBuilding): void {
  ctx.save();
  // Deep contact shadow directly under the foundation.
  ctx.fillStyle = "rgba(10,8,6,0.5)";
  ctx.beginPath();
  ctx.ellipse(b.fx, b.fy - 2, b.drawW * 0.42, 14, 0, 0, Math.PI * 2);
  ctx.fill();

  // Raised stone plinth: top plane and darker front face.
  const hw = b.drawW * 0.4;
  ctx.fillStyle = "#857867";
  ctx.beginPath();
  ctx.moveTo(b.fx - hw, b.fy - 24);
  ctx.lineTo(b.fx + hw, b.fy - 24);
  ctx.lineTo(b.fx + hw * 1.08, b.fy - 2);
  ctx.lineTo(b.fx - hw * 1.08, b.fy - 2);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#574b40";
  ctx.beginPath();
  ctx.moveTo(b.fx - hw * 1.08, b.fy - 2);
  ctx.lineTo(b.fx + hw * 1.08, b.fy - 2);
  ctx.lineTo(b.fx + hw, b.fy + 10);
  ctx.lineTo(b.fx - hw, b.fy + 10);
  ctx.closePath();
  ctx.fill();

  // Broader ambient occlusion shadow.
  ctx.fillStyle = "rgba(10,8,6,0.2)";
  ctx.beginPath();
  ctx.ellipse(b.fx, b.fy - 4, b.drawW * 0.48, 24, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** A dimensional, y-sorted portal seated directly in each sanctuary-wall exit. */
function drawBiomeGate(
  ctx: CanvasRenderingContext2D,
  gate: BiomeGate,
  time: number,
  active: boolean,
): void {
  const { x, y, region } = gate;
  const pulse = 0.78 + Math.sin(time * 0.003 + gate.angle * 3) * 0.12;
  ctx.save();

  // Ground footprint and deep sill give the arch visible depth.
  ctx.fillStyle = "rgba(8,6,5,0.52)";
  ctx.beginPath();
  ctx.ellipse(x, y + 7, 67, 19, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#4a4038";
  ctx.beginPath();
  ctx.moveTo(x - 61, y - 5);
  ctx.lineTo(x + 61, y - 5);
  ctx.lineTo(x + 52, y + 13);
  ctx.lineTo(x - 52, y + 13);
  ctx.closePath();
  ctx.fill();

  // Portal energy sits behind the stone arch.
  const glow = ctx.createRadialGradient(x, y - 58, 4, x, y - 52, 55);
  glow.addColorStop(0, `${region.accent}ee`);
  glow.addColorStop(0.62, `${region.accent}88`);
  glow.addColorStop(1, `${region.accent}00`);
  ctx.globalAlpha = pulse;
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.moveTo(x - 37, y - 4);
  ctx.lineTo(x - 37, y - 62);
  ctx.arc(x, y - 62, 37, Math.PI, 0);
  ctx.lineTo(x + 37, y - 4);
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = 1;

  // Two-tone masonry adds a front face instead of a flat outline.
  ctx.fillStyle = "#75695d";
  ctx.fillRect(x - 58, y - 76, 20, 76);
  ctx.fillRect(x + 38, y - 76, 20, 76);
  ctx.strokeStyle = "#ad9c86";
  ctx.lineWidth = 18;
  ctx.beginPath();
  ctx.arc(x, y - 61, 48, Math.PI, 0);
  ctx.stroke();
  ctx.strokeStyle = "#433a33";
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(x - 38, y - 61);
  ctx.arc(x, y - 61, 38, Math.PI, 0);
  ctx.lineTo(x + 38, y - 1);
  ctx.stroke();
  ctx.fillStyle = "#4e443b";
  ctx.fillRect(x - 58, y - 76, 7, 76);
  ctx.fillRect(x + 51, y - 76, 7, 76);

  // Carved destination plaque is part of the object, not a floating UI card.
  ctx.fillStyle = active ? region.accent : "#887967";
  roundRect(ctx, x - 50, y - 133, 100, 24, 4);
  ctx.fill();
  ctx.fillStyle = "#18130f";
  ctx.font = "800 10px ui-sans-serif, system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(region.name.toUpperCase(), x, y - 117);
  ctx.textAlign = "left";
  ctx.restore();
}

// The six biome roads are the spine of the map: they radiate from the hub and run
// far past the walls so they dominate the view. Scenery is kept off them by the
// matching keep-out mask in tileMap (onRoad), so a road is never littered.
function drawRoads(ctx: CanvasRenderingContext2D, v: Vis): void {
  const viewR =
    Math.hypot(Math.max(Math.abs(v.vx0), Math.abs(v.vx1)), Math.max(Math.abs(v.vy0), Math.abs(v.vy1))) + 200;
  const r1 = Math.min(6000, viewR);
  if (r1 <= 140) return;
  const hw = ROAD_HALF;
  let pi = 0;
  for (const a of BIOME_ANGLES) {
    pi++;
    const cos = Math.cos(a);
    const sin = Math.sin(a);
    let startDist = 0;
    if (Math.abs(cos) > Math.abs(sin)) {
      startDist = WALL_HALF / Math.abs(cos);
    } else {
      startDist = WALL_HALF / Math.abs(sin);
    }

    ctx.save();
    ctx.rotate(a);
    ctx.beginPath();
    ctx.rect(startDist, -hw, r1 - startDist, hw * 2);
    ctx.clip();
    paintCobbleField(ctx, startDist, -hw, r1, hw, PATH_PAL, pi * 101);
    // Soft earthen shoulders so the road settles into the surrounding terrain.
    const g = ctx.createLinearGradient(0, -hw, 0, hw);
    g.addColorStop(0, "rgba(42,31,22,0.66)");
    g.addColorStop(0.28, "rgba(42,31,22,0)");
    g.addColorStop(0.72, "rgba(42,31,22,0)");
    g.addColorStop(1, "rgba(42,31,22,0.66)");
    ctx.fillStyle = g;
    ctx.fillRect(startDist, -hw, r1 - startDist, hw * 2);
    ctx.restore();
  }
}

function drawTownGround(ctx: CanvasRenderingContext2D, _sprites: Record<string, HTMLImageElement>, v: Vis): void {
  // Cull when the whole town is off-screen.
  if (v.vx1 < -WALL_HALF - 400 || v.vx0 > WALL_HALF + 400 || v.vy1 < -WALL_HALF - 400 || v.vy0 > WALL_HALF + 400) return;

  // Cobblestone plaza, painted procedurally.
  ctx.save();
  plazaEdgePath(ctx, PLAZA_HALF);
  ctx.clip();
  const bx0 = Math.max(-PLAZA_HALF - 8, v.vx0 - 48);
  const by0 = Math.max(-PLAZA_HALF - 8, v.vy0 - 48);
  const bx1 = Math.min(PLAZA_HALF + 8, v.vx1 + 48);
  const by1 = Math.min(PLAZA_HALF + 8, v.vy1 + 48);
  paintCobbleField(ctx, bx0, by0, bx1, by1, PLAZA_PAL, 0);
  // Warm light pooling toward the center, gentle shade at the rim to seat it in the world.
  const warm = ctx.createRadialGradient(0, -60, 40, 0, 0, PLAZA_HALF * 1.2);
  warm.addColorStop(0, "rgba(255,236,188,0.16)");
  warm.addColorStop(0.6, "rgba(255,236,188,0)");
  warm.addColorStop(1, "rgba(20,26,16,0.5)");
  ctx.fillStyle = warm;
  ctx.fillRect(-PLAZA_HALF, -PLAZA_HALF, PLAZA_HALF * 2, PLAZA_HALF * 2);
  ctx.restore();

  // Enclosing sanctuary wall (with gate gaps) and gate pillars.
  drawSanctuaryWall(ctx);

  // Town nameplate above the plaza.
  ctx.save();
  ctx.globalAlpha = 0.85;
  ctx.fillStyle = "#f3ead2";
  ctx.font = "700 22px ui-sans-serif, system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("CROSSROADS", 0, -PLAZA_HALF + 60);
  ctx.restore();
  ctx.textAlign = "left";
}

function drawBuilding(
  ctx: CanvasRenderingContext2D,
  b: TownBuilding,
  sprite: HTMLImageElement | undefined,
  near: boolean,
): void {
  // Ground the building with a soft contact shadow.
  drawFoundation(ctx, b);

  // Door highlight (drawn first so the building base sits over its top edge).
  if (near) {
    ctx.save();
    ctx.fillStyle = "rgba(251,191,36,0.85)";
    ctx.beginPath();
    ctx.ellipse(b.door.x, b.door.y, 28, 13, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // Detailed isometric building sprite, stamped at the foot anchor (bottom-centre).
  if (sprite && sprite.complete && sprite.naturalWidth > 0) {
    ctx.drawImage(sprite, b.fx - b.drawW / 2, b.fy - b.drawH, b.drawW, b.drawH);
  }

  // Keep labels grounded and contextual instead of floating over every roof.
  if (near) {
    ctx.save();
    ctx.font = "700 14px ui-sans-serif, system-ui, sans-serif";
    ctx.textAlign = "center";
    const tw = ctx.measureText(b.label).width;
    const ly = b.fy + 26;
    ctx.fillStyle = "rgba(20,16,12,0.86)";
    roundRect(ctx, b.fx - tw / 2 - 10, ly - 15, tw + 20, 22, 5);
    ctx.fill();
    ctx.fillStyle = "#f3ead2";
    ctx.fillText(b.label, b.fx, ly + 1);
    ctx.restore();
    ctx.textAlign = "left";
  }
}

// Geometry of an entrance archway opening (a rectangle capped with a semicircle).
const ARCH_OPEN_W = 96;
const ARCH_STRAIGHT_H = 64;

function archOpeningPath(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  const r = ARCH_OPEN_W / 2;
  const left = x - r;
  const right = x + r;
  const shTop = y - ARCH_STRAIGHT_H;
  ctx.beginPath();
  ctx.moveTo(left, y);
  ctx.lineTo(left, shTop);
  ctx.arc(x, shTop, r, Math.PI, Math.PI * 2, false);
  ctx.lineTo(right, y);
  ctx.closePath();
}

/** A small procedural diorama of the dungeon's first room, drawn inside the arch
 *  opening (the caller has already clipped to the opening shape). */
function drawDungeonPeek(
  ctx: CanvasRenderingContext2D,
  en: WorldEntrance,
  now: number,
  pulse: number,
): void {
  const cx = en.x;
  const bottom = en.y;
  const r = ARCH_OPEN_W / 2;
  const apex = en.y - ARCH_STRAIGHT_H - r;
  const accent = en.accent;

  // Depth gradient backdrop.
  const g = ctx.createLinearGradient(0, apex, 0, bottom);
  g.addColorStop(0, "#05070b");
  g.addColorStop(1, "#0b0f16");
  ctx.fillStyle = g;
  ctx.fillRect(cx - r - 4, apex - 4, ARCH_OPEN_W + 8, bottom - apex + 8);

  // Vanishing point a little below the apex.
  const vpY = apex + 30;

  // Perspective floor.
  ctx.fillStyle = "#10151d";
  ctx.beginPath();
  ctx.moveTo(cx - r, bottom);
  ctx.lineTo(cx + r, bottom);
  ctx.lineTo(cx + 16, vpY);
  ctx.lineTo(cx - 16, vpY);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = accent + "33";
  ctx.lineWidth = 1;
  for (let i = 1; i <= 4; i++) {
    const t = i / 5;
    const y = bottom + (vpY - bottom) * t;
    const halfw = r * (1 - t) + 16 * t;
    ctx.beginPath();
    ctx.moveTo(cx - halfw, y);
    ctx.lineTo(cx + halfw, y);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.moveTo(cx - r, bottom);
  ctx.lineTo(cx - 16, vpY);
  ctx.moveTo(cx + r, bottom);
  ctx.lineTo(cx + 16, vpY);
  ctx.stroke();

  // Faint pillars flanking the corridor.
  ctx.fillStyle = "rgba(0,0,0,0.5)";
  for (const sx of [-1, 1]) {
    const bx = cx + sx * 34;
    const bxTop = cx + sx * 22;
    ctx.beginPath();
    ctx.moveTo(bx - 6, bottom - 8);
    ctx.lineTo(bx + 6, bottom - 8);
    ctx.lineTo(bxTop + 4, vpY + 14);
    ctx.lineTo(bxTop - 4, vpY + 14);
    ctx.closePath();
    ctx.fill();
  }

  // Distant glowing doorway at the vanishing point.
  const dGlow = ctx.createRadialGradient(cx, vpY + 4, 2, cx, vpY + 4, 38 + pulse * 8);
  dGlow.addColorStop(0, accent + "cc");
  dGlow.addColorStop(1, accent + "00");
  ctx.fillStyle = dGlow;
  ctx.fillRect(cx - 36, vpY - 28, 72, 64);
  ctx.fillStyle = "#02040a";
  ctx.fillRect(cx - 13, vpY - 6, 26, 40);
  ctx.strokeStyle = accent + "aa";
  ctx.lineWidth = 2;
  ctx.strokeRect(cx - 13, vpY - 6, 26, 40);

  // Drifting motes for life.
  for (let i = 0; i < 3; i++) {
    const ph = now / 1400 + i * 2.1 + en.id;
    const span = bottom - vpY - 8;
    const mx = cx + Math.sin(ph) * 24;
    const my = bottom - 10 - (((ph * 18) % span) + span) % span;
    ctx.globalAlpha = 0.35 + 0.35 * (0.5 + 0.5 * Math.sin(ph * 2));
    ctx.fillStyle = accent;
    ctx.beginPath();
    ctx.arc(mx, my, 1.6, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

/** The carved stone archway framing the peek, themed by the biome accent. */
function drawArchFrame(
  ctx: CanvasRenderingContext2D,
  en: WorldEntrance,
  active: boolean,
  pulse: number,
): void {
  const cx = en.x;
  const bottom = en.y;
  const r = ARCH_OPEN_W / 2;
  const left = cx - r;
  const right = cx + r;
  const shTop = en.y - ARCH_STRAIGHT_H;
  const accent = en.accent;
  const jamb = 16;
  const stone = "#867b6d";
  const stoneLit = "#a99d8b";
  const stoneDark = "#5d5448";

  // Active rune glow tracing the opening.
  if (active) {
    ctx.save();
    ctx.shadowColor = accent;
    ctx.shadowBlur = 16 + pulse * 10;
    ctx.strokeStyle = accent;
    ctx.lineWidth = 4;
    archOpeningPath(ctx, en.x, en.y);
    ctx.stroke();
    ctx.restore();
  }

  // Jambs.
  ctx.fillStyle = stone;
  ctx.fillRect(left - jamb, shTop, jamb, bottom - shTop);
  ctx.fillRect(right, shTop, jamb, bottom - shTop);
  ctx.fillStyle = stoneLit;
  ctx.fillRect(left - jamb, shTop, 5, bottom - shTop);
  ctx.fillRect(right + jamb - 5, shTop, 5, bottom - shTop);
  ctx.fillStyle = stoneDark;
  ctx.fillRect(left - 3, shTop, 3, bottom - shTop);
  ctx.fillRect(right, shTop, 3, bottom - shTop);

  // Arch ring over the curved top.
  ctx.lineWidth = jamb;
  ctx.strokeStyle = stone;
  ctx.beginPath();
  ctx.arc(cx, shTop, r + jamb / 2, Math.PI, Math.PI * 2, false);
  ctx.stroke();
  ctx.lineWidth = 4;
  ctx.strokeStyle = stoneLit;
  ctx.beginPath();
  ctx.arc(cx, shTop, r + jamb - 3, Math.PI, Math.PI * 2, false);
  ctx.stroke();
  ctx.lineWidth = 3;
  ctx.strokeStyle = stoneDark;
  ctx.beginPath();
  ctx.arc(cx, shTop, r + 2, Math.PI, Math.PI * 2, false);
  ctx.stroke();

  // Footings.
  ctx.fillStyle = stoneDark;
  roundRect(ctx, left - jamb - 4, bottom - 10, jamb + 8, 12, 3);
  ctx.fill();
  roundRect(ctx, right - 4, bottom - 10, jamb + 8, 12, 3);
  ctx.fill();

  // Keystone with a glowing biome rune.
  const ky = shTop - r;
  ctx.fillStyle = stoneLit;
  roundRect(ctx, cx - 11, ky - 12, 22, 24, 4);
  ctx.fill();
  ctx.save();
  ctx.globalAlpha = 0.7 + pulse * 0.3;
  ctx.fillStyle = accent;
  ctx.beginPath();
  ctx.arc(cx, ky, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawEntrance(
  ctx: CanvasRenderingContext2D,
  en: WorldEntrance,
  _sprites: Record<string, HTMLImageElement>,
  now: number,
  active: boolean,
  scale: number,
): void {
  const pulse = 0.5 + Math.sin(now / 600 + en.id) * 0.5;

  // Base contact shadow to ground the portal
  ctx.save();
  ctx.fillStyle = "rgba(8,6,4,0.4)";
  ctx.beginPath();
  ctx.ellipse(en.x, en.y + 12, 70, 26, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Threshold glow inviting the player to step in.
  const gr = ctx.createRadialGradient(en.x, en.y + 6, 4, en.x, en.y + 6, 70 + (active ? 14 : 0));
  gr.addColorStop(0, en.accent + (active ? "aa" : "55"));
  gr.addColorStop(1, en.accent + "00");
  ctx.save();
  ctx.fillStyle = gr;
  ctx.beginPath();
  ctx.ellipse(en.x, en.y + 8, 64 + (active ? 12 : 0), 24, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Peek into the first room, clipped to the arch opening.
  ctx.save();
  archOpeningPath(ctx, en.x, en.y);
  ctx.clip();
  drawDungeonPeek(ctx, en, now, pulse);
  ctx.restore();

  // Stone archway over the opening edges.
  drawArchFrame(ctx, en, active, pulse);

  // Unpublished marker.
  if (!en.published) {
    ctx.save();
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = "rgba(10,12,16,0.7)";
    ctx.font = "600 11px ui-sans-serif, system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("· unpublished ·", en.x, en.y - 150);
    ctx.restore();
    ctx.textAlign = "left";
  }

  // Name plate (only when zoomed in enough, or when active).
  if (scale >= NAMEPLATE_SCALE || active) {
    const label = en.name;
    ctx.font = "600 15px ui-sans-serif, system-ui, sans-serif";
    const w = Math.max(70, ctx.measureText(label).width + 24);
    const py = en.y - 186;
    ctx.fillStyle = "rgba(10,12,16,0.82)";
    roundRect(ctx, en.x - w / 2, py, w, 26, 8);
    ctx.fill();
    ctx.fillStyle = en.accent;
    ctx.fillRect(en.x - w / 2, py, 4, 26);
    ctx.fillStyle = "#fff";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, en.x + 2, py + 13);
    ctx.font = "500 11px ui-sans-serif, system-ui, sans-serif";
    ctx.fillStyle = en.accent;
    ctx.fillText(`Lvl ${en.level}`, en.x, py + 38);
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
  }
}

function drawAvatar(
  ctx: CanvasRenderingContext2D,
  sheet: CanvasImageSource | undefined,
  x: number,
  y: number,
  size: number,
  row: number,
  frame: number,
  color: string,
  name: string,
  overlay: Overlay | undefined,
  now: number,
  isLocal = false,
): void {
  ctx.save();
  // Deep contact shadow directly at the feet
  ctx.globalAlpha = 0.5;
  ctx.fillStyle = "#0c0a08";
  ctx.beginPath();
  ctx.ellipse(x, y - 2, size * 0.15, size * 0.06, 0, 0, Math.PI * 2);
  ctx.fill();

  // Outer soft shadow
  ctx.globalAlpha = 0.25;
  ctx.beginPath();
  ctx.ellipse(x, y - 2, size * 0.28, size * 0.12, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.strokeStyle = color;
  ctx.globalAlpha = isLocal ? 0.9 : 0.6;
  ctx.lineWidth = isLocal ? 3 : 2;
  ctx.beginPath();
  ctx.ellipse(x, y, size * 0.28, size * 0.12, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();

  if (sheet) {
    drawLpcAvatar(ctx, sheet, x, y + size * 0.08, size, row, frame, 1);
  } else {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y - size * 0.35, size * 0.2, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.font = "600 13px ui-sans-serif, system-ui, sans-serif";
  const w = ctx.measureText(name).width + 16;
  const ny = y - size - 6;
  ctx.fillStyle = "rgba(10,12,16,0.78)";
  roundRect(ctx, x - w / 2, ny - 18, w, 20, 7);
  ctx.fill();
  ctx.fillStyle = isLocal ? "#fde68a" : "#fff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(name, x, ny - 8);
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";

  if (overlay?.emoteUntil && overlay.emoteUntil > now && overlay.emoteGlyph) {
    const fade = Math.min(1, (overlay.emoteUntil - now) / 400);
    const rise = (1 - Math.min(1, (overlay.emoteUntil - now) / EMOTE_MS)) * 8;
    ctx.save();
    ctx.globalAlpha = fade;
    ctx.font = "800 18px ui-monospace, SFMono-Regular, monospace";
    ctx.textAlign = "center";
    ctx.fillStyle = "#fff";
    ctx.strokeStyle = "rgba(0,0,0,0.8)";
    ctx.lineWidth = 3;
    ctx.strokeText(overlay.emoteGlyph, x, ny - 30 - rise);
    ctx.fillText(overlay.emoteGlyph, x, ny - 30 - rise);
    ctx.restore();
    ctx.textAlign = "left";
  }

  if (overlay?.chatUntil && overlay.chatUntil > now && overlay.chatText) {
    const fade = Math.min(1, (overlay.chatUntil - now) / 500);
    ctx.save();
    ctx.globalAlpha = fade;
    ctx.font = "500 13px ui-sans-serif, system-ui, sans-serif";
    const text = overlay.chatText;
    const tw = Math.min(240, ctx.measureText(text).width);
    const bw = tw + 20;
    const by = ny - 52;
    ctx.fillStyle = "rgba(255,255,255,0.95)";
    roundRect(ctx, x - bw / 2, by - 22, bw, 26, 9);
    ctx.fill();
    ctx.fillStyle = "#111827";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, x, by - 9, 240);
    ctx.restore();
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
  }
}

// --- Symbolic (zoomed-out) rendering ------------------------------------------

function drawRegionsSymbolic(ctx: CanvasRenderingContext2D, regions: BiomeRegion[], v: Vis, now: number): void {
  for (const z of regions) {
    if (z.cx + z.radius < v.vx0 || z.cx - z.radius > v.vx1 || z.cy + z.radius < v.vy0 || z.cy - z.radius > v.vy1) continue;
    const g = ctx.createRadialGradient(z.cx, z.cy, z.radius * 0.1, z.cx, z.cy, z.radius);
    g.addColorStop(0, z.accent + "88");
    g.addColorStop(0.7, z.accent + "44");
    g.addColorStop(1, z.accent + "08");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(z.cx, z.cy, z.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.save();
    ctx.strokeStyle = z.accent;
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = 3 / 1;
    ctx.setLineDash([16, 14]);
    ctx.lineDashOffset = -now / 50;
    ctx.beginPath();
    ctx.arc(z.cx, z.cy, z.radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
}

function drawHubSymbolic(ctx: CanvasRenderingContext2D, v: Vis): void {
  if (0 < v.vx0 || 0 > v.vx1 || 0 < v.vy0 || 0 > v.vy1) return;
  ctx.save();
  ctx.fillStyle = "rgba(230, 224, 210, 0.85)";
  ctx.beginPath();
  ctx.arc(0, 0, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawPlayerDot(ctx: CanvasRenderingContext2D, x: number, y: number, color: string, scale: number, isLocal: boolean): void {
  const r = (isLocal ? 6 : 4) / scale;
  ctx.save();
  ctx.fillStyle = color;
  ctx.strokeStyle = "rgba(0,0,0,0.6)";
  ctx.lineWidth = 1 / scale;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

// Screen-space labels + entrance dots for symbolic mode.
function drawSymbolicLabels(
  ctx: CanvasRenderingContext2D,
  regions: BiomeRegion[],
  entrances: WorldEntrance[],
  cam: { x: number; y: number },
  scale: number,
  cssW: number,
  cssH: number,
): void {
  const toScreen = (wx: number, wy: number): [number, number] => [
    (wx - cam.x) * scale + cssW / 2,
    (wy - cam.y) * scale + cssH / 2,
  ];

  // Entrance dots.
  for (const en of entrances) {
    const [sx, sy] = toScreen(en.x, en.y);
    if (sx < -10 || sx > cssW + 10 || sy < -10 || sy > cssH + 10) continue;
    ctx.fillStyle = en.accent;
    ctx.beginPath();
    ctx.arc(sx, sy, 3, 0, Math.PI * 2);
    ctx.fill();
  }

  // Region labels.
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (const z of regions) {
    const [sx, sy] = toScreen(z.cx, z.cy);
    if (sx < -100 || sx > cssW + 100 || sy < -40 || sy > cssH + 40) continue;
    ctx.font = "800 16px ui-sans-serif, system-ui, sans-serif";
    ctx.fillStyle = "rgba(10,12,16,0.55)";
    ctx.fillText(z.name.toUpperCase(), sx + 1, sy + 1);
    ctx.fillStyle = z.accent;
    ctx.fillText(z.name.toUpperCase(), sx, sy);
    ctx.font = "500 11px ui-sans-serif, system-ui, sans-serif";
    ctx.fillStyle = "rgba(255,255,255,0.75)";
    ctx.fillText(`${z.count} labyrinth${z.count === 1 ? "" : "s"}`, sx, sy + 16);
  }
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
}

// ---------------------------------------------------------------------------
// Minimap — player-centered local window of the unbounded world.
// ---------------------------------------------------------------------------

function drawMinimap(
  canvas: HTMLCanvasElement | null,
  regions: BiomeRegion[],
  entrances: WorldEntrance[],
  local: { x: number; y: number },
  remote: { x: number; y: number }[],
  worldLimit: number,
): void {
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const mw = canvas.clientWidth;
  const mh = canvas.clientHeight;
  if (mw === 0 || mh === 0) return;
  if (canvas.width !== Math.floor(mw * dpr) || canvas.height !== Math.floor(mh * dpr)) {
    canvas.width = Math.floor(mw * dpr);
    canvas.height = Math.floor(mh * dpr);
  }

  const R = 6000; // world radius shown around the player
  const scale = mw / 2 / R;
  const toMap = (wx: number, wy: number): [number, number] => [mw / 2 + (wx - local.x) * scale, mh / 2 + (wy - local.y) * scale];

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, mw, mh);
  ctx.fillStyle = "rgba(18, 24, 20, 0.92)";
  ctx.fillRect(0, 0, mw, mh);

  // Region blobs.
  for (const z of regions) {
    const [zx, zy] = toMap(z.cx, z.cy);
    const zr = z.radius * scale;
    if (zx + zr < 0 || zx - zr > mw || zy + zr < 0 || zy - zr > mh) continue;
    ctx.save();
    ctx.globalAlpha = 0.3;
    ctx.fillStyle = z.accent;
    ctx.beginPath();
    ctx.arc(zx, zy, Math.max(2, zr), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // Hub.
  {
    const [hx, hy] = toMap(0, 0);
    if (hx >= 0 && hx <= mw && hy >= 0 && hy <= mh) {
      ctx.fillStyle = "rgba(230,224,210,0.9)";
      ctx.beginPath();
      ctx.arc(hx, hy, 2.2, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Entrances.
  for (const en of entrances) {
    const [ex, ey] = toMap(en.x, en.y);
    if (ex < 0 || ex > mw || ey < 0 || ey > mh) continue;
    ctx.fillStyle = en.accent;
    ctx.beginPath();
    ctx.arc(ex, ey, 1.8, 0, Math.PI * 2);
    ctx.fill();
  }

  // Remote players.
  ctx.fillStyle = "rgba(255,255,255,0.65)";
  for (const r of remote) {
    const [rx, ry] = toMap(r.x, r.y);
    if (rx < 0 || rx > mw || ry < 0 || ry > mh) continue;
    ctx.beginPath();
    ctx.arc(rx, ry, 1.6, 0, Math.PI * 2);
    ctx.fill();
  }

  // Local player (always center).
  ctx.fillStyle = "#fbbf24";
  ctx.strokeStyle = "#000";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(mw / 2, mh / 2, 3.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // Subtle frame; hint at how much of the world is shown vs. its full extent.
  ctx.strokeStyle = "rgba(255,255,255,0.12)";
  ctx.lineWidth = 1;
  ctx.strokeRect(0.5, 0.5, mw - 1, mh - 1);
  void worldLimit;
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
