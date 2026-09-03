import { useMemo, useState } from "react";
import { useListItemTemplates, useListMyItems } from "@workspace/api-client-react";
import type { ItemTemplate } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Search, X, Check, Lock, Swords, Shield } from "lucide-react";
import { rarity, RARITY_ORDER, fmt } from "@/lib/game";
import { slotMeta, type SlotKey } from "@/lib/slots";
import { StatList } from "@/components/StatList";
import { AbilityInfo } from "@/components/AbilityInfo";
import { GearSprite } from "@/components/GearSprite";

/** Accent color + label for a weapon's damage type, for an at-a-glance badge. */
const DAMAGE_META: Record<string, { label: string; className: string }> = {
  physical: { label: "Physical", className: "text-slate-600 border-slate-300 bg-slate-50" },
  fire: { label: "Fire", className: "text-orange-700 border-orange-300 bg-orange-50" },
  frost: { label: "Frost", className: "text-cyan-700 border-cyan-300 bg-cyan-50" },
  lightning: { label: "Lightning", className: "text-amber-700 border-amber-300 bg-amber-50" },
};

type Category = "weapon" | "gear";

const CATEGORIES: { key: Category; label: string; icon: typeof Swords }[] = [
  { key: "weapon", label: "Weapons", icon: Swords },
  { key: "gear", label: "Armor & Gear", icon: Shield },
];

const RARITY_RANK: Record<string, number> = Object.fromEntries(
  RARITY_ORDER.map((r, i) => [r, i]),
);

/** Searchable text for a template: name, rarity, slot, damage type, description. */
function haystack(t: ItemTemplate): string {
  return [t.name, rarity(t.rarity).label, t.slot, t.damageType, t.description]
    .join(" ")
    .toLowerCase();
}

