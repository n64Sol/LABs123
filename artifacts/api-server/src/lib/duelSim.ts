import type { ItemStatsData } from "@workspace/db";

// ---------------------------------------------------------------------------
// Server-authoritative PvP duel simulator.
//
// A duel is resolved entirely on the server the instant it is accepted: given
// both players' equipped combat stats + abilities and a deterministic seed
// (derived from the duel id and the two user ids), this produces the winner and
// a bounded, replayable event timeline. Both clients then fetch that immutable
// timeline and play it back in sync, so the visible fight is just an animation
// of an outcome the players cannot influence or fake.
//
// The combat model mirrors the single-player run loop's math so a player's gear
// behaves consistently in PvP:
//   maxHp        = 100 + health
//   basic damage = 12 + attack
//   attack every = (720 - attackSpeed*7) * (1 - cdr/200) ms
//   crit         = critChance% chance of a 2x hit
//   mitigation   = dmg * 100 / (100 + defenderDefense)
// ---------------------------------------------------------------------------

export type DuelAbilityKind = "cleave" | "nova" | "chain" | "shield" | "blink" | "buff";

/** Mirror of the client ability catalog cooldowns (ms), by mechanical family. */
const ABILITY_BASE_CD: Record<DuelAbilityKind, number> = {
  cleave: 4800,
  nova: 6500,
  chain: 5000,
  shield: 9000,
  blink: 3500,
  buff: 12000,
};

/** Mirror of the client ABILITIES catalog: ability key -> kind. */
const ABILITY_KIND_BY_KEY: Record<string, DuelAbilityKind> = {
  flame_arc: "cleave",
  crescent_sweep: "cleave",
  chain_shot: "chain",
  seismic_slam: "nova",
  barkskin: "shield",
  sun_ward: "shield",
  bulwark: "shield",
  fortune_surge: "buff",
  quickstep: "blink",
};

/** Human-readable ability names, by key (for timeline labels). */
const ABILITY_NAME_BY_KEY: Record<string, string> = {
  flame_arc: "Flame Arc",
  crescent_sweep: "Crescent Sweep",
  chain_shot: "Chain Shot",
  seismic_slam: "Seismic Slam",
  barkskin: "Barkskin",
  sun_ward: "Sun Ward",
  bulwark: "Bulwark",
  fortune_surge: "Fortune Surge",
  quickstep: "Quickstep",
};

export function resolveAbilityKey(
  key: string | null | undefined,
): { key: string; kind: DuelAbilityKind; name: string } | null {
  if (!key) return null;
  const kind = ABILITY_KIND_BY_KEY[key];
  if (!kind) return null;
  return { key, kind, name: ABILITY_NAME_BY_KEY[key] ?? key };
}

export interface DuelCombatantInput {
  userId: number;
  stats: ItemStatsData;
  /** Ability keys from equipped ability stones. */
  abilityKeys: string[];
}

export type DuelEventKind = "attack" | "crit" | "ability";

export interface DuelEvent {
  /** Milliseconds from the start of the fight. */
  tMs: number;
  actorUserId: number;
  targetUserId: number;
  kind: DuelEventKind;
  /** HP actually removed from the target (0 for a dodge or a self-buff). */
  damage: number;
  /** Target's HP remaining after this event. */
  targetHp: number;
  /** Set for ability events; the ability's display name. */
  abilityName?: string;
}

export interface DuelSimResult {
  winnerUserId: number;
  loserUserId: number;
  durationMs: number;
  maxHpByUser: { userId: number; maxHp: number }[];
  events: DuelEvent[];
}

