import type { ItemStats } from "@workspace/api-client-react";
import { STAT_LABELS } from "@/lib/game";

/**
 * Stat list for an item. When `compare` is supplied (the item currently equipped
 * in the slot this item would take), each stat shows a green/red delta vs that
 * item so the player can tell upgrades from downgrades at a glance. Shared by the
 * Loadout inventory and the in-run loot popup so the two always read the same.
 */
export function StatList({ stats, compare }: { stats?: ItemStats; compare?: ItemStats | null }) {
  if (!stats) return null;
  const keys = (Object.keys(STAT_LABELS) as (keyof ItemStats)[]).filter(
    (k) => (stats[k] ?? 0) !== 0 || (compare?.[k] ?? 0) !== 0,
  );
  if (keys.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
      {keys.map((k) => {
        const val = stats[k] ?? 0;
        const delta = compare ? val - (compare[k] ?? 0) : 0;
        return (
          <span key={k} className="text-muted-foreground">
            <span className="font-semibold text-foreground">{val > 0 ? `+${val}` : val}</span> {STAT_LABELS[k]}
            {compare && delta !== 0 && (
              <span
                className={`ml-0.5 font-bold tabular-nums ${delta > 0 ? "text-emerald-600" : "text-red-500"}`}
                title={`${delta > 0 ? "+" : ""}${delta} vs equipped`}
              >
                {delta > 0 ? `▲${delta}` : `▼${Math.abs(delta)}`}
              </span>
            )}
          </span>
        );
      })}
    </div>
  );
}
