import type { PlayerItem, LoadoutSlots } from "@workspace/api-client-react";
import { effectiveStats, statTotal } from "./game";
import { SLOT_ORDER, slotMeta, type SlotKey } from "./slots";

/**
 * The loadout slot a template-slot item ("ability_stone") would equip into: the
 * first free matching slot, or — when all are full — the weakest occupied one,
 * so equipping always swaps out your worst piece (and matches the comparison
 * shown to the player). Covers dual slots like the two ability stones.
 */
export function targetSlotFor(
  slots: LoadoutSlots | undefined,
  templateSlot: string,
): SlotKey | null {
  const matches = SLOT_ORDER.filter((s) => slotMeta(s).templateSlot === templateSlot);
  if (matches.length === 0) return null;
  const free = matches.find((s) => !slots?.[s]);
  if (free) return free;
  return matches.reduce((weakest, s) =>
    statTotal(effectiveStats(slots?.[s])) < statTotal(effectiveStats(slots?.[weakest]))
      ? s
      : weakest,
  );
}

/**
 * The equipped item a given item would be compared against: the piece in the
 * slot it would replace. Returns null when that slot is free (pure addition,
 * nothing to compare) or when the item is itself the equipped piece.
 */
export function compareItemFor(
  slots: LoadoutSlots | undefined,
  it: PlayerItem,
): PlayerItem | null {
  const target = targetSlotFor(slots, it.template.slot);
  const equipped = target ? slots?.[target] ?? null : null;
  return equipped && equipped.id !== it.id ? equipped : null;
}

/**
 * Highest-power item the player owns for each template slot — the "Best in Slot"
 * set, so the strongest piece is obvious whether browsing inventory or loot.
 */
export function computeBestInSlotIds(items: PlayerItem[] | undefined): Set<number> {
  const best: Record<string, { id: number; total: number }> = {};
  for (const it of items ?? []) {
    const t = it.template.slot;
    const total = statTotal(effectiveStats(it));
    if (!best[t] || total > best[t].total) best[t] = { id: it.id, total };
  }
  return new Set(Object.values(best).map((b) => b.id));
}

/**
 * Whether `it` is a net power upgrade over the item it would replace. False when
 * there is nothing to compare against (a free slot).
 */
export function isUpgradeOver(it: PlayerItem, compare: PlayerItem | null): boolean {
  if (!compare) return false;
  return statTotal(effectiveStats(it)) > statTotal(effectiveStats(compare));
}
