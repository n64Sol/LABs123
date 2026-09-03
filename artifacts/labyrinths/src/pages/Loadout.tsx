import { useEffect, useMemo, useRef, useState } from "react";
import {
  useGetLoadout,
  useListMyItems,
  useEquipItem,
  useUnequipSlot,
  useBulkDisposeItems,
  useGetDuelRecord,
  getGetLoadoutQueryKey,
  getListMyItemsQueryKey,
  getGetBalancesQueryKey,
} from "@workspace/api-client-react";
import type { PlayerItem, ItemStats, LoadoutSlots, DuelRecord } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { motion, AnimatePresence } from "framer-motion";
import { X, Plus, Check, Search, ArrowDownUp, ArrowUp, Crown, Coins, Recycle, CheckSquare, Square, Tag, Swords } from "lucide-react";
import { toast } from "sonner";
import { rarity, RARITY_ORDER, STAT_LABELS, fmt, effectiveStats, makeIdempotencyKey, timeAgo } from "@/lib/game";
import { SLOT_ORDER, slotMeta, type SlotKey } from "@/lib/slots";
import { compareItemFor, computeBestInSlotIds, isUpgradeOver, targetSlotFor } from "@/lib/gear";
import { StatList } from "@/components/StatList";
import { AbilityInfo } from "@/components/AbilityInfo";
import { composeLoadoutSprite, loadBaseSprite, drawStillPose } from "@/lib/sprite";

type SortKey =
  | "default"
  | "rarity"
  | "level"
  | "name"
  | "attack"
  | "defense"
  | "health";

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: "default", label: "Equipped first" },
  { key: "rarity", label: "Rarity" },
  { key: "level", label: "Item level" },
  { key: "name", label: "Name (A–Z)" },
  { key: "attack", label: "Attack" },
  { key: "defense", label: "Defense" },
  { key: "health", label: "Health" },
];

const RARITY_RANK: Record<string, number> = Object.fromEntries(
  RARITY_ORDER.map((r, i) => [r, i]),
);

/** A single stat value off an item (level-scaled if present), for sorting. */
function itemStat(it: PlayerItem, key: keyof ItemStats): number {
  const stats = it.stats ?? it.template.stats;
  return stats?.[key] ?? 0;
}

/**
 * Build a haystack of searchable text for an item: name, rarity, slot label,
 * and any non-zero stat keywords (e.g. "attack", "crit chance").
 */
function searchHaystack(it: PlayerItem): string {
  const stats = it.stats ?? it.template.stats;
  const statWords = stats
    ? (Object.keys(stats) as (keyof ItemStats)[])
        .filter((k) => (stats[k] ?? 0) !== 0)
        .map((k) => STAT_LABELS[k])
    : [];
  return [
    it.template.name,
    rarity(it.template.rarity).label,
    it.template.slot,
    ...statWords,
  ]
    .join(" ")
    .toLowerCase();
}

/**
 * Still, front-facing character composed from the equipped loadout using the
 * same shared compositor the in-game character uses, so they match. Re-composes
 * whenever any equipped slot changes.
 */
