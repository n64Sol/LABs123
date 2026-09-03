import { db, pool } from "@workspace/db";
import {
  usersTable,
  playerBalancesTable,
  playerMaterialsTable,
  treasuryTable,
  labyrinthsTable,
  labyrinthUpgradesTable,
  labyrinthRoomUnlocksTable,
  ratingsTable,
  chamberTemplatesTable,
  itemTemplatesTable,
  craftingRecipesTable,
  playerItemsTable,
  playerLoadoutsTable,
  activityLogTable,
  ledgerEntriesTable,
  ownerEarningsPendingTable,
  chainTransactionsTable,
  runsTable,
  type ChamberSpawnData,
  type ChamberObstacleData,
  type ItemStatsData,
} from "@workspace/db";
import { sql } from "drizzle-orm";
import { MOCK_WALLETS, MATERIALS, BIOME_BY_KEY } from "./lib/catalog";
import { GENERATED_TEMPLATES } from "./data/generatedCatalog";
import { parsedRoomLibrary, type RoomRole } from "./lib/rooms";
import { ROOM_TYPE_CATALOG, SIZE_RANK, roomTypeKey } from "./lib/roomPool";

async function clearAll(): Promise<void> {
  await db.execute(sql`
    TRUNCATE TABLE
      ${playerLoadoutsTable},
      ${playerItemsTable},
      ${runsTable},
      ${ratingsTable},
      ${labyrinthUpgradesTable},
      ${labyrinthRoomUnlocksTable},
      ${labyrinthsTable},
      ${playerMaterialsTable},
      ${playerBalancesTable},
      ${ledgerEntriesTable},
      ${ownerEarningsPendingTable},
      ${activityLogTable},
      ${chainTransactionsTable},
      ${craftingRecipesTable},
      ${chamberTemplatesTable},
      ${itemTemplatesTable},
      ${treasuryTable},
      ${usersTable}
    RESTART IDENTITY CASCADE
  `);
}

// ----- Item templates (15 across 7 slot types, 5 rarities) -----
interface SeedTemplate {
  key: string;
  name: string;
  description: string;
  slot: string;
  category: string;
  rarity: string;
  damageType: string;
  baseValue: number;
  stats: ItemStatsData;
  abilityKey?: string;
  abilityName?: string;
  abilityDescription?: string;
  icon: string;
  spriteLayers?: Record<string, string>;
}

