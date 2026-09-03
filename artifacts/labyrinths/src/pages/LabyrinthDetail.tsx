import { useParams, useLocation, Link } from "wouter";
import {
  useGetLabyrinth,
  useGetLabyrinthPreview,
  useListLabyrinthRatings,
  useStartRun,
  useGetCurrentPlayer,
  getGetLabyrinthQueryKey,
  getGetLabyrinthPreviewQueryKey,
  getListLabyrinthRatingsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { motion } from "framer-motion";
import { Star, Swords, Coins, Users, Gauge, ArrowLeft, Lock, Crown, Skull, Trophy, Clock } from "lucide-react";
import { rarity, biome, fmt, makeIdempotencyKey } from "@/lib/game";
import { CombatModeSelector } from "@/components/CombatModeSelector";
import { toast } from "sonner";

const DIFFICULTY_LABELS: Record<string, string> = { novice: "Novice", adept: "Adept", veteran: "Veteran", master: "Master", mythic: "Mythic" };

export default function LabyrinthDetail() {
  const params = useParams();
  const id = Number(params.id);
  const [, setLocation] = useLocation();
  const qc = useQueryClient();

  const { data: lab, isLoading } = useGetLabyrinth(id, { query: { enabled: !!id, queryKey: getGetLabyrinthQueryKey(id) } });
  const { data: preview } = useGetLabyrinthPreview(id, { query: { enabled: !!id, queryKey: getGetLabyrinthPreviewQueryKey(id) } });
  const { data: ratings } = useListLabyrinthRatings(id, { query: { enabled: !!id, queryKey: getListLabyrinthRatingsQueryKey(id) } });
  const { data: player } = useGetCurrentPlayer();
  const start = useStartRun();

  const handleRun = async () => {
    try {
      const run = await start.mutateAsync({ data: { labyrinthId: id, idempotencyKey: makeIdempotencyKey("run") } });
      qc.invalidateQueries({ queryKey: getGetLabyrinthQueryKey(id) });
      setLocation(`/run/${run.id}`);
    } catch {
      toast.error("Could not start the run. Check your balance for paid labyrinths.");
    }
  };

  if (isLoading || !lab) {
    return <div className="space-y-4"><div className="h-48 rounded-2xl bg-muted animate-pulse" /><div className="h-64 rounded-2xl bg-muted animate-pulse" /></div>;
  }

  const b = biome(lab.biome);
  const isOwner = lab.isOwner;
  const isPaid = lab.tollGateUnlocked && lab.entryFee > 0 && !isOwner;
  const canAfford = (player?.balances.gold ?? 0) >= lab.entryFee;

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <Link href="/" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="w-4 h-4" /> Back to Overworld
      </Link>

      {/* Hero */}
      <div className="relative overflow-hidden rounded-3xl border" style={{ background: b.bg }}>
        <div className="absolute inset-0 bg-gradient-to-t from-background via-background/40 to-transparent" />
        <div className="relative p-8 pt-32">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Badge className="bg-background/80 text-foreground backdrop-blur">Level {lab.level}</Badge>
                <Badge variant="outline" className="bg-background/60 backdrop-blur">{b.name}</Badge>
                {lab.bossActive && <Badge className="bg-destructive text-destructive-foreground"><Skull className="w-3 h-3 mr-1" />Boss Active</Badge>}
                {isOwner && <Badge className="bg-primary text-primary-foreground"><Crown className="w-3 h-3 mr-1" />Yours</Badge>}
              </div>
              <h1 className="text-4xl font-bold tracking-tight drop-shadow-sm">{lab.name}</h1>
              <div className="flex items-center gap-2 mt-2 text-muted-foreground">
                <img src={lab.ownerAvatarUrl} alt="" className="w-6 h-6 rounded-full" />
                <span>by {lab.ownerName}</span>
                <span className="inline-flex items-center gap-1 ml-2 text-amber-600 font-semibold"><Star className="w-4 h-4 fill-current" />{lab.ratingAverage.toFixed(1)}</span>
                <span className="text-xs">({lab.ratingCount})</span>
              </div>
            </div>
            <div className="text-right">
              {isPaid ? (
                <div className="mb-2 inline-flex items-center gap-1 rounded-full bg-background/80 px-3 py-1 font-bold text-primary backdrop-blur"><Coins className="w-4 h-4" /> {fmt(lab.entryFee)} entry</div>
              ) : (
                <div className="mb-2 inline-flex items-center gap-1 rounded-full bg-emerald-100 px-3 py-1 font-semibold text-emerald-700">Free entry</div>
              )}
              <div>
                <CombatModeSelector className="mb-3 w-56 rounded-xl bg-background/70 p-3 backdrop-blur" />
                <Button size="lg" className="shadow-lg" disabled={start.isPending || (isPaid && !canAfford)} onClick={handleRun}>
                  <Swords className="w-5 h-5 mr-1" /> {isOwner ? "Self-Run (preview)" : isPaid && !canAfford ? "Not enough gold" : "Enter the Labyrinth"}
                </Button>
                {isOwner && <p className="text-xs text-muted-foreground mt-1">No entry fee or drop-share on your own runs.</p>}
              </div>
            </div>
          </div>
        </div>
      </div>

      <p className="text-lg text-muted-foreground">{lab.description || "A mysterious dungeon waiting to be explored."}</p>

      {/* Stats grid */}
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        {[
          { icon: Swords, label: "Runs Today", value: `${fmt(lab.runsToday)} / ${fmt(lab.dailyRunCapacity)}` },
          { icon: Coins, label: "Reward Today", value: `${fmt(lab.rewardValueToday)} / ${fmt(lab.dailyRewardCapacity)}` },
          { icon: Users, label: "All-Time Runs", value: fmt(lab.runsAllTime) },
          { icon: Gauge, label: "Appeal Score", value: fmt(lab.appealScore) },
        ].map((s) => (
          <Card key={s.label}><CardContent className="p-4">
            <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground mb-1"><s.icon className="w-4 h-4" />{s.label}</div>
            <div className="text-xl font-bold tabular-nums">{s.value}</div>
          </CardContent></Card>
        ))}
      </div>

      {/* Preview: chambers + loot + difficulty */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card><CardContent className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold">Chambers</h2>
            {preview && <Badge variant="secondary" className="gap-1"><Clock className="w-3 h-3" />~{Math.round(preview.estimatedClearSeconds)}s · {DIFFICULTY_LABELS[preview.difficulty] ?? preview.difficulty}</Badge>}
          </div>
          <div className="space-y-2">
            {preview?.chambers.map((c, i) => (
              <motion.div key={c.id} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.05 }}
                className="flex items-center gap-3 rounded-xl border p-3">
                <div className="w-7 h-7 rounded-full bg-primary/15 text-primary font-bold flex items-center justify-center text-sm">{i + 1}</div>
                <div className="flex-1">
                  <div className="font-semibold">{c.name}</div>
                  <div className="text-xs text-muted-foreground">{biome(c.biome).name} · {c.enemyCount} foes · loot tier {c.lootTier}</div>
                </div>
                {c.hasBoss && <Badge className="bg-destructive text-destructive-foreground"><Skull className="w-3 h-3 mr-1" />Boss</Badge>}
              </motion.div>
            ))}
            {!preview && <div className="h-32 rounded-xl bg-muted animate-pulse" />}
          </div>
        </CardContent></Card>

        <Card><CardContent className="p-6">
          <h2 className="text-lg font-bold mb-4 flex items-center gap-2"><Trophy className="w-5 h-5 text-primary" />Loot Table</h2>
          <div className="space-y-2">
            {preview?.lootTable.map((entry, i) => {
              const r = rarity(entry.rarity);
              return (
                <div key={i} className={`flex items-center gap-3 rounded-xl border-2 ${r.border} ${r.bg} p-2.5`}>
                  {entry.icon && <span className="text-lg">{entry.icon}</span>}
                  <div className="flex-1">
                    <div className="font-semibold text-sm">{entry.label}</div>
                    <div className="text-xs text-muted-foreground">{fmt(entry.minValue)}–{fmt(entry.maxValue)} value</div>
                  </div>
                  <Badge variant="outline" className={`${r.text} ${r.border} text-[10px]`}>{Math.round(entry.chance * 100)}%</Badge>
                </div>
              );
            })}
            {!preview && <div className="h-32 rounded-xl bg-muted animate-pulse" />}
          </div>
        </CardContent></Card>
      </div>

      {/* Toll gate note */}
      {!lab.tollGateUnlocked && (
        <Card className="border-dashed"><CardContent className="p-4 flex items-center gap-3 text-sm text-muted-foreground">
          <Lock className="w-4 h-4" /> This labyrinth's toll gate is not unlocked — runs are free for everyone.
        </CardContent></Card>
      )}

      {/* Ratings */}
      <div>
        <h2 className="text-lg font-bold mb-3">Reviews</h2>
        <div className="space-y-3">
          {(ratings ?? []).map((rt) => (
            <Card key={rt.id}><CardContent className="p-4">
              <div className="flex items-center gap-3 mb-1">
                <img src={rt.raterAvatarUrl} alt="" className="w-7 h-7 rounded-full" />
                <span className="font-semibold text-sm">{rt.raterName}</span>
                <div className="flex items-center gap-0.5 text-amber-500">
                  {Array.from({ length: 5 }).map((_, i) => <Star key={i} className={`w-3.5 h-3.5 ${i < rt.stars ? "fill-current" : "text-muted"}`} />)}
                </div>
                {rt.difficultyVote && <Badge variant="outline" className="text-[10px] capitalize">{rt.difficultyVote.replace(/_/g, " ")}</Badge>}
              </div>
              {rt.comment && <p className="text-sm text-muted-foreground">{rt.comment}</p>}
            </CardContent></Card>
          ))}
          {(ratings ?? []).length === 0 && <p className="text-muted-foreground text-sm py-6 text-center">No reviews yet. Be the first to run it.</p>}
        </div>
      </div>
    </div>
  );
}
