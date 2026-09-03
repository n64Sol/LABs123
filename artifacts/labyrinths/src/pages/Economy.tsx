import {
  useGetTreasury,
  useGetOwnerEarnings,
  useCollectEarnings,
  useGetLedger,
  useGetActivityFeed,
  useGetMyActivity,
  useGetWorldStats,
  useGetChainStatus,
  useListChainTransactions,
  getGetOwnerEarningsQueryKey,
  getGetBalancesQueryKey,
  getGetLedgerQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { motion } from "framer-motion";
import { Coins, Landmark, TrendingUp, Wallet, Activity, ScrollText, HandCoins } from "lucide-react";
import { fmt, timeAgo, makeIdempotencyKey } from "@/lib/game";
import { toast } from "sonner";

function Stat({ label, value, icon: Icon, accent }: { label: string; value: string; icon: typeof Coins; accent?: boolean }) {
  return (
    <Card className={accent ? "bg-gradient-to-br from-primary/15 to-amber-200/20 border-primary/30" : ""}>
      <CardContent className="p-5">
        <div className="flex items-center gap-2 text-muted-foreground text-xs uppercase tracking-wide mb-2"><Icon className="w-4 h-4" /> {label}</div>
        <div className="text-3xl font-bold tabular-nums">{value}</div>
      </CardContent>
    </Card>
  );
}

export default function Economy() {
  const { data: treasury } = useGetTreasury();
  const { data: earnings } = useGetOwnerEarnings();
  const { data: ledger } = useGetLedger();
  const { data: activity } = useGetActivityFeed();
  const { data: myActivity } = useGetMyActivity();
  const { data: world } = useGetWorldStats();
  const { data: chain } = useGetChainStatus();
  const { data: chainTxns } = useListChainTransactions();
  const collect = useCollectEarnings();
  const qc = useQueryClient();

  const handleCollect = async () => {
    try {
      const res = await collect.mutateAsync({ data: { idempotencyKey: makeIdempotencyKey("collect") } });
      qc.invalidateQueries({ queryKey: getGetOwnerEarningsQueryKey() });
      qc.invalidateQueries({ queryKey: getGetBalancesQueryKey() });
      qc.invalidateQueries({ queryKey: getGetLedgerQueryKey() });
      toast.success(`Collected ${fmt(res.collectedLabToken)} $LAB`);
    } catch {
      toast.error("Nothing to collect right now.");
    }
  };

  const pending = earnings?.pendingTotal ?? 0;

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div>
        <h1 className="text-4xl font-bold tracking-tight mb-1">Economy</h1>
        <p className="text-muted-foreground text-lg">Your earnings, the realm's treasury, and the flow of $LAB on Robinhood Chain.</p>
      </div>

      {/* World stats */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Treasury Balance" value={`${fmt(treasury?.labTokenBalance)} $LAB`} icon={Landmark} accent />
        <Stat label="Total Runs" value={fmt(world?.totalRuns)} icon={Activity} />
        <Stat label="Published Labyrinths" value={fmt(world?.publishedLabyrinths)} icon={TrendingUp} />
        <Stat label="Value Dropped" value={fmt(world?.totalValueDropped)} icon={Coins} />
      </div>

      {/* Owner earnings */}
      <Card className="overflow-hidden">
        <CardContent className="p-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 text-sm font-semibold mb-3"><HandCoins className="w-5 h-5 text-primary" /> Owner Earnings</div>
              {earnings?.hasLabyrinth ? (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-6">
                  <div><div className="text-xs text-muted-foreground">Pending Drop Share</div><div className="text-xl font-bold">{fmt(earnings.pendingDropShareValue)}</div></div>
                  <div><div className="text-xs text-muted-foreground">Pending Entry Share</div><div className="text-xl font-bold">{fmt(earnings.pendingEntryShare)}</div></div>
                  <div><div className="text-xs text-muted-foreground">Lifetime Earned</div><div className="text-xl font-bold">{fmt(earnings.lifetimeDropShareValue + earnings.lifetimeEntryShare)}</div></div>
                  <div><div className="text-xs text-muted-foreground">Earned Today</div><div className="text-xl font-bold">{fmt(earnings.dropShareToday + earnings.entryShareToday)}</div></div>
                </div>
              ) : (
                <p className="text-muted-foreground">Claim and publish a labyrinth to start earning from visitors.</p>
              )}
            </div>
            {earnings?.hasLabyrinth && (
              <div className="text-right">
                <div className="text-xs text-muted-foreground mb-1">Available to collect</div>
                <div className="text-3xl font-bold text-primary mb-2">{fmt(pending)} $LAB</div>
                <Button disabled={pending <= 0 || collect.isPending} onClick={handleCollect}>
                  <Wallet className="w-4 h-4 mr-1" /> Collect Earnings
                </Button>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="activity" className="w-full">
        <TabsList>
          <TabsTrigger value="activity">World Activity</TabsTrigger>
          <TabsTrigger value="ledger">My Ledger</TabsTrigger>
          <TabsTrigger value="mine">My Activity</TabsTrigger>
          <TabsTrigger value="chain">Robinhood Chain</TabsTrigger>
        </TabsList>

        <TabsContent value="activity" className="mt-4 space-y-2">
          {(activity ?? []).map((a, i) => (
            <motion.div key={a.id} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.02 }}>
              <Card><CardContent className="p-3 flex items-center gap-3">
                <img src={a.actorAvatarUrl} alt="" className="w-8 h-8 rounded-full" />
                <div className="flex-1 text-sm">{a.message}</div>
                {a.value != null && <Badge variant="secondary">{fmt(a.value)}</Badge>}
                <span className="text-xs text-muted-foreground whitespace-nowrap">{timeAgo(a.createdAt)}</span>
              </CardContent></Card>
            </motion.div>
          ))}
          {(activity ?? []).length === 0 && <p className="text-muted-foreground py-8 text-center">No activity yet.</p>}
        </TabsContent>

        <TabsContent value="ledger" className="mt-4 space-y-2">
          {(ledger ?? []).map((l, i) => (
            <motion.div key={l.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.02 }}>
              <Card><CardContent className="p-3 flex items-center gap-3">
                <ScrollText className="w-4 h-4 text-muted-foreground shrink-0" />
                <div className="flex-1">
                  <div className="text-sm font-medium">{l.description}</div>
                  <div className="text-xs text-muted-foreground">{l.type} · {timeAgo(l.createdAt)}</div>
                </div>
                <span className={`font-bold tabular-nums ${l.amount >= 0 ? "text-emerald-600" : "text-destructive"}`}>{l.amount >= 0 ? "+" : ""}{fmt(l.amount)} {l.currency}</span>
              </CardContent></Card>
            </motion.div>
          ))}
          {(ledger ?? []).length === 0 && <p className="text-muted-foreground py-8 text-center">Your ledger is empty.</p>}
        </TabsContent>

        <TabsContent value="mine" className="mt-4 space-y-2">
          {(myActivity ?? []).map((a, i) => (
            <motion.div key={a.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.02 }}>
              <Card><CardContent className="p-3 flex items-center gap-3">
                <div className="flex-1 text-sm">{a.message}</div>
                {a.value != null && <Badge variant="secondary">{fmt(a.value)}</Badge>}
                <span className="text-xs text-muted-foreground whitespace-nowrap">{timeAgo(a.createdAt)}</span>
              </CardContent></Card>
            </motion.div>
          ))}
          {(myActivity ?? []).length === 0 && <p className="text-muted-foreground py-8 text-center">No personal activity yet.</p>}
        </TabsContent>

        <TabsContent value="chain" className="mt-4 space-y-4">
          {chain && (
            <Card className="border-dashed">
              <CardContent className="p-5">
                <div className="flex items-center justify-between mb-2">
                  <div className="font-semibold flex items-center gap-2"><Wallet className="w-4 h-4" /> {chain.network}</div>
                  <Badge variant={chain.connected ? "default" : "outline"}>{chain.connected ? "Ready" : "Unavailable"}</Badge>
                </div>
                <p className="text-sm text-muted-foreground mb-3">{chain.note}</p>
                <div className="grid sm:grid-cols-2 gap-2 text-xs font-mono">
                  <div className="truncate"><span className="text-muted-foreground">Chain ID: </span>{chain.chainId}</div>
                  <div className="truncate"><span className="text-muted-foreground">Settlement: </span>{chain.settlementMode.replace("_", " ")}</div>
                  <a href={chain.explorerUrl} target="_blank" rel="noreferrer" className="truncate sm:col-span-2 text-primary hover:underline">Open block explorer</a>
                </div>
              </CardContent>
            </Card>
          )}
          {(chainTxns ?? []).map((t) => (
            <Card key={t.id}><CardContent className="p-3 flex items-center gap-3">
              <Badge variant="outline" className="capitalize">{t.kind.replace(/_/g, " ")}</Badge>
              <div className="flex-1 min-w-0">
                <div className="text-sm">{t.memo ?? t.transactionReference}</div>
                <div className="text-xs text-muted-foreground font-mono truncate">{t.transactionReference} · {t.status}</div>
              </div>
              <span className="font-bold tabular-nums">{fmt(t.amount)} {t.currency}</span>
            </CardContent></Card>
          ))}
          {(chainTxns ?? []).length === 0 && <p className="text-muted-foreground py-8 text-center">No settlement records yet.</p>}
        </TabsContent>
      </Tabs>
    </div>
  );
}