const TEMPLATES: SeedTemplate[] = [
  // Weapons now live in the generated catalog (data/generatedCatalog.ts, slot
  // "weapon"); seed inserts GENERATED_TEMPLATES alongside these, so they reach
  // both fresh seeds and live DBs via backfill. Starter loadout below still
  // references their keys (rusted_shortsword, moonsilver_glaive).
  // Armor
  { key: "padded_jerkin", name: "Padded Jerkin", description: "Simple cloth padding for the cautious.", slot: "armor", category: "light", rarity: "common", damageType: "physical", baseValue: 40, stats: { defense: 6, health: 22 }, icon: "🧥", spriteLayers: { torso: "game/lpc/armor/padded.png" } },
  { key: "verdant_plate", name: "Verdant Plate", description: "Living bark armor that mends slowly over time.", slot: "armor", category: "heavy", rarity: "rare", damageType: "physical", baseValue: 210, stats: { defense: 24, health: 72 }, icon: "🛡️", spriteLayers: { torso: "game/lpc/armor/verdant.png" } },
  { key: "aegis_of_dawn", name: "Aegis of Dawn", description: "Radiant plate that drinks in the morning sun.", slot: "armor", category: "heavy", rarity: "legendary", damageType: "physical", baseValue: 750, stats: { defense: 72, health: 210, lootBonus: 8 }, icon: "🌅", spriteLayers: { torso: "game/lpc/armor/aegis.png" } },
  // Boots
  { key: "worn_traveler_boots", name: "Worn Traveler's Boots", description: "Cracked leather that's seen many roads.", slot: "boots", category: "light", rarity: "common", damageType: "physical", baseValue: 40, stats: { moveSpeed: 8, defense: 2 }, icon: "🥾", spriteLayers: { feet: "game/lpc/boots/worn.png" } },
  { key: "tidewalker_greaves", name: "Tidewalker Greaves", description: "Greaves that let you glide like the tide.", slot: "boots", category: "light", rarity: "epic", damageType: "physical", baseValue: 410, stats: { moveSpeed: 56, attackSpeed: 10, critChance: 8 }, icon: "🌊", spriteLayers: { feet: "game/lpc/boots/tidewalker.png" } },
  // Relics
  { key: "lucky_coin", name: "Lucky Coin", description: "An old coin that always lands your way.", slot: "relic", category: "trinket", rarity: "uncommon", damageType: "physical", baseValue: 95, stats: { lootBonus: 15 }, icon: "🪙" },
  { key: "prism_idol", name: "Prism Idol", description: "A faceted idol refracting fortune itself.", slot: "relic", category: "trinket", rarity: "epic", damageType: "physical", baseValue: 410, stats: { lootBonus: 36, critChance: 12 }, icon: "💠" },
  // Ability stones & runes — the sole source of combat abilities. Each carries one
  // ability plus modest stats, with rarity/value scaling to the ability's power.
  { key: "stone_of_haste", name: "Stone of Haste", description: "A warm stone that quickens the hand.", slot: "ability_stone", category: "stone", rarity: "uncommon", damageType: "physical", baseValue: 100, stats: { attackSpeed: 14, cooldownReduction: 10 }, abilityKey: "quickstep", abilityName: "Quickstep", abilityDescription: "Dash a short distance, evading harm.", icon: "💨" },
  { key: "stone_of_warding", name: "Stone of Warding", description: "A cool stone humming with protective resolve.", slot: "ability_stone", category: "stone", rarity: "rare", damageType: "physical", baseValue: 210, stats: { defense: 16, cooldownReduction: 14, health: 40 }, abilityKey: "bulwark", abilityName: "Bulwark", abilityDescription: "Plant your feet and greatly reduce damage for a moment.", icon: "🪨" },
  { key: "ember_rune", name: "Ember Rune", description: "A cracked rune leaking trapped firelight.", slot: "ability_stone", category: "stone", rarity: "rare", damageType: "fire", baseValue: 210, stats: { attack: 10, critChance: 6, cooldownReduction: 8 }, abilityKey: "flame_arc", abilityName: "Flame Arc", abilityDescription: "Unleash a sweeping arc of fire that burns all nearby foes.", icon: "🔥" },
  { key: "crescent_rune", name: "Crescent Rune", description: "A silver rune curved like a waning moon.", slot: "ability_stone", category: "stone", rarity: "epic", damageType: "physical", baseValue: 410, stats: { attack: 16, range: 1, critChance: 10 }, abilityKey: "crescent_sweep", abilityName: "Crescent Sweep", abilityDescription: "Strike all enemies in a wide crescent ahead of you.", icon: "🌙" },
  { key: "storm_rune", name: "Storm Rune", description: "A rune that snaps with caged lightning.", slot: "ability_stone", category: "stone", rarity: "epic", damageType: "lightning", baseValue: 410, stats: { attack: 14, attackSpeed: 12, range: 2 }, abilityKey: "chain_shot", abilityName: "Chain Shot", abilityDescription: "Fire a bolt that arcs between multiple enemies.", icon: "⚡" },
  { key: "tremor_stone", name: "Tremor Stone", description: "A dense stone that hums with buried force.", slot: "ability_stone", category: "stone", rarity: "epic", damageType: "physical", baseValue: 410, stats: { attack: 18, health: 30, cooldownReduction: 6 }, abilityKey: "seismic_slam", abilityName: "Seismic Slam", abilityDescription: "Smash the ground, stunning and damaging everything around you.", icon: "🌋" },
  { key: "bark_stone", name: "Heartwood Stone", description: "A knot of living wood that hardens on command.", slot: "ability_stone", category: "stone", rarity: "rare", damageType: "physical", baseValue: 210, stats: { defense: 14, health: 48, cooldownReduction: 10 }, abilityKey: "barkskin", abilityName: "Barkskin", abilityDescription: "Harden your skin, sharply reducing incoming damage briefly.", icon: "🌳" },
  { key: "dawn_stone", name: "Dawnstone", description: "A radiant stone that drinks in the morning light.", slot: "ability_stone", category: "stone", rarity: "legendary", damageType: "physical", baseValue: 700, stats: { defense: 30, health: 90, lootBonus: 6 }, abilityKey: "sun_ward", abilityName: "Sun Ward", abilityDescription: "Erect a shield of light that absorbs a burst of damage.", icon: "🌅" },
  { key: "fortune_rune", name: "Fortune Rune", description: "A prism-cut rune that bends luck your way.", slot: "ability_stone", category: "stone", rarity: "epic", damageType: "physical", baseValue: 410, stats: { lootBonus: 24, critChance: 8 }, abilityKey: "fortune_surge", abilityName: "Fortune Surge", abilityDescription: "Briefly double loot quality from kills.", icon: "💠" },
  { key: "phoenix_rune", name: "Phoenix Rune", description: "A still-warm rune that pulses with rebirth.", slot: "ability_stone", category: "stone", rarity: "legendary", damageType: "fire", baseValue: 700, stats: { health: 100, defense: 18, lootBonus: 10 }, abilityKey: "rekindle", abilityName: "Rekindle", abilityDescription: "On lethal damage, revive once with a burst of flame.", icon: "🪶" },
  // Charm
  { key: "sprigs_charm", name: "Sprig's Charm", description: "A tiny woven charm that wards off ill luck.", slot: "charm", category: "charm", rarity: "common", damageType: "physical", baseValue: 40, stats: { health: 25, lootBonus: 4 }, icon: "🍀" },
  { key: "phoenix_feather", name: "Phoenix Feather", description: "A still-warm feather that pulses with rebirth.", slot: "charm", category: "charm", rarity: "legendary", damageType: "fire", baseValue: 750, stats: { health: 130, defense: 22, lootBonus: 14 }, icon: "🪶" },
];

