import { EquipInputSlot } from "@workspace/api-client-react";
import {
  Sword,
  Shield,
  ShieldHalf,
  Footprints,
  Gem,
  Sparkles,
  Clover,
  HardHat,
  Wind,
  Shirt,
  Hand,
  PersonStanding,
  Crown,
  type LucideIcon,
} from "lucide-react";

/** Canonical loadout slot key, driven by the shared API enum. */
export type SlotKey = keyof typeof EquipInputSlot;

interface SlotMeta {
  label: string;
  icon: LucideIcon;
  /** The `ItemTemplate.slot` value that fits this loadout slot. */
  templateSlot: string;
}

/**
 * Per-slot presentation + the template-slot it accepts. Keep this in sync with
 * the shared `EquipInputSlot` enum; any enum member without an entry here still
 * renders via `slotMeta`'s graceful fallback so new slots never break the UI.
 */
export const SLOT_META: Partial<Record<SlotKey, SlotMeta>> = {
  weapon: { label: "Weapon", icon: Sword, templateSlot: "weapon" },
  helmet: { label: "Helmet", icon: HardHat, templateSlot: "helmet" },
  armor: { label: "Armor", icon: Shield, templateSlot: "armor" },
  shoulders: { label: "Shoulders", icon: Shirt, templateSlot: "shoulders" },
  gloves: { label: "Gloves", icon: Hand, templateSlot: "gloves" },
  pants: { label: "Pants", icon: PersonStanding, templateSlot: "pants" },
  boots: { label: "Boots", icon: Footprints, templateSlot: "boots" },
  cape: { label: "Cape", icon: Wind, templateSlot: "cape" },
  shield: { label: "Shield", icon: ShieldHalf, templateSlot: "shield" },
  neck: { label: "Neck", icon: Crown, templateSlot: "neck" },
  relic: { label: "Relic", icon: Gem, templateSlot: "relic" },
  abilityStone: { label: "Ability Stone I", icon: Sparkles, templateSlot: "ability_stone" },
  abilityStone2: { label: "Ability Stone II", icon: Sparkles, templateSlot: "ability_stone" },
  charm: { label: "Charm", icon: Clover, templateSlot: "charm" },
};

const PREFERRED_ORDER: SlotKey[] = [
  "weapon",
  "helmet",
  "armor",
  "shoulders",
  "gloves",
  "pants",
  "boots",
  "cape",
  "shield",
  "neck",
  "relic",
  "abilityStone",
  "abilityStone2",
  "charm",
];

/**
 * Ordered list of every loadout slot. Derived from the shared enum so newly
 * added slots appear automatically; known slots keep a hand-tuned order and any
 * unknown ones are appended.
 */
export const SLOT_ORDER: SlotKey[] = (() => {
  const all = Object.keys(EquipInputSlot) as SlotKey[];
  const ordered = PREFERRED_ORDER.filter((s) => all.includes(s));
  const extra = all.filter((s) => !ordered.includes(s));
  return [...ordered, ...extra];
})();

function titleize(key: string): string {
  return key
    .replace(/([a-z])([A-Z0-9])/g, "$1 $2")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Presentation for a slot, with a safe fallback for slots lacking explicit meta. */
export function slotMeta(slot: SlotKey): SlotMeta {
  return SLOT_META[slot] ?? { label: titleize(slot), icon: Gem, templateSlot: slot };
}
