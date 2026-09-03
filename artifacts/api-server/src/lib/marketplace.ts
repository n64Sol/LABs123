import { db } from "@workspace/db";
import {
  marketplaceListingsTable,
  playerItemsTable,
  itemTemplatesTable,
  usersTable,
  type MarketplaceListing,
  type ItemTemplate,
  type PlayerItem,
  type User,
} from "@workspace/db";
import { eq, and, inArray } from "drizzle-orm";
import { MARKETPLACE_FEE_BPS } from "./catalog";
import { toItemTemplateDto } from "./dto";
import { itemValue, scaleStats } from "./game";

import type { DbLike } from "./db";

// Fee charged on a sale price (integer USDC cents), floored.
export function marketplaceFee(priceCents: number): number {
  return Math.floor((priceCents * MARKETPLACE_FEE_BPS) / 10_000);
}

// Set of the caller's player-item ids that currently have an ACTIVE listing
// (i.e. are escrowed). Used to lock items from equip / upgrade / disposal.
export async function listedItemIds(
  userId: number,
  tx: DbLike = db,
): Promise<Set<number>> {
  const rows = await tx
    .select({ playerItemId: marketplaceListingsTable.playerItemId })
    .from(marketplaceListingsTable)
    .where(
      and(
        eq(marketplaceListingsTable.sellerUserId, userId),
        eq(marketplaceListingsTable.status, "active"),
      ),
    );
  return new Set(rows.map((r) => r.playerItemId));
}

// Returns the active listing for a given item, or null.
export async function activeListingForItem(
  playerItemId: number,
  tx: DbLike = db,
): Promise<MarketplaceListing | null> {
  const rows = await tx
    .select()
    .from(marketplaceListingsTable)
    .where(
      and(
        eq(marketplaceListingsTable.playerItemId, playerItemId),
        eq(marketplaceListingsTable.status, "active"),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

export interface MarketplaceListingDto {
  id: number;
  priceCents: number;
  feeCents: number;
  status: string;
  sellerUserId: number;
  sellerName: string;
  sellerAvatarUrl: string;
  isOwn: boolean;
  playerItemId: number;
  item: {
    id: number;
    template: ReturnType<typeof toItemTemplateDto>;
    level: number;
    value: number;
    stats: ReturnType<typeof scaleStats>;
  };
  createdAt: string;
}

function toListingDto(
  listing: MarketplaceListing,
  item: PlayerItem,
  template: ItemTemplate,
  seller: User | null,
  viewerUserId: number | null,
): MarketplaceListingDto {
  return {
    id: listing.id,
    priceCents: listing.priceCents,
    feeCents: marketplaceFee(listing.priceCents),
    status: listing.status,
    sellerUserId: listing.sellerUserId,
    sellerName: seller?.displayName ?? "Unknown",
    sellerAvatarUrl: seller?.avatarUrl ?? "",
    isOwn: viewerUserId != null && viewerUserId === listing.sellerUserId,
    playerItemId: listing.playerItemId,
    item: {
      id: item.id,
      template: toItemTemplateDto(template),
      level: item.level,
      value: itemValue(template.baseValue, item.level),
      stats: scaleStats(template.stats, item.level),
    },
    createdAt: listing.createdAt.toISOString(),
  };
}

// Builds DTOs for a set of listings, batch-loading items, templates, sellers.
export async function buildListingDtos(
  listings: MarketplaceListing[],
  viewerUserId: number | null,
  tx: DbLike = db,
): Promise<MarketplaceListingDto[]> {
  if (listings.length === 0) return [];
  const itemIds = listings.map((l) => l.playerItemId);
  const sellerIds = Array.from(new Set(listings.map((l) => l.sellerUserId)));

  const items = await tx
    .select()
    .from(playerItemsTable)
    .where(inArray(playerItemsTable.id, itemIds));
  const itemById = new Map(items.map((i) => [i.id, i]));

  const templateKeys = Array.from(new Set(items.map((i) => i.templateKey)));
  const templates =
    templateKeys.length > 0
      ? await tx
          .select()
          .from(itemTemplatesTable)
          .where(inArray(itemTemplatesTable.key, templateKeys))
      : [];
  const tplByKey = new Map(templates.map((t) => [t.key, t]));

  const sellers = await tx
    .select()
    .from(usersTable)
    .where(inArray(usersTable.id, sellerIds));
  const sellerById = new Map(sellers.map((s) => [s.id, s]));

  const out: MarketplaceListingDto[] = [];
  for (const listing of listings) {
    const item = itemById.get(listing.playerItemId);
    if (!item) continue;
    const template = tplByKey.get(item.templateKey);
    if (!template) continue;
    out.push(
      toListingDto(
        listing,
        item,
        template,
        sellerById.get(listing.sellerUserId) ?? null,
        viewerUserId,
      ),
    );
  }
  return out;
}