const RECIPES = [
  { name: "Forge Emberbrand Blade", description: "Temper steel in emberglass to forge a smoldering blade.", resultTemplateKey: "emberbrand_blade", costGold: 330, costMaterials: [{ key: "emberglass", name: "Emberglass", icon: "🔥", amount: 6 }, { key: "moonsilver", name: "Moonsilver", icon: "🌙", amount: 3 }] },
  { name: "Grow Verdant Plate", description: "Coax living bark into a self-mending breastplate.", resultTemplateKey: "verdant_plate", costGold: 330, costMaterials: [{ key: "verdant_root", name: "Verdant Root", icon: "🌿", amount: 8 }, { key: "moonsilver", name: "Moonsilver", icon: "🌙", amount: 2 }] },
  { name: "Cut the Prism Idol", description: "Facet a prism shard into an idol of fortune.", resultTemplateKey: "prism_idol", costGold: 540, costMaterials: [{ key: "prism_shard", name: "Prism Shard", icon: "💠", amount: 5 }, { key: "shadow_thread", name: "Shadow Thread", icon: "🕸️", amount: 3 }] },
  { name: "Weave Tidewalker Greaves", description: "Weave shadow thread into greaves light as sea foam.", resultTemplateKey: "tidewalker_greaves", costGold: 500, costMaterials: [{ key: "shadow_thread", name: "Shadow Thread", icon: "🕸️", amount: 6 }, { key: "moonsilver", name: "Moonsilver", icon: "🌙", amount: 4 }] },
  { name: "Bind the Phoenix Feather", description: "Bind ember and prism to a feather of endless rebirth.", resultTemplateKey: "phoenix_feather", costGold: 1050, costMaterials: [{ key: "emberglass", name: "Emberglass", icon: "🔥", amount: 12 }, { key: "prism_shard", name: "Prism Shard", icon: "💠", amount: 7 }] },
];

function chamber(
  name: string,
  biome: string,
  width: number,
  height: number,
  difficulty: number,
  lootTier: number,
  hasBoss: boolean,
  spawns: ChamberSpawnData[],
  obstacles: ChamberObstacleData[],
) {
  return {
    name,
    biome,
    accentColor: BIOME_BY_KEY[biome]?.accentColor ?? "#f5b942",
    backgroundStyle: BIOME_BY_KEY[biome]?.backgroundStyle,
    width,
    height,
    difficulty,
    lootTier,
    hasBoss,
    spawns,
    obstacles,
  };
}

