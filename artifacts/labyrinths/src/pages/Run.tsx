import { useEffect, useRef, useState, useCallback } from "react";
import { useParams, useLocation, Link } from "wouter";
import {
  useGetRun,
  useCompleteRun,
  useRateRun,
  useListMyItems,
  useGetCurrentPlayer,
  getGetRunQueryKey,
  getGetBalancesQueryKey,
  getGetLabyrinthQueryKey,
  getListMyItemsQueryKey,
} from "@workspace/api-client-react";
import type { Run as RunType, ChamberLayout, ItemStats, RunSummary } from "@workspace/api-client-react";
import { CoopRunClient } from "@/lib/coop/coopClient";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { motion, AnimatePresence } from "framer-motion";
import { Heart, Swords, Gem, Package, Star, Trophy, Skull, ArrowRight, ArrowUp, Crown, Coins, Wind, Shield as ShieldIcon } from "lucide-react";
import { rarity, biome, fmt, makeIdempotencyKey, effectiveStats } from "@/lib/game";
import { compareItemFor, computeBestInSlotIds, isUpgradeOver } from "@/lib/gear";
import { StatList } from "@/components/StatList";
import { composeLoadoutSprite } from "@/lib/sprite";
import { RUN_SPRITE_NAMES as SPRITE_NAMES } from "@/lib/runSprites";
import { ABILITIES, ART_BASE_CD } from "@/lib/abilities";
import { useCombatMode } from "@/lib/combatMode";
import { Zap, MousePointerClick } from "lucide-react";
import { toast } from "sonner";

// Melee reach/arc tuning: widen base reach and the forward hit cone so a player
// facing an adjacent enemy reliably connects (in both Auto and Manual modes)
// before taking a hit. Ranged attacks are untouched — these only scale the melee
// swing branch.
const MELEE_REACH_MULT = 1.5;
const MELEE_ARC_DOT = 0.2;

type Phase = "loading" | "playing" | "summary";
type EnemyKind = "grunt" | "ranged" | "charger" | "slammer";
type Element = "physical" | "fire" | "lightning" | "frost";

interface Entity {
  id: string;
  type: string;
  kind: EnemyKind;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  damage: number;
  speed: number;
  radius: number;
  alive: boolean;
  variant?: string;
  hitFlash: number;
  hurtStart: number;
  deathStart: number;
  vx: number;
  vy: number;
  burn: number;
  chill: number;
  shock: number;
  stun: number;
  tele: number;
  teleMax: number;
  teleType: "" | "shot" | "lunge" | "slam";
  atkCd: number;
  lungeUntil: number;
  lungeHit: boolean;
  sx: number;
  sy: number;
}

interface Projectile {
  x: number; y: number; vx: number; vy: number;
  dmg: number; radius: number; life: number;
  element: Element; chain: number; hitIds: string[];
}
interface EnemyShot { x: number; y: number; vx: number; vy: number; dmg: number; radius: number; life: number; }
interface Particle { x: number; y: number; vx: number; vy: number; life: number; maxLife: number; color: string; size: number; }
interface AfterImage { x: number; y: number; lpcRow: number; lpcFrame: number; life: number; }
interface SlashFx { x: number; y: number; angle: number; reach: number; t: number; element: Element; big: boolean; }
interface VisualFx {
  kind: "crescent" | "shockwave" | "bolt" | "blink" | "burst";
  x: number; y: number; tx: number; ty: number;
  angle: number; reach: number;
  t: number; speed: number;
  element: Element; variant: string; seed: number;
}
const easeOut = (x: number) => 1 - Math.pow(1 - x, 3);

interface Art {
  key: string;
  name: string;
  kind: "cleave" | "nova" | "chain" | "shield" | "blink" | "buff";
  element: Element;
  cd: number;
  cdUntil: number;
}

interface GameState {
  px: number; py: number; php: number; pmaxhp: number;
  pradius: number; pspeed: number; patk: number; pcrit: number; prange: number;
  patkInterval: number; pdefense: number; lastAttack: number;
  adx: number; ady: number; facing: number;
  dashUntil: number; iframeUntil: number; dashCdUntil: number; dashCd: number; dashDirX: number; dashDirY: number;
  moving: boolean; attackAnimUntil: number; attackAnimStart: number; castAnimUntil: number; castAnimStart: number; hurtFlashUntil: number; hurtAnimStart: number; deathStart: number;
  shieldUntil: number; lootBuffUntil: number; reviveAvailable: boolean;
  attackShape: "melee" | "ranged"; weaponElement: Element;
  arts: { q: Art | null; e: Art | null; r: Art | null };
  chamberIdx: number;
  enemies: Entity[];
  pickups: Entity[];
  hazards: Entity[];
  pproj: Projectile[];
  eproj: EnemyShot[];
  parts: Particle[];
  portal: { x: number; y: number; radius: number } | null;
  obstacles: { x: number; y: number; w: number; h: number }[];
  hazardZones: { x: number; y: number; w: number; h: number }[];
  doors: { x: number; y: number; w: number; h: number }[];
  doorsOpen: boolean;
  tiles: { cols: number; rows: number; cell: number; data: string } | null;
  worldW: number; worldH: number; unit: number;
  enemiesDefeated: number; nodesHarvested: number; chestsOpened: number;
  bossDefeated: boolean; damageTaken: number; startTime: number;
  slashes: SlashFx[];
  fx: VisualFx[];
  afterimages: AfterImage[];
  shieldKey: string;
  floats: { x: number; y: number; text: string; t: number; color: string }[];
  shake: number; hitstopUntil: number;
}

function statVal(s: ItemStats | undefined, k: keyof ItemStats): number {
  return s?.[k] ?? 0;
}

function mapElement(dt?: string): Element {
  if (dt === "fire") return "fire";
  if (dt === "lightning") return "lightning";
  if (dt === "frost" || dt === "ice") return "frost";
  return "physical";
}
const ELEMENT_COLOR: Record<Element, string> = {
  physical: "#fef3c7", fire: "#fb923c", lightning: "#facc15", frost: "#7dd3fc",
};

function enemySprite(kind: EnemyKind): string {
  if (kind === "ranged") return "enemy_ranged";
  if (kind === "charger") return "enemy_elite";
  if (kind === "slammer") return "enemy_boss";
  return "enemy_grunt";
}

