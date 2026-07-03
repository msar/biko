import { weeklyPromoGroupKey, weeklyPromoGroupLabel } from '@biko/shared';
import { Prisma, PrismaClient } from '@prisma/client';

type Db = PrismaClient | Prisma.TransactionClient;

export type PromoForFavorite = {
  store: string | null;
  notes: string | null;
  sponsorBank: string | null;
  entity: { name: string };
};

function promoEntityName(promo: PromoForFavorite): string {
  return promo.sponsorBank ? `${promo.sponsorBank} vía ${promo.entity.name}` : promo.entity.name;
}

export function favoriteGroupFromPromotion(promo: PromoForFavorite): { groupKey: string; label: string } {
  const entityName = promoEntityName(promo);
  return {
    groupKey: weeklyPromoGroupKey({ store: promo.store, notes: promo.notes, entityName }),
    label: weeklyPromoGroupLabel({ store: promo.store, notes: promo.notes }),
  };
}

export async function ensureFavoriteForPromotion(db: Db, householdId: string, promo: PromoForFavorite) {
  const { groupKey, label } = favoriteGroupFromPromotion(promo);
  await db.householdFavoriteWeeklyPromo.upsert({
    where: { householdId_groupKey: { householdId, groupKey } },
    create: { householdId, groupKey, label },
    update: {},
  });
}

export async function ensureFavoriteForPromotionId(db: Db, householdId: string, promotionId: string) {
  const promo = await db.promotion.findUnique({
    where: { id: promotionId },
    include: { entity: true },
  });
  if (!promo) return;
  await ensureFavoriteForPromotion(db, householdId, promo);
}

export async function syncFavoritesFromPurchaseHistory(db: PrismaClient, householdId: string) {
  const purchases = await db.purchase.findMany({
    where: {
      householdId,
      promotionId: { not: null },
    },
    select: { promotionId: true },
    distinct: ['promotionId'],
  });

  for (const { promotionId } of purchases) {
    if (promotionId) {
      await ensureFavoriteForPromotionId(db, householdId, promotionId);
    }
  }

  await db.household.update({
    where: { id: householdId },
    data: { favoritePromosSyncedAt: new Date() },
  });
}

export async function ensurePurchaseHistoryFavoritesSynced(db: PrismaClient, householdId: string) {
  const household = await db.household.findUnique({
    where: { id: householdId },
    select: { favoritePromosSyncedAt: true },
  });
  if (!household || household.favoritePromosSyncedAt) return;
  await syncFavoritesFromPurchaseHistory(db, householdId);
}