function CharacterPreview({ slots }: { slots?: LoadoutSlots }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Re-run composition only when the set of equipped sprite-bearing items changes.
  const layerKey = useMemo(() => {
    if (!slots) return "";
    return SLOT_ORDER.map((s) => {
      const item = slots[s];
      return item?.template.spriteLayers ? `${s}:${item.template.key}` : "";
    })
      .filter(Boolean)
      .join("|");
  }, [slots]);

  useEffect(() => {
    let cancelled = false;
    const baseUrl = import.meta.env.BASE_URL as string;

    const paint = (src: CanvasImageSource | null) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const dpr = window.devicePixelRatio || 1;
      const cssSize = canvas.clientWidth || 240;
      if (canvas.width !== cssSize * dpr) {
        canvas.width = cssSize * dpr;
        canvas.height = cssSize * dpr;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, cssSize, cssSize);
      if (!src) return;
      // Center, scale to ~78% of the panel, anchored slightly low for footing.
      const size = cssSize * 0.78;
      drawStillPose(ctx, src, (cssSize - size) / 2, (cssSize - size) / 2 + cssSize * 0.06, size);
    };

    composeLoadoutSprite(slots, baseUrl).then(async (composed) => {
      if (cancelled) return;
      if (composed) {
        paint(composed);
      } else {
        const base = await loadBaseSprite(baseUrl);
        if (!cancelled) paint(base);
      }
    });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layerKey]);

  return (
    <div className="relative aspect-square w-full max-w-[260px] mx-auto rounded-2xl bg-gradient-to-b from-muted/60 to-background border overflow-hidden">
      <div
        className="absolute inset-x-0 bottom-6 mx-auto h-6 w-1/2 rounded-[50%] bg-black/20 blur-md"
        aria-hidden
      />
      <canvas ref={canvasRef} className="relative h-full w-full [image-rendering:pixelated]" />
    </div>
  );
}

/**
 * Durable PvP standing: lifetime wins/losses, win rate, and a short list of the
 * player's most recent duels so their victories actually stick.
 */
