// Static game catalog: currencies, materials, upgrades, biomes, mock wallets.
// All values are INTEGERS. Money/material splits use floor rounding.

export interface MaterialDef {
  key: string;
  name: string;
  icon: string;
  value: number; // gold-equivalent value used for drop-value math
}

// Crafting materials (separate from the currency columns gold/ore/dust/keys/labToken)
export const MATERIALS: MaterialDef[] = [
  { key: "moonsilver", name: "Moonsilver", icon: "🌙", value: 6 },
  { key: "emberglass", name: "Emberglass", icon: "🔥", value: 7 },
  { key: "verdant_root", name: "Verdant Root", icon: "🌿", value: 5 },
  { key: "shadow_thread", name: "Shadow Thread", icon: "🕸️", value: 8 },
  { key: "prism_shard", name: "Prism Shard", icon: "💠", value: 12 },
];
export const MATERIAL_BY_KEY: Record<string, MaterialDef> = Object.fromEntries(
  MATERIALS.map((m) => [m.key, m]),
);

// Marketplace fee in basis points (1/100th of a percent) taken out of the
// sale price on a confirmed purchase. 500 bps = 5%. The fee is deducted from
// the seller's proceeds (never minted) and accrues to the house treasury.
export const MARKETPLACE_FEE_BPS = 500;

// Bounds for a USDC listing price, in integer cents ($0.01 .. $1,000,000).
export const MARKETPLACE_MIN_PRICE_CENTS = 1;
export const MARKETPLACE_MAX_PRICE_CENTS = 100_000_000;

// Gold-equivalent value weights for currencies (drop-value math, owner 20% share)
export const CURRENCY_VALUE = {
  gold: 1,
  ore: 2,
  dust: 2,
  keys: 10,
  labToken: 5,
} as const;

export interface BiomeDef {
  key: string;
  name: string;
  accentColor: string;
  backgroundStyle: string;
}

export const BIOMES: BiomeDef[] = [
  { key: "sunlit_ruins", name: "Sunlit Ruins", accentColor: "#f5b942", backgroundStyle: "radial-gradient(circle at 30% 20%, #fff4d6, #e8c977)" },
  { key: "verdant_grove", name: "Verdant Grove", accentColor: "#5fd97a", backgroundStyle: "radial-gradient(circle at 30% 20%, #d6ffe0, #7fd99a)" },
  { key: "crystal_caverns", name: "Crystal Caverns", accentColor: "#5fc9f5", backgroundStyle: "radial-gradient(circle at 30% 20%, #d6f3ff, #7fc4e0)" },
  { key: "emberforge", name: "Emberforge Depths", accentColor: "#f57c5f", backgroundStyle: "radial-gradient(circle at 30% 20%, #ffe0d6, #e08f7f)" },
  { key: "astral_spire", name: "Astral Spire", accentColor: "#b98cf5", backgroundStyle: "radial-gradient(circle at 30% 20%, #ece0ff, #b89ae0)" },
  { key: "tidecaller", name: "Tidecaller Hollow", accentColor: "#5fe0d4", backgroundStyle: "radial-gradient(circle at 30% 20%, #d6fff9, #7fd9cf)" },
];
export const BIOME_BY_KEY: Record<string, BiomeDef> = Object.fromEntries(
  BIOMES.map((b) => [b.key, b]),
);

export function biomeAccent(biome: string): string {
  return BIOME_BY_KEY[biome]?.accentColor ?? "#f5b942";
}

export interface UpgradeDef {
  key: string;
  name: string;
  description: string;
  category: "capacity" | "reward" | "appeal" | "defense" | "utility";
  maxLevel: number;
  baseCostGold: number;
  costScaling: number;
  effectSummary: string;
  icon: string;
}

