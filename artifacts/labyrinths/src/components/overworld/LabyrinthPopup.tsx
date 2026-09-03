import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import {
  useGetLabyrinth,
  useGetLabyrinthPreview,
  useGetLoadout,
  useStartRun,
  useGetCurrentPlayer,
  getGetLabyrinthQueryKey,
  getGetLabyrinthPreviewQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Star, Swords, Coins, Gauge, X, Lock, Crown, Skull, Trophy, Clock, ChevronDown, ChevronUp, Shield,
} from "lucide-react";
import { rarity, biome, fmt, makeIdempotencyKey } from "@/lib/game";
import { CombatModeSelector } from "@/components/CombatModeSelector";
import { fetchLeaderboard, type LeaderRow } from "@/lib/overworld/worldClient";
import { toast } from "sonner";

const DIFFICULTY_LABELS: Record<string, string> = {
  novice: "Novice", adept: "Adept", veteran: "Veteran", master: "Master", mythic: "Mythic",
};

function combatPower(stats?: Partial<Record<string, number>>): number {
  if (!stats) return 0;
  const a = stats.attack ?? 0;
  const d = stats.defense ?? 0;
  const h = stats.health ?? 0;
  return Math.round(a * 2 + d * 1.5 + h * 0.2);
}

interface Props {
  id: number;
  /** Called after a run is started, with the run id to navigate to. */
  onEnter: (runId: string) => void;
  onClose: () => void;
}

/**
 * In-world quick-glance card for a labyrinth. Opens over the overworld canvas so
 * a player can size up a labyrinth (difficulty vs. their power, loot ceiling,
 * fee, biome), optionally expand full details, and enter a run directly — no
 * page navigation.
 */