// --- Deterministic RNG ------------------------------------------------------

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashSeed(str: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// --- Combat ----------------------------------------------------------------

const TICK_MS = 100;
const MAX_DURATION_MS = 40_000;
const MAX_EVENTS = 600;

interface Fighter {
  userId: number;
  maxHp: number;
  hp: number;
  patk: number;
  defense: number;
  critChance: number;
  atkInterval: number;
  atkTimer: number;
  abilities: { kind: DuelAbilityKind; name: string; cd: number; timer: number }[];
  shield: number;
  atkMult: number;
  atkMultUntil: number;
  dodgeCharges: number;
}

function num(v: number | undefined): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

function makeFighter(input: DuelCombatantInput, cdr: number): Fighter {
  const s = input.stats;
  const maxHp = Math.max(40, Math.round(100 + num(s.health)));
  const patk = Math.max(4, 12 + num(s.attack));
  const attackSpeed = num(s.attackSpeed);
  const atkInterval = Math.max(220, Math.round((720 - attackSpeed * 7) * (1 - cdr / 200)));
  const abilities = input.abilityKeys
    .map((k) => resolveAbilityKey(k))
    .filter((a): a is NonNullable<typeof a> => a !== null)
    .map((a) => {
      const base = ABILITY_BASE_CD[a.kind];
      const cd = Math.round(base * (1 - cdr / 200));
      return { kind: a.kind, name: a.name, cd, timer: Math.round(cd * 0.5) };
    });
  return {
    userId: input.userId,
    maxHp,
    hp: maxHp,
    patk,
    defense: num(s.defense),
    critChance: Math.max(0, Math.min(75, num(s.critChance))),
    atkInterval,
    atkTimer: Math.round(atkInterval * 0.5),
    abilities,
    shield: 0,
    atkMult: 1,
    atkMultUntil: 0,
    dodgeCharges: 0,
  };
}

/**
 * Resolve a complete duel deterministically. The same inputs always produce the
 * exact same winner and timeline, which is what makes the outcome impossible to
 * fake from a client: the server is the sole authority.
 */
export function simulateDuel(
  duelId: string,
  a: DuelCombatantInput,
  b: DuelCombatantInput,
): DuelSimResult {
  const cdrA = num(a.stats.cooldownReduction);
  const cdrB = num(b.stats.cooldownReduction);
  const fa = makeFighter(a, cdrA);
  const fb = makeFighter(b, cdrB);
  const rng = mulberry32(hashSeed(`${duelId}:${a.userId}:${b.userId}`));
  const events: DuelEvent[] = [];

  let t = 0;
  let winner: number | null = null;

  const applyDamage = (
    attacker: Fighter,
    defender: Fighter,
    rawDmg: number,
    kind: DuelEventKind,
    abilityName?: string,
  ): void => {
    if (events.length >= MAX_EVENTS) return;
    // A blink/dodge charge fully avoids a single basic attack.
    if (defender.dodgeCharges > 0 && kind !== "ability") {
      defender.dodgeCharges -= 1;
      events.push({
        tMs: t,
        actorUserId: attacker.userId,
        targetUserId: defender.userId,
        kind: "attack",
        damage: 0,
        targetHp: Math.round(defender.hp),
      });
      return;
    }
    const mitigated = (rawDmg * 100) / (100 + Math.max(0, defender.defense));
    let remaining = mitigated;
    if (defender.shield > 0) {
      const absorbed = Math.min(defender.shield, remaining);
      defender.shield -= absorbed;
      remaining -= absorbed;
    }
    const before = defender.hp;
    defender.hp = Math.max(0, defender.hp - remaining);
    const dealt = Math.round(before - defender.hp);
    events.push({
      tMs: t,
      actorUserId: attacker.userId,
      targetUserId: defender.userId,
      kind,
      damage: dealt,
      targetHp: Math.round(defender.hp),
      ...(abilityName ? { abilityName } : {}),
    });
    if (defender.hp <= 0 && winner === null) winner = attacker.userId;
  };

  const fireAbility = (self: Fighter, foe: Fighter, kind: DuelAbilityKind, name: string): void => {
    const atk = self.patk * (t < self.atkMultUntil ? self.atkMult : 1);
    switch (kind) {
      case "cleave":
        applyDamage(self, foe, atk * 1.8, "ability", name);
        break;
      case "nova":
        applyDamage(self, foe, atk * 2.4, "ability", name);
        break;
      case "chain":
        applyDamage(self, foe, atk * 2.0, "ability", name);
        break;
      case "shield":
        self.shield += Math.round(self.maxHp * 0.18);
        if (events.length < MAX_EVENTS) {
          events.push({
            tMs: t,
            actorUserId: self.userId,
            targetUserId: self.userId,
            kind: "ability",
            damage: 0,
            targetHp: Math.round(self.hp),
            abilityName: name,
          });
        }
        break;
      case "buff":
        self.atkMult = 1.4;
        self.atkMultUntil = t + 4000;
        if (events.length < MAX_EVENTS) {
          events.push({
            tMs: t,
            actorUserId: self.userId,
            targetUserId: self.userId,
            kind: "ability",
            damage: 0,
            targetHp: Math.round(self.hp),
            abilityName: name,
          });
        }
        break;
      case "blink":
        self.dodgeCharges += 1;
        if (events.length < MAX_EVENTS) {
          events.push({
            tMs: t,
            actorUserId: self.userId,
            targetUserId: self.userId,
            kind: "ability",
            damage: 0,
            targetHp: Math.round(self.hp),
            abilityName: name,
          });
        }
        break;
    }
  };

  const stepFighter = (self: Fighter, foe: Fighter): void => {
    if (winner !== null) return;
    // Abilities fire on cooldown before basic attacks.
    for (const ab of self.abilities) {
      ab.timer -= TICK_MS;
      if (ab.timer <= 0 && foe.hp > 0 && self.hp > 0) {
        ab.timer = ab.cd;
        fireAbility(self, foe, ab.kind, ab.name);
        if (winner !== null) return;
      }
    }
    self.atkTimer -= TICK_MS;
    if (self.atkTimer <= 0 && foe.hp > 0 && self.hp > 0) {
      self.atkTimer = self.atkInterval;
      const buffed = t < self.atkMultUntil ? self.atkMult : 1;
      const isCrit = rng() * 100 < self.critChance;
      const dmg = self.patk * buffed * (isCrit ? 2 : 1);
      applyDamage(self, foe, dmg, isCrit ? "crit" : "attack");
    }
  };

  while (t < MAX_DURATION_MS && winner === null && events.length < MAX_EVENTS) {
    t += TICK_MS;
    stepFighter(fa, fb);
    if (winner !== null) break;
    stepFighter(fb, fa);
  }

  // Timeout: the fighter with more remaining HP fraction wins. Deterministic
  // tie-breaks keep the result stable: higher max HP, then lower user id.
  if (winner === null) {
    const fracA = fa.hp / fa.maxHp;
    const fracB = fb.hp / fb.maxHp;
    if (fracA > fracB) winner = fa.userId;
    else if (fracB > fracA) winner = fb.userId;
    else if (fa.maxHp !== fb.maxHp) winner = fa.maxHp > fb.maxHp ? fa.userId : fb.userId;
    else winner = Math.min(fa.userId, fb.userId);
  }

  const loserUserId = winner === fa.userId ? fb.userId : fa.userId;
  return {
    winnerUserId: winner,
    loserUserId,
    durationMs: t,
    maxHpByUser: [
      { userId: fa.userId, maxHp: fa.maxHp },
      { userId: fb.userId, maxHp: fb.maxHp },
    ],
    events,
  };
}