function CodexCard({ t, owned }: { t: ItemTemplate; owned: boolean }) {
  const r = rarity(t.rarity);
  const dmg = DAMAGE_META[t.damageType];
  const isWeapon = t.slot === "weapon";
  return (
    <Card
      className="overflow-hidden border-2 transition-shadow hover:shadow-md"
      style={{ borderColor: r.glow }}
    >
      <CardContent className="p-4 flex gap-4">
        <div
          className="relative shrink-0 self-start rounded-xl border bg-gradient-to-b from-muted/60 to-background"
          style={!owned ? { filter: "grayscale(1)", opacity: 0.55 } : undefined}
        >
          <GearSprite layers={t.spriteLayers} fallbackIcon={t.icon} size={76} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <span className="font-bold leading-tight">{t.name}</span>
            {owned ? (
              <Badge className="gap-0.5 shrink-0 bg-emerald-500 hover:bg-emerald-500 text-white border-transparent text-[10px]">
                <Check className="w-3 h-3" /> Found
              </Badge>
            ) : (
              <Badge variant="outline" className="gap-0.5 shrink-0 text-muted-foreground text-[10px]">
                <Lock className="w-3 h-3" /> Undiscovered
              </Badge>
            )}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <Badge variant="outline" className={`${r.text} ${r.border} text-[10px]`}>
              {r.label}
            </Badge>
            <Badge variant="outline" className="text-[10px] capitalize">
              {slotMeta(t.slot as SlotKey).label.replace(/ I+$/, "")}
            </Badge>
            {isWeapon && dmg && (
              <Badge variant="outline" className={`${dmg.className} text-[10px]`}>
                {dmg.label}
              </Badge>
            )}
          </div>
          <p className="mt-1.5 text-xs leading-snug text-muted-foreground line-clamp-2">
            {t.description}
          </p>
          <div className="mt-2">
            <StatList stats={t.stats} />
          </div>
          <AbilityInfo template={t} compact />
          <div className="mt-2 text-[10px] uppercase tracking-wide text-muted-foreground">
            Value · <span className="font-semibold text-foreground tabular-nums">{fmt(t.baseValue)}</span> gold
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function Codex() {
  const { data: templates, isLoading } = useListItemTemplates();
  const { data: myItems } = useListMyItems();
  const [category, setCategory] = useState<Category>("weapon");
  const [slotFilter, setSlotFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [ownedOnly, setOwnedOnly] = useState(false);

  // Template keys the player has ever owned → "discovered" for the codex.
  const ownedKeys = useMemo(
    () => new Set((myItems ?? []).map((it) => it.template.key)),
    [myItems],
  );

  // Catalog is gear only — drop ability stones / non-sprite curios so the
  // gallery shows wearable, visible equipment (weapons + armor pieces).
  const gearTemplates = useMemo(
    () => (templates ?? []).filter((t) => t.slot !== "ability_stone"),
    [templates],
  );

  const inCategory = useMemo(
    () =>
      gearTemplates.filter((t) =>
        category === "weapon" ? t.slot === "weapon" : t.slot !== "weapon",
      ),
    [gearTemplates, category],
  );

  // Slot sub-filter chips for the gear category (weapons are a single slot).
  const slotChips = useMemo(() => {
    if (category === "weapon") return [];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const t of inCategory) {
      if (!seen.has(t.slot)) {
        seen.add(t.slot);
        out.push(t.slot);
      }
    }
    return out.sort((a, b) =>
      slotMeta(a as SlotKey).label.localeCompare(slotMeta(b as SlotKey).label),
    );
  }, [inCategory, category]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return inCategory.filter((t) => {
      if (slotFilter !== "all" && t.slot !== slotFilter) return false;
      if (ownedOnly && !ownedKeys.has(t.key)) return false;
      if (q && !haystack(t).includes(q)) return false;
      return true;
    });
  }, [inCategory, slotFilter, ownedOnly, ownedKeys, search]);

  // Group the visible entries by rarity, strongest first, to show off the range.
  const grouped = useMemo(() => {
    const byRarity = new Map<string, ItemTemplate[]>();
    for (const t of visible) {
      const arr = byRarity.get(t.rarity) ?? [];
      arr.push(t);
      byRarity.set(t.rarity, arr);
    }
    return [...RARITY_ORDER]
      .slice()
      .reverse()
      .map((r) => ({ rarity: r, items: byRarity.get(r) ?? [] }))
      .filter((g) => g.items.length > 0)
      .map((g) => ({
        ...g,
        items: g.items.sort((a, b) => a.name.localeCompare(b.name)),
      }));
  }, [visible]);

  const discovered = inCategory.filter((t) => ownedKeys.has(t.key)).length;
  const totalAll = gearTemplates.length;
  const discoveredAll = gearTemplates.filter((t) => ownedKeys.has(t.key)).length;

  const handleCategory = (c: Category) => {
    setCategory(c);
    setSlotFilter("all");
  };

  if (isLoading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-40 rounded-2xl bg-muted animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-4xl font-bold tracking-tight mb-1">Codex</h1>
          <p className="text-muted-foreground text-lg">
            Every weapon and piece of gear in the labyrinths — chase the ones you haven't found yet.
          </p>
        </div>
        <div className="text-right">
          <div className="text-3xl font-bold tabular-nums">
            {discoveredAll}
            <span className="text-muted-foreground text-xl">/{totalAll}</span>
          </div>
          <div className="text-xs uppercase tracking-widest text-muted-foreground">
            Collected
          </div>
        </div>
      </div>

      {/* Category tabs */}
      <div className="flex flex-wrap gap-2">
        {CATEGORIES.map((c) => {
          const Icon = c.icon;
          const active = category === c.key;
          return (
            <button
              key={c.key}
              onClick={() => handleCategory(c.key)}
              className={`inline-flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-semibold transition-colors ${
                active
                  ? "bg-primary text-primary-foreground border-primary"
                  : "hover:bg-muted"
              }`}
            >
              <Icon className="w-4 h-4" />
              {c.label}
            </button>
          );
        })}
      </div>

      {/* Controls */}
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, rarity, damage type…"
              className="h-9 pl-8 pr-8 text-sm"
              aria-label="Search codex"
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
          <label className="inline-flex shrink-0 cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium">
            <input
              type="checkbox"
              checked={ownedOnly}
              onChange={(e) => setOwnedOnly(e.target.checked)}
              className="accent-primary"
            />
            Found only
            <span className="text-xs text-muted-foreground">
              ({discovered}/{inCategory.length})
            </span>
          </label>
        </div>

        {slotChips.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            <button
              onClick={() => setSlotFilter("all")}
              className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                slotFilter === "all"
                  ? "bg-primary text-primary-foreground border-primary"
                  : "hover:bg-muted"
              }`}
            >
              All
            </button>
            {slotChips.map((s) => (
              <button
                key={s}
                onClick={() => setSlotFilter(s)}
                className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                  slotFilter === s
                    ? "bg-primary text-primary-foreground border-primary"
                    : "hover:bg-muted"
                }`}
              >
                {slotMeta(s as SlotKey).label.replace(/ I+$/, "")}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Grouped grid */}
      {grouped.length === 0 ? (
        <div className="rounded-xl border border-dashed p-10 text-center text-muted-foreground">
          Nothing matches your filters.
        </div>
      ) : (
        <div className="space-y-8">
          {grouped.map((g) => {
            const r = rarity(g.rarity);
            return (
              <section key={g.rarity}>
                <div className="mb-3 flex items-center gap-3">
                  <h2 className={`text-lg font-bold ${r.text}`}>{r.label}</h2>
                  <div className="h-px flex-1" style={{ backgroundColor: r.glow }} />
                  <span className="text-xs font-medium text-muted-foreground tabular-nums">
                    {g.items.length}
                  </span>
                </div>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {g.items.map((t) => (
                    <CodexCard key={t.key} t={t} owned={ownedKeys.has(t.key)} />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