export const UPGRADES: UpgradeDef[] = [
  {
    key: "expand_chambers",
    name: "Expand Chambers",
    description: "Carve an additional chamber into your labyrinth, deepening every run.",
    category: "capacity",
    maxLevel: 6,
    baseCostGold: 300,
    costScaling: 250,
    effectSummary: "+1 chamber, +1 depth, +15 daily run capacity per level",
    icon: "🏛️",
  },
  {
    key: "deepen_vault",
    name: "Deepen the Vault",
    description: "Enrich the treasure tables so every clear drops more value.",
    category: "reward",
    maxLevel: 6,
    baseCostGold: 350,
    costScaling: 280,
    effectSummary: "+2500 daily reward capacity, richer loot rolls per level",
    icon: "💰",
  },
  {
    key: "rare_nodes",
    name: "Seed Rare Nodes",
    description: "Plant glittering resource nodes that yield premium materials.",
    category: "reward",
    maxLevel: 5,
    baseCostGold: 400,
    costScaling: 300,
    effectSummary: "+1 rare node, higher material drop value per level",
    icon: "💎",
  },
  {
    key: "gilded_halls",
    name: "Gilded Halls",
    description: "Adorn your halls to draw more adventurers from the overworld.",
    category: "appeal",
    maxLevel: 5,
    baseCostGold: 320,
    costScaling: 260,
    effectSummary: "+appeal score, boosts trending placement per level",
    icon: "✨",
  },
  {
    key: "ward_stones",
    name: "Ward Stones",
    description: "Empower guardians with arcane wards for a sterner challenge.",
    category: "defense",
    maxLevel: 5,
    baseCostGold: 280,
    costScaling: 240,
    effectSummary: "+enemy strength & difficulty, +appeal per level",
    icon: "🛡️",
  },
  {
    key: "boss_chamber",
    name: "Summon a Guardian Boss",
    description: "Bind a mighty boss to your final chamber for legendary rewards.",
    category: "appeal",
    maxLevel: 1,
    baseCostGold: 1200,
    costScaling: 0,
    effectSummary: "Adds a boss encounter with legendary loot & big appeal",
    icon: "👑",
  },
  {
    key: "beacon",
    name: "Overworld Beacon",
    description: "Light a beacon that pushes your labyrinth into featured rotations.",
    category: "utility",
    maxLevel: 3,
    baseCostGold: 600,
    costScaling: 500,
    effectSummary: "Strong appeal & featured boost per level",
    icon: "🔆",
  },
  {
    key: "torchlight",
    name: "Everburning Torches",
    description: "Speed adventurers through your halls for smoother, faster runs.",
    category: "utility",
    maxLevel: 4,
    baseCostGold: 220,
    costScaling: 200,
    effectSummary: "Faster estimated clears, +loot quality per level",
    icon: "🔥",
  },
];

export const UPGRADE_BY_KEY: Record<string, UpgradeDef> = Object.fromEntries(
  UPGRADES.map((u) => [u.key, u]),
);

export function upgradeCostForLevel(def: UpgradeDef, currentLevel: number): number {
  // cost to go from currentLevel -> currentLevel+1
  return def.baseCostGold + def.costScaling * currentLevel;
}

// Loadout slot keys (two ability stones share the ability_stone template slot;
// all other slots map 1:1 to their item template slot).
export const LOADOUT_SLOTS = [
  "weapon",
  "armor",
  "boots",
  "relic",
  "abilityStone",
  "abilityStone2",
  "charm",
  "helmet",
  "cape",
  "shoulders",
  "gloves",
  "pants",
  "shield",
  "neck",
] as const;

export type LoadoutSlotKey = (typeof LOADOUT_SLOTS)[number];

// Maps a loadout slot key to the item template slot it accepts
export function templateSlotForLoadoutSlot(slot: string): string {
  if (slot === "abilityStone" || slot === "abilityStone2") return "ability_stone";
  return slot;
}

export interface MockWalletSeed {
  walletAddress: string;
  displayName: string;
  avatarUrl: string;
  tagline: string;
  isPrimary: boolean;
  isGuest: boolean;
}

export const MOCK_WALLETS: MockWalletSeed[] = [
  {
    walletAddress: "Lab1Hammad7vQk9rZ3mXpToWnE5sYbCdGfHjKlMnPqRs",
    displayName: "Hammad",
    avatarUrl: "https://api.dicebear.com/7.x/adventurer/svg?seed=Hammad&backgroundColor=f5b942",
    tagline: "Architect of the Sunlit Ruins",
    isPrimary: true,
    isGuest: false,
  },
  {
    walletAddress: "Lab2Azuki5kQw8rT2nXpVoWmD4sYaBcEfGhJkLmNoPq",
    displayName: "AzukiKing",
    avatarUrl: "https://api.dicebear.com/7.x/adventurer/svg?seed=AzukiKing&backgroundColor=f57c5f",
    tagline: "Lord of the Emberforge",
    isPrimary: false,
    isGuest: false,
  },
  {
    walletAddress: "Lab3Spore6jPw7sT1nWpUoVmC3rXzAbDeFgHiJkLmNo",
    displayName: "SporeLord",
    avatarUrl: "https://api.dicebear.com/7.x/adventurer/svg?seed=SporeLord&backgroundColor=5fd97a",
    tagline: "Keeper of the Verdant Grove",
    isPrimary: false,
    isGuest: false,
  },
  {
    walletAddress: "Lab4Guest9mRx4uV6pZqYnXoWdB2tCaEgFhIjKlMnOp",
    displayName: "Guest Adventurer",
    avatarUrl: "https://api.dicebear.com/7.x/adventurer/svg?seed=Guest&backgroundColor=5fc9f5",
    tagline: "A wanderer seeking glory",
    isPrimary: false,
    isGuest: true,
  },
];
// Fixture wallets are exposed only when explicitly enabled in development.
