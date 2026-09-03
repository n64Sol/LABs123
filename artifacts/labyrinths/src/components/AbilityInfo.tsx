import type { ItemTemplate } from "@workspace/api-client-react";
import { Sparkles, Timer } from "lucide-react";
import { abilityInfoFor, formatCooldown } from "@/lib/abilities";

/**
 * Surfaces the ability an Ability Stone grants — name, description, and base
 * cooldown — so players can judge a stone without entering a run. Renders
 * nothing for items that grant no ability. Shared by the Loadout's equipped
 * slots and the inventory list so they always read the same.
 */
export function AbilityInfo({
  template,
  compact = false,
}: {
  template: ItemTemplate;
  compact?: boolean;
}) {
  const info = abilityInfoFor(template);
  if (!info) return null;

  return (
    <div className="mt-1.5 rounded-md border border-violet-500/30 bg-violet-500/10 px-2 py-1.5">
      <div className="flex items-center gap-1.5 flex-wrap">
        <Sparkles className="w-3.5 h-3.5 shrink-0 text-violet-400" aria-hidden />
        <span className="text-xs font-semibold text-violet-200">{info.name}</span>
        {info.cooldownMs != null && (
          <span className="ml-auto inline-flex items-center gap-1 text-[10px] font-medium text-violet-300/90 tabular-nums">
            <Timer className="w-3 h-3" aria-hidden />
            {formatCooldown(info.cooldownMs)} CD
          </span>
        )}
      </div>
      {!compact && info.description && (
        <p className="mt-1 text-[11px] leading-snug text-muted-foreground">{info.description}</p>
      )}
    </div>
  );
}