const ROLE_DIFFICULTY: Record<RoomRole, number> = {
  entry: 1,
  combat: 2,
  gauntlet: 3,
  hazard: 3,
  treasure: 2,
  boss: 5,
};

const ROLE_LOOT_TIER: Record<RoomRole, number> = {
  entry: 1,
  combat: 2,
  gauntlet: 2,
  hazard: 2,
  treasure: 3,
  boss: 5,
};

// Insert the handcrafted room library as biome-agnostic chamber templates. The
// assembler reskins each room to a labyrinth's biome at run time, so a neutral
// default biome is stored here for legacy summary fields.
function buildChamberTemplates() {
  const defaultBiome = Object.keys(BIOME_BY_KEY)[0]!;
  return parsedRoomLibrary().map((room) => ({
    name: room.name,
    biome: defaultBiome,
    accentColor: BIOME_BY_KEY[defaultBiome]?.accentColor ?? "#f5b942",
    backgroundStyle: BIOME_BY_KEY[defaultBiome]?.backgroundStyle,
    width: room.width,
    height: room.height,
    difficulty: ROLE_DIFFICULTY[room.role],
    lootTier: ROLE_LOOT_TIER[room.role],
    hasBoss: room.role === "boss",
    spawns: room.spawns,
    obstacles: room.obstacles,
    tiles: room.tiles,
    hazardZones: room.hazardZones,
    doors: room.doors,
    role: room.role,
    sizeClass: room.sizeClass,
  }));
}

interface SeedLab {
  ownerIdx: number;
  name: string;
  description: string;
  biome: string;
  level: number;
  depth: number;
  chamberCount: number;
  rareNodeCount: number;
  published: boolean;
  featured: boolean;
  tollGateUnlocked: boolean;
  entryFee: number;
  bossActive: boolean;
  runsAllTime: number;
  runsToday: number;
  rewardValueAllTime: number;
  rewardValueToday: number;
  lifetimeDropShareValue: number;
  lifetimeEntryShare: number;
  pendingDropShareValue: number;
  pendingEntryShare: number;
  upgrades: { key: string; level: number }[];
}

