import { useMemo, useState } from "react";
import {
  useListMarketplaceListings,
  useListMyItems,
  useBuyMarketplaceListing,
  useCancelMarketplaceListing,
  useCreateMarketplaceListing,
  useDepositUsdc,
  useGetBalances,
  getListMarketplaceListingsQueryKey,
  getListMyItemsQueryKey,
  getGetBalancesQueryKey,
  getGetLoadoutQueryKey,
} from "@workspace/api-client-react";
import type { MarketplaceListing, PlayerItem } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { motion, AnimatePresence } from "framer-motion";
import {
  X,
  Search,
  ArrowDownUp,
  Store,
  Tag,
  DollarSign,
  ShoppingCart,
  Plus,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { rarity, RARITY_ORDER, fmtUsdc, makeIdempotencyKey, timeAgo } from "@/lib/game";
import { StatList } from "@/components/StatList";

type SortKey =
  | "recent"
  | "priceAsc"
  | "priceDesc"
  | "rarity"
  | "attack"
  | "defense"
  | "level";

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: "recent", label: "Newest" },
  { key: "priceAsc", label: "Price: low to high" },
  { key: "priceDesc", label: "Price: high to low" },
  { key: "rarity", label: "Rarity" },
  { key: "attack", label: "Attack: high to low" },
  { key: "defense", label: "Defense: high to low" },
  { key: "level", label: "Item level" },
];