export default function Run() {
  const params = useParams();
  const id = Number(params.id);
  const [, setLocation] = useLocation();
  const qc = useQueryClient();

  const { data: run, isLoading } = useGetRun(id, { query: { enabled: !!id, queryKey: getGetRunQueryKey(id) } });
  // Inventory powers the loot-popup comparisons: each drop is a real owned item,
  // so we match it back to its PlayerItem and reuse the exact Loadout logic.
  const { data: myItems } = useListMyItems();
  const complete = useCompleteRun();
  const rate = useRateRun();

  // Device-local combat scheme chosen at run setup. Auto-firing vs manual aim.
  const [combatMode] = useCombatMode();
  const combatModeRef = useRef(combatMode);
  useEffect(() => { combatModeRef.current = combatMode; }, [combatMode]);

  const [phase, setPhase] = useState<Phase>("loading");
  const [summary, setSummary] = useState<RunSummary | null>(null);
  const [hud, setHud] = useState({
    hp: 100, maxHp: 100, chamber: 1, totalChambers: 1, enemies: 0, nodes: 0, chests: 0, remaining: 0,
    arts: [] as { slot: string; name: string; frac: number }[],
    dashFrac: 0, shield: false, mode: "auto" as "auto" | "manual",
  });

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stateRef = useRef<GameState | null>(null);
  const keysRef = useRef<Record<string, boolean>>({});
  const pointerRef = useRef<{ active: boolean; x: number; y: number }>({ active: false, x: 0, y: 0 });
  const aimRef = useRef<{ x: number; y: number; lastMove: number }>({ x: 0, y: 0, lastMove: 0 });
  // Manual-mode attack input: true while the mouse button or F key is held, so
  // holding fires repeatedly at the attack-speed cap (rate-limited in the loop).
  const attackHeldRef = useRef(false);
  const actionsRef = useRef<string[]>([]);
  const spritesRef = useRef<Record<string, HTMLImageElement>>({});
  const playerCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const composedSpriteRef = useRef<OffscreenCanvas | null>(null);
  const rafRef = useRef<number>(0);
  const finishedRef = useRef(false);

  // Co-op session: real-time link to teammates sharing this run. Null in solo runs.
  const { data: me } = useGetCurrentPlayer();
  const coopRef = useRef<CoopRunClient | null>(null);
  const coopRenderRef = useRef<Map<number, { rx: number; ry: number; frame: number }>>(new Map());
  const lastCoopSendRef = useRef(0);
  const downSentRef = useRef(false);

  // Rating
  const [stars, setStars] = useState(5);
  const [comment, setComment] = useState("");
  const [difficultyVote, setDifficultyVote] = useState<"too_easy" | "balanced" | "brutal">("balanced");
  const [rated, setRated] = useState(false);

  // Preload sprites once
  useEffect(() => {
    const map: Record<string, HTMLImageElement> = {};
    for (const n of SPRITE_NAMES) {
      const img = new Image();
      img.src = `${import.meta.env.BASE_URL}game/${n}.png`;
      map[n] = img;
    }
    spritesRef.current = map;
  }, []);

  const buildArts = useCallback((run: RunType): GameState["arts"] => {
    const slots = run.loadout?.slots;
    const cs = run.loadout?.combatStats;
    const cdr = statVal(cs, "cooldownReduction");
    // Abilities come solely from the two equipped Ability Stone slots.
    const sources = [slots?.abilityStone, slots?.abilityStone2];
    const keys: string[] = [];
    for (const it of sources) {
      const k = it?.template.abilityKey;
      if (k && ABILITIES[k] && !keys.includes(k)) keys.push(k);
    }
    const make = (k?: string): Art | null => {
      if (!k) return null;
      const def = ABILITIES[k];
      const baseCd = def.cd ?? ART_BASE_CD[def.kind];
      return { key: k, name: def.name, kind: def.kind, element: def.element, cd: Math.round(baseCd * (1 - cdr / 200)), cdUntil: 0 };
    };
    return { q: make(keys[0]), e: make(keys[1]), r: make(keys[2]) };
  }, []);

  const buildChamber = useCallback((run: RunType, idx: number): GameState => {
    const chambers = run.chambers ?? [];
    const ch: ChamberLayout = chambers[idx];
    const cs = run.loadout?.combatStats;
    const worldW = ch?.width || 800;
    const worldH = ch?.height || 500;
    const unit = Math.min(worldW, worldH);

    const prev = stateRef.current;
    const pmaxhp = 100 + statVal(cs, "health");
    const start = ch?.spawns.find((s) => s.type === "player_start");

    const weapon = run.loadout?.slots?.weapon?.template;
    const attackShape: "melee" | "ranged" = weapon?.category === "ranged" ? "ranged" : "melee";
    const weaponElement = mapElement(weapon?.damageType);

    const enemies: Entity[] = [];
    const pickups: Entity[] = [];
    const hazards: Entity[] = [];
    let portal: GameState["portal"] = null;
    let gruntIdx = 0;

    for (const sp of ch?.spawns ?? []) {
      const base: Omit<Entity, "type" | "kind"> = {
        id: sp.id, x: sp.x, y: sp.y, hp: sp.hp ?? 30, maxHp: sp.hp ?? 30,
        damage: sp.damage ?? 6, speed: (sp.speed ?? unit * 0.0025), radius: unit * 0.022, alive: true, variant: sp.variant, hitFlash: 0, hurtStart: 0, deathStart: 0,
        vx: 0, vy: 0, burn: 0, chill: 0, shock: 0, stun: 0, tele: 0, teleMax: 0, teleType: "", atkCd: 800, lungeUntil: 0, lungeHit: false, sx: 0, sy: 0,
      };
      if (sp.type === "enemy") {
        const ranged = sp.variant === "ranged" || sp.variant === "caster" || gruntIdx++ % 3 === 2;
        enemies.push({ ...base, type: "enemy", kind: ranged ? "ranged" : "grunt" });
      } else if (sp.type === "elite") {
        enemies.push({ ...base, type: "elite", kind: "charger", radius: unit * 0.03, hp: sp.hp ?? 60, maxHp: sp.hp ?? 60 });
      } else if (sp.type === "boss") {
        enemies.push({ ...base, type: "boss", kind: "slammer", radius: unit * 0.045, hp: sp.hp ?? 200, maxHp: sp.hp ?? 200 });
      } else if (sp.type === "node") pickups.push({ ...base, type: "node", kind: "grunt", radius: unit * 0.02 });
      else if (sp.type === "chest") pickups.push({ ...base, type: "chest", kind: "grunt", radius: unit * 0.024 });
      else if (sp.type === "hazard") hazards.push({ ...base, type: "hazard", kind: "grunt", radius: unit * 0.035 });
      else if (sp.type === "portal") portal = { x: sp.x, y: sp.y, radius: unit * 0.04 };
    }
    if (!portal) portal = { x: worldW - unit * 0.08, y: worldH / 2, radius: unit * 0.04 };

    const moveSpeed = statVal(cs, "moveSpeed");
    return {
      px: start?.x ?? unit * 0.08,
      py: start?.y ?? worldH / 2,
      php: prev ? prev.php : pmaxhp,
      pmaxhp,
      pradius: unit * 0.025,
      pspeed: unit * 0.006 * (1 + moveSpeed / 150),
      patk: 12 + statVal(cs, "attack"),
      pcrit: statVal(cs, "critChance"),
      prange: unit * 0.05 + statVal(cs, "range") * (unit * 0.0008),
      patkInterval: Math.max(220, 720 - statVal(cs, "attackSpeed") * 7) * (1 - statVal(cs, "cooldownReduction") / 200),
      pdefense: statVal(cs, "defense"),
      lastAttack: 0,
      adx: 1, ady: 0, facing: 1,
      dashUntil: 0, iframeUntil: 0, dashCdUntil: 0, dashCd: Math.max(650, 1300 - moveSpeed * 8), dashDirX: 1, dashDirY: 0,
      moving: false, attackAnimUntil: 0, attackAnimStart: 0, castAnimUntil: 0, castAnimStart: 0, hurtFlashUntil: 0, hurtAnimStart: 0, deathStart: 0,
      shieldUntil: 0, lootBuffUntil: 0, shieldKey: "",
      reviveAvailable: prev ? prev.reviveAvailable : !!(run.loadout?.slots?.abilityStone?.template.abilityKey === "rekindle" || run.loadout?.slots?.abilityStone2?.template.abilityKey === "rekindle"),
      attackShape, weaponElement,
      arts: prev ? prev.arts : buildArts(run),
      chamberIdx: idx,
      enemies, pickups, hazards, pproj: [], eproj: [], parts: [], portal,
      obstacles: (ch?.obstacles ?? []).map((o) => ({ x: o.x, y: o.y, w: o.width, h: o.height })),
      hazardZones: (ch?.hazardZones ?? []).map((o) => ({ x: o.x, y: o.y, w: o.width, h: o.height })),
      doors: (ch?.doors ?? []).map((o) => ({ x: o.x, y: o.y, w: o.width, h: o.height })),
      doorsOpen: false,
      tiles: ch?.tiles ?? null,
      worldW, worldH, unit,
      enemiesDefeated: prev?.enemiesDefeated ?? 0,
      nodesHarvested: prev?.nodesHarvested ?? 0,
      chestsOpened: prev?.chestsOpened ?? 0,
      bossDefeated: prev?.bossDefeated ?? false,
      damageTaken: prev?.damageTaken ?? 0,
      startTime: prev?.startTime ?? performance.now(),
      slashes: [], fx: [], afterimages: [], floats: [], shake: 0, hitstopUntil: 0,
    };
  }, [buildArts]);

  const finishRun = useCallback(async (cleared: boolean) => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    cancelAnimationFrame(rafRef.current);
    const s = stateRef.current!;
    const timeSeconds = Math.max(1, Math.round((performance.now() - s.startTime) / 1000));
    try {
      const res = await complete.mutateAsync({
        id,
        data: {
          idempotencyKey: makeIdempotencyKey("complete"),
          cleared,
          enemiesDefeated: s.enemiesDefeated,
          nodesHarvested: s.nodesHarvested,
          chestsOpened: s.chestsOpened,
          bossDefeated: s.bossDefeated,
          timeSeconds,
          damageTaken: Math.round(s.damageTaken),
        },
      });
      setSummary(res);
      setPhase("summary");
      qc.invalidateQueries({ queryKey: getGetBalancesQueryKey() });
      qc.invalidateQueries({ queryKey: getGetRunQueryKey(id) });
      // Refresh inventory so the new drops appear as owned items, powering the
      // loot-popup stat deltas and Best-in-Slot flags.
      qc.invalidateQueries({ queryKey: getListMyItemsQueryKey() });
      if (run) qc.invalidateQueries({ queryKey: getGetLabyrinthQueryKey(run.labyrinthId) });
    } catch {
      toast.error("Could not record the run result.");
      setPhase("summary");
    }
  }, [complete, id, qc, run]);

  const advanceOrFinish = useCallback((): boolean => {
    const s = stateRef.current!;
    const chambers = run?.chambers ?? [];
    if (s.chamberIdx + 1 < chambers.length) {
      stateRef.current = buildChamber(run!, s.chamberIdx + 1);
      return false;
    }
    finishRun(true);
    return true;
  }, [run, buildChamber, finishRun]);

  // Init game when run arrives
  useEffect(() => {
    if (!run || phase !== "loading") return;
    if (run.status === "completed" && run.summary) {
      setSummary(run.summary);
      setPhase("summary");
      return;
    }
    stateRef.current = buildChamber(run, 0);
    setPhase("playing");
  }, [run, phase, buildChamber]);

  // Co-op session lifecycle: connect to the shared session layer once we are
  // actually playing a co-op run and know our own user id. Solo runs skip this.
  useEffect(() => {
    if (phase !== "playing" || !run?.coopPartyId || me?.id == null) return;
    const client = new CoopRunClient(me.id);
    coopRef.current = client;
    const s = stateRef.current;
    client.start({
      x: s?.px ?? 0,
      y: s?.py ?? 0,
      facing: s?.facing ?? 1,
      moving: false,
      chamberIndex: s?.chamberIdx ?? 0,
      hp: Math.round(s?.php ?? 1),
      maxHp: Math.round(s?.pmaxhp ?? 1),
    });
    return () => {
      client.stop();
      coopRef.current = null;
      coopRenderRef.current.clear();
    };
  }, [phase, run?.coopPartyId, me?.id]);

  // Compose character sprite from LPC layers when run starts
  useEffect(() => {
    if (!run || phase !== "playing") return;
    let cancelled = false;
    const baseUrl = import.meta.env.BASE_URL as string;
    // Shared compositor — keeps the in-run character identical to the loadout
    // preview. Falls back to player_sheet / player.png when it returns null.
    composeLoadoutSprite(run.loadout?.slots, baseUrl).then((canvas) => {
      if (!cancelled) composedSpriteRef.current = canvas;
    });
    return () => {
      cancelled = true;
      composedSpriteRef.current = null;
    };
  }, [run, phase]);

  // Input listeners
  useEffect(() => {
    const action = new Set([" ", "q", "e", "r"]);
    const down = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      keysRef.current[key] = true;
      if (["arrowup", "arrowdown", "arrowleft", "arrowright", " "].includes(key)) e.preventDefault();
      if (!e.repeat && action.has(key)) actionsRef.current.push(key === " " ? "dash" : key);
    };
    const up = (e: KeyboardEvent) => { keysRef.current[e.key.toLowerCase()] = false; };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); };
  }, []);

  // Game loop
  useEffect(() => {
    if (phase !== "playing") return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    let last = performance.now();

    const circleRectHit = (cx: number, cy: number, r: number, rx: number, ry: number, rw: number, rh: number) => {
      const nx = Math.max(rx, Math.min(cx, rx + rw));
      const ny = Math.max(ry, Math.min(cy, ry + rh));
      return (cx - nx) ** 2 + (cy - ny) ** 2 < r * r;
    };

    const loop = (now: number) => {
      const s = stateRef.current!;
      const sprites = spritesRef.current;
      const realDt = Math.min(33, now - last);
      const dt = realDt / 16.67;
      last = now;
      const DEATH_MS = 950;
      const EHURT_MS = 200;
      const EDEATH_MS = 600;
      const frozen = now < s.hitstopUntil || s.deathStart > 0;

      // Solid collision = static walls/pits plus doors that are still closed
      // (doors stay shut until the chamber's enemies are cleared).
      const hitsSolid = (cx: number, cy: number, r: number) => {
        for (const o of s.obstacles) if (circleRectHit(cx, cy, r, o.x, o.y, o.w, o.h)) return true;
        if (!s.doorsOpen) for (const o of s.doors) if (circleRectHit(cx, cy, r, o.x, o.y, o.w, o.h)) return true;
        return false;
      };

      // If an enemy ends up overlapping a wall/door (knockback, lunge, or a spawn
      // that started embedded), spiral outward to the nearest free spot so it can
      // resume chasing instead of freezing forever.
      const freeFromSolid = (e: Entity) => {
        if (!hitsSolid(e.x, e.y, e.radius)) return;
        const step = Math.max(2, e.radius * 0.5);
        for (let ring = 1; ring <= 24; ring++) {
          const dist = ring * step;
          for (let a = 0; a < 12; a++) {
            const ang = (a / 12) * Math.PI * 2;
            const nx = Math.max(e.radius, Math.min(s.worldW - e.radius, e.x + Math.cos(ang) * dist));
            const ny = Math.max(e.radius, Math.min(s.worldH - e.radius, e.y + Math.sin(ang) * dist));
            if (!hitsSolid(nx, ny, e.radius)) { e.x = nx; e.y = ny; e.vx = 0; e.vy = 0; return; }
          }
        }
      };

      const addParts = (x: number, y: number, n: number, color: string, spread: number) => {
        for (let i = 0; i < n; i++) {
          const a = Math.random() * Math.PI * 2;
          const sp = spread * (0.4 + Math.random() * 0.8);
          s.parts.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 1, maxLife: 1, color, size: s.unit * (0.004 + Math.random() * 0.006) });
        }
      };
      const applyStatus = (e: Entity, el: Element) => {
        if (el === "fire") e.burn = Math.max(e.burn, 1800);
        else if (el === "frost") e.chill = Math.max(e.chill, 1600);
        else if (el === "lightning") e.shock = 220;
      };
      const killEnemy = (e: Entity) => {
        e.alive = false;
        e.deathStart = now;
        s.enemiesDefeated += 1;
        if (e.type === "boss") s.bossDefeated = true;
        addParts(e.x, e.y, e.type === "boss" ? 26 : e.type === "elite" ? 16 : 10, "#fca5a5", s.unit * 0.012);
        s.shake = Math.max(s.shake, e.type === "boss" ? 16 : 6);
        // Co-op: broadcast the kill so teammates clear the same entity. The server
        // keeps the authoritative deduped tally that drives shared rewards.
        coopRef.current?.sendCombat(e.type === "boss" ? "boss" : "enemy", e.id);
      };
      // Apply a kill/harvest a teammate performed: clear the matching entity in
      // our own simulation (no local counter bump — the server tally is the source
      // of truth for co-op rewards) so progression and doors stay in sync.
      const applyRemoteClear = (kind: string, entId: string) => {
        if (kind === "enemy" || kind === "boss") {
          const e = s.enemies.find((x) => x.id === entId && x.alive);
          if (e) {
            e.alive = false;
            e.deathStart = now;
            if (e.type === "boss") s.bossDefeated = true;
            addParts(e.x, e.y, 8, "#fca5a5", s.unit * 0.01);
          }
        } else if (kind === "node" || kind === "chest") {
          const p = s.pickups.find((x) => x.id === entId && x.alive);
          if (p) {
            p.alive = false;
            addParts(p.x, p.y, 8, kind === "node" ? "#5fd97a" : "#f5b942", s.unit * 0.006);
          }
        }
      };
      const hurtEnemy = (e: Entity, dmg: number, el: Element, crit: boolean, kx: number, ky: number, kb: number) => {
        e.hp -= dmg;
        e.hitFlash = 6;
        e.hurtStart = now;
        e.vx += kx * kb; e.vy += ky * kb;
        applyStatus(e, el);
        s.floats.push({ x: e.x, y: e.y - e.radius, text: `${Math.round(dmg)}${crit ? "!" : ""}`, t: 1, color: crit ? "#f59e0b" : ELEMENT_COLOR[el] });
        if (e.hp <= 0) killEnemy(e);
      };
      const hurtPlayer = (raw: number, shake = 5) => {
        if (now < s.iframeUntil) return;
        let dmg = raw * (100 / (100 + s.pdefense));
        if (now < s.shieldUntil) dmg *= 0.4;
        s.php -= dmg; s.damageTaken += dmg;
        s.hurtFlashUntil = now + 240;
        s.hurtAnimStart = now;
        s.shake = Math.max(s.shake, shake);
        if (s.php <= 0 && s.reviveAvailable) {
          s.reviveAvailable = false;
          s.php = s.pmaxhp * 0.5;
          s.iframeUntil = now + 1300;
          s.floats.push({ x: s.px, y: s.py - s.pradius * 2, text: "Rekindle!", t: 1.4, color: "#fb923c" });
          addParts(s.px, s.py, 30, "#fb923c", s.unit * 0.014);
        }
      };

      // Co-op: pull in teammate kills/harvests, then push our own telemetry.
      const coop = coopRef.current;
      if (coop) {
        for (const relay of coop.drainCombat()) {
          if (relay.kind === "enemy" || relay.kind === "boss" || relay.kind === "node" || relay.kind === "chest") {
            applyRemoteClear(relay.kind, relay.id);
          }
        }
        if (now - lastCoopSendRef.current > 80) {
          lastCoopSendRef.current = now;
          coop.sendTelemetry({
            x: Math.round(s.px),
            y: Math.round(s.py),
            facing: s.facing,
            moving: s.moving,
            chamberIndex: s.chamberIdx,
            hp: Math.round(s.php),
            maxHp: Math.round(s.pmaxhp),
          });
        }
      }

      // Movement input direction
      let mx = 0, my = 0;
      const k = keysRef.current;
      if (k["w"] || k["arrowup"]) my -= 1;
      if (k["s"] || k["arrowdown"]) my += 1;
      if (k["a"] || k["arrowleft"]) mx -= 1;
      if (k["d"] || k["arrowright"]) mx += 1;
      if (pointerRef.current.active) {
        const dx = pointerRef.current.x - s.px, dy = pointerRef.current.y - s.py;
        const d = Math.hypot(dx, dy);
        if (d > s.pradius) { mx += dx / d; my += dy / d; }
      }

      // Aim direction. Auto: lock onto the nearest enemy so auto-fire connects.
      // Manual: follow the mouse cursor. Both fall back to the movement vector.
      const mode = combatModeRef.current;
      let nearest: Entity | null = null, nbest = Infinity;
      for (const e of s.enemies) { if (!e.alive) continue; const d = Math.hypot(s.px - e.x, s.py - e.y); if (d < nbest) { nbest = d; nearest = e; } }
      if (mode === "manual") {
        if (aimRef.current.lastMove > 0) {
          const dx = aimRef.current.x - s.px, dy = aimRef.current.y - s.py; const d = Math.hypot(dx, dy) || 1;
          s.adx = dx / d; s.ady = dy / d;
        } else if (mx || my) {
          const d = Math.hypot(mx, my) || 1; s.adx = mx / d; s.ady = my / d;
        }
      } else if (nearest) {
        const dx = nearest.x - s.px, dy = nearest.y - s.py; const d = Math.hypot(dx, dy) || 1;
        s.adx = dx / d; s.ady = dy / d;
      } else if (mx || my) {
        const d = Math.hypot(mx, my) || 1; s.adx = mx / d; s.ady = my / d;
      }
      s.facing = s.adx >= 0 ? 1 : -1;

      // Consume actions
      if (!frozen) {
        for (const a of actionsRef.current) {
          if (a === "dash") {
            if (now >= s.dashCdUntil) {
              let dx = mx, dy = my;
              if (!dx && !dy) { dx = s.adx; dy = s.ady; }
              const d = Math.hypot(dx, dy) || 1;
              s.dashDirX = dx / d; s.dashDirY = dy / d;
              s.dashUntil = now + 180; s.iframeUntil = now + 240; s.dashCdUntil = now + s.dashCd;
              addParts(s.px, s.py, 8, "#fde68a", s.unit * 0.006);
            }
          } else {
            const art = a === "q" ? s.arts.q : a === "e" ? s.arts.e : s.arts.r;
            if (art && now >= art.cdUntil) {
              art.cdUntil = now + art.cd;
              s.castAnimStart = now; s.castAnimUntil = now + 420;
              s.floats.push({ x: s.px, y: s.py - s.pradius * 2, text: art.name, t: 1.2, color: ELEMENT_COLOR[art.element] });
              if (art.kind === "cleave") {
                const reach = s.prange * 1.9;
                const facing = Math.atan2(s.ady, s.adx);
                for (const e of s.enemies) {
                  if (!e.alive) continue;
                  const dx = e.x - s.px, dy = e.y - s.py; const d = Math.hypot(dx, dy);
                  if (d > reach + e.radius) continue;
                  const dot = (dx / (d || 1)) * s.adx + (dy / (d || 1)) * s.ady;
                  if (dot < 0.1) continue;
                  hurtEnemy(e, s.patk * 2.4, art.element, Math.random() * 100 < s.pcrit + 15, dx / (d || 1), dy / (d || 1), s.unit * 0.005);
                }
                s.fx.push({ kind: "crescent", x: s.px, y: s.py, tx: 0, ty: 0, angle: facing, reach, t: 1, speed: 0.05, element: art.element, variant: art.key, seed: Math.random() * 1000 });
                s.fx.push({ kind: "burst", x: s.px, y: s.py, tx: 0, ty: 0, angle: facing, reach: s.pradius * 2.4, t: 1, speed: 0.09, element: art.element, variant: "cast", seed: 0 });
                if (art.element === "fire") for (let i = 0; i < 10; i++) { const a = facing + (Math.random() - 0.5) * 1.7; addParts(s.px + Math.cos(a) * reach * 0.7, s.py + Math.sin(a) * reach * 0.7, 1, i % 2 ? "#fb923c" : "#fde68a", s.unit * 0.006); }
                s.hitstopUntil = now + 75; s.shake = Math.max(s.shake, 9);
              } else if (art.kind === "nova") {
                const reach = s.unit * 0.32;
                for (const e of s.enemies) {
                  if (!e.alive) continue;
                  const dx = e.x - s.px, dy = e.y - s.py; const d = Math.hypot(dx, dy) || 1;
                  if (d > reach + e.radius) continue;
                  e.stun = Math.max(e.stun, 850);
                  hurtEnemy(e, s.patk * 2.0, art.element, false, dx / d, dy / d, s.unit * 0.007);
                }
                s.fx.push({ kind: "shockwave", x: s.px, y: s.py, tx: 0, ty: 0, angle: 0, reach, t: 1, speed: 0.032, element: art.element, variant: "", seed: Math.random() * 1000 });
                for (let i = 0; i < 26; i++) { const a = Math.random() * Math.PI * 2; addParts(s.px + Math.cos(a) * s.pradius, s.py + Math.sin(a) * s.pradius, 1, i % 3 ? "#d6a463" : "#fcd34d", s.unit * 0.016); }
                s.hitstopUntil = now + 90; s.shake = Math.max(s.shake, 15);
              } else if (art.kind === "chain") {
                s.pproj.push({ x: s.px, y: s.py, vx: s.adx * s.unit * 0.015, vy: s.ady * s.unit * 0.015, dmg: s.patk * 1.8, radius: s.unit * 0.016, life: 1400, element: art.element, chain: 3, hitIds: [] });
                s.fx.push({ kind: "burst", x: s.px, y: s.py, tx: 0, ty: 0, angle: 0, reach: s.pradius * 2, t: 1, speed: 0.1, element: art.element, variant: "cast", seed: 0 });
                addParts(s.px, s.py, 8, "#fde047", s.unit * 0.006);
              } else if (art.kind === "shield") {
                s.shieldUntil = now + 4000; s.shieldKey = art.key;
                const col = art.key === "barkskin" ? "#4ade80" : art.key === "sun_ward" ? "#fcd34d" : "#93c5fd";
                s.fx.push({ kind: "burst", x: s.px, y: s.py, tx: 0, ty: 0, angle: 0, reach: s.pradius * 2.6, t: 1, speed: 0.05, element: art.element, variant: "shield_" + art.key, seed: 0 });
                for (let i = 0; i < 18; i++) { const a = (i / 18) * Math.PI * 2; addParts(s.px + Math.cos(a) * s.pradius * 1.4, s.py + Math.sin(a) * s.pradius * 1.4, 1, col, s.unit * 0.006); }
              } else if (art.kind === "blink") {
                let dx = mx, dy = my; if (!dx && !dy) { dx = s.adx; dy = s.ady; }
                const dl = Math.hypot(dx, dy) || 1; const ux = dx / dl, uy = dy / dl;
                const ox = s.px, oy = s.py;
                const dist = s.unit * 0.3;
                const isValid = (cx: number, cy: number) => {
                  if (cx < s.pradius || cx > s.worldW - s.pradius || cy < s.pradius || cy > s.worldH - s.pradius) return false;
                  if (hitsSolid(cx, cy, s.pradius)) return false;
                  return true;
                };
                let nx = ox, ny = oy;
                const steps = 12;
                for (let i = 1; i <= steps; i++) {
                  const cx = ox + ux * dist * (i / steps), cy = oy + uy * dist * (i / steps);
                  if (isValid(cx, cy)) { nx = cx; ny = cy; } else break;
                }
                s.px = nx; s.py = ny; s.iframeUntil = now + 380; s.dashDirX = ux; s.dashDirY = uy;
                const traveled = Math.hypot(nx - ox, ny - oy);
                const mxp = (ox + nx) / 2, myp = (oy + ny) / 2;
                for (const e of s.enemies) {
                  if (!e.alive) continue;
                  if (Math.hypot(e.x - mxp, e.y - myp) < traveled * 0.6 + e.radius) hurtEnemy(e, s.patk * 1.4, art.element, false, ux, uy, s.unit * 0.004);
                }
                s.fx.push({ kind: "blink", x: ox, y: oy, tx: nx, ty: ny, angle: Math.atan2(uy, ux), reach: s.pradius * 2, t: 1, speed: 0.07, element: art.element, variant: "", seed: 0 });
                addParts(ox, oy, 14, "#c4b5fd", s.unit * 0.008); addParts(nx, ny, 14, "#ddd6fe", s.unit * 0.008);
              } else if (art.kind === "buff") {
                s.lootBuffUntil = now + 8000;
                s.fx.push({ kind: "burst", x: s.px, y: s.py, tx: 0, ty: 0, angle: 0, reach: s.pradius * 3, t: 1, speed: 0.045, element: art.element, variant: "buff", seed: 0 });
                for (let i = 0; i < 16; i++) addParts(s.px + (Math.random() - 0.5) * s.pradius * 2, s.py + s.pradius, 1, i % 2 ? "#fcd34d" : "#fde68a", s.unit * 0.008);
              }
            }
          }
        }
      }
      actionsRef.current = [];

      if (!frozen) {
        // Player movement (with dash)
        const dashing = now < s.dashUntil;
        let dirx = mx, diry = my;
        let speed = s.pspeed;
        if (dashing) { dirx = s.dashDirX; diry = s.dashDirY; speed = s.pspeed * 3.4; }
        const ml = Math.hypot(dirx, diry);
        s.moving = ml > 0;
        if (ml > 0) {
          const nx = s.px + (dirx / ml) * speed * dt;
          const ny = s.py + (diry / ml) * speed * dt;
          let bx = false, by = false;
          if (hitsSolid(nx, s.py, s.pradius)) bx = true;
          if (hitsSolid(s.px, ny, s.pradius)) by = true;
          if (!bx) s.px = Math.max(s.pradius, Math.min(s.worldW - s.pradius, nx));
          if (!by) s.py = Math.max(s.pradius, Math.min(s.worldH - s.pradius, ny));
          if (dashing) {
            if (Math.random() < 0.6) addParts(s.px, s.py, 1, "#fde68a", s.unit * 0.003);
            if (Math.random() < 0.55) {
              let aiRow: number;
              if (Math.abs(s.ady) > Math.abs(s.adx)) { aiRow = s.ady < 0 ? 8 : 10; } else { aiRow = s.adx >= 0 ? 11 : 9; }
              if (!Array.isArray(s.afterimages)) s.afterimages = [];
              s.afterimages.push({ x: s.px, y: s.py, lpcRow: aiRow, lpcFrame: Math.floor(now / 100) % 9, life: 1 });
            }
          }
        }

        // Enemy update
        for (const e of s.enemies) {
          if (!e.alive) continue;
          // Un-stick: if this enemy is somehow overlapping a solid, nudge it out
          // before it tries to move (otherwise every move is rejected forever).
          freeFromSolid(e);
          if (e.hitFlash > 0) e.hitFlash -= dt;
          // Status
          if (e.burn > 0) { e.burn -= realDt; const tick = s.patk * 0.014 * dt; e.hp -= tick; if (Math.random() < 0.08) addParts(e.x, e.y, 1, "#fb923c", s.unit * 0.004); if (e.hp <= 0) { killEnemy(e); continue; } }
          let slow = 1;
          if (e.chill > 0) { e.chill -= realDt; slow = 0.5; }
          if (e.shock > 0) e.shock -= realDt;
          if (e.stun > 0) e.stun -= realDt;
          // Knockback (and active lunges) — resolve against solids with an
          // axis-separated slide so the enemy scrapes along walls instead of
          // being shoved inside them.
          if (Math.abs(e.vx) > 0.01 || Math.abs(e.vy) > 0.01) {
            const nx = Math.max(e.radius, Math.min(s.worldW - e.radius, e.x + e.vx * dt));
            const ny = Math.max(e.radius, Math.min(s.worldH - e.radius, e.y + e.vy * dt));
            if (!hitsSolid(nx, e.y, e.radius)) e.x = nx; else e.vx = 0;
            if (!hitsSolid(e.x, ny, e.radius)) e.y = ny; else e.vy = 0;
            e.vx *= 0.82; e.vy *= 0.82;
          }
          const stunned = e.stun > 0;
          const dx = s.px - e.x, dy = s.py - e.y;
          const d = Math.hypot(dx, dy) || 1;
          const ux = dx / d, uy = dy / d;

          if (!stunned) {
            // Telegraph resolution
            if (e.tele > 0) {
              e.tele -= realDt;
              if (e.tele <= 0) {
                if (e.teleType === "shot") {
                  const sd = Math.hypot(s.px - e.x, s.py - e.y) || 1;
                  s.eproj.push({ x: e.x, y: e.y, vx: ((s.px - e.x) / sd) * s.unit * 0.009, vy: ((s.py - e.y) / sd) * s.unit * 0.009, dmg: e.damage * 1.3, radius: s.unit * 0.014, life: 2600 });
                } else if (e.teleType === "lunge") {
                  const ld = Math.hypot(e.sx - e.x, e.sy - e.y) || 1;
                  e.vx = ((e.sx - e.x) / ld) * s.unit * 0.03; e.vy = ((e.sy - e.y) / ld) * s.unit * 0.03;
                  e.lungeUntil = now + 320; e.lungeHit = false;
                } else if (e.teleType === "slam") {
                  const sr = s.unit * 0.16;
                  if (Math.hypot(s.px - e.sx, s.py - e.sy) < sr) hurtPlayer(e.damage * 1.6, 14);
                  addParts(e.sx, e.sy, 22, "#f87171", s.unit * 0.016);
                  s.shake = Math.max(s.shake, 12);
                }
                e.teleType = "";
              }
            } else if (e.lungeUntil > now) {
              // mid-lunge: contact handled below
            } else {
              // Behavior
              const move = (factor: number) => {
                const nx = e.x + ux * e.speed * slow * factor * dt, ny = e.y + uy * e.speed * slow * factor * dt;
                if (!hitsSolid(nx, ny, e.radius)) { e.x = nx; e.y = ny; }
              };
              if (e.kind === "grunt") { move(1); }
              else if (e.kind === "ranged") {
                const want = s.unit * 0.3;
                if (d < want * 0.8) move(-1.1);
                else if (d > want * 1.25) move(1);
                if (now >= e.atkCd && d < s.unit * 0.55) { e.tele = 560; e.teleMax = 560; e.teleType = "shot"; e.atkCd = now + 2200; }
              } else if (e.kind === "charger") {
                if (d > s.unit * 0.42) move(0.85);
                else if (now >= e.atkCd) { e.tele = 680; e.teleMax = 680; e.teleType = "lunge"; e.sx = s.px; e.sy = s.py; e.atkCd = now + 2600; }
                else move(0.4);
              } else if (e.kind === "slammer") {
                if (d > s.unit * 0.1) move(0.6);
                if (now >= e.atkCd) { e.tele = 900; e.teleMax = 900; e.teleType = "slam"; e.sx = s.px; e.sy = s.py; e.atkCd = now + 3000; }
              }
            }
          }

          // Contact damage
          if (d < e.radius + s.pradius) {
            if (e.lungeUntil > now && !e.lungeHit) { hurtPlayer(e.damage * 1.4, 9); e.lungeHit = true; }
            else if (e.kind !== "ranged") hurtPlayer(e.damage * 0.045 * dt, 3);
          }

          // Hazard floors damage enemies too (whoever stands on them)
          {
            let onHazard = false;
            for (const h of s.hazards) {
              if (Math.hypot(e.x - h.x, e.y - h.y) < h.radius + e.radius) { onHazard = true; break; }
            }
            if (!onHazard) {
              for (const z of s.hazardZones) {
                if (circleRectHit(e.x, e.y, e.radius * 0.7, z.x, z.y, z.w, z.h)) { onHazard = true; break; }
              }
            }
            if (onHazard) {
              e.hp -= e.maxHp * 0.0006 * dt;
              if (Math.random() < 0.06) addParts(e.x, e.y, 1, "#f87171", s.unit * 0.004);
              if (e.hp <= 0) { killEnemy(e); continue; }
            }
          }
        }

        // Hazards (point hazards + handcrafted hazard-floor zones) — player
        for (const h of s.hazards) {
          if (Math.hypot(s.px - h.x, s.py - h.y) < h.radius + s.pradius) hurtPlayer(0.2 * dt, 2);
        }
        for (const z of s.hazardZones) {
          if (circleRectHit(s.px, s.py, s.pradius * 0.7, z.x, z.y, z.w, z.h)) { hurtPlayer(0.22 * dt, 2); break; }
        }

        // Player projectiles
        for (const p of s.pproj) {
          p.x += p.vx * dt; p.y += p.vy * dt; p.life -= realDt;
          for (const e of s.enemies) {
            if (!e.alive || p.hitIds.includes(e.id)) continue;
            if (Math.hypot(p.x - e.x, p.y - e.y) < e.radius + p.radius) {
              const ud = Math.hypot(p.vx, p.vy) || 1;
              hurtEnemy(e, p.dmg, p.element, Math.random() * 100 < s.pcrit, p.vx / ud, p.vy / ud, s.unit * 0.003);
              p.hitIds.push(e.id);
              if (p.chain > 0) {
                p.chain -= 1;
                let next: Entity | null = null, nb = Infinity;
                for (const e2 of s.enemies) { if (!e2.alive || p.hitIds.includes(e2.id)) continue; const dd = Math.hypot(p.x - e2.x, p.y - e2.y); if (dd < s.unit * 0.35 && dd < nb) { nb = dd; next = e2; } }
                if (next) { const nd = Math.hypot(next.x - p.x, next.y - p.y) || 1; p.vx = ((next.x - p.x) / nd) * ud; p.vy = ((next.y - p.y) / nd) * ud; p.life = Math.max(p.life, 400); s.fx.push({ kind: "bolt", x: p.x, y: p.y, tx: next.x, ty: next.y, angle: 0, reach: 0, t: 1, speed: 0.13, element: p.element, variant: "", seed: Math.random() * 1000 }); addParts(p.x, p.y, 5, "#fef08a", s.unit * 0.006); }
                else p.life = 0;
              } else { p.life = 0; }
              break;
            }
          }
          if (p.x < 0 || p.y < 0 || p.x > s.worldW || p.y > s.worldH) p.life = 0;
          else if (hitsSolid(p.x, p.y, p.radius)) p.life = 0;
        }
        s.pproj = s.pproj.filter((p) => p.life > 0);

        // Enemy projectiles
        for (const p of s.eproj) {
          p.x += p.vx * dt; p.y += p.vy * dt; p.life -= realDt;
          if (Math.hypot(p.x - s.px, p.y - s.py) < s.pradius + p.radius) { hurtPlayer(p.dmg, 7); p.life = 0; }
          if (p.x < 0 || p.y < 0 || p.x > s.worldW || p.y > s.worldH) p.life = 0;
          else if (hitsSolid(p.x, p.y, p.radius)) p.life = 0;
        }
        s.eproj = s.eproj.filter((p) => p.life > 0);

        // Attack. Auto mode fires on its own at the nearest enemy; Manual mode
        // fires only while the player holds the attack input (mouse / F key) and
        // aims with the cursor. Both share the same attack-speed cap.
        const wantAttack = mode === "auto"
          ? !!nearest
          : (attackHeldRef.current || !!keysRef.current["f"]);
        if (now - s.lastAttack > s.patkInterval && wantAttack) {
          s.lastAttack = now;
          s.attackAnimStart = now; s.attackAnimUntil = now + Math.min(260, s.patkInterval * 0.7);
          const crit = Math.random() * 100 < s.pcrit;
          if (s.attackShape === "ranged") {
            // Range stat governs how far the arrow flies: life = travel time so a
            // longer-ranged bow reaches across the room while a short one falls short.
            const life = Math.max(450, (s.prange / s.unit) * 9000);
            s.pproj.push({ x: s.px, y: s.py, vx: s.adx * s.unit * 0.013, vy: s.ady * s.unit * 0.013, dmg: s.patk * (crit ? 2 : 1), radius: s.unit * 0.012, life, element: s.weaponElement, chain: 0, hitIds: [] });
          } else {
            // Widened melee: longer reach + a broader forward arc so a facing
            // adjacent enemy reliably connects (see MELEE_REACH_MULT/ARC_DOT).
            const reach = s.prange * MELEE_REACH_MULT;
            let hitAny = false;
            for (const e of s.enemies) {
              if (!e.alive) continue;
              const dx = e.x - s.px, dy = e.y - s.py; const d = Math.hypot(dx, dy);
              if (d > reach + e.radius) continue;
              const dot = (dx / (d || 1)) * s.adx + (dy / (d || 1)) * s.ady;
              if (dot < MELEE_ARC_DOT) continue;
              hurtEnemy(e, s.patk * (crit ? 2 : 1), s.weaponElement, crit, dx / (d || 1), dy / (d || 1), s.unit * 0.0025);
              hitAny = true;
            }
            s.slashes.push({ x: s.px, y: s.py, angle: Math.atan2(s.ady, s.adx), reach, t: 1, element: s.weaponElement, big: false });
            if (hitAny && crit) { s.hitstopUntil = now + 45; s.shake = Math.max(s.shake, 4); }
          }
        }

        // Pickups
        for (const p of s.pickups) {
          if (!p.alive) continue;
          if (Math.hypot(s.px - p.x, s.py - p.y) < p.radius + s.pradius) {
            p.alive = false;
            if (p.type === "node") { s.nodesHarvested += 1; s.floats.push({ x: p.x, y: p.y - p.radius, text: "+harvest", t: 1, color: "#5fd97a" }); addParts(p.x, p.y, 12, "#5fd97a", s.unit * 0.008); }
            else { s.chestsOpened += 1; s.floats.push({ x: p.x, y: p.y - p.radius, text: "+chest", t: 1, color: "#f5b942" }); addParts(p.x, p.y, 14, "#f5b942", s.unit * 0.008); }
            // Co-op: broadcast the harvest so teammates clear the same node/chest;
            // the server keeps the deduped shared tally for reward settlement.
            coopRef.current?.sendCombat(p.type === "node" ? "node" : "chest", p.id);
          }
        }

        // Particles
        for (const pa of s.parts) { pa.x += pa.vx * dt; pa.y += pa.vy * dt; pa.vx *= 0.92; pa.vy *= 0.92; pa.life -= 0.03 * dt; }
        s.parts = s.parts.filter((pa) => pa.life > 0);
      }

      const enemiesLeft = s.enemies.filter((e) => e.alive).length;
      const portalActive = enemiesLeft === 0;
      if (portalActive && !s.doorsOpen) s.doorsOpen = true;

      // Portal
      if (!frozen && s.portal && portalActive) {
        if (Math.hypot(s.px - s.portal.x, s.py - s.portal.y) < s.portal.radius + s.pradius) {
          const finished = advanceOrFinish();
          if (!finished) rafRef.current = requestAnimationFrame(loop);
          return;
        }
      }
      // Death — play a collapse beat before handing off to the run-over UI.
      if (s.php <= 0) {
        s.php = 0;
        if (s.deathStart === 0) {
          s.deathStart = now;
          s.shake = Math.max(s.shake, 10);
          // Co-op: tell teammates we went down so the party UI/server can reflect it
          // while the remaining members carry on (graceful member-drop handling).
          if (!downSentRef.current) {
            downSentRef.current = true;
            coopRef.current?.sendCombat("down", String(me?.id ?? ""));
          }
        }
        if (now - s.deathStart >= DEATH_MS) { finishRun(false); return; }
      }

      // ---- Render ----
      const dpr = window.devicePixelRatio || 1;
      const cw = canvas.clientWidth, chh = canvas.clientHeight;
      if (canvas.width !== cw * dpr || canvas.height !== chh * dpr) { canvas.width = cw * dpr; canvas.height = chh * dpr; }
      const scale = Math.min(cw / s.worldW, chh / s.worldH);
      let offX = (cw - s.worldW * scale) / 2;
      let offY = (chh - s.worldH * scale) / 2;
      if (s.shake > 0.2) { offX += (Math.random() - 0.5) * s.shake; offY += (Math.random() - 0.5) * s.shake; s.shake *= 0.86; } else s.shake = 0;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, cw, chh);
      ctx.save();
      ctx.translate(offX, offY);
      ctx.scale(scale, scale);

      const ch = (run?.chambers ?? [])[s.chamberIdx];
      const accent = ch?.accentColor || "#f5b942";
      const drawSprite = (img: HTMLImageElement | undefined, x: number, y: number, size: number, flip = 1, alpha = 1) => {
        if (!img || !img.complete || img.naturalWidth === 0) return false;
        ctx.save(); ctx.globalAlpha = alpha; ctx.translate(x, y); if (flip < 0) ctx.scale(-1, 1);
        ctx.drawImage(img, -size / 2, -size / 2, size, size); ctx.restore(); return true;
      };
      // LPC OffscreenCanvas blit: 64px cells, walk rows 8-11 (up/left/down/right), 9 frames each.
      const LPC_CELL = 64;
      const drawLpcFrame = (composed: OffscreenCanvas, x: number, y: number, drawSize: number, alpha: number, lpcRow: number, lpcFrame: number, tint: number): boolean => {
        const sx = lpcFrame * LPC_CELL, sy = lpcRow * LPC_CELL;
        ctx.save(); ctx.globalAlpha = alpha; ctx.translate(x, y);
        if (tint > 0) {
          let tcv = playerCanvasRef.current;
          if (!tcv) { tcv = document.createElement("canvas"); playerCanvasRef.current = tcv; }
          if (tcv.width !== LPC_CELL) tcv.width = LPC_CELL;
          if (tcv.height !== LPC_CELL) tcv.height = LPC_CELL;
          const tctx = tcv.getContext("2d");
          if (tctx) {
            tctx.clearRect(0, 0, LPC_CELL, LPC_CELL);
            tctx.drawImage(composed, sx, sy, LPC_CELL, LPC_CELL, 0, 0, LPC_CELL, LPC_CELL);
            tctx.globalCompositeOperation = "source-atop";
            tctx.fillStyle = `rgba(255,70,70,${tint})`;
            tctx.fillRect(0, 0, LPC_CELL, LPC_CELL);
            tctx.globalCompositeOperation = "source-over";
            ctx.drawImage(tcv, -drawSize / 2, -drawSize / 2, drawSize, drawSize);
          }
        } else {
          ctx.drawImage(composed, sx, sy, LPC_CELL, LPC_CELL, -drawSize / 2, -drawSize / 2, drawSize, drawSize);
        }
        ctx.restore(); return true;
      };

      // Player sheets (side/up/down) share one geometry contract: 4 cols x 4 rows of
      // 256x320 cells, rows = [idle, run, attack, dash]. Keep new art on this grid.
      const PLAYER_CELL_W = 256, PLAYER_CELL_H = 320;
      const drawPlayerSheet = (sheet: HTMLImageElement | undefined, x: number, y: number, drawH: number, flip: number, alpha: number, row: number, frame: number, tint: number) => {
        if (!sheet || !sheet.complete || sheet.naturalWidth === 0) return false;
        const sx = frame * PLAYER_CELL_W, sy = row * PLAYER_CELL_H;
        const drawW = drawH * (PLAYER_CELL_W / PLAYER_CELL_H);
        ctx.save(); ctx.globalAlpha = alpha; ctx.translate(x, y); if (flip < 0) ctx.scale(-1, 1);
        if (tint > 0) {
          let tcv = playerCanvasRef.current;
          if (!tcv) { tcv = document.createElement("canvas"); playerCanvasRef.current = tcv; }
          if (tcv.width !== PLAYER_CELL_W) tcv.width = PLAYER_CELL_W;
          if (tcv.height !== PLAYER_CELL_H) tcv.height = PLAYER_CELL_H;
          const tctx = tcv.getContext("2d");
          if (tctx) {
            tctx.clearRect(0, 0, PLAYER_CELL_W, PLAYER_CELL_H);
            tctx.drawImage(sheet, sx, sy, PLAYER_CELL_W, PLAYER_CELL_H, 0, 0, PLAYER_CELL_W, PLAYER_CELL_H);
            tctx.globalCompositeOperation = "source-atop";
            tctx.fillStyle = `rgba(255,70,70,${tint})`;
            tctx.fillRect(0, 0, PLAYER_CELL_W, PLAYER_CELL_H);
            tctx.globalCompositeOperation = "source-over";
            ctx.drawImage(tcv, -drawW / 2, -drawH / 2, drawW, drawH);
          }
        } else {
          ctx.drawImage(sheet, sx, sy, PLAYER_CELL_W, PLAYER_CELL_H, -drawW / 2, -drawH / 2, drawW, drawH);
        }
        ctx.restore(); return true;
      };

      // Floor
      const floorImg = sprites[`floor_${run?.biome ?? "sunlit_ruins"}`] ?? sprites["floor_sunlit_ruins"];
      if (floorImg && floorImg.complete && floorImg.naturalWidth > 0) {
        const tile = s.unit * 0.34;
        for (let x = 0; x < s.worldW; x += tile) for (let y = 0; y < s.worldH; y += tile) ctx.drawImage(floorImg, x, y, tile, tile);
        const tint = ctx.createRadialGradient(s.worldW * 0.5, s.worldH * 0.4, 0, s.worldW * 0.5, s.worldH * 0.5, s.worldW * 0.8);
        tint.addColorStop(0, "rgba(255,255,255,0.12)"); tint.addColorStop(1, accent + "22");
        ctx.fillStyle = tint; ctx.fillRect(0, 0, s.worldW, s.worldH);
      } else {
        const grad = ctx.createRadialGradient(s.worldW * 0.4, s.worldH * 0.3, 0, s.worldW * 0.5, s.worldH * 0.5, s.worldW);
        grad.addColorStop(0, "#fff8e7"); grad.addColorStop(1, accent + "33");
        ctx.fillStyle = grad; ctx.fillRect(0, 0, s.worldW, s.worldH);
        ctx.strokeStyle = "rgba(0,0,0,0.05)"; ctx.lineWidth = 1;
        const gridStep = s.unit / 12;
        for (let x = 0; x < s.worldW; x += gridStep) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, s.worldH); ctx.stroke(); }
        for (let y = 0; y < s.worldH; y += gridStep) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(s.worldW, y); ctx.stroke(); }
      }
      // vignette
      const vig = ctx.createRadialGradient(s.worldW / 2, s.worldH / 2, s.unit * 0.4, s.worldW / 2, s.worldH / 2, s.unit * 0.95);
      vig.addColorStop(0, "transparent"); vig.addColorStop(1, "rgba(20,10,0,0.28)");
      ctx.fillStyle = vig; ctx.fillRect(0, 0, s.worldW, s.worldH);

      // Handcrafted tile overlay (walls / hazard floors / water / pits / doors / decor)
      if (s.tiles) {
        const { cols, rows, cell, data } = s.tiles;
        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            const tch = data[r * cols + c];
            if (!tch || tch === ".") continue;
            const x = c * cell, y = r * cell;
            if (tch === "#") {
              ctx.fillStyle = "rgba(40,30,20,0.92)"; ctx.fillRect(x, y, cell, cell);
              ctx.fillStyle = "rgba(255,255,255,0.06)"; ctx.fillRect(x, y, cell, cell * 0.2);
              ctx.strokeStyle = "rgba(0,0,0,0.35)"; ctx.lineWidth = 1; ctx.strokeRect(x + 0.5, y + 0.5, cell - 1, cell - 1);
            } else if (tch === "o") {
              const pg = ctx.createRadialGradient(x + cell / 2, y + cell / 2, 2, x + cell / 2, y + cell / 2, cell * 0.65);
              pg.addColorStop(0, "#04060a"); pg.addColorStop(1, "rgba(12,12,18,0.25)");
              ctx.fillStyle = pg; ctx.fillRect(x, y, cell, cell);
            } else if (tch === "^") {
              const pulse = 0.5 + Math.sin(now / 240 + (c + r)) * 0.5;
              ctx.fillStyle = `rgba(239,68,68,${0.18 + pulse * 0.16})`; ctx.fillRect(x, y, cell, cell);
              ctx.strokeStyle = "rgba(248,113,113,0.5)"; ctx.lineWidth = 1; ctx.strokeRect(x + 1, y + 1, cell - 2, cell - 2);
            } else if (tch === "~") {
              ctx.fillStyle = "rgba(56,140,200,0.4)"; ctx.fillRect(x, y, cell, cell);
              ctx.fillStyle = `rgba(186,230,253,${0.1 + Math.sin(now / 400 + c) * 0.05})`; ctx.fillRect(x, y + cell * 0.5, cell, cell * 0.12);
            } else if (tch === ",") {
              ctx.fillStyle = "rgba(0,0,0,0.1)"; ctx.beginPath(); ctx.arc(x + cell / 2, y + cell / 2, cell * 0.16, 0, Math.PI * 2); ctx.fill();
            } else if (tch === "+") {
              if (s.doorsOpen) {
                ctx.fillStyle = "rgba(120,90,50,0.16)"; ctx.fillRect(x, y, cell, cell);
                ctx.fillStyle = "rgba(180,140,80,0.5)"; ctx.fillRect(x, y, cell * 0.14, cell); ctx.fillRect(x + cell * 0.86, y, cell * 0.14, cell);
              } else {
                ctx.fillStyle = "rgba(90,60,30,0.95)"; ctx.fillRect(x, y, cell, cell);
                ctx.strokeStyle = accent; ctx.lineWidth = 2; ctx.strokeRect(x + 3, y + 3, cell - 6, cell - 6);
                ctx.fillStyle = "rgba(0,0,0,0.3)"; for (let b = 0; b < 3; b++) ctx.fillRect(x + 4, y + (cell / 3) * b + 4, cell - 8, 3);
              }
            }
          }
        }
      }

      // Obstacles (legacy rectangle rooms only; tile rooms draw their own walls)
      if (!s.tiles) for (const o of s.obstacles) {
        if (!drawSprite(sprites["rock"], o.x + o.w / 2, o.y + o.h / 2, Math.max(o.w, o.h) * 1.05)) {
          ctx.fillStyle = "rgba(70,50,30,0.35)"; ctx.strokeStyle = "rgba(70,50,30,0.6)"; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.roundRect(o.x, o.y, o.w, o.h, 6); ctx.fill(); ctx.stroke();
        }
      }
      // Hazards
      for (const h of s.hazards) {
        ctx.save(); ctx.translate(h.x, h.y);
        const pulse = 1 + Math.sin(now / 200) * 0.1;
        ctx.fillStyle = "rgba(239,68,68,0.22)"; ctx.strokeStyle = "rgba(239,68,68,0.7)"; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(0, 0, h.radius * pulse, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.restore();
      }
      // Pickups
      for (const p of s.pickups) {
        if (!p.alive) continue;
        const pulse = 1 + Math.sin(now / 250) * 0.08;
        ctx.save(); ctx.translate(p.x, p.y);
        ctx.shadowColor = p.type === "node" ? "#5fd97a" : "#f5b942"; ctx.shadowBlur = 16;
        const drew = drawSprite(sprites[p.type === "node" ? "node" : "chest"], 0, 0, p.radius * 2.6 * pulse);
        ctx.shadowBlur = 0;
        if (!drew) {
          if (p.type === "node") { ctx.fillStyle = "#5fd97a"; ctx.strokeStyle = "#2f9e54"; } else { ctx.fillStyle = "#f5b942"; ctx.strokeStyle = "#b9851f"; }
          ctx.lineWidth = 2; ctx.beginPath();
          if (p.type === "node") ctx.arc(0, 0, p.radius, 0, Math.PI * 2); else ctx.roundRect(-p.radius, -p.radius * 0.8, p.radius * 2, p.radius * 1.6, 4);
          ctx.fill(); ctx.stroke();
        }
        ctx.restore();
      }
      // Portal
      if (s.portal) {
        ctx.save(); ctx.translate(s.portal.x, s.portal.y);
        const r = s.portal.radius * (1 + Math.sin(now / 200) * 0.06);
        ctx.globalAlpha = portalActive ? 1 : 0.35;
        ctx.rotate(now / 1400);
        const drew = drawSprite(sprites["portal"], 0, 0, r * 3.2);
        ctx.rotate(-now / 1400);
        if (!drew) {
          const pg = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
          pg.addColorStop(0, portalActive ? "#b98cf5" : "#9ca3af"); pg.addColorStop(1, "transparent");
          ctx.fillStyle = pg; ctx.beginPath(); ctx.arc(0, 0, r * 1.6, 0, Math.PI * 2); ctx.fill();
          ctx.strokeStyle = portalActive ? "#7c3aed" : "#6b7280"; ctx.lineWidth = 3;
          ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.stroke();
        }
        ctx.restore();
      }

      // Enemy projectiles
      for (const p of s.eproj) {
        ctx.save(); ctx.translate(p.x, p.y); ctx.shadowColor = "#ef4444"; ctx.shadowBlur = 12;
        ctx.fillStyle = "#f87171"; ctx.beginPath(); ctx.arc(0, 0, p.radius, 0, Math.PI * 2); ctx.fill(); ctx.restore();
      }
      // Player projectiles
      for (const p of s.pproj) {
        ctx.save(); ctx.translate(p.x, p.y); ctx.shadowColor = ELEMENT_COLOR[p.element]; ctx.shadowBlur = 14;
        ctx.fillStyle = ELEMENT_COLOR[p.element]; ctx.beginPath(); ctx.arc(0, 0, p.radius, 0, Math.PI * 2); ctx.fill(); ctx.restore();
      }

      // Enemies
      for (const e of s.enemies) {
        // Keep rendering recently-killed enemies so they can play a collapse beat.
        const eDying = !e.alive && e.deathStart > 0 && now - e.deathStart < EDEATH_MS;
        if (!e.alive && !eDying) continue;
        const dProg = eDying ? easeOut(Math.min(1, (now - e.deathStart) / EDEATH_MS)) : 0;
        const deathAlpha = eDying ? Math.max(0, 1 - dProg) : 1;
        // shadow (fades with the dissolve)
        ctx.save(); ctx.translate(e.x, e.y + e.radius * 0.9); ctx.scale(1, 0.4);
        ctx.fillStyle = `rgba(0,0,0,${0.22 * deathAlpha})`; ctx.beginPath(); ctx.arc(0, 0, e.radius * 0.9, 0, Math.PI * 2); ctx.fill(); ctx.restore();
        // telegraph
        if (e.alive && e.tele > 0 && e.teleMax > 0) {
          const fr = 1 - e.tele / e.teleMax;
          ctx.save();
          if (e.teleType === "slam") {
            ctx.translate(e.sx, e.sy); ctx.fillStyle = `rgba(239,68,68,${0.12 + fr * 0.25})`; ctx.strokeStyle = "rgba(239,68,68,0.8)"; ctx.lineWidth = 3;
            ctx.beginPath(); ctx.arc(0, 0, s.unit * 0.16, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
          } else if (e.teleType === "lunge") {
            ctx.translate(e.x, e.y); ctx.strokeStyle = `rgba(239,68,68,${0.4 + fr * 0.5})`; ctx.lineWidth = 3 + fr * 4;
            ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(e.sx - e.x, e.sy - e.y); ctx.stroke();
          } else if (e.teleType === "shot") {
            ctx.translate(e.x, e.y); ctx.strokeStyle = `rgba(250,204,21,${0.4 + fr * 0.5})`; ctx.lineWidth = 2;
            ctx.beginPath(); ctx.arc(0, 0, e.radius * (1.3 + fr), 0, Math.PI * 2); ctx.stroke();
          }
          ctx.restore();
        }
        ctx.save(); ctx.translate(e.x, e.y);
        if (e.shock > 0) { ctx.shadowColor = "#facc15"; ctx.shadowBlur = 14; }
        const flip = s.px < e.x ? -1 : 1;
        // Hurt flinch: a quick squash-and-pop beat on top of the hit-flash tint.
        if (e.alive && e.hurtStart > 0 && now - e.hurtStart < EHURT_MS) {
          const k = Math.sin(Math.min(1, (now - e.hurtStart) / EHURT_MS) * Math.PI);
          ctx.translate(0, -e.radius * 0.08 * k);
          ctx.translate(0, e.radius); ctx.scale(1 + 0.16 * k, 1 - 0.13 * k); ctx.translate(0, -e.radius);
        }
        // Death collapse: tip over away from the player, squash flat, and sink.
        if (eDying) {
          const dir = s.px < e.x ? 1 : -1;
          ctx.translate(0, e.radius * 0.9);
          ctx.rotate(dProg * 1.15 * dir);
          ctx.scale(1 + 0.12 * dProg, 1 - 0.55 * dProg);
          ctx.translate(0, -e.radius * 0.9);
        }
        const drew = drawSprite(sprites[enemySprite(e.kind)], 0, 0, e.radius * 2.5, flip, deathAlpha);
        ctx.shadowBlur = 0;
        if (drew && e.alive) {
          if (e.hitFlash > 0) { ctx.globalCompositeOperation = "lighter"; ctx.fillStyle = "rgba(255,255,255,0.5)"; ctx.beginPath(); ctx.arc(0, 0, e.radius, 0, Math.PI * 2); ctx.fill(); ctx.globalCompositeOperation = "source-over"; }
          if (e.burn > 0) { ctx.fillStyle = "rgba(251,146,60,0.25)"; ctx.beginPath(); ctx.arc(0, 0, e.radius, 0, Math.PI * 2); ctx.fill(); }
          if (e.chill > 0) { ctx.fillStyle = "rgba(125,211,252,0.3)"; ctx.beginPath(); ctx.arc(0, 0, e.radius, 0, Math.PI * 2); ctx.fill(); }
        } else if (!drew) {
          ctx.globalAlpha = deathAlpha;
          const col = e.type === "boss" ? "#b91c1c" : e.type === "elite" ? "#c2410c" : "#dc2626";
          ctx.fillStyle = (e.alive && e.hitFlash > 0) ? "#fff" : e.burn > 0 ? "#f97316" : e.chill > 0 ? "#60a5fa" : col;
          ctx.strokeStyle = "rgba(0,0,0,0.4)"; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.arc(0, 0, e.radius, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
          ctx.fillStyle = "rgba(255,255,255,0.85)"; ctx.beginPath(); ctx.arc(0, -e.radius * 0.15, e.radius * 0.3, 0, Math.PI * 2); ctx.fill();
          ctx.globalAlpha = 1;
        }
        // hp bar (hidden once the enemy is dying)
        if (e.alive) {
          ctx.fillStyle = "rgba(0,0,0,0.35)"; ctx.fillRect(-e.radius, -e.radius - 10, e.radius * 2, 4);
          ctx.fillStyle = e.type === "boss" ? "#f59e0b" : "#22c55e"; ctx.fillRect(-e.radius, -e.radius - 10, e.radius * 2 * Math.max(0, e.hp / e.maxHp), 4);
        }
        ctx.restore();
      }

      // Slash VFX
      for (const sl of s.slashes) {
        ctx.save(); ctx.translate(sl.x, sl.y); ctx.rotate(sl.angle);
        const size = sl.reach * 2 * (sl.big ? 1.3 : 1);
        const img = sprites["slash"];
        if (img && img.complete && img.naturalWidth > 0) {
          ctx.globalAlpha = sl.t * 0.9;
          ctx.drawImage(img, -size * 0.1, -size / 2, size, size);
        } else {
          ctx.globalAlpha = sl.t; ctx.strokeStyle = ELEMENT_COLOR[sl.element]; ctx.lineWidth = 4 * sl.t;
          ctx.beginPath(); ctx.arc(0, 0, sl.reach, -0.9, 0.9); ctx.stroke();
        }
        ctx.restore();
        sl.t -= 0.1 * dt;
      }
      s.slashes = s.slashes.filter((sl) => sl.t > 0);

      // Ability VFX (procedural, animated)
      for (const f of s.fx) {
        const col = ELEMENT_COLOR[f.element];
        const p = easeOut(1 - f.t);
        ctx.save();
        if (f.kind === "crescent") {
          ctx.translate(f.x, f.y);
          const sweep = 1.95;
          const a0 = f.angle - sweep / 2;
          const head = a0 + sweep * p;
          const rOut = f.reach, rIn = f.reach * 0.42;
          const mid = (rOut + rIn) / 2, band = rOut - rIn;
          const fire = f.variant === "flame_arc" || f.element === "fire";
          ctx.lineCap = "round";
          for (let i = 0; i < 7; i++) {
            const aa = head - i * 0.16;
            if (aa < a0 - 0.1) break;
            ctx.globalAlpha = f.t * (1 - i / 7) * 0.45;
            ctx.lineWidth = band * (1 - i / 10);
            ctx.strokeStyle = fire ? (i % 2 ? "#fb923c" : col) : col;
            ctx.beginPath(); ctx.arc(0, 0, mid, aa - 0.13, aa + 0.02); ctx.stroke();
          }
          ctx.globalAlpha = f.t; ctx.lineWidth = band * 0.5; ctx.strokeStyle = "#ffffff";
          ctx.beginPath(); ctx.arc(0, 0, mid, head - 0.14, head + 0.05); ctx.stroke();
          ctx.globalAlpha = f.t * 0.9; ctx.fillStyle = "#ffffff";
          ctx.beginPath(); ctx.arc(Math.cos(head) * rOut, Math.sin(head) * rOut, band * 0.18, 0, Math.PI * 2); ctx.fill();
        } else if (f.kind === "shockwave") {
          ctx.translate(f.x, f.y);
          for (let i = 0; i < 3; i++) {
            const rp = p - i * 0.16; if (rp <= 0) continue;
            const r = f.reach * Math.min(1, rp);
            ctx.globalAlpha = f.t * (1 - i * 0.22) * 0.9;
            ctx.lineWidth = f.reach * 0.07 * (1 - rp * 0.5);
            ctx.strokeStyle = i === 0 ? "#ffffff" : col;
            ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.stroke();
          }
          ctx.globalAlpha = f.t * 0.5; ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.lineCap = "round";
          for (let i = 0; i < 8; i++) {
            const a = f.seed + i * (Math.PI / 4);
            const r1 = f.reach * 0.18, r2 = f.reach * (0.6 + (i % 3) * 0.13) * p;
            const midr = (r1 + r2) / 2;
            ctx.beginPath();
            ctx.moveTo(Math.cos(a) * r1, Math.sin(a) * r1);
            ctx.lineTo(Math.cos(a + 0.14) * midr, Math.sin(a + 0.14) * midr);
            ctx.lineTo(Math.cos(a) * r2, Math.sin(a) * r2);
            ctx.stroke();
          }
        } else if (f.kind === "bolt") {
          const dx = f.tx - f.x, dy = f.ty - f.y; const len = Math.hypot(dx, dy) || 1;
          const nxp = -dy / len, nyp = dx / len;
          const segs = 7;
          const px: number[] = [], py: number[] = [];
          for (let i = 0; i <= segs; i++) {
            const tt = i / segs;
            const off = i === 0 || i === segs ? 0 : (Math.sin(f.seed + i * 9.7 + now / 35) * len * 0.1 + Math.sin(f.seed * 2 + i * 4.1 + now / 23) * len * 0.06);
            px.push(f.x + dx * tt + nxp * off); py.push(f.y + dy * tt + nyp * off);
          }
          ctx.lineJoin = "round"; ctx.lineCap = "round";
          ctx.globalAlpha = f.t; ctx.strokeStyle = col; ctx.lineWidth = 5; ctx.shadowColor = col; ctx.shadowBlur = 14;
          ctx.beginPath(); ctx.moveTo(px[0], py[0]); for (let i = 1; i <= segs; i++) ctx.lineTo(px[i], py[i]); ctx.stroke();
          ctx.shadowBlur = 0; ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 1.8;
          ctx.beginPath(); ctx.moveTo(px[0], py[0]); for (let i = 1; i <= segs; i++) ctx.lineTo(px[i], py[i]); ctx.stroke();
        } else if (f.kind === "blink") {
          ctx.lineCap = "round";
          ctx.globalAlpha = f.t * 0.6; ctx.strokeStyle = "#c4b5fd"; ctx.lineWidth = s.pradius * 0.9 * f.t;
          ctx.beginPath(); ctx.moveTo(f.x, f.y); ctx.lineTo(f.tx, f.ty); ctx.stroke();
          ctx.globalAlpha = f.t; ctx.strokeStyle = "#ddd6fe"; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.arc(f.x, f.y, f.reach * (0.3 + (1 - f.t)), 0, Math.PI * 2); ctx.stroke();
          ctx.beginPath(); ctx.arc(f.tx, f.ty, f.reach * (1 - f.t) * 1.2, 0, Math.PI * 2); ctx.stroke();
        } else if (f.kind === "burst") {
          ctx.translate(f.x, f.y);
          let bcol = col;
          if (f.variant === "shield_barkskin") bcol = "#4ade80";
          else if (f.variant === "shield_sun_ward") bcol = "#fcd34d";
          else if (f.variant.startsWith("shield_")) bcol = "#93c5fd";
          else if (f.variant === "buff") bcol = "#fcd34d";
          const r = f.reach * p;
          ctx.globalAlpha = f.t; ctx.strokeStyle = bcol; ctx.lineWidth = 3 * f.t;
          ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.stroke();
          ctx.globalAlpha = f.t * 0.8; ctx.lineWidth = 2;
          for (let i = 0; i < 8; i++) {
            const a = (i / 8) * Math.PI * 2 + now / 300;
            ctx.beginPath(); ctx.moveTo(Math.cos(a) * r * 0.6, Math.sin(a) * r * 0.6); ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r); ctx.stroke();
          }
        }
        ctx.restore();
        f.t -= f.speed * dt;
      }
      ctx.globalAlpha = 1; ctx.shadowBlur = 0;
      s.fx = s.fx.filter((f) => f.t > 0);

      // Particles
      for (const pa of s.parts) {
        ctx.globalAlpha = Math.max(0, pa.life); ctx.fillStyle = pa.color;
        ctx.beginPath(); ctx.arc(pa.x, pa.y, pa.size, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalAlpha = 1;

      // Dash afterimages (rendered before player so player is on top)
      if (!Array.isArray(s.afterimages)) s.afterimages = [];
      const composed = composedSpriteRef.current;
      if (composed) {
        for (const ai of s.afterimages) {
          ctx.save(); ctx.translate(ai.x, ai.y);
          ctx.globalAlpha = ai.life * 0.45;
          ctx.globalCompositeOperation = "lighter";
          const sx = ai.lpcFrame * 64, sy = ai.lpcRow * 64;
          ctx.drawImage(composed, sx, sy, 64, 64, -s.pradius * 1.5, -s.pradius * 1.5, s.pradius * 3.0, s.pradius * 3.0);
          ctx.restore();
          ai.life -= 0.12 * dt;
        }
        ctx.globalCompositeOperation = "source-over";
      }
      s.afterimages = s.afterimages.filter((ai) => ai.life > 0);

      // Co-op teammates — render allies who are in the same chamber as us. We
      // smooth their last-known telemetry toward the latest target each frame.
      // Teammates carry no LPC layer data, so we draw them with the shared base
      // player sheet (graceful fallback) plus a name label and a small health pip.
      if (coopRef.current) {
        const teammates = coopRef.current.getTeammates();
        for (const mate of teammates) {
          if (mate.chamberIndex !== s.chamberIdx) continue;
          let rs = coopRenderRef.current.get(mate.userId);
          if (!rs) { rs = { rx: mate.x, ry: mate.y, frame: 0 }; coopRenderRef.current.set(mate.userId, rs); }
          rs.rx += (mate.x - rs.rx) * Math.min(1, 0.2 * dt);
          rs.ry += (mate.y - rs.ry) * Math.min(1, 0.2 * dt);
          if (mate.moving) rs.frame += 0.18 * dt; else rs.frame = 0;
          const frame = Math.floor(rs.frame) % 4;
          const row = mate.moving ? 1 : 0;
          ctx.save(); ctx.translate(rs.rx, rs.ry);
          // shadow
          ctx.save(); ctx.globalAlpha = 0.28; ctx.fillStyle = "#000";
          ctx.beginPath(); ctx.ellipse(0, s.pradius * 0.92, s.pradius * 0.8, s.pradius * 0.32, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore();
          const matAlpha = mate.hp <= 0 ? 0.35 : 1;
          const drew = drawPlayerSheet(sprites["player_sheet"], 0, 0, s.pradius * 3.0, mate.facing < 0 ? -1 : 1, matAlpha, row, frame, 0);
          if (!drew) {
            ctx.save(); ctx.globalAlpha = matAlpha; ctx.fillStyle = "#7dd3fc";
            ctx.beginPath(); ctx.arc(0, 0, s.pradius, 0, Math.PI * 2); ctx.fill(); ctx.restore();
          }
          // name label
          ctx.save();
          ctx.font = `600 ${Math.round(s.pradius * 0.62)}px ui-sans-serif, system-ui`;
          ctx.textAlign = "center"; ctx.textBaseline = "bottom";
          const label = mate.displayName || "Ally";
          const ly = -s.pradius * 1.7;
          ctx.lineWidth = 3; ctx.strokeStyle = "rgba(0,0,0,0.75)"; ctx.strokeText(label, 0, ly);
          ctx.fillStyle = "#bae6fd"; ctx.fillText(label, 0, ly);
          // health pip
          const barW = s.pradius * 1.6, barH = Math.max(2, s.pradius * 0.16);
          const frac = mate.maxHp > 0 ? Math.max(0, Math.min(1, mate.hp / mate.maxHp)) : 0;
          ctx.fillStyle = "rgba(0,0,0,0.55)"; ctx.fillRect(-barW / 2, ly + 2, barW, barH);
          ctx.fillStyle = frac > 0.3 ? "#4ade80" : "#f87171"; ctx.fillRect(-barW / 2, ly + 2, barW * frac, barH);
          ctx.restore();
          ctx.restore();
        }
      }

      // Player
      ctx.save(); ctx.translate(s.px, s.py);
      // shadow
      ctx.save(); ctx.translate(0, s.pradius * 0.9); ctx.scale(1, 0.4);
      ctx.fillStyle = "rgba(0,0,0,0.25)"; ctx.beginPath(); ctx.arc(0, 0, s.pradius * 0.9, 0, Math.PI * 2); ctx.fill(); ctx.restore();
      const dashing = now < s.dashUntil;
      const dying = s.deathStart > 0;
      const deathP = dying ? Math.min(1, (now - s.deathStart) / DEATH_MS) : 0;
      // Collapse: tip the sprite over and let it sink while the death beat plays.
      if (dying) { ctx.rotate(deathP * Math.PI * 0.42 * (s.facing || 1)); ctx.translate(0, deathP * s.pradius * 0.5); }
      if (now < s.shieldUntil) {
        const remain = s.shieldUntil - now;
        const fade = Math.min(1, remain / 600);
        const scol = s.shieldKey === "barkskin" ? "#4ade80" : s.shieldKey === "sun_ward" ? "#fcd34d" : "#93c5fd";
        const br = s.pradius * 1.65;
        ctx.globalAlpha = (0.18 + Math.sin(now / 180) * 0.06) * fade;
        ctx.fillStyle = scol; ctx.beginPath(); ctx.arc(0, 0, br, 0, Math.PI * 2); ctx.fill();
        for (let layer = 0; layer < 2; layer++) {
          ctx.globalAlpha = (layer === 0 ? 0.85 : 0.45) * fade;
          ctx.strokeStyle = layer === 0 ? scol : "#ffffff"; ctx.lineWidth = layer === 0 ? 2.5 : 1.2;
          const rot = now / (layer === 0 ? 1500 : -1100);
          ctx.beginPath();
          for (let i = 0; i <= 6; i++) { const a = rot + (i / 6) * Math.PI * 2; const rr = br + (layer === 0 ? 0 : 2); const x = Math.cos(a) * rr, y = Math.sin(a) * rr; if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); }
          ctx.stroke();
        }
        if (s.shieldKey === "sun_ward") {
          ctx.globalAlpha = 0.5 * fade; ctx.strokeStyle = "#fde68a"; ctx.lineWidth = 1.5;
          for (let i = 0; i < 8; i++) { const a = now / 900 + (i / 8) * Math.PI * 2; ctx.beginPath(); ctx.moveTo(Math.cos(a) * br, Math.sin(a) * br); ctx.lineTo(Math.cos(a) * (br + s.pradius * 0.5), Math.sin(a) * (br + s.pradius * 0.5)); ctx.stroke(); }
        }
        ctx.globalAlpha = 1;
      }
      if (now < s.lootBuffUntil) { ctx.shadowColor = "#fcd34d"; ctx.shadowBlur = 22; } else { ctx.shadowColor = accent; ctx.shadowBlur = dashing ? 26 : 16; }
      let animRow = 0, animFrame = 0;
      if (now < s.castAnimUntil) {
        animRow = 2;
        const prog = (now - s.castAnimStart) / Math.max(1, s.castAnimUntil - s.castAnimStart);
        animFrame = Math.min(3, Math.max(0, Math.floor(prog * 4)));
      } else if (now < s.attackAnimUntil) {
        animRow = 2;
        const prog = (now - s.attackAnimStart) / Math.max(1, s.attackAnimUntil - s.attackAnimStart);
        animFrame = Math.min(3, Math.max(0, Math.floor(prog * 4)));
      } else if (dashing) {
        animRow = 3; animFrame = 0;
      } else if (s.moving) {
        animRow = 1; animFrame = Math.floor(now / 90) % 4;
      }
      const playerAlpha = dying ? Math.max(0, 1 - deathP * 0.85) : (now < s.iframeUntil && !dashing ? 0.55 : 1);
      const idleBob = animRow === 0 ? Math.sin(now / 520) * s.pradius * 0.06 : 0;
      const hurtTint = now < s.hurtFlashUntil ? Math.min(0.6, ((s.hurtFlashUntil - now) / 240) * 0.6) : 0;
      const ready = (im: HTMLImageElement | undefined): im is HTMLImageElement => !!im && im.complete && im.naturalWidth > 0;
      // LPC composed canvas takes priority; fall back to directional sheets, then static sprite.
      // LPC walk rows: 8=up, 9=left, 10=down, 11=right — all 9 frames per row.
      let drewP = false;
      if (composed) {
        // Direction index in LPC order: 0=up, 1=left, 2=down, 3=right.
        let dirIdx: number;
        if (Math.abs(s.ady) > Math.abs(s.adx)) dirIdx = s.ady < 0 ? 0 : 2;
        else dirIdx = s.adx >= 0 ? 3 : 1;
        // Pick animation group: spellcast (rows 0-3, 7f) for ability casts,
        // slash (rows 12-15, 6f) for melee attacks, else walk (rows 8-11, 9f).
        let baseRow: number, lpcFrame: number;
        // Hurt/death use LPC row 20 (6 frames, down direction only), so force the
        // single hurt row rather than offsetting by facing direction.
        let forcedRow = -1;
        if (dying) {
          baseRow = 20; forcedRow = 20;
          lpcFrame = Math.min(5, Math.max(0, Math.floor(deathP * 6)));
        } else if (now < s.hurtFlashUntil && s.hurtAnimStart > 0) {
          baseRow = 20; forcedRow = 20;
          const prog = (now - s.hurtAnimStart) / Math.max(1, s.hurtFlashUntil - s.hurtAnimStart);
          lpcFrame = Math.min(5, Math.max(0, Math.floor(prog * 6)));
        } else if (now < s.castAnimUntil) {
          baseRow = 0;
          const prog = (now - s.castAnimStart) / Math.max(1, s.castAnimUntil - s.castAnimStart);
          lpcFrame = Math.min(6, Math.max(0, Math.floor(prog * 7)));
        } else if (now < s.attackAnimUntil) {
          baseRow = 12;
          const prog = (now - s.attackAnimStart) / Math.max(1, s.attackAnimUntil - s.attackAnimStart);
          lpcFrame = Math.min(5, Math.max(0, Math.floor(prog * 6)));
        } else if (dashing) {
          baseRow = 8; lpcFrame = Math.floor(now / 70) % 9;
        } else if (s.moving) {
          baseRow = 8; lpcFrame = Math.floor(now / 100) % 9;
        } else {
          baseRow = 8; lpcFrame = 0;
        }
        let lpcRow = forcedRow >= 0 ? forcedRow : baseRow + dirIdx;
        // Fall back to the walk row if the requested animation row is missing.
        if ((lpcRow + 1) * 64 > composed.height) { lpcRow = 8 + dirIdx; lpcFrame = Math.min(lpcFrame, 8); }
        drewP = drawLpcFrame(composed, 0, idleBob, s.pradius * 3.0, playerAlpha, lpcRow, lpcFrame, hurtTint);
      }
      if (!drewP) {
        const sideSheet = sprites["player_sheet"];
        const upSheet = sprites["player_sheet_up"];
        const downSheet = sprites["player_sheet_down"];
        // Pick directional sheet from aim vector: vertical aim -> up/down (no flip), else side (flip by facing).
        let dirSheet = sideSheet, dirFlip = s.facing;
        if (Math.abs(s.ady) > Math.abs(s.adx)) {
          if (s.ady < 0 && ready(upSheet)) { dirSheet = upSheet; dirFlip = 1; }
          else if (s.ady >= 0 && ready(downSheet)) { dirSheet = downSheet; dirFlip = 1; }
        }
        if (ready(dirSheet)) {
          drewP = drawPlayerSheet(dirSheet, 0, idleBob, s.pradius * 3.0, dirFlip, playerAlpha, animRow, animFrame, hurtTint);
        } else {
          drewP = drawSprite(sprites["player"], 0, 0, s.pradius * 2.7, s.facing, playerAlpha);
        }
      }
      ctx.shadowBlur = 0;
      if (now < s.lootBuffUntil) {
        const bfade = Math.min(1, (s.lootBuffUntil - now) / 700);
        for (let i = 0; i < 4; i++) {
          const a = now / 320 + (i / 4) * Math.PI * 2;
          const orb = s.pradius * (1.7 + Math.sin(now / 240 + i) * 0.18);
          ctx.globalAlpha = bfade; ctx.fillStyle = i % 2 ? "#fcd34d" : "#fde68a";
          ctx.beginPath(); ctx.arc(Math.cos(a) * orb, Math.sin(a) * orb, s.pradius * 0.16, 0, Math.PI * 2); ctx.fill();
        }
        ctx.globalAlpha = 1;
      }
      if (!drewP) {
        ctx.fillStyle = "#1e3a8a"; ctx.strokeStyle = "#fbbf24"; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(0, 0, s.pradius, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.fillStyle = "#fde68a"; ctx.beginPath(); ctx.arc(0, 0, s.pradius * 0.45, 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();

      // Aim reticle — only Manual mode aims with the mouse.
      if (mode === "manual" && aimRef.current.lastMove > 0) {
        ctx.save(); ctx.translate(aimRef.current.x, aimRef.current.y);
        ctx.strokeStyle = "rgba(251,191,36,0.6)"; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(0, 0, s.unit * 0.018, 0, Math.PI * 2); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(-s.unit * 0.026, 0); ctx.lineTo(s.unit * 0.026, 0); ctx.moveTo(0, -s.unit * 0.026); ctx.lineTo(0, s.unit * 0.026); ctx.stroke();
        ctx.restore();
      }

      // Floats
      ctx.font = `bold ${Math.round(s.unit * 0.035)}px Inter, sans-serif`;
      ctx.textAlign = "center";
      for (const f of s.floats) {
        ctx.globalAlpha = Math.max(0, Math.min(1, f.t));
        ctx.fillStyle = f.color; ctx.lineWidth = 3; ctx.strokeStyle = "rgba(0,0,0,0.4)";
        ctx.strokeText(f.text, f.x, f.y - (1 - f.t) * 30); ctx.fillText(f.text, f.x, f.y - (1 - f.t) * 30);
        f.t -= 0.02 * dt;
      }
      ctx.globalAlpha = 1;
      s.floats = s.floats.filter((f) => f.t > 0);

      ctx.restore();

      // HUD sync
      const artHud = (["q", "e", "r"] as const).map((slot) => {
        const a = s.arts[slot];
        if (!a) return null;
        return { slot: slot.toUpperCase(), name: a.name, frac: Math.max(0, Math.min(1, (a.cdUntil - now) / a.cd)) };
      }).filter(Boolean) as { slot: string; name: string; frac: number }[];
      setHud({
        hp: Math.round(s.php), maxHp: Math.round(s.pmaxhp),
        chamber: s.chamberIdx + 1, totalChambers: (run?.chambers ?? []).length,
        enemies: s.enemiesDefeated, nodes: s.nodesHarvested, chests: s.chestsOpened,
        remaining: enemiesLeft, arts: artHud,
        dashFrac: Math.max(0, Math.min(1, (s.dashCdUntil - now) / s.dashCd)),
        shield: now < s.shieldUntil, mode,
      });

      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [phase, run, advanceOrFinish, finishRun]);

  const toWorld = (clientX: number, clientY: number) => {
    const s = stateRef.current; const canvas = canvasRef.current;
    if (!s || !canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const scale = Math.min(rect.width / s.worldW, rect.height / s.worldH);
    const offX = (rect.width - s.worldW * scale) / 2;
    const offY = (rect.height - s.worldH * scale) / 2;
    return { x: (clientX - rect.left - offX) / scale, y: (clientY - rect.top - offY) / scale };
  };

  const handleRate = async () => {
    if (!run) return;
    try {
      await rate.mutateAsync({ id, data: { stars, comment: comment || undefined, difficultyVote, idempotencyKey: makeIdempotencyKey("rate") } });
      setRated(true);
      toast.success("Thanks for your review!");
    } catch { toast.error("Could not submit rating."); }
  };

  if (isLoading || phase === "loading") {
    // Neutral dark threshold so the hand-off from the entrance chamber reads as a
    // continuous descent rather than a loading screen.
    return (
      <div className="flex h-[70vh] items-center justify-center rounded-2xl bg-[#05070b]">
        <div className="h-2.5 w-2.5 animate-ping rounded-full bg-primary/80" />
      </div>
    );
  }

  const b = run ? biome(run.biome) : biome();

  return (
    <div className="space-y-4">
      {phase === "playing" && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-2xl font-bold">{run?.labyrinthName}</h1>
              <p className="text-sm text-muted-foreground">{b.name} · Chamber {hud.chamber} of {hud.totalChambers}</p>
            </div>
            <div className="flex items-center gap-4">
              <div className="w-48">
                <div className="flex items-center gap-1 text-xs font-semibold mb-1"><Heart className="w-3.5 h-3.5 text-rose-500" /> {hud.hp}/{hud.maxHp}{hud.shield && <ShieldIcon className="w-3.5 h-3.5 text-sky-400 ml-1" />}</div>
                <div className="h-3 rounded-full bg-muted overflow-hidden border">
                  <div className="h-full bg-gradient-to-r from-rose-500 to-rose-400 transition-all duration-100" style={{ width: `${(hud.hp / hud.maxHp) * 100}%` }} />
                </div>
              </div>
              <Badge variant="secondary" className="gap-1"><Swords className="w-3 h-3" />{hud.enemies}</Badge>
              <Badge variant="secondary" className="gap-1"><Gem className="w-3 h-3" />{hud.nodes}</Badge>
              <Badge variant="secondary" className="gap-1"><Package className="w-3 h-3" />{hud.chests}</Badge>
              <Badge variant="outline" className="gap-1" title="Combat mode (set before a run)">
                {hud.mode === "auto" ? <Zap className="w-3 h-3" /> : <MousePointerClick className="w-3 h-3" />}
                {hud.mode === "auto" ? "Auto" : "Manual"}
              </Badge>
            </div>
          </div>

          <div className="relative rounded-2xl overflow-hidden border-2 shadow-xl" style={{ borderColor: b.accent }}>
            <canvas
              ref={canvasRef}
              className="w-full touch-none"
              style={{ height: "62vh", display: "block", background: "#1a1208", cursor: "crosshair" }}
              onPointerDown={(e) => {
                (e.target as HTMLElement).setPointerCapture(e.pointerId);
                const w = toWorld(e.clientX, e.clientY);
                aimRef.current = { x: w.x, y: w.y, lastMove: performance.now() };
                // Manual: a click is an attack (held while the button is down).
                // Auto: a click is click-to-move toward the pointer.
                if (combatModeRef.current === "manual") attackHeldRef.current = true;
                else pointerRef.current = { active: true, x: w.x, y: w.y };
              }}
              onPointerMove={(e) => { const w = toWorld(e.clientX, e.clientY); aimRef.current = { x: w.x, y: w.y, lastMove: performance.now() }; if (pointerRef.current.active) { pointerRef.current.x = w.x; pointerRef.current.y = w.y; } }}
              onPointerUp={() => { pointerRef.current.active = false; attackHeldRef.current = false; }}
              onPointerLeave={() => { pointerRef.current.active = false; attackHeldRef.current = false; }}
            />
            {/* Ability bar */}
            <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex items-end gap-2">
              {hud.arts.map((a) => (
                <div key={a.slot} className="relative w-14 h-14 rounded-xl bg-background/85 backdrop-blur border-2 flex flex-col items-center justify-center overflow-hidden" style={{ borderColor: b.accent }}>
                  {a.frac > 0 && <div className="absolute inset-x-0 bottom-0 bg-black/45" style={{ height: `${a.frac * 100}%` }} />}
                  <span className="relative text-sm font-extrabold leading-none">{a.slot}</span>
                  <span className="relative text-[8px] text-muted-foreground leading-tight text-center px-0.5 mt-0.5">{a.name}</span>
                </div>
              ))}
              <div className="relative w-14 h-14 rounded-xl bg-background/85 backdrop-blur border-2 flex flex-col items-center justify-center overflow-hidden" style={{ borderColor: b.accent }}>
                {hud.dashFrac > 0 && <div className="absolute inset-x-0 bottom-0 bg-black/45" style={{ height: `${hud.dashFrac * 100}%` }} />}
                <Wind className="relative w-4 h-4" />
                <span className="relative text-[8px] text-muted-foreground leading-tight mt-0.5">Dodge</span>
              </div>
            </div>
            <div className="absolute bottom-3 left-3 rounded-lg bg-background/80 backdrop-blur px-3 py-1.5 text-xs text-muted-foreground max-w-[40%]">
              {hud.remaining > 0 ? `Defeat ${hud.remaining} foe${hud.remaining > 1 ? "s" : ""} to open the portal` : "Portal open — step through to advance"}
            </div>
            <div className="absolute top-3 right-3 rounded-lg bg-background/80 backdrop-blur px-3 py-1.5 text-xs text-muted-foreground text-right">
              {hud.mode === "auto"
                ? "WASD move · Auto-attack · Space dodge · Q/E/R skills"
                : "WASD move · Mouse aim · Click/F attack · Space dodge · Q/E/R skills"}
            </div>
          </div>
          <div className="flex justify-end">
            <Button variant="ghost" size="sm" onClick={() => finishRun(false)}>Abandon Run</Button>
          </div>
        </>
      )}

      <AnimatePresence>
        {phase === "summary" && (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="max-w-2xl mx-auto py-6">
            <div className="text-center mb-6">
              <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: "spring", delay: 0.1 }}
                className="w-20 h-20 mx-auto rounded-full flex items-center justify-center mb-4"
                style={{ background: summary?.cleared ? "rgba(245,158,11,0.15)" : "rgba(239,68,68,0.12)" }}>
                {summary?.cleared ? <Trophy className="w-10 h-10 text-amber-500" /> : <Skull className="w-10 h-10 text-rose-500" />}
              </motion.div>
              <h1 className="text-3xl font-bold">{summary?.cleared ? "Labyrinth Cleared!" : "You Fell in Battle"}</h1>
              <p className="text-muted-foreground">{run?.labyrinthName}</p>
            </div>

            {summary && (
              <>
                <Card className="mb-4"><CardContent className="p-6">
                  <h2 className="font-bold mb-3 flex items-center gap-2"><Coins className="w-5 h-5 text-primary" />Rewards</h2>
                  <div className="grid grid-cols-3 sm:grid-cols-5 gap-3 text-center">
                    {[["Gold", summary.visitorRewards.gold], ["Ore", summary.visitorRewards.ore], ["Dust", summary.visitorRewards.dust], ["Keys", summary.visitorRewards.keys]].map(([l, v]) => (
                      <div key={l as string} className="rounded-xl bg-muted p-3">
                        <div className="text-xl font-bold tabular-nums">{fmt(v as number)}</div>
                        <div className="text-xs text-muted-foreground">{l}</div>
                      </div>
                    ))}
                  </div>
                  <div className="mt-3 text-center text-sm text-muted-foreground">Total value harvested: <span className="font-bold text-foreground">{fmt(summary.visitorRewards.totalValue)}</span></div>
                  {!run?.isOwnerRun && summary.ownerDropShareValue > 0 && (
                    <div className="mt-2 text-center text-xs text-muted-foreground">Owner drop-share (20%): {fmt(summary.ownerDropShareValue)} · Owner entry-share: {fmt(summary.ownerEntryShare)} · Treasury: {fmt(summary.treasuryEntryShare)}</div>
                  )}
                  {run?.isOwnerRun && <div className="mt-2 text-center text-xs text-muted-foreground">Self-run: no entry fee and no owner drop-share applied.</div>}
                </CardContent></Card>

                {summary.itemDrops.length > 0 && (() => {
                  // Match each drop to the owned PlayerItem it became, then reuse
                  // the same comparison helpers the Loadout screen uses so the
                  // green/red deltas and Upgrade / Best in Slot flags read alike.
                  const slots = run?.loadout?.slots;
                  const bestIds = computeBestInSlotIds(myItems);
                  const itemById = new Map((myItems ?? []).map((pi) => [pi.id, pi]));
                  return (
                  <Card className="mb-4"><CardContent className="p-6">
                    <h2 className="font-bold mb-3">Item Drops</h2>
                    <div className="space-y-2">
                      {summary.itemDrops.map((it, i) => {
                        const r = rarity(it.rarity);
                        const pi = it.playerItemId != null ? itemById.get(it.playerItemId) : undefined;
                        const cmp = pi ? compareItemFor(slots, pi) : null;
                        const cmpStats = cmp ? effectiveStats(cmp) : null;
                        const dropStats = pi ? effectiveStats(pi) : undefined;
                        const isUpgrade = pi ? isUpgradeOver(pi, cmp) : false;
                        const isBest = pi ? bestIds.has(pi.id) : false;
                        return (
                          <motion.div key={i} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.3 + i * 0.1 }}
                            className={`rounded-xl border-2 ${r.border} ${r.bg} p-3`}>
                            <div className="flex items-center gap-3">
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="font-semibold truncate">{it.name}</span>
                                  <Badge variant="outline" className={`${r.text} ${r.border} text-[10px] capitalize`}>{it.rarity} · {it.slot}</Badge>
                                  {isBest && (
                                    <Badge className="gap-0.5 text-[10px] bg-amber-500 hover:bg-amber-500 text-white border-transparent">
                                      <Crown className="w-3 h-3" /> Best in Slot
                                    </Badge>
                                  )}
                                  {isUpgrade && (
                                    <Badge className="gap-0.5 text-[10px] bg-emerald-600 hover:bg-emerald-600 text-white border-transparent">
                                      <ArrowUp className="w-3 h-3" /> Upgrade
                                    </Badge>
                                  )}
                                </div>
                                {dropStats && (
                                  <div className="mt-1">
                                    <StatList stats={dropStats} compare={cmpStats} />
                                  </div>
                                )}
                              </div>
                              <span className="font-bold tabular-nums shrink-0">{fmt(it.value)}</span>
                            </div>
                          </motion.div>
                        );
                      })}
                    </div>
                  </CardContent></Card>
                  );
                })()}
              </>
            )}

            {/* Rating */}
            {!run?.isOwnerRun && !rated && (
              <Card className="mb-4"><CardContent className="p-6">
                <h2 className="font-bold mb-3">Rate this Labyrinth</h2>
                <div className="flex items-center gap-1 mb-3">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <button key={i} onClick={() => setStars(i + 1)}>
                      <Star className={`w-7 h-7 transition-colors ${i < stars ? "fill-amber-400 text-amber-400" : "text-muted-foreground"}`} />
                    </button>
                  ))}
                </div>
                <div className="flex gap-2 mb-3">
                  {(["too_easy", "balanced", "brutal"] as const).map((d) => (
                    <Button key={d} size="sm" variant={difficultyVote === d ? "default" : "outline"} onClick={() => setDifficultyVote(d)} className="capitalize">{d.replace(/_/g, " ")}</Button>
                  ))}
                </div>
                <Textarea rows={2} placeholder="Leave a review (optional)" value={comment} onChange={(e) => setComment(e.target.value)} className="mb-3" />
                <Button onClick={handleRate} disabled={rate.isPending}>Submit Review</Button>
              </CardContent></Card>
            )}

            <div className="flex gap-3 justify-center">
              <Link href="/"><Button variant="outline">Back to Overworld</Button></Link>
              {run && <Link href={`/labyrinth/${run.labyrinthId}`}><Button>View Labyrinth <ArrowRight className="w-4 h-4 ml-1" /></Button></Link>}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