export default function LabyrinthPopup({ id, onEnter, onClose }: Props) {
  const [, setLocation] = useLocation();
  const qc = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const [leaders, setLeaders] = useState<LeaderRow[] | null>(null);

  const { data: lab, isLoading } = useGetLabyrinth(id, {
    query: { enabled: !!id, queryKey: getGetLabyrinthQueryKey(id) },
  });
  const { data: preview } = useGetLabyrinthPreview(id, {
    query: { enabled: !!id, queryKey: getGetLabyrinthPreviewQueryKey(id) },
  });
  const { data: player } = useGetCurrentPlayer();
  const { data: loadout } = useGetLoadout();
  const start = useStartRun();

  // Lazily load the leaderboard the first time details are expanded.
  useEffect(() => {
    if (expanded && leaders === null) {
      void fetchLeaderboard(id).then(setLeaders);
    }
  }, [expanded, leaders, id]);

  // Close on Escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const handleRun = async () => {
    try {
      const run = await start.mutateAsync({ data: { labyrinthId: id, idempotencyKey: makeIdempotencyKey("run") } });
      qc.invalidateQueries({ queryKey: getGetLabyrinthQueryKey(id) });
      onEnter(String(run.id));
    } catch {
      toast.error("Could not start the run. Check your balance for paid labyrinths.");
    }
  };

  const b = biome(lab?.biome);
  const isOwner = lab?.isOwner ?? false;
  const canEnter = (lab?.published ?? false) || isOwner;
  const isPaid = !!lab && lab.tollGateUnlocked && lab.entryFee > 0 && !isOwner;
  const canAfford = (player?.balances.gold ?? 0) >= (lab?.entryFee ?? 0);
  const power = combatPower(loadout?.combatStats as Record<string, number> | undefined);
  const lootCeiling = preview?.lootTable.reduce((m, e) => Math.max(m, e.maxValue), 0) ?? 0;

  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center p-4">
      {/* Scrim */}
      <div className="absolute inset-0 bg-black/55 backdrop-blur-sm animate-in fade-in" onClick={onClose} />

      <div
        className="relative w-full max-w-md max-h-[88%] overflow-y-auto rounded-2xl border border-border bg-card shadow-2xl animate-in fade-in zoom-in-95 duration-200"
        role="dialog"
        aria-modal="true"
      >
        {/* Banner */}
        <div className="relative h-24 w-full" style={{ background: b.bg }}>
          <div className="absolute inset-0 bg-gradient-to-t from-card via-card/30 to-transparent" />
          <button
            onClick={onClose}
            className="absolute right-2 top-2 rounded-full bg-background/70 p-1.5 text-foreground backdrop-blur transition-colors hover:bg-background"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="-mt-8 space-y-4 p-5">
          {isLoading || !lab ? (
            <div className="space-y-3">
              <div className="h-6 w-2/3 rounded bg-muted animate-pulse" />
              <div className="h-20 rounded bg-muted animate-pulse" />
            </div>
          ) : (
            <>
              {/* Title + owner */}
              <div>
                <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
                  <Badge className="bg-background/80 text-foreground backdrop-blur">Level {lab.level}</Badge>
                  <Badge variant="outline" className="bg-background/60 backdrop-blur">{b.name}</Badge>
                  {lab.bossActive && (
                    <Badge className="bg-destructive text-destructive-foreground"><Skull className="mr-1 h-3 w-3" />Boss</Badge>
                  )}
                  {isOwner && (
                    <Badge className="bg-primary text-primary-foreground"><Crown className="mr-1 h-3 w-3" />Yours</Badge>
                  )}
                  {!lab.published && !isOwner && (
                    <Badge variant="outline" className="border-dashed">Unpublished</Badge>
                  )}
                </div>
                <h2 className="text-2xl font-bold leading-tight">{lab.name}</h2>
                <div className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
                  <img src={lab.ownerAvatarUrl} alt="" className="h-5 w-5 rounded-full" />
                  <span>by {lab.ownerName}</span>
                  <span className="ml-1 inline-flex items-center gap-1 font-semibold text-amber-500">
                    <Star className="h-3.5 w-3.5 fill-current" />{lab.ratingAverage.toFixed(1)}
                  </span>
                </div>
              </div>

              {/* Quick-glance stats: difficulty vs power, loot ceiling, fee */}
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div className="rounded-xl border bg-muted/30 p-3">
                  <div className="mb-1 flex items-center gap-1.5 text-xs uppercase tracking-wide text-muted-foreground">
                    <Gauge className="h-3.5 w-3.5" /> Difficulty
                  </div>
                  <div className="font-bold">
                    {preview ? (DIFFICULTY_LABELS[preview.difficulty] ?? preview.difficulty) : "—"}
                  </div>
                </div>
                <div className="rounded-xl border bg-muted/30 p-3">
                  <div className="mb-1 flex items-center gap-1.5 text-xs uppercase tracking-wide text-muted-foreground">
                    <Shield className="h-3.5 w-3.5" /> Your Power
                  </div>
                  <div className="font-bold tabular-nums">{fmt(power)}</div>
                </div>
                <div className="rounded-xl border bg-muted/30 p-3">
                  <div className="mb-1 flex items-center gap-1.5 text-xs uppercase tracking-wide text-muted-foreground">
                    <Trophy className="h-3.5 w-3.5" /> Loot Ceiling
                  </div>
                  <div className="font-bold tabular-nums">{lootCeiling ? fmt(lootCeiling) : "—"}</div>
                </div>
                <div className="rounded-xl border bg-muted/30 p-3">
                  <div className="mb-1 flex items-center gap-1.5 text-xs uppercase tracking-wide text-muted-foreground">
                    <Coins className="h-3.5 w-3.5" /> Entry
                  </div>
                  <div className="font-bold">
                    {isPaid ? <span className="text-primary">{fmt(lab.entryFee)}</span> : <span className="text-emerald-600">Free</span>}
                  </div>
                </div>
              </div>

              {preview && (
                <div className="flex items-center justify-center gap-1 text-xs text-muted-foreground">
                  <Clock className="h-3 w-3" /> ~{Math.round(preview.estimatedClearSeconds)}s estimated clear
                </div>
              )}

              <CombatModeSelector />

              {/* Enter */}
              <Button
                size="lg"
                className="w-full shadow"
                disabled={!canEnter || start.isPending || (isPaid && !canAfford)}
                onClick={handleRun}
              >
                <Swords className="mr-1 h-5 w-5" />
                {!canEnter
                  ? "Not published yet"
                  : isOwner
                    ? "Self-Run (preview)"
                    : isPaid && !canAfford
                      ? "Not enough gold"
                      : "Enter the Labyrinth"}
              </Button>

              {/* More info toggle */}
              <button
                onClick={() => setExpanded((v) => !v)}
                className="flex w-full items-center justify-center gap-1 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
              >
                {expanded ? <>Less info <ChevronUp className="h-4 w-4" /></> : <>More info <ChevronDown className="h-4 w-4" /></>}
              </button>

              {expanded && (
                <div className="space-y-4 border-t pt-4 animate-in fade-in slide-in-from-top-2">
                  {/* Lore */}
                  {lab.description && (
                    <p className="text-sm text-muted-foreground">{lab.description}</p>
                  )}

                  {/* Drop table */}
                  <div>
                    <h3 className="mb-2 flex items-center gap-1.5 text-sm font-bold">
                      <Trophy className="h-4 w-4 text-primary" /> Drop Table
                    </h3>
                    <div className="space-y-1.5">
                      {preview?.lootTable.map((entry, i) => {
                        const r = rarity(entry.rarity);
                        return (
                          <div key={i} className={`flex items-center gap-2 rounded-lg border ${r.border} ${r.bg} p-2`}>
                            {entry.icon && <span className="text-base">{entry.icon}</span>}
                            <div className="flex-1">
                              <div className="text-sm font-semibold">{entry.label}</div>
                              <div className="text-[11px] text-muted-foreground">{fmt(entry.minValue)}–{fmt(entry.maxValue)} value</div>
                            </div>
                            <Badge variant="outline" className={`${r.text} ${r.border} text-[10px]`}>
                              {Math.round(entry.chance * 100)}%
                            </Badge>
                          </div>
                        );
                      })}
                      {!preview && <div className="h-20 rounded-lg bg-muted animate-pulse" />}
                    </div>
                  </div>

                  {/* Leaderboard */}
                  <div>
                    <h3 className="mb-2 flex items-center gap-1.5 text-sm font-bold">
                      <Crown className="h-4 w-4 text-amber-500" /> Top Finishers
                    </h3>
                    {leaders === null ? (
                      <div className="h-16 rounded-lg bg-muted animate-pulse" />
                    ) : leaders.length === 0 ? (
                      <p className="py-3 text-center text-xs text-muted-foreground">No one has cleared this labyrinth yet. Be the first.</p>
                    ) : (
                      <div className="space-y-1">
                        {leaders.map((row) => (
                          <div key={row.rank} className="flex items-center gap-2 rounded-lg border p-2 text-sm">
                            <span className="w-5 text-center font-bold text-muted-foreground">{row.rank}</span>
                            {row.avatarUrl ? (
                              <img src={row.avatarUrl} alt="" className="h-6 w-6 rounded-full" />
                            ) : (
                              <div className="h-6 w-6 rounded-full bg-muted" />
                            )}
                            <span className="flex-1 truncate font-medium">{row.name}</span>
                            {row.bossDefeated && <Skull className="h-3.5 w-3.5 text-destructive" />}
                            <span className="inline-flex items-center gap-1 font-semibold tabular-nums text-primary">
                              <Coins className="h-3.5 w-3.5" />{fmt(row.rewardValue)}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Full detail link */}
                  <button
                    onClick={() => { onClose(); setLocation(`/labyrinth/${id}`); }}
                    className="text-xs text-muted-foreground underline-offset-2 hover:underline"
                  >
                    Open full labyrinth page
                  </button>
                </div>
              )}

              {!lab.tollGateUnlocked && (
                <div className="flex items-center gap-2 rounded-lg border border-dashed p-2.5 text-xs text-muted-foreground">
                  <Lock className="h-3.5 w-3.5" /> Toll gate locked — runs are free for everyone.
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
