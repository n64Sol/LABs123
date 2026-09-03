import { Zap, MousePointerClick } from "lucide-react";
import { useCombatMode, type CombatMode } from "@/lib/combatMode";
import { cn } from "@/lib/utils";

const OPTIONS: { value: CombatMode; label: string; icon: typeof Zap; hint: string }[] = [
  { value: "auto", label: "Auto", icon: Zap, hint: "Attacks fire on their own" },
  { value: "manual", label: "Manual", icon: MousePointerClick, hint: "You aim & trigger attacks" },
];

/**
 * Run-setup control for the Auto vs Manual combat scheme. Writes straight to the
 * device-local combat-mode preference, so the choice persists and is picked up by
 * the next run that starts.
 */
export function CombatModeSelector({ className }: { className?: string }) {
  const [mode, setMode] = useCombatMode();
  return (
    <div className={className}>
      <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Combat Mode
      </div>
      <div className="grid grid-cols-2 gap-2">
        {OPTIONS.map((o) => {
          const active = mode === o.value;
          return (
            <button
              key={o.value}
              type="button"
              onClick={() => setMode(o.value)}
              aria-pressed={active}
              className={cn(
                "flex flex-col items-start gap-0.5 rounded-xl border-2 p-2.5 text-left transition-colors",
                active
                  ? "border-primary bg-primary/10"
                  : "border-border bg-muted/30 hover:bg-muted/60",
              )}
            >
              <span className="flex items-center gap-1.5 text-sm font-bold">
                <o.icon className="h-4 w-4" /> {o.label}
              </span>
              <span className="text-[11px] leading-tight text-muted-foreground">{o.hint}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