const LABS: SeedLab[] = [
  { ownerIdx: 0, name: "The Sunlit Atrium", description: "A radiant maze of golden ruins, beloved by new adventurers.", biome: "sunlit_ruins", level: 6, depth: 5, chamberCount: 4, rareNodeCount: 2, published: true, featured: true, tollGateUnlocked: true, entryFee: 12, bossActive: true, runsAllTime: 482, runsToday: 14, rewardValueAllTime: 142500, rewardValueToday: 3820, lifetimeDropShareValue: 28500, lifetimeEntryShare: 4600, pendingDropShareValue: 760, pendingEntryShare: 134, upgrades: [{ key: "expand_chambers", level: 3 }, { key: "deepen_vault", level: 2 }, { key: "rare_nodes", level: 2 }, { key: "boss_chamber", level: 1 }, { key: "gilded_halls", level: 2 }] },
  { ownerIdx: 1, name: "Emberforge Descent", description: "Plunge through molten halls guarded by a fire-wreathed colossus.", biome: "emberforge", level: 8, depth: 6, chamberCount: 5, rareNodeCount: 3, published: true, featured: true, tollGateUnlocked: true, entryFee: 25, bossActive: true, runsAllTime: 731, runsToday: 22, rewardValueAllTime: 268400, rewardValueToday: 6120, lifetimeDropShareValue: 53600, lifetimeEntryShare: 14600, pendingDropShareValue: 1224, pendingEntryShare: 440, upgrades: [{ key: "expand_chambers", level: 4 }, { key: "deepen_vault", level: 3 }, { key: "boss_chamber", level: 1 }, { key: "ward_stones", level: 3 }, { key: "beacon", level: 2 }] },
  { ownerIdx: 2, name: "The Verdant Spiral", description: "A living labyrinth of vines and glittering spore-nodes.", biome: "verdant_grove", level: 5, depth: 4, chamberCount: 3, rareNodeCount: 2, published: true, featured: false, tollGateUnlocked: true, entryFee: 8, bossActive: false, runsAllTime: 356, runsToday: 9, rewardValueAllTime: 98200, rewardValueToday: 2140, lifetimeDropShareValue: 19640, lifetimeEntryShare: 2280, pendingDropShareValue: 428, pendingEntryShare: 64, upgrades: [{ key: "expand_chambers", level: 2 }, { key: "rare_nodes", level: 3 }, { key: "gilded_halls", level: 1 }] },
  { ownerIdx: 0, name: "Crystal Caverns of Echoes", description: "Shimmering caves where every step rings like a bell.", biome: "crystal_caverns", level: 4, depth: 4, chamberCount: 3, rareNodeCount: 1, published: true, featured: false, tollGateUnlocked: false, entryFee: 0, bossActive: false, runsAllTime: 214, runsToday: 6, rewardValueAllTime: 61200, rewardValueToday: 1480, lifetimeDropShareValue: 12240, lifetimeEntryShare: 0, pendingDropShareValue: 296, pendingEntryShare: 0, upgrades: [{ key: "expand_chambers", level: 2 }, { key: "deepen_vault", level: 1 }] },
  { ownerIdx: 1, name: "Astral Spire Ascent", description: "Climb a tower of starlight toward an arcane guardian.", biome: "astral_spire", level: 7, depth: 5, chamberCount: 4, rareNodeCount: 2, published: true, featured: false, tollGateUnlocked: true, entryFee: 18, bossActive: true, runsAllTime: 419, runsToday: 11, rewardValueAllTime: 156800, rewardValueToday: 3260, lifetimeDropShareValue: 31360, lifetimeEntryShare: 6040, pendingDropShareValue: 652, pendingEntryShare: 158, upgrades: [{ key: "expand_chambers", level: 3 }, { key: "boss_chamber", level: 1 }, { key: "ward_stones", level: 2 }, { key: "beacon", level: 1 }] },
  { ownerIdx: 2, name: "Tidecaller Hollow", description: "A drowned grotto where treasure glints beneath the waves.", biome: "tidecaller", level: 5, depth: 4, chamberCount: 3, rareNodeCount: 2, published: true, featured: false, tollGateUnlocked: true, entryFee: 10, bossActive: false, runsAllTime: 287, runsToday: 7, rewardValueAllTime: 79400, rewardValueToday: 1760, lifetimeDropShareValue: 15880, lifetimeEntryShare: 2160, pendingDropShareValue: 352, pendingEntryShare: 88, upgrades: [{ key: "rare_nodes", level: 2 }, { key: "torchlight", level: 2 }, { key: "gilded_halls", level: 1 }] },
  { ownerIdx: 0, name: "The Gilded Descent", description: "An opulent maze dripping with gold for the bold.", biome: "sunlit_ruins", level: 9, depth: 6, chamberCount: 5, rareNodeCount: 3, published: true, featured: true, tollGateUnlocked: true, entryFee: 30, bossActive: true, runsAllTime: 904, runsToday: 28, rewardValueAllTime: 342000, rewardValueToday: 8400, lifetimeDropShareValue: 68400, lifetimeEntryShare: 21680, pendingDropShareValue: 1680, pendingEntryShare: 672, upgrades: [{ key: "expand_chambers", level: 4 }, { key: "deepen_vault", level: 4 }, { key: "rare_nodes", level: 3 }, { key: "boss_chamber", level: 1 }, { key: "beacon", level: 3 }, { key: "gilded_halls", level: 3 }] },
  { ownerIdx: 1, name: "Verdant Ruin Crossing", description: "Where jungle reclaims an ancient stone crossing.", biome: "verdant_grove", level: 3, depth: 3, chamberCount: 2, rareNodeCount: 1, published: true, featured: false, tollGateUnlocked: false, entryFee: 0, bossActive: false, runsAllTime: 132, runsToday: 4, rewardValueAllTime: 34800, rewardValueToday: 920, lifetimeDropShareValue: 6960, lifetimeEntryShare: 0, pendingDropShareValue: 184, pendingEntryShare: 0, upgrades: [{ key: "expand_chambers", level: 1 }] },
  { ownerIdx: 2, name: "The Frostlit Vault", description: "A quiet, crystalline vault rumored to hide a legendary relic.", biome: "crystal_caverns", level: 6, depth: 5, chamberCount: 4, rareNodeCount: 2, published: true, featured: false, tollGateUnlocked: true, entryFee: 15, bossActive: true, runsAllTime: 366, runsToday: 10, rewardValueAllTime: 118600, rewardValueToday: 2680, lifetimeDropShareValue: 23720, lifetimeEntryShare: 4380, pendingDropShareValue: 536, pendingEntryShare: 120, upgrades: [{ key: "expand_chambers", level: 3 }, { key: "boss_chamber", level: 1 }, { key: "deepen_vault", level: 2 }] },
  { ownerIdx: 0, name: "Ruins of First Light", description: "A gentle starter maze where every hero takes their first steps.", biome: "sunlit_ruins", level: 2, depth: 2, chamberCount: 2, rareNodeCount: 0, published: true, featured: false, tollGateUnlocked: false, entryFee: 0, bossActive: false, runsAllTime: 88, runsToday: 3, rewardValueAllTime: 18200, rewardValueToday: 540, lifetimeDropShareValue: 3640, lifetimeEntryShare: 0, pendingDropShareValue: 108, pendingEntryShare: 0, upgrades: [] },
];