function DuelRecordCard({ record }: { record?: DuelRecord }) {
  return (
    <Card>
      <CardContent className="p-6 space-y-4">
        <div className="flex items-center gap-2">
          <Swords className="w-4 h-4 text-primary" />
          <span className="text-sm font-semibold">Duel Record</span>
        </div>
        {record && record.total > 0 ? (
          <>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded-lg bg-muted/50 py-2">
                <div className="text-2xl font-bold tabular-nums text-emerald-500">{record.wins}</div>
                <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Wins</div>
              </div>
              <div className="rounded-lg bg-muted/50 py-2">
                <div className="text-2xl font-bold tabular-nums text-rose-500">{record.losses}</div>
                <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Losses</div>
              </div>
              <div className="rounded-lg bg-muted/50 py-2">
                <div className="text-2xl font-bold tabular-nums">{record.winRate}%</div>
                <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Win Rate</div>
              </div>
            </div>
            {record.recent.length > 0 && (
              <div className="space-y-1.5">
                <div className="text-xs uppercase tracking-widest text-muted-foreground font-semibold">
                  Recent Duels
                </div>
                {record.recent.map((d) => (
                  <div key={d.id} className="flex items-center gap-2 text-sm">
                    <Badge
                      variant="outline"
                      className={`text-[10px] w-12 justify-center shrink-0 ${
                        d.outcome === "win"
                          ? "text-emerald-500 border-emerald-500/40"
                          : "text-rose-500 border-rose-500/40"
                      }`}
                    >
                      {d.outcome === "win" ? "Won" : "Lost"}
                    </Badge>
                    <span className="flex-1 min-w-0 truncate">
                      <span className="text-muted-foreground">vs </span>
                      {d.opponentName}
                    </span>
                    <span className="text-xs text-muted-foreground shrink-0">{timeAgo(d.resolvedAt)}</span>
                  </div>
                ))}
              </div>
            )}
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            No duels yet. Challenge a rival in the overworld to start building your record.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export default function Loadout() {
  const { data: loadout, isLoading } = useGetLoadout();
  const { data: items } = useListMyItems();
  const { data: duelRecord } = useGetDuelRecord();
  const equip = useEquipItem();
  const unequip = useUnequipSlot();
  const bulkDispose = useBulkDisposeItems();
  const qc = useQueryClient();
  const [pickerSlot, setPickerSlot] = useState<SlotKey | null>(null);
  const [invFilter, setInvFilter] = useState<string>("all");
  const [search, setSearch] = useState<string>("");
  const [sortBy, setSortBy] = useState<SortKey>("default");
  const [selecting, setSelecting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [confirmMode, setConfirmMode] = useState<"sell" | "scrap" | null>(null);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: getGetLoadoutQueryKey() });
    qc.invalidateQueries({ queryKey: getListMyItemsQueryKey() });
    qc.invalidateQueries({ queryKey: getGetBalancesQueryKey() });
  };

  const handleEquip = async (playerItemId: number, slot: SlotKey) => {
    await equip.mutateAsync({ data: { playerItemId, slot } });
    invalidate();
    setPickerSlot(null);
  };
  const handleUnequip = async (slot: SlotKey) => {
    await unequip.mutateAsync({ data: { slot } });
    invalidate();
  };

  const slots = loadout?.slots;
  const equippedIds = new Set(
    slots ? SLOT_ORDER.map((s) => slots[s]?.id).filter(Boolean) : [],
  );

  const toggleSelect = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const exitSelectMode = () => {
    setSelecting(false);
    setSelectedIds(new Set());
  };

  const listedIds = useMemo(
    () => new Set((items ?? []).filter((it) => it.listed).map((it) => it.id)),
    [items],
  );

  const runBulkDispose = async (mode: "sell" | "scrap") => {
    const ids = [...selectedIds].filter((id) => !equippedIds.has(id) && !listedIds.has(id));
    if (ids.length === 0) return;
    try {
      const res = await bulkDispose.mutateAsync({
        data: { playerItemIds: ids, mode, idempotencyKey: makeIdempotencyKey("dispose") },
      });
      invalidate();
      if (mode === "sell") {
        toast.success(
          `Sold ${res.disposedCount} item${res.disposedCount === 1 ? "" : "s"} for ${res.goldEarned} gold`,
        );
      } else {
        const mats = res.materialsEarned
          .map((m) => `${m.amount} ${m.name}`)
          .join(", ");
        toast.success(
          `Scrapped ${res.disposedCount} item${res.disposedCount === 1 ? "" : "s"}${mats ? ` → ${mats}` : ""}`,
        );
      }
      setConfirmMode(null);
      exitSelectMode();
    } catch {
      toast.error("Couldn't complete the bulk action. Please try again.");
      setConfirmMode(null);
    }
  };

  // Highest-power item the player owns for each template slot — flagged "Best in
  // Slot" so the strongest piece is obvious even before equipping.
  const bestInSlotIds = useMemo(() => computeBestInSlotIds(items), [items]);

  const candidatesFor = (slot: SlotKey): PlayerItem[] => {
    const tSlot = slotMeta(slot).templateSlot;
    return (items ?? []).filter((it) => it.template.slot === tSlot && !equippedIds.has(it.id));
  };

  // Inventory: every owned item, optional slot filter, equipped pinned first.
  const slotFilters = useMemo(() => {
    const present = new Set<string>((items ?? []).map((it) => it.template.slot));
    return SLOT_ORDER.filter((s, i, arr) => {
      const t = slotMeta(s).templateSlot;
      return present.has(t) && arr.findIndex((o) => slotMeta(o).templateSlot === t) === i;
    });
  }, [items]);

  const visibleItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = (items ?? []).filter((it) => {
      if (invFilter !== "all" && it.template.slot !== invFilter) return false;
      if (q && !searchHaystack(it).includes(q)) return false;
      return true;
    });
    return [...list].sort((a, b) => {
      // Equipped items stay pinned to the top regardless of the chosen sort.
      const ae = equippedIds.has(a.id) ? 0 : 1;
      const be = equippedIds.has(b.id) ? 0 : 1;
      if (ae !== be) return ae - be;
      switch (sortBy) {
        case "rarity": {
          const ra = RARITY_RANK[a.template.rarity] ?? 0;
          const rb = RARITY_RANK[b.template.rarity] ?? 0;
          if (ra !== rb) return rb - ra;
          return b.level - a.level;
        }
        case "name":
          return a.template.name.localeCompare(b.template.name);
        case "attack":
        case "defense":
        case "health": {
          const diff = itemStat(b, sortBy) - itemStat(a, sortBy);
          if (diff !== 0) return diff;
          return b.level - a.level;
        }
        case "level":
        case "default":
        default:
          return b.level - a.level;
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, invFilter, search, sortBy, slots]);

  if (isLoading) {
    return (
      <div className="grid gap-4 md:grid-cols-2">
        <div className="h-96 rounded-2xl bg-muted animate-pulse" />
        <div className="h-96 rounded-2xl bg-muted animate-pulse" />
      </div>
    );
  }

  const combat = loadout?.combatStats;

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div>
        <h1 className="text-4xl font-bold tracking-tight mb-1">Loadout</h1>
        <p className="text-muted-foreground text-lg">
          See your adventurer, equip your gear, and forge your identity in the labyrinth.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[20rem_1.4fr_1fr]">
        {/* Character preview + combat identity */}
        <div className="space-y-4">
          <Card>
            <CardContent className="p-5 space-y-4">
              <div className="text-xs uppercase tracking-widest text-primary font-semibold">
                Your Character
              </div>
              <CharacterPreview slots={slots} />
              <div>
                <div className="text-xs uppercase tracking-widest text-muted-foreground font-semibold mb-0.5">
                  Archetype
                </div>
                <div className="text-xl font-bold">{loadout?.archetype ?? "Wanderer"}</div>
                <p className="text-sm text-muted-foreground">
                  {loadout?.archetypeDescription ?? "Equip gear to forge your identity."}
                </p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-6">
              <div className="text-sm font-semibold mb-3">Combat Stats</div>
              <div className="space-y-2">
                {combat &&
                  (Object.keys(combat) as (keyof ItemStats)[])
                    .filter((k) => (combat[k] ?? 0) !== 0)
                    .map((k) => (
                      <div key={k} className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">{STAT_LABELS[k]}</span>
                        <span className="font-bold tabular-nums">{fmt(combat[k])}</span>
                      </div>
                    ))}
                {(!combat || Object.values(combat).every((v) => !v)) && (
                  <p className="text-sm text-muted-foreground">No stats yet — equip some gear.</p>
                )}
              </div>
            </CardContent>
          </Card>
          <DuelRecordCard record={duelRecord} />
        </div>

        {/* Gear slots */}
        <div className="space-y-3">
          <div className="text-sm font-semibold text-muted-foreground">Equipped Loadout</div>
          {SLOT_ORDER.map((slot) => {
            const item = slots?.[slot] ?? null;
            const meta = slotMeta(slot);
            const Icon = meta.icon;
            const r = item ? rarity(item.template.rarity) : null;
            return (
              <motion.div key={slot} layout>
                <Card
                  className="overflow-hidden border-2 transition-all"
                  style={item && r ? { borderColor: r.glow, boxShadow: `0 0 0 1px ${r.glow}` } : undefined}
                >
                  <CardContent className="p-4 flex items-center gap-4">
                    <div className="w-14 h-14 shrink-0 rounded-xl bg-muted flex items-center justify-center text-2xl">
                      {item?.template.icon ? <span>{item.template.icon}</span> : <Icon className="w-6 h-6 text-muted-foreground" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs uppercase tracking-wide text-muted-foreground">{meta.label}</div>
                      {item ? (
                        <>
                          <div className="flex items-center gap-2">
                            <span className="font-bold truncate">{item.template.name}</span>
                            <Badge variant="outline" className={`${r!.text} ${r!.border} text-[10px]`}>Lv {item.level}</Badge>
                          </div>
                          <StatList stats={item.stats ?? item.template.stats} />
                          <AbilityInfo template={item.template} />
                        </>
                      ) : (
                        <div className="text-muted-foreground font-medium">Empty slot</div>
                      )}
                    </div>
                    {item ? (
                      <Button size="icon" variant="ghost" onClick={() => handleUnequip(slot)} aria-label="Unequip">
                        <X className="w-4 h-4" />
                      </Button>
                    ) : (
                      <Button size="sm" variant="secondary" className="gap-1" onClick={() => setPickerSlot(slot)}>
                        <Plus className="w-4 h-4" /> Equip
                      </Button>
                    )}
                  </CardContent>
                </Card>
              </motion.div>
            );
          })}
        </div>

        {/* Inventory */}
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="text-sm font-semibold text-muted-foreground">
              Inventory
              <span className="ml-2 text-xs font-normal">
                {visibleItems.length === (items?.length ?? 0)
                  ? `${items?.length ?? 0} items`
                  : `${visibleItems.length} of ${items?.length ?? 0} items`}
              </span>
            </div>
            {(items?.length ?? 0) > 0 &&
              (selecting ? (
                <Button size="sm" variant="ghost" className="h-8" onClick={exitSelectMode}>
                  Cancel
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 gap-1.5"
                  onClick={() => setSelecting(true)}
                >
                  <CheckSquare className="w-4 h-4" /> Select
                </Button>
              ))}
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search name, rarity, or stat…"
                className="h-9 pl-8 pr-8 text-sm"
                aria-label="Search inventory"
              />
              {search && (
                <button
                  onClick={() => setSearch("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  aria-label="Clear search"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
            <div className="relative shrink-0">
              <ArrowDownUp className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as SortKey)}
                aria-label="Sort inventory"
                className="h-9 w-full appearance-none rounded-md border bg-background pl-8 pr-7 text-sm font-medium outline-none focus-visible:ring-1 focus-visible:ring-ring sm:w-44"
              >
                {SORT_OPTIONS.map((o) => (
                  <option key={o.key} value={o.key}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex flex-wrap gap-1.5">
            <button
              onClick={() => setInvFilter("all")}
              className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                invFilter === "all" ? "bg-primary text-primary-foreground border-primary" : "hover:bg-muted"
              }`}
            >
              All
            </button>
            {slotFilters.map((s) => {
              const meta = slotMeta(s);
              const t = meta.templateSlot;
              const active = invFilter === t;
              return (
                <button
                  key={t}
                  onClick={() => setInvFilter(t)}
                  className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                    active ? "bg-primary text-primary-foreground border-primary" : "hover:bg-muted"
                  }`}
                >
                  {meta.label.replace(/ I+$/, "")}
                </button>
              );
            })}
          </div>

          {selecting && (
            <div className="flex flex-wrap items-center gap-1.5 rounded-lg border bg-muted/40 px-2.5 py-2">
              <span className="text-xs font-medium text-muted-foreground mr-1">Quick select:</span>
              <button
                onClick={() => {
                  const ids = visibleItems
                    .filter((it) => !equippedIds.has(it.id) && !it.listed)
                    .map((it) => it.id);
                  setSelectedIds(new Set(ids));
                }}
                className="rounded-full border px-2.5 py-0.5 text-xs font-medium hover:bg-muted"
              >
                All visible
              </button>
              <button
                onClick={() => {
                  const ids = (items ?? [])
                    .filter((it) => it.template.rarity === "common" && !equippedIds.has(it.id) && !it.listed)
                    .map((it) => it.id);
                  setSelectedIds(new Set(ids));
                }}
                className="rounded-full border px-2.5 py-0.5 text-xs font-medium hover:bg-muted"
              >
                All Common
              </button>
              <button
                onClick={() => {
                  const ids = (items ?? [])
                    .filter(
                      (it) =>
                        (it.template.rarity === "common" || it.template.rarity === "uncommon") &&
                        !equippedIds.has(it.id) &&
                        !it.listed,
                    )
                    .map((it) => it.id);
                  setSelectedIds(new Set(ids));
                }}
                className="rounded-full border px-2.5 py-0.5 text-xs font-medium hover:bg-muted"
              >
                Common + Uncommon
              </button>
              {selectedIds.size > 0 && (
                <button
                  onClick={() => setSelectedIds(new Set())}
                  className="rounded-full border px-2.5 py-0.5 text-xs font-medium text-muted-foreground hover:bg-muted"
                >
                  Clear ({selectedIds.size})
                </button>
              )}
            </div>
          )}

          <div className="space-y-2 max-h-[34rem] overflow-y-auto pr-1">
            {visibleItems.map((it) => {
              const r = rarity(it.template.rarity);
              const isEquipped = equippedIds.has(it.id);
              const target = targetSlotFor(slots, it.template.slot);
              const cmp = isEquipped ? null : compareItemFor(slots, it);
              const cmpStats = cmp ? effectiveStats(cmp) : null;
              const isUpgrade = !isEquipped && isUpgradeOver(it, cmp);
              const isBest = bestInSlotIds.has(it.id);
              const isSelected = selectedIds.has(it.id);
              const selectable = selecting && !isEquipped;
              return (
                <div
                  key={it.id}
                  onClick={selectable ? () => toggleSelect(it.id) : undefined}
                  className={`rounded-xl border-2 ${r.border} ${r.bg} p-3 flex items-center gap-3 ${
                    selectable ? "cursor-pointer" : ""
                  } ${isSelected ? "ring-2 ring-primary ring-offset-1 ring-offset-background" : ""}`}
                >
                  {selecting &&
                    (isEquipped ? (
                      <div className="w-5 shrink-0" aria-hidden />
                    ) : isSelected ? (
                      <CheckSquare className="w-5 h-5 shrink-0 text-primary" />
                    ) : (
                      <Square className="w-5 h-5 shrink-0 text-muted-foreground" />
                    ))}
                  <div className="w-10 h-10 shrink-0 rounded-lg bg-background/60 flex items-center justify-center text-xl">
                    {it.template.icon}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold truncate">{it.template.name}</span>
                      <Badge variant="outline" className={`${r.text} ${r.border} text-[10px]`}>
                        {r.label} · Lv {it.level}
                      </Badge>
                      {isBest && (
                        <Badge className="gap-0.5 text-[10px] bg-amber-500 hover:bg-amber-500 text-white border-transparent">
                          <Crown className="w-3 h-3" /> Best in Slot
                        </Badge>
                      )}
                      {isUpgrade && (
                        <Badge className="gap-0.5 text-[10px] bg-emerald-600 hover:bg-emerald-600 text-white border-transparent">
                          <ArrowUp className="w-3 h-3" /> Upgrade
                        </Badge>
                      )}
                      {it.listed && (
                        <Badge className="gap-0.5 text-[10px] bg-sky-600 hover:bg-sky-600 text-white border-transparent">
                          <Tag className="w-3 h-3" /> Listed
                        </Badge>
                      )}
                    </div>
                    <StatList stats={it.stats ?? it.template.stats} compare={cmpStats} />
                    <AbilityInfo template={it.template} />
                  </div>
                  {selecting ? (
                    isEquipped ? (
                      <Badge variant="secondary" className="gap-1 shrink-0">
                        <Check className="w-3 h-3" /> Equipped
                      </Badge>
                    ) : null
                  ) : isEquipped ? (
                    <Badge variant="secondary" className="gap-1 shrink-0">
                      <Check className="w-3 h-3" /> Equipped
                    </Badge>
                  ) : target ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      className="gap-1 shrink-0"
                      disabled={equip.isPending}
                      onClick={() => handleEquip(it.id, target)}
                    >
                      <Plus className="w-4 h-4" /> Equip
                    </Button>
                  ) : null}
                </div>
              );
            })}
            {visibleItems.length === 0 &&
              ((items?.length ?? 0) > 0 ? (
                <div className="py-12 text-center space-y-2">
                  <p className="text-sm text-muted-foreground">
                    No items match your search or filters.
                  </p>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setSearch("");
                      setInvFilter("all");
                    }}
                  >
                    Clear filters
                  </Button>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground py-12 text-center">
                  No items yet. Clear labyrinths or craft in the Forge to fill your inventory.
                </p>
              ))}
          </div>

          {selecting && (
            <div className="sticky bottom-0 flex flex-wrap items-center gap-2 rounded-xl border bg-card/95 backdrop-blur p-3 shadow-lg">
              <span className="text-sm font-medium">
                {selectedIds.size} selected
              </span>
              <div className="flex-1" />
              <Button
                size="sm"
                variant="secondary"
                className="gap-1.5"
                disabled={selectedIds.size === 0 || bulkDispose.isPending}
                onClick={() => setConfirmMode("sell")}
              >
                <Coins className="w-4 h-4" /> Sell
              </Button>
              <Button
                size="sm"
                variant="secondary"
                className="gap-1.5"
                disabled={selectedIds.size === 0 || bulkDispose.isPending}
                onClick={() => setConfirmMode("scrap")}
              >
                <Recycle className="w-4 h-4" /> Scrap
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Bulk dispose confirmation */}
      <AnimatePresence>
        {confirmMode && (
          <motion.div
            className="fixed inset-0 z-50 bg-background/70 backdrop-blur-sm flex items-center justify-center p-4"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={() => !bulkDispose.isPending && setConfirmMode(null)}
          >
            <motion.div
              className="w-full max-w-md bg-card rounded-2xl border shadow-2xl p-6"
              initial={{ scale: 0.95, y: 12 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.95, y: 12 }}
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="text-lg font-bold mb-1">
                {confirmMode === "sell" ? "Sell" : "Scrap"} {selectedIds.size} item
                {selectedIds.size === 1 ? "" : "s"}?
              </h3>
              <p className="text-sm text-muted-foreground mb-5">
                {confirmMode === "sell"
                  ? "These items will be permanently removed from your inventory in exchange for gold. Equipped items are never included."
                  : "These items will be permanently broken down into crafting materials and removed from your inventory. Equipped items are never included."}
              </p>
              <div className="flex justify-end gap-2">
                <Button
                  variant="ghost"
                  onClick={() => setConfirmMode(null)}
                  disabled={bulkDispose.isPending}
                >
                  Cancel
                </Button>
                <Button
                  className="gap-1.5"
                  onClick={() => runBulkDispose(confirmMode)}
                  disabled={bulkDispose.isPending}
                >
                  {confirmMode === "sell" ? <Coins className="w-4 h-4" /> : <Recycle className="w-4 h-4" />}
                  {bulkDispose.isPending
                    ? "Working…"
                    : confirmMode === "sell"
                      ? "Sell items"
                      : "Scrap items"}
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Equip picker (from empty slot cards) */}
      <AnimatePresence>
        {pickerSlot && (
          <motion.div
            className="fixed inset-0 z-50 bg-background/70 backdrop-blur-sm flex items-center justify-center p-4"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={() => setPickerSlot(null)}
          >
            <motion.div
              className="w-full max-w-lg bg-card rounded-2xl border shadow-2xl p-6 max-h-[80vh] overflow-y-auto"
              initial={{ scale: 0.95, y: 12 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.95, y: 12 }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold">Equip {slotMeta(pickerSlot).label}</h3>
                <Button size="icon" variant="ghost" onClick={() => setPickerSlot(null)}><X className="w-4 h-4" /></Button>
              </div>
              <div className="space-y-2">
                {candidatesFor(pickerSlot).map((it) => {
                  const r = rarity(it.template.rarity);
                  return (
                    <button
                      key={it.id}
                      onClick={() => handleEquip(it.id, pickerSlot)}
                      disabled={equip.isPending}
                      className={`w-full text-left rounded-xl border-2 ${r.border} ${r.bg} p-3 flex items-center gap-3 hover:scale-[1.01] transition-transform`}
                    >
                      <div className="w-10 h-10 rounded-lg bg-background/60 flex items-center justify-center text-xl">{it.template.icon}</div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold truncate">{it.template.name}</span>
                          <Badge variant="outline" className={`${r.text} ${r.border} text-[10px]`}>{r.label} · Lv {it.level}</Badge>
                        </div>
                        <StatList stats={it.stats ?? it.template.stats} />
                      </div>
                    </button>
                  );
                })}
                {candidatesFor(pickerSlot).length === 0 && (
                  <p className="text-sm text-muted-foreground py-8 text-center">No unequipped items fit this slot. Craft some in the Forge.</p>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
