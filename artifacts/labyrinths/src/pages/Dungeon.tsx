import { useState, useEffect } from "react";
import { Link } from "wouter";
import {
  useGetMyLabyrinth,
  useClaimLabyrinth,
  useUpdateLabyrinth,
  usePublishLabyrinth,
  useUnpublishLabyrinth,
  useListUpgradeCatalog,
  useListLabyrinthUpgrades,
  useBuyLabyrinthUpgrade,
  useListRoomTypes,
  useUnlockRoomType,
  useUnlockTollGate,
  useSetTollGateFee,
  useGetSuggestedFee,
  useGetBalances,
  getGetMyLabyrinthQueryKey,
  getListLabyrinthUpgradesQueryKey,
  getListRoomTypesQueryKey,
  getGetSuggestedFeeQueryKey,
  getGetBalancesQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { motion } from "framer-motion";
import { Coins, Crown, Lock, Unlock, Eye, Send, Save, Sparkles, Castle, LayoutGrid, Check } from "lucide-react";
import { BIOMES, biome, fmt, makeIdempotencyKey } from "@/lib/game";
import { toast } from "sonner";

function ClaimView() {
  const claim = useClaimLabyrinth();
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [selBiome, setSelBiome] = useState("sunlit_ruins");

  const handleClaim = async () => {
    try {
      await claim.mutateAsync({ data: { name: name || undefined, biome: selBiome } });
      qc.invalidateQueries({ queryKey: getGetMyLabyrinthQueryKey() });
      toast.success("Labyrinth claimed!");
    } catch {
      toast.error("Could not claim a labyrinth.");
    }
  };

  return (
    <div className="max-w-xl mx-auto text-center py-12 animate-in fade-in zoom-in-95 duration-500">
      <div className="w-20 h-20 mx-auto rounded-3xl bg-primary/15 flex items-center justify-center mb-6">
        <Castle className="w-10 h-10 text-primary" />
      </div>
      <h1 className="text-3xl font-bold mb-2">Claim Your Labyrinth</h1>
      <p className="text-muted-foreground mb-8">Stake your claim on the overworld. Build it, fill it with danger, and earn from every adventurer who dares to enter.</p>
      <Card className="text-left"><CardContent className="p-6 space-y-4">
        <div>
          <Label className="mb-1.5 block">Name</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="The Gilded Descent" />
        </div>
        <div>
          <Label className="mb-1.5 block">Biome</Label>
          <Select value={selBiome} onValueChange={setSelBiome}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {Object.entries(BIOMES).map(([k, v]) => <SelectItem key={k} value={k}>{v.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <Button className="w-full" size="lg" disabled={claim.isPending} onClick={handleClaim}>
          <Crown className="w-5 h-5 mr-1" /> Claim Labyrinth
        </Button>
      </CardContent></Card>
    </div>
  );
}

export default function Dungeon() {
  const { data: lab, isLoading } = useGetMyLabyrinth();
  const qc = useQueryClient();

  if (isLoading) return <div className="h-96 rounded-2xl bg-muted animate-pulse" />;
  if (!lab) return <ClaimView />;

  return <ManageView labId={lab.id} />;
}

function ManageView({ labId }: { labId: number }) {
  const { data: lab } = useGetMyLabyrinth();
  const { data: catalog } = useListUpgradeCatalog();
  const { data: owned } = useListLabyrinthUpgrades(labId, { query: { queryKey: getListLabyrinthUpgradesQueryKey(labId) } });
  const { data: roomTypes } = useListRoomTypes(labId, { query: { queryKey: getListRoomTypesQueryKey(labId) } });
  const { data: suggested } = useGetSuggestedFee(labId, { query: { queryKey: getGetSuggestedFeeQueryKey(labId) } });
  const { data: balances } = useGetBalances();

  const update = useUpdateLabyrinth();
  const publish = usePublishLabyrinth();
  const unpublish = useUnpublishLabyrinth();
  const buy = useBuyLabyrinthUpgrade();
  const unlockRoom = useUnlockRoomType();
  const unlock = useUnlockTollGate();
  const setFee = useSetTollGateFee();
  const qc = useQueryClient();

  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [selBiome, setSelBiome] = useState("sunlit_ruins");
  const [fee, setFeeVal] = useState(0);

  useEffect(() => {
    if (lab) {
      setName(lab.name);
      setDesc(lab.description);
      setSelBiome(lab.biome);
      setFeeVal(lab.entryFee);
    }
  }, [lab?.id]);

  if (!lab) return null;

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: getGetMyLabyrinthQueryKey() });
    qc.invalidateQueries({ queryKey: getListLabyrinthUpgradesQueryKey(labId) });
    qc.invalidateQueries({ queryKey: getListRoomTypesQueryKey(labId) });
    qc.invalidateQueries({ queryKey: getGetSuggestedFeeQueryKey(labId) });
    qc.invalidateQueries({ queryKey: getGetBalancesQueryKey() });
  };

  const ownedMap = new Map((owned ?? []).map((u) => [u.key, u]));

  const handleSave = async () => {
    try {
      await update.mutateAsync({ id: labId, data: { name, description: desc, biome: selBiome } });
      invalidate();
      toast.success("Labyrinth updated.");
    } catch { toast.error("Update failed."); }
  };
  const handleBuy = async (key: string, name: string) => {
    try {
      await buy.mutateAsync({ id: labId, data: { upgradeKey: key, idempotencyKey: makeIdempotencyKey("up") } });
      invalidate();
      toast.success(`${name} upgraded.`);
    } catch { toast.error("Not enough gold for that upgrade."); }
  };
  const handleUnlockRoom = async (key: string, name: string) => {
    try {
      await unlockRoom.mutateAsync({ id: labId, data: { roomKey: key, idempotencyKey: makeIdempotencyKey("room") } });
      invalidate();
      toast.success(`${name} unlocked.`);
    } catch { toast.error("Not enough gold for that room type."); }
  };
  const handleUnlock = async () => {
    try {
      await unlock.mutateAsync({ id: labId, data: { idempotencyKey: makeIdempotencyKey("toll") } });
      invalidate();
      toast.success("Toll gate unlocked!");
    } catch { toast.error("Could not unlock the toll gate."); }
  };
  const handleSetFee = async () => {
    try {
      await setFee.mutateAsync({ id: labId, data: { entryFee: fee } });
      invalidate();
      toast.success("Entry fee set.");
    } catch { toast.error("Could not set the fee."); }
  };
  const handlePublishToggle = async () => {
    try {
      if (lab.published) { await unpublish.mutateAsync({ id: labId }); toast.success("Unpublished."); }
      else { await publish.mutateAsync({ id: labId }); toast.success("Published to the overworld!"); }
      invalidate();
    } catch { toast.error("Action failed."); }
  };

  const b = biome(lab.biome);

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Header */}
      <div className="relative overflow-hidden rounded-3xl border" style={{ background: b.bg }}>
        <div className="absolute inset-0 bg-gradient-to-t from-background via-background/30 to-transparent" />
        <div className="relative p-8 pt-20 flex flex-wrap items-end justify-between gap-4">
          <div>
            <Badge className="bg-primary text-primary-foreground mb-2"><Crown className="w-3 h-3 mr-1" />Your Labyrinth</Badge>
            <h1 className="text-4xl font-bold drop-shadow-sm">{lab.name}</h1>
            <p className="text-muted-foreground mt-1">Level {lab.level} · {b.name} · {lab.chamberCount} chambers</p>
          </div>
          <div className="flex gap-2">
            <Link href={`/labyrinth/${lab.id}`}><Button variant="secondary"><Eye className="w-4 h-4 mr-1" />Preview</Button></Link>
            <Button onClick={handlePublishToggle} disabled={publish.isPending || unpublish.isPending}>
              {lab.published ? <><Lock className="w-4 h-4 mr-1" />Unpublish</> : <><Send className="w-4 h-4 mr-1" />Publish</>}
            </Button>
          </div>
        </div>
      </div>

      {balances && (
        <div className="flex items-center gap-2 rounded-full bg-primary/10 px-4 py-2 font-bold text-primary w-fit"><Coins className="w-5 h-5" /> {fmt(balances.gold)} Gold</div>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_1.3fr]">
        {/* Edit panel */}
        <div className="space-y-6">
          <Card><CardContent className="p-6 space-y-4">
            <h2 className="font-bold">Identity</h2>
            <div><Label className="mb-1.5 block">Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
            <div><Label className="mb-1.5 block">Description</Label><Textarea rows={3} value={desc} onChange={(e) => setDesc(e.target.value)} /></div>
            <div><Label className="mb-1.5 block">Biome</Label>
              <Select value={selBiome} onValueChange={setSelBiome}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{Object.entries(BIOMES).map(([k, v]) => <SelectItem key={k} value={k}>{v.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <Button className="w-full" disabled={update.isPending} onClick={handleSave}><Save className="w-4 h-4 mr-1" />Save Changes</Button>
          </CardContent></Card>

          {/* Toll gate */}
          <Card><CardContent className="p-6 space-y-4">
            <h2 className="font-bold flex items-center gap-2">{lab.tollGateUnlocked ? <Unlock className="w-4 h-4 text-primary" /> : <Lock className="w-4 h-4" />} Toll Gate</h2>
            {lab.tollGateUnlocked ? (
              <>
                <p className="text-sm text-muted-foreground">Charge an entry fee. You keep 80% of every paid entry; 20% goes to the treasury.</p>
                {suggested && (
                  <div className="text-xs rounded-lg bg-muted p-3">
                    Suggested: <span className="font-semibold">{fmt(suggested.suggestedMin)}–{fmt(suggested.suggestedMax)}</span> $LAB
                    {suggested.rationale && <span className="block mt-1 text-muted-foreground">{suggested.rationale}</span>}
                    {suggested.warning && <span className="block mt-1 text-destructive">{suggested.warning}</span>}
                  </div>
                )}
                <div className="flex gap-2 items-end">
                  <div className="flex-1"><Label className="mb-1.5 block">Entry Fee</Label><Input type="number" min={0} value={fee} onChange={(e) => setFeeVal(Math.max(0, Math.floor(Number(e.target.value))))} /></div>
                  <Button disabled={setFee.isPending} onClick={handleSetFee}>Set Fee</Button>
                </div>
              </>
            ) : (
              <>
                <p className="text-sm text-muted-foreground">Unlock the toll gate to start charging adventurers for entry.</p>
                <Button className="w-full" disabled={unlock.isPending} onClick={handleUnlock}><Unlock className="w-4 h-4 mr-1" />Unlock Toll Gate</Button>
              </>
            )}
          </CardContent></Card>
        </div>

        {/* Upgrades */}
        <Card><CardContent className="p-6">
          <h2 className="font-bold mb-4 flex items-center gap-2"><Sparkles className="w-5 h-5 text-primary" />Upgrade Catalog</h2>
          <div className="space-y-3">
            {(catalog ?? []).map((u, i) => {
              const cur = ownedMap.get(u.key);
              const level = cur?.level ?? 0;
              const maxed = level >= u.maxLevel;
              const cost = cur?.nextCostGold ?? u.baseCostGold;
              const affordable = (balances?.gold ?? 0) >= cost;
              return (
                <motion.div key={u.key} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}
                  className="rounded-xl border p-4">
                  <div className="flex items-start gap-3">
                    {u.icon && <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center text-xl">{u.icon}</div>}
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold">{u.name}</span>
                        <Badge variant="outline" className="text-[10px] capitalize">{u.category}</Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">{u.description}</p>
                      <p className="text-xs text-primary mt-1">{u.effectSummary}</p>
                    </div>
                  </div>
                  <div className="mt-3">
                    <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
                      <span>Level {level} / {u.maxLevel}</span>
                      {!maxed && <span className="inline-flex items-center gap-1 font-semibold text-foreground"><Coins className="w-3 h-3" />{fmt(cost)}</span>}
                    </div>
                    <Progress value={(level / u.maxLevel) * 100} className="h-1.5 mb-2" />
                    <Button size="sm" className="w-full" disabled={maxed || !affordable || buy.isPending} onClick={() => handleBuy(u.key, u.name)}>
                      {maxed ? "Maxed" : !affordable ? "Need Gold" : level === 0 ? "Purchase" : "Upgrade"}
                    </Button>
                  </div>
                </motion.div>
              );
            })}
          </div>
        </CardContent></Card>

        {/* Room types */}
        <Card className="lg:col-span-2"><CardContent className="p-6">
          <h2 className="font-bold mb-1 flex items-center gap-2"><LayoutGrid className="w-5 h-5 text-primary" />Room Types</h2>
          <p className="text-sm text-muted-foreground mb-4">Unlock room types to expand the pool your runs are built from. Difficulty and rewards stay automatic — you shape <em>which</em> rooms can appear, not their order or loot.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            {(roomTypes ?? []).map((rt, i) => {
              const affordable = (balances?.gold ?? 0) >= rt.cost;
              return (
                <motion.div key={rt.key} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }}
                  className={`rounded-xl border p-4 ${rt.unlocked ? "border-primary/40 bg-primary/5" : ""}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold">{rt.name}</span>
                        <Badge variant="outline" className="text-[10px] capitalize">{rt.role}</Badge>
                        <Badge variant="outline" className="text-[10px] capitalize">{rt.size}</Badge>
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">{rt.description}</p>
                      <p className="text-[11px] text-muted-foreground mt-1">{rt.templateCount} layout{rt.templateCount === 1 ? "" : "s"}: {rt.sampleNames.join(", ")}</p>
                    </div>
                  </div>
                  <div className="mt-3">
                    {rt.unlocked ? (
                      <div className="flex items-center justify-center gap-1.5 text-xs font-semibold text-primary py-1.5">
                        <Check className="w-4 h-4" />{rt.starter ? "Starter" : "Unlocked"}
                      </div>
                    ) : (
                      <Button size="sm" className="w-full" disabled={!affordable || unlockRoom.isPending} onClick={() => handleUnlockRoom(rt.key, rt.name)}>
                        {!affordable ? "Need Gold" : <span className="inline-flex items-center gap-1"><Coins className="w-3 h-3" />Unlock · {fmt(rt.cost)}</span>}
                      </Button>
                    )}
                  </div>
                </motion.div>
              );
            })}
          </div>
        </CardContent></Card>
      </div>
    </div>
  );
}