async function seed(): Promise<void> {
  console.log("Clearing existing data...");
  await clearAll();

  console.log("Seeding treasury...");
  await db.insert(treasuryTable).values({
    id: 1,
    labTokenBalance: 18420,
    totalEntryFeesCollected: 92100,
    totalRuns: 3979,
  });

  console.log("Seeding users + balances + materials...");
  const userIds: number[] = [];
  const balancePresets = [
    { gold: 4200, ore: 320, dust: 280, keys: 24, labToken: 1850 }, // Hammad
    { gold: 3100, ore: 210, dust: 190, keys: 16, labToken: 1240 }, // AzukiKing
    { gold: 2600, ore: 180, dust: 160, keys: 12, labToken: 980 }, // SporeLord
    { gold: 800, ore: 60, dust: 40, keys: 4, labToken: 250 }, // Guest
  ];
  for (let i = 0; i < MOCK_WALLETS.length; i++) {
    const w = MOCK_WALLETS[i]!;
    const inserted = await db
      .insert(usersTable)
      .values({
        walletAddress: w.walletAddress,
        displayName: w.displayName,
        avatarUrl: w.avatarUrl,
        tagline: w.tagline,
        isPrimary: w.isPrimary,
        isGuest: w.isGuest,
      })
      .returning();
    const uid = inserted[0]!.id;
    userIds.push(uid);
    const preset = balancePresets[i]!;
    await db.insert(playerBalancesTable).values({ userId: uid, ...preset });
    // Record seeded starting balances in the ledger so the accounting trail is
    // complete from genesis.
    for (const [currency, amount] of Object.entries(preset)) {
      if (amount <= 0) continue;
      await db.insert(ledgerEntriesTable).values({
        userId: uid,
        type: "admin_seed_credit",
        direction: "credit",
        description: `Seeded starting ${currency} balance`,
        reason: `Seeded starting ${currency} balance`,
        amount,
        currency,
      });
    }
    for (let m = 0; m < MATERIALS.length; m++) {
      const matAmount = Math.max(2, 18 - i * 3 - m * 2);
      await db.insert(playerMaterialsTable).values({
        userId: uid,
        materialKey: MATERIALS[m]!.key,
        amount: matAmount,
      });
      await db.insert(ledgerEntriesTable).values({
        userId: uid,
        type: "admin_seed_credit",
        direction: "credit",
        description: `Seeded starting ${MATERIALS[m]!.name}`,
        reason: `Seeded starting ${MATERIALS[m]!.name}`,
        amount: matAmount,
        currency: MATERIALS[m]!.key,
      });
    }
  }

  console.log("Seeding item templates...");
  await db.insert(itemTemplatesTable).values([...TEMPLATES, ...GENERATED_TEMPLATES]);

  console.log("Seeding crafting recipes...");
  await db.insert(craftingRecipesTable).values(RECIPES);

  console.log("Seeding chamber templates...");
  await db.insert(chamberTemplatesTable).values(buildChamberTemplates());

  console.log("Seeding labyrinths + upgrades...");
  const labIds: number[] = [];
  for (const lab of LABS) {
    const ownerId = userIds[lab.ownerIdx]!;
    const inserted = await db
      .insert(labyrinthsTable)
      .values({
        ownerUserId: ownerId,
        name: lab.name,
        description: lab.description,
        biome: lab.biome,
        accentColor: BIOME_BY_KEY[lab.biome]?.accentColor ?? "#f5b942",
        level: lab.level,
        depth: lab.depth,
        chamberCount: lab.chamberCount,
        rareNodeCount: lab.rareNodeCount,
        published: lab.published,
        featured: lab.featured,
        tollGateUnlocked: lab.tollGateUnlocked,
        entryFee: lab.entryFee,
        bossActive: lab.bossActive,
        runsAllTime: lab.runsAllTime,
        runsToday: lab.runsToday,
        rewardValueAllTime: lab.rewardValueAllTime,
        rewardValueToday: lab.rewardValueToday,
        lifetimeDropShareValue: lab.lifetimeDropShareValue,
        lifetimeEntryShare: lab.lifetimeEntryShare,
        pendingDropShareValue: lab.pendingDropShareValue,
        pendingEntryShare: lab.pendingEntryShare,
        dropShareToday: Math.floor(lab.rewardValueToday * 0.2),
        entryShareToday: Math.floor(lab.pendingEntryShare),
        dailyRunCapacity: 50 + lab.chamberCount * 15,
        dailyRewardCapacity: 5000 + lab.level * 2500,
      })
      .returning();
    const labId = inserted[0]!.id;
    labIds.push(labId);
    for (const u of lab.upgrades) {
      await db.insert(labyrinthUpgradesTable).values({ labyrinthId: labId, upgradeKey: u.key, level: u.level });
    }
    // Unlock the room types this lab's depth/size can currently use (plus boss if
    // a boss chamber is active), so seeded labs assemble exactly as before.
    const maxRank = lab.depth >= 5 ? SIZE_RANK.large : lab.depth >= 3 ? SIZE_RANK.medium : SIZE_RANK.small;
    const roomKeys = ROOM_TYPE_CATALOG.filter(
      (e) => e.role !== "boss" && SIZE_RANK[e.size] <= maxRank,
    ).map((e) => e.key);
    if (lab.bossActive) roomKeys.push(roomTypeKey("boss", "large"));
    if (roomKeys.length > 0) {
      await db
        .insert(labyrinthRoomUnlocksTable)
        .values(roomKeys.map((roomKey) => ({ labyrinthId: labId, roomKey })))
        .onConflictDoNothing();
    }
  }

  console.log("Seeding ratings + activity...");
  const comments = [
    { stars: 5, comment: "Stunning design and the boss fight was thrilling!", difficultyVote: "just_right" },
    { stars: 4, comment: "Great loot, a touch tough in the final chamber.", difficultyVote: "hard" },
    { stars: 5, comment: "My favorite labyrinth — I run it daily.", difficultyVote: "just_right" },
    { stars: 3, comment: "Fun but the toll fee is a bit steep.", difficultyVote: "just_right" },
    { stars: 4, comment: "Beautiful biome, smooth pacing.", difficultyVote: "easy" },
  ];
  // Each rating belongs to exactly one completed, non-owner run. We seed a
  // matching completed run for every rating so the run_id (notNull + unique)
  // invariant holds with realistic data.
  async function seedCompletedRun(
    labId: number,
    visitorId: number,
    ownerId: number,
  ): Promise<number> {
    const inserted = await db
      .insert(runsTable)
      .values({
        labyrinthId: labId,
        visitorUserId: visitorId,
        ownerUserId: ownerId,
        status: "completed",
        isOwnerRun: false,
        cleared: true,
        chambers: [],
        completedAt: new Date(),
      })
      .returning();
    return inserted[0]!.id;
  }
  for (let i = 0; i < labIds.length; i++) {
    const ownerId = userIds[LABS[i]!.ownerIdx]!;
    const raterId = userIds[(i + 1) % 3]!;
    const raterId2 = userIds[(i + 2) % 3]!;
    // Skip a rater that would be the owner (owners cannot rate their own lab).
    const ratersForLab = [raterId, raterId2].filter((r) => r !== ownerId);
    const commentPool = [comments[i % comments.length]!, comments[(i + 2) % comments.length]!];
    for (let r = 0; r < ratersForLab.length; r++) {
      const rater = ratersForLab[r]!;
      const c = commentPool[r]!;
      const runId = await seedCompletedRun(labIds[i]!, rater, ownerId);
      await db.insert(ratingsTable).values({
        labyrinthId: labIds[i]!,
        runId,
        raterUserId: rater,
        stars: c.stars,
        comment: c.comment,
        difficultyVote: c.difficultyVote,
      });
    }
  }

  const activities = [
    { type: "publish", message: "Hammad published The Gilded Descent to the overworld", actorUserId: userIds[0]!, labyrinthId: labIds[6]! },
    { type: "run", message: "AzukiKing cleared The Sunlit Atrium and gathered 420 in loot", actorUserId: userIds[1]!, labyrinthId: labIds[0]!, value: 420 },
    { type: "drop_share", message: "Hammad earned a 20% drop share of 84 $LAB", actorUserId: userIds[0]!, labyrinthId: labIds[0]!, value: 84 },
    { type: "toll_gate", message: "SporeLord unlocked the Toll Gate on Tidecaller Hollow", actorUserId: userIds[2]!, labyrinthId: labIds[5]! },
    { type: "upgrade", message: "AzukiKing summoned a Guardian Boss in Emberforge Descent", actorUserId: userIds[1]!, labyrinthId: labIds[1]! },
    { type: "rating", message: "Guest Adventurer rated Astral Spire Ascent 5★", actorUserId: userIds[3]!, labyrinthId: labIds[4]!, value: 5 },
    { type: "craft", message: "Hammad crafted Emberbrand Blade", actorUserId: userIds[0]! },
  ];
  await db.insert(activityLogTable).values(activities);

  console.log("Seeding starter inventory + loadout for Hammad...");
  const hammad = userIds[0]!;
  const starterItems: { templateKey: string; level: number; slot: string | null }[] = [
    { templateKey: "moonsilver_glaive", level: 2, slot: "weapon" },
    { templateKey: "verdant_plate", level: 2, slot: "armor" },
    { templateKey: "tidewalker_greaves", level: 1, slot: "boots" },
    { templateKey: "prism_idol", level: 1, slot: "relic" },
    { templateKey: "stone_of_haste", level: 1, slot: "abilityStone" },
    { templateKey: "stone_of_warding", level: 1, slot: "abilityStone2" },
    { templateKey: "phoenix_feather", level: 1, slot: "charm" },
    { templateKey: "rusted_shortsword", level: 1, slot: null },
    { templateKey: "lucky_coin", level: 1, slot: null },
  ];
  for (const si of starterItems) {
    const ins = await db
      .insert(playerItemsTable)
      .values({ userId: hammad, templateKey: si.templateKey, level: si.level })
      .returning();
    if (si.slot) {
      await db.insert(playerLoadoutsTable).values({ userId: hammad, slotKey: si.slot, playerItemId: ins[0]!.id });
    }
  }

  // Give the other non-guest players a couple of unequipped items each
  for (const uid of [userIds[1]!, userIds[2]!]) {
    for (const key of ["emberbrand_blade", "aegis_of_dawn", "stone_of_haste"]) {
      await db.insert(playerItemsTable).values({ userId: uid, templateKey: key, level: 1 });
    }
  }

  console.log("Seeding sample Robinhood Chain settlement records...");
  await db.insert(chainTransactionsTable).values([
    { userId: hammad, reference: "ledger_seed_airdrop_hammad", kind: "airdrop", status: "confirmed", amount: 1000, currency: "LAB", memo: "Welcome ledger credit", network: "Robinhood Chain Testnet", chainId: 46630 },
    { userId: userIds[1]!, reference: "ledger_seed_entry_azuki", kind: "entry_fee", status: "confirmed", amount: 12, currency: "LAB", memo: "Paid entry to The Sunlit Atrium", network: "Robinhood Chain Testnet", chainId: 46630 },
    { userId: hammad, reference: "ledger_seed_collect_hammad", kind: "collect_earnings", status: "confirmed", amount: 640, currency: "LAB", memo: "Collected owner earnings", network: "Robinhood Chain Testnet", chainId: 46630 },
  ]);

  console.log("Seed complete.");
}

seed()
  .then(async () => {
    await pool.end();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error(err);
    await pool.end();
    process.exit(1);
  });
