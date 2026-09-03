import {
  useListCraftingRecipes,
  useListMyItems,
  useGetBalances,
  useCraftItem,
  useUpgradePlayerItem,
  getListCraftingRecipesQueryKey,
  getListMyItemsQueryKey,
  getGetBalancesQueryKey,
  getGetLoadoutQueryKey,
} from "@workspace/api-client-react";
import type { Material, ItemStats } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { motion } from "framer-motion";
import { Hammer, Coins, ArrowUp, Sparkles } from "lucide-react";
import { rarity, STAT_LABELS, fmt, makeIdempotencyKey } from "@/lib/game";
import { toast } from "sonner";

function MaterialCost({ mats, balanceMats }: { mats: Material[]; balanceMats: Material[] }) {
  return (
    <div className="flex flex-wrap gap-2">
      {mats.map((m) => {
        const have = balanceMats.find((b) => b.key === m.key)?.amount ?? 0;
        const enough = have >= m.amount;
        return (
          <span key={m.key} className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs border ${enough ? "border-border text-foreground" : "border-destructive/40 text-destructive"}`}>
            {m.icon && <span>{m.icon}</span>}
            {m.amount} {m.name} <span className="text-muted-foreground">({have})</span>
          </span>
        );
      })}
    </div>
  );
}

export default function Forge() {
  const { data: recipes, isLoading } = useListCraftingRecipes();
  const { data: items } = useListMyItems();
  const { data: balances } = useGetBalances();
  const craft = useCraftItem();
  const upgrade = useUpgradePlayerItem();
  const qc = useQueryClient();

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: getListMyItemsQueryKey() });
    qc.invalidateQueries({ queryKey: getGetBalancesQueryKey() });
    qc.invalidateQueries({ queryKey: getListCraftingRecipesQueryKey() });
    qc.invalidateQueries({ queryKey: getGetLoadoutQueryKey() });
  };

  const balanceMats = balances?.materials ?? [];

  const handleCraft = async (recipeId: number, name: string) => {
    try {
      await craft.mutateAsync({ data: { recipeId, idempotencyKey: makeIdempotencyKey("craft") } });
      invalidate();
      toast.success(`Forged ${name}`);
    } catch {
      toast.error("Not enough resources to craft this.");
    }
  };
  const handleUpgrade = async (playerItemId: number, name: string) => {
    try {
      await upgrade.mutateAsync({ id: playerItemId, data: { idempotencyKey: makeIdempotencyKey("up") } });
      invalidate();
      toast.success(`Upgraded ${name}`);
    } catch {
      toast.error("Not enough resources to upgrade.");
    }
  };

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-end justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-4xl font-bold tracking-tight mb-1 flex items-center gap-3">
            <Hammer className="w-8 h-8 text-primary" /> The Forge
          </h1>
          <p className="text-muted-foreground text-lg">Craft new gear and temper what you own.</p>
        </div>
        {balances && (
          <div className="flex items-center gap-2 rounded-full bg-primary/10 px-4 py-2 font-bold text-primary">
            <Coins className="w-5 h-5" /> {fmt(balances.gold)} Gold
          </div>
        )}
      </div>

      <Tabs defaultValue="craft" className="w-full">
        <TabsList>
          <TabsTrigger value="craft">Crafting</TabsTrigger>
          <TabsTrigger value="upgrade">Upgrade Gear</TabsTrigger>
        </TabsList>

        <TabsContent value="craft" className="mt-6">
          {isLoading ? (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">{Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-56 rounded-2xl bg-muted animate-pulse" />)}</div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {recipes?.map((recipe, idx) => {
                const r = rarity(recipe.resultTemplate.rarity);
                const goldOk = (balances?.gold ?? 0) >= recipe.costGold;
                const matsOk = recipe.costMaterials.every((m) => (balanceMats.find((b) => b.key === m.key)?.amount ?? 0) >= m.amount);
                const canCraft = goldOk && matsOk;
                return (
                  <motion.div key={recipe.id} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: idx * 0.05 }}>
                    <Card className={`h-full flex flex-col border-2 ${r.border}`}>
                      <CardContent className="p-5 flex flex-col h-full gap-3">
                        <div className="flex items-start gap-3">
                          <div className="w-12 h-12 rounded-xl flex items-center justify-center text-2xl" style={{ background: r.glow }}>{recipe.resultTemplate.icon}</div>
                          <div className="flex-1">
                            <div className="font-bold leading-tight">{recipe.resultTemplate.name}</div>
                            <Badge variant="outline" className={`${r.text} ${r.border} text-[10px] mt-1`}>{r.label}</Badge>
                          </div>
                        </div>
                        <p className="text-sm text-muted-foreground flex-1">{recipe.description}</p>
                        <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
                          {(Object.keys(recipe.resultTemplate.stats) as (keyof ItemStats)[])
                            .filter((k) => (recipe.resultTemplate.stats[k] ?? 0) !== 0)
                            .map((k) => <span key={k} className="text-muted-foreground"><span className="font-semibold text-foreground">+{recipe.resultTemplate.stats[k]}</span> {STAT_LABELS[k]}</span>)}
                        </div>
                        <div className="space-y-2 pt-1">
                          <div className={`inline-flex items-center gap-1 text-sm font-semibold ${goldOk ? "text-foreground" : "text-destructive"}`}><Coins className="w-4 h-4" /> {fmt(recipe.costGold)}</div>
                          <MaterialCost mats={recipe.costMaterials} balanceMats={balanceMats} />
                        </div>
                        <Button className="w-full mt-2" disabled={!canCraft || craft.isPending} onClick={() => handleCraft(recipe.id, recipe.resultTemplate.name)}>
                          <Hammer className="w-4 h-4 mr-1" /> {canCraft ? "Forge" : "Need Resources"}
                        </Button>
                      </CardContent>
                    </Card>
                  </motion.div>
                );
              })}
            </div>
          )}
        </TabsContent>

        <TabsContent value="upgrade" className="mt-6">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {(items ?? []).map((it, idx) => {
              const r = rarity(it.template.rarity);
              return (
                <motion.div key={it.id} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: idx * 0.04 }}>
                  <Card className={`h-full border-2 ${r.border}`}>
                    <CardContent className="p-5 flex flex-col gap-3 h-full">
                      <div className="flex items-start gap-3">
                        <div className="w-12 h-12 rounded-xl flex items-center justify-center text-2xl" style={{ background: r.glow }}>{it.template.icon}</div>
                        <div className="flex-1">
                          <div className="font-bold leading-tight">{it.template.name}</div>
                          <div className="flex items-center gap-2 mt-1">
                            <Badge variant="outline" className={`${r.text} ${r.border} text-[10px]`}>Lv {it.level}</Badge>
                            {it.equipped && <Badge variant="secondary" className="text-[10px]"><Sparkles className="w-3 h-3 mr-1" />Equipped</Badge>}
                          </div>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs flex-1">
                        {(Object.keys(it.stats ?? it.template.stats) as (keyof ItemStats)[])
                          .filter((k) => ((it.stats ?? it.template.stats)[k] ?? 0) !== 0)
                          .map((k) => <span key={k} className="text-muted-foreground"><span className="font-semibold text-foreground">+{(it.stats ?? it.template.stats)[k]}</span> {STAT_LABELS[k]}</span>)}
                      </div>
                      <Button variant="secondary" className="w-full" disabled={upgrade.isPending} onClick={() => handleUpgrade(it.id, it.template.name)}>
                        <ArrowUp className="w-4 h-4 mr-1" /> Upgrade to Lv {it.level + 1}
                      </Button>
                    </CardContent>
                  </Card>
                </motion.div>
              );
            })}
            {(items ?? []).length === 0 && <p className="text-muted-foreground col-span-full py-12 text-center">You own no items yet. Craft some on the Crafting tab.</p>}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