/** Pretty label for a snake_case template slot (e.g. "ability_stone" → "Ability Stone"). */
function slotLabel(slot: string): string {
  return slot.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

const RARITY_RANK: Record<string, number> = Object.fromEntries(
  RARITY_ORDER.map((r, i) => [r, i]),
);

const RARITY_FILTERS = ["all", ...RARITY_ORDER] as const;

/** Parse a user-entered dollar amount (e.g. "12.50") into integer cents. */
function dollarsToCents(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return null;
  const cents = Math.round(parseFloat(trimmed) * 100);
  return Number.isFinite(cents) ? cents : null;
}

export default function Marketplace() {
  const { data: listings, isLoading } = useListMarketplaceListings();
  const { data: items } = useListMyItems();
  const { data: balances } = useGetBalances();
  const buy = useBuyMarketplaceListing();
  const cancel = useCancelMarketplaceListing();
  const createListing = useCreateMarketplaceListing();
  const deposit = useDepositUsdc();
  const qc = useQueryClient();

  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<SortKey>("recent");
  const [rarityFilter, setRarityFilter] = useState<(typeof RARITY_FILTERS)[number]>("all");
  const [slotFilter, setSlotFilter] = useState<string>("all");
  const [listingPanel, setListingPanel] = useState(false);
  const [sellItem, setSellItem] = useState<PlayerItem | null>(null);
  const [priceInput, setPriceInput] = useState("");
  const [pendingId, setPendingId] = useState<number | null>(null);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: getListMarketplaceListingsQueryKey() });
    qc.invalidateQueries({ queryKey: getListMyItemsQueryKey() });
    qc.invalidateQueries({ queryKey: getGetBalancesQueryKey() });
    qc.invalidateQueries({ queryKey: getGetLoadoutQueryKey() });
  };

  // Slots present across all current listings, for the slot filter control.
  const availableSlots = useMemo(() => {
    const set = new Set<string>();
    for (const l of listings ?? []) set.add(l.item.template.slot);
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [listings]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    const statOf = (l: MarketplaceListing, key: "attack" | "defense"): number => {
      const s = l.item.stats ?? l.item.template.stats;
      return (s as Record<string, number | undefined>)?.[key] ?? 0;
    };
    const list = (listings ?? []).filter((l) => {
      if (rarityFilter !== "all" && l.item.template.rarity !== rarityFilter) return false;
      if (slotFilter !== "all" && l.item.template.slot !== slotFilter) return false;
      if (q) {
        const hay = `${l.item.template.name} ${l.item.template.rarity} ${l.item.template.slot} ${l.sellerName}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    return [...list].sort((a, b) => {
      switch (sortBy) {
        case "priceAsc":
          return a.priceCents - b.priceCents;
        case "priceDesc":
          return b.priceCents - a.priceCents;
        case "rarity": {
          const ra = RARITY_RANK[a.item.template.rarity] ?? 0;
          const rb = RARITY_RANK[b.item.template.rarity] ?? 0;
          if (ra !== rb) return rb - ra;
          return b.item.level - a.item.level;
        }
        case "attack":
          return statOf(b, "attack") - statOf(a, "attack");
        case "defense":
          return statOf(b, "defense") - statOf(a, "defense");
        case "level":
          return b.item.level - a.item.level;
        case "recent":
        default:
          return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      }
    });
  }, [listings, search, sortBy, rarityFilter, slotFilter]);

  // Items eligible to list: owned, not equipped, not already listed.
  const sellable = useMemo(
    () => (items ?? []).filter((it) => !it.equipped && !it.listed),
    [items],
  );

  const usdc = balances?.usdc ?? 0;

  const handleBuy = async (listing: MarketplaceListing) => {
    setPendingId(listing.id);
    try {
      const res = await buy.mutateAsync({
        id: listing.id,
        data: { idempotencyKey: makeIdempotencyKey("buy") },
      });
      invalidate();
      toast.success(
        `Bought ${listing.item.template.name} for ${fmtUsdc(res.pricePaidCents)}`,
      );
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't complete the purchase."));
    } finally {
      setPendingId(null);
    }
  };

  const handleCancel = async (listing: MarketplaceListing) => {
    setPendingId(listing.id);
    try {
      await cancel.mutateAsync({
        id: listing.id,
        data: { idempotencyKey: makeIdempotencyKey("cancel") },
      });
      invalidate();
      toast.success(`Delisted ${listing.item.template.name}`);
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't cancel the listing."));
    } finally {
      setPendingId(null);
    }
  };

  const handleList = async () => {
    if (!sellItem) return;
    const cents = dollarsToCents(priceInput);
    if (cents == null || cents < 1) {
      toast.error("Enter a valid price (e.g. 12.50).");
      return;
    }
    try {
      await createListing.mutateAsync({
        data: {
          playerItemId: sellItem.id,
          priceCents: cents,
          idempotencyKey: makeIdempotencyKey("list"),
        },
      });
      invalidate();
      toast.success(`Listed ${sellItem.template.name} for ${fmtUsdc(cents)}`);
      setSellItem(null);
      setPriceInput("");
      setListingPanel(false);
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't list this item."));
    }
  };

  const handleDeposit = async (amountCents: number) => {
    try {
      await deposit.mutateAsync({
        data: { amountCents, idempotencyKey: makeIdempotencyKey("deposit") },
      });
      qc.invalidateQueries({ queryKey: getGetBalancesQueryKey() });
      toast.success(`Added ${fmtUsdc(amountCents)} test USDC`);
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't add test USDC."));
    }
  };

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-4xl font-bold tracking-tight mb-1 flex items-center gap-2">
            <Store className="w-8 h-8 text-primary" /> Marketplace
          </h1>
          <p className="text-muted-foreground text-lg">
            Trade gear with other adventurers. Settled in USDC, escrowed until sold.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="rounded-xl border bg-card px-4 py-2.5">
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">
              Your USDC
            </div>
            <div className="flex items-center gap-1 text-lg font-bold text-emerald-500 tabular-nums">
              <DollarSign className="w-4 h-4" />
              {fmtUsdc(usdc).replace(/^\$/, "")}
            </div>
          </div>
          <Button className="gap-1.5" onClick={() => setListingPanel(true)}>
            <Tag className="w-4 h-4" /> Sell an item
          </Button>
        </div>
      </div>

      {/* Mock USDC on-ramp */}
      <Card className="border-dashed">
        <CardContent className="flex flex-wrap items-center gap-3 p-4">
          <span className="text-sm text-muted-foreground">
            Need USDC to trade? Add some test funds (mock on-ramp):
          </span>
          {[500, 2500, 10000].map((amt) => (
            <Button
              key={amt}
              size="sm"
              variant="outline"
              className="gap-1"
              disabled={deposit.isPending}
              onClick={() => handleDeposit(amt)}
            >
              <Plus className="w-3.5 h-3.5" /> {fmtUsdc(amt)}
            </Button>
          ))}
          {deposit.isPending && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
        </CardContent>
      </Card>

      {/* Filters */}
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by item, rarity, slot, or seller…"
              className="h-9 pl-8 pr-8 text-sm"
              aria-label="Search listings"
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
              aria-label="Sort listings"
              className="h-9 w-full appearance-none rounded-md border bg-background pl-8 pr-7 text-sm font-medium outline-none focus-visible:ring-1 focus-visible:ring-ring sm:w-52"
            >
              {SORT_OPTIONS.map((o) => (
                <option key={o.key} value={o.key}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <div className="relative shrink-0">
            <Tag className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <select
              value={slotFilter}
              onChange={(e) => setSlotFilter(e.target.value)}
              aria-label="Filter by slot"
              className="h-9 w-full appearance-none rounded-md border bg-background pl-8 pr-7 text-sm font-medium capitalize outline-none focus-visible:ring-1 focus-visible:ring-ring sm:w-44"
            >
              <option value="all">All slots</option>
              {availableSlots.map((s) => (
                <option key={s} value={s}>
                  {slotLabel(s)}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {RARITY_FILTERS.map((rf) => {
            const active = rarityFilter === rf;
            const label = rf === "all" ? "All" : rarity(rf).label;
            return (
              <button
                key={rf}
                onClick={() => setRarityFilter(rf)}
                className={`rounded-full border px-3 py-1 text-xs font-medium capitalize transition-colors ${
                  active ? "bg-primary text-primary-foreground border-primary" : "hover:bg-muted"
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Listings */}
      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-48 rounded-2xl bg-muted animate-pulse" />
          ))}
        </div>
      ) : visible.length === 0 ? (
        <div className="py-20 text-center space-y-2">
          <Store className="w-10 h-10 mx-auto text-muted-foreground/50" />
          <p className="text-muted-foreground">
            {(listings?.length ?? 0) === 0
              ? "No items are listed yet. Be the first to sell one!"
              : "No listings match your search or filters."}
          </p>
          {(listings?.length ?? 0) > 0 && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setSearch("");
                setRarityFilter("all");
                setSlotFilter("all");
              }}
            >
              Clear filters
            </Button>
          )}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((l) => {
            const r = rarity(l.item.template.rarity);
            const canAfford = usdc >= l.priceCents;
            const busy = pendingId === l.id;
            return (
              <motion.div key={l.id} layout>
                <Card
                  className="overflow-hidden border-2 h-full flex flex-col"
                  style={{ borderColor: r.glow }}
                >
                  <CardContent className="p-4 flex flex-col gap-3 flex-1">
                    <div className="flex items-start gap-3">
                      <div className="w-12 h-12 shrink-0 rounded-xl bg-background/60 flex items-center justify-center text-2xl">
                        {l.item.template.icon}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-bold truncate">{l.item.template.name}</div>
                        <div className="flex items-center gap-1.5 flex-wrap mt-0.5">
                          <Badge variant="outline" className={`${r.text} ${r.border} text-[10px]`}>
                            {r.label} · Lv {l.item.level}
                          </Badge>
                          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                            {l.item.template.slot}
                          </span>
                        </div>
                      </div>
                    </div>

                    <StatList stats={l.item.stats ?? l.item.template.stats} />

                    <div className="mt-auto flex items-end justify-between gap-2 pt-2">
                      <div>
                        <div className="text-xl font-bold text-emerald-500 tabular-nums flex items-center gap-0.5">
                          <DollarSign className="w-4 h-4" />
                          {fmtUsdc(l.priceCents).replace(/^\$/, "")}
                        </div>
                        <div className="text-[11px] text-muted-foreground truncate max-w-[10rem]">
                          {l.isOwn ? "Your listing" : `by ${l.sellerName}`} · {timeAgo(l.createdAt)}
                        </div>
                      </div>
                      {l.isOwn ? (
                        <Button
                          size="sm"
                          variant="outline"
                          className="gap-1.5"
                          disabled={busy}
                          onClick={() => handleCancel(l)}
                        >
                          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <X className="w-4 h-4" />}
                          Delist
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          className="gap-1.5"
                          disabled={busy || !canAfford}
                          onClick={() => handleBuy(l)}
                          title={canAfford ? undefined : "Not enough USDC"}
                        >
                          {busy ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <ShoppingCart className="w-4 h-4" />
                          )}
                          {canAfford ? "Buy" : "Need USDC"}
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            );
          })}
        </div>
      )}

      {/* Sell panel: pick an item, then set price */}
      <AnimatePresence>
        {listingPanel && (
          <motion.div
            className="fixed inset-0 z-50 bg-background/70 backdrop-blur-sm flex items-center justify-center p-4"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => {
              if (!createListing.isPending) {
                setListingPanel(false);
                setSellItem(null);
                setPriceInput("");
              }
            }}
          >
            <motion.div
              className="w-full max-w-lg bg-card rounded-2xl border shadow-2xl p-6 max-h-[80vh] overflow-y-auto"
              initial={{ scale: 0.95, y: 12 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 12 }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold">
                  {sellItem ? "Set your price" : "Choose an item to sell"}
                </h3>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => {
                    setListingPanel(false);
                    setSellItem(null);
                    setPriceInput("");
                  }}
                >
                  <X className="w-4 h-4" />
                </Button>
              </div>

              {sellItem ? (
                <SellForm
                  item={sellItem}
                  priceInput={priceInput}
                  onPrice={setPriceInput}
                  onBack={() => {
                    setSellItem(null);
                    setPriceInput("");
                  }}
                  onConfirm={handleList}
                  pending={createListing.isPending}
                />
              ) : (
                <div className="space-y-2">
                  {sellable.map((it) => {
                    const r = rarity(it.template.rarity);
                    return (
                      <button
                        key={it.id}
                        onClick={() => setSellItem(it)}
                        className={`w-full text-left rounded-xl border-2 ${r.border} ${r.bg} p-3 flex items-center gap-3 hover:scale-[1.01] transition-transform`}
                      >
                        <div className="w-10 h-10 rounded-lg bg-background/60 flex items-center justify-center text-xl">
                          {it.template.icon}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold truncate">{it.template.name}</span>
                            <Badge variant="outline" className={`${r.text} ${r.border} text-[10px]`}>
                              {r.label} · Lv {it.level}
                            </Badge>
                          </div>
                          <StatList stats={it.stats ?? it.template.stats} />
                        </div>
                      </button>
                    );
                  })}
                  {sellable.length === 0 && (
                    <p className="text-sm text-muted-foreground py-8 text-center">
                      No items available to sell. Unequip gear or clear labyrinths to get more.
                    </p>
                  )}
                </div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function SellForm({
  item,
  priceInput,
  onPrice,
  onBack,
  onConfirm,
  pending,
}: {
  item: PlayerItem;
  priceInput: string;
  onPrice: (v: string) => void;
  onBack: () => void;
  onConfirm: () => void;
  pending: boolean;
}) {
  const r = rarity(item.template.rarity);
  const cents = dollarsToCents(priceInput);
  const feeCents = cents != null ? Math.floor((cents * 500) / 10000) : 0;
  const proceeds = cents != null ? cents - feeCents : 0;
  const valid = cents != null && cents >= 1;
  return (
    <div className="space-y-4">
      <div className={`rounded-xl border-2 ${r.border} ${r.bg} p-3 flex items-center gap-3`}>
        <div className="w-10 h-10 rounded-lg bg-background/60 flex items-center justify-center text-xl">
          {item.template.icon}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-semibold truncate">{item.template.name}</span>
            <Badge variant="outline" className={`${r.text} ${r.border} text-[10px]`}>
              {r.label} · Lv {item.level}
            </Badge>
          </div>
          <StatList stats={item.stats ?? item.template.stats} />
        </div>
      </div>

      <div>
        <label className="text-sm font-medium mb-1.5 block">Price (USDC)</label>
        <div className="relative">
          <DollarSign className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={priceInput}
            onChange={(e) => onPrice(e.target.value)}
            placeholder="0.00"
            inputMode="decimal"
            className="h-10 pl-8"
            autoFocus
          />
        </div>
        {priceInput && !valid && (
          <p className="text-xs text-destructive mt-1">Enter a valid amount like 12.50.</p>
        )}
      </div>

      {valid && (
        <div className="rounded-lg bg-muted/50 p-3 text-sm space-y-1">
          <div className="flex justify-between">
            <span className="text-muted-foreground">List price</span>
            <span className="font-medium tabular-nums">{fmtUsdc(cents)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Marketplace fee (5%)</span>
            <span className="font-medium tabular-nums text-muted-foreground">
              −{fmtUsdc(feeCents)}
            </span>
          </div>
          <div className="flex justify-between border-t pt-1 mt-1">
            <span className="font-semibold">You receive</span>
            <span className="font-bold tabular-nums text-emerald-500">{fmtUsdc(proceeds)}</span>
          </div>
        </div>
      )}

      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onBack} disabled={pending}>
          Back
        </Button>
        <Button className="gap-1.5" onClick={onConfirm} disabled={!valid || pending}>
          {pending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Tag className="w-4 h-4" />}
          {pending ? "Listing…" : "List for sale"}
        </Button>
      </div>
    </div>
  );
}

function errorMessage(err: unknown, fallback: string): string {
  const e = err as { response?: { data?: { error?: string } }; data?: { error?: string } };
  return e?.response?.data?.error ?? e?.data?.error ?? fallback;
}
