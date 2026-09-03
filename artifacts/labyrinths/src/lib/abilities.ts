import type { ItemTemplate } from "@workspace/api-client-react";

/** Visual element an ability is themed around. */
export type AbilityElement = "physical" | "fire" | "lightning" | "frost";

/** Mechanical family an ability belongs to. */
export type AbilityKind = "cleave" | "nova" | "chain" | "shield" | "blink" | "buff";

export interface AbilityDef {
  name: string;
  kind: AbilityKind;
  element: AbilityElement;
  /** Explicit base cooldown in ms; falls back to ART_BASE_CD[kind] when absent. */
  cd?: number;
}

/**
 * Canonical ability catalog, keyed by the `abilityKey` stamped on an Ability
 * Stone template. Shared by the in-run combat loop (which spawns the actual
 * Art) and the Loadout/inventory UI (which surfaces name + cooldown) so the
 * two never disagree about what a stone does.
 */
export const ABILITIES: Record<string, AbilityDef> = {
  flame_arc: { name: "Flame Arc", kind: "cleave", element: "fire", cd: 5200 },
  crescent_sweep: { name: "Crescent Sweep", kind: "cleave", element: "physical", cd: 4200 },
  chain_shot: { name: "Chain Shot", kind: "chain", element: "lightning", cd: 5000 },
  seismic_slam: { name: "Seismic Slam", kind: "nova", element: "physical", cd: 7000 },
  barkskin: { name: "Barkskin", kind: "shield", element: "physical", cd: 8500 },
  sun_ward: { name: "Sun Ward", kind: "shield", element: "physical", cd: 11000 },
  bulwark: { name: "Bulwark", kind: "shield", element: "physical", cd: 9000 },
  fortune_surge: { name: "Fortune Surge", kind: "buff", element: "physical", cd: 12000 },
  quickstep: { name: "Quickstep", kind: "blink", element: "physical", cd: 3500 },
};

/** Base cooldown per ability family, used when a def omits an explicit `cd`. */
export const ART_BASE_CD: Record<AbilityKind, number> = {
  cleave: 4800,
  nova: 6500,
  chain: 5000,
  shield: 9000,
  blink: 3500,
  buff: 12000,
};

/**
 * Base cooldown (ms) for an ability key, optionally reduced by a cooldown
 * reduction percentage (matching the in-run formula). Returns null for keys
 * not in the catalog.
 */
export function abilityCooldownMs(key: string | null | undefined, cdrPercent = 0): number | null {
  if (!key) return null;
  const def = ABILITIES[key];
  if (!def) return null;
  const base = def.cd ?? ART_BASE_CD[def.kind];
  return Math.round(base * (1 - cdrPercent / 200));
}

export interface AbilityInfo {
  name: string;
  description: string | null;
  /** Base cooldown in ms, or null when the ability isn't in the catalog. */
  cooldownMs: number | null;
}

/**
 * Resolve the ability an Ability Stone grants for display. Name and description
 * come from the item DTO (always present for ability stones); the cooldown is
 * derived from the shared catalog. Returns null for templates that grant no
 * ability.
 */
export function abilityInfoFor(template: ItemTemplate): AbilityInfo | null {
  const key = template.abilityKey;
  const name = template.abilityName ?? (key ? ABILITIES[key]?.name : undefined);
  if (!key && !name) return null;
  return {
    name: name ?? "Unknown Ability",
    description: template.abilityDescription ?? null,
    cooldownMs: abilityCooldownMs(key),
  };
}

/** Human-readable cooldown, e.g. `5.2s`. */
export function formatCooldown(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}
