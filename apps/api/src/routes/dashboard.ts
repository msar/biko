import {
  allocationShareForInstallment,
  attributionMonth,
  computeSettleTransfers,
  groupCategories,
  groupCategoriesByMonth,
} from '@biko/shared';
import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { resolvePurchasePayer } from '../services/purchase-payer.js';

export type DashboardScope = 'household' | 'personal' | 'all';

const scopeSchema = z.enum(['household', 'personal', 'all']).default('household');

const monthQuerySchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/).optional(),
  scope: scopeSchema,
});

const longTermQuerySchema = z.object({
  months: z.coerce.number().int().min(1).max(36).optional(),
  scope: scopeSchema,
});

const upcomingQuerySchema = z.object({
  scope: scopeSchema,
});

function rateToArs(value: unknown): number {
  if (value == null) return 1;
  if (typeof value === 'object' && value !== null && 'toNumber' in value) {
    const n = (value as { toNumber(): number }).toNumber();
    return Number.isFinite(n) && n > 0 ? n : 1;
  }
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

/** Devuelve los últimos `count` meses en formato `YYYY-MM`, del más viejo al más reciente. */
function recentMonths(count: number): string[] {
  const now = new Date();
  const months: string[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  return months;
}

function monthRange(month?: string): { gte: Date; lt: Date; label: string } {
  const now = new Date();
  const [y, m] = month ? month.split('-').map(Number) : [now.getFullYear(), now.getMonth() + 1];
  return {
    gte: new Date(y!, m! - 1, 1),
    lt: new Date(y!, m!, 1),
    label: `${y}-${String(m).padStart(2, '0')}`,
  };
}

/** Whether a purchase counts toward the selected dashboard scope for this viewer. */
export function purchaseMatchesScope(
  purchase: { scope: 'HOUSEHOLD' | 'PERSONAL'; userId: string },
  viewerId: string,
  dashboardScope: DashboardScope,
): boolean {
  if (purchase.scope === 'PERSONAL' && purchase.userId !== viewerId) return false;
  if (dashboardScope === 'household') return purchase.scope === 'HOUSEHOLD';
  if (dashboardScope === 'personal') return purchase.scope === 'PERSONAL';
  return true; // all = household + own personal
}

function purchaseScopeWhere(viewerId: string, dashboardScope: DashboardScope) {
  if (dashboardScope === 'household') {
    return { scope: 'HOUSEHOLD' as const };
  }
  if (dashboardScope === 'personal') {
    return { scope: 'PERSONAL' as const, userId: viewerId };
  }
  return {
    OR: [
      { scope: 'HOUSEHOLD' as const },
      { scope: 'PERSONAL' as const, userId: viewerId },
    ],
  };
}

/** Merge dashboard scope with extra purchase predicates (dates, installment count). */
function purchaseWhere(
  viewerId: string,
  dashboardScope: DashboardScope,
  extra: Record<string, unknown>,
) {
  const scopePart = purchaseScopeWhere(viewerId, dashboardScope);
  if ('OR' in scopePart) {
    return { AND: [scopePart, extra] };
  }
  return { ...scopePart, ...extra };
}

export default async function dashboardRoutes(app: FastifyInstance) {
  app.get('/dashboard/monthly', { preHandler: [app.authenticate] }, async (request) => {
    const { month, scope: dashboardScope } = monthQuerySchema.parse(request.query);
    const range = monthRange(month);
    const householdId = request.user.householdId;
    const viewerId = request.user.userId;

    const installments = await app.prisma.installment.findMany({
      where: {
        householdId,
        OR: [
          {
            purchase: purchaseWhere(viewerId, dashboardScope, {
              installmentsCount: 1,
              purchaseDate: { gte: range.gte, lt: range.lt },
            }),
          },
          {
            purchase: purchaseWhere(viewerId, dashboardScope, {
              installmentsCount: { gte: 2 },
            }),
            dueDate: { gte: range.gte, lt: range.lt },
          },
        ],
      },
      include: {
        purchase: {
          include: {
            category: true,
            user: { select: { id: true, name: true } },
            paidBy: { select: { id: true, name: true } },
            paymentMethod: {
              include: { definition: { include: { entity: true } }, owner: { select: { id: true, name: true } } },
            },
            allocations: { include: { user: { select: { id: true, name: true } } } },
          },
        },
      },
      orderBy: { dueDate: 'asc' },
    });

    const byCategory = new Map<
      string,
      { categoryId: string; name: string; icon: string | null; color: string | null; total: number }
    >();
    const byUser = new Map<string, { userId: string; name: string; total: number }>();
    const byPaymentMethod = new Map<string, { paymentMethodId: string; name: string; total: number }>();

    // Settle-up: only HOUSEHOLD spend creates shared debt (and only when viewing hogar).
    const memberNames = new Map<string, string>();
    const paidByUser = new Map<string, number>();
    const shareByUser = new Map<string, number>();
    const includeSettle = dashboardScope === 'household';

    for (const inst of installments) {
      const purchase = inst.purchase;
      const rate = rateToArs(purchase.exchangeRateToArs);
      const amount = inst.amount.toNumber() * rate;
      const netAmount = purchase.netAmount.toNumber();
      const isHousehold = purchase.scope === 'HOUSEHOLD';

      const cat = purchase.category;
      const catEntry = byCategory.get(cat.id) ?? {
        categoryId: cat.id,
        name: cat.name,
        icon: cat.icon,
        color: cat.color,
        total: 0,
      };
      catEntry.total += amount;
      byCategory.set(cat.id, catEntry);

      const pm = purchase.paymentMethod;
      const pmName = pm.nickname ?? pm.definition.name;
      const pmEntry = byPaymentMethod.get(pm.id) ?? { paymentMethodId: pm.id, name: pmName, total: 0 };
      pmEntry.total += amount;
      byPaymentMethod.set(pm.id, pmEntry);

      if (includeSettle && isHousehold) {
        const payer = resolvePurchasePayer(purchase);
        memberNames.set(payer.id, payer.name);
        paidByUser.set(payer.id, (paidByUser.get(payer.id) ?? 0) + amount);
      }

      for (const allocation of purchase.allocations) {
        const shareNative = allocationShareForInstallment(
          inst.amount.toNumber(),
          allocation.amount.toNumber(),
          netAmount,
        );
        const share = shareNative * rate;
        if (share <= 0) continue;
        const userEntry = byUser.get(allocation.userId) ?? {
          userId: allocation.userId,
          name: allocation.user.name,
          total: 0,
        };
        userEntry.total += share;
        byUser.set(allocation.userId, userEntry);

        if (includeSettle && isHousehold) {
          memberNames.set(allocation.userId, allocation.user.name);
          shareByUser.set(allocation.userId, (shareByUser.get(allocation.userId) ?? 0) + share);
        }
      }
    }

    const total = installments.reduce((sum, inst) => {
      const rate = rateToArs(inst.purchase.exchangeRateToArs);
      return sum + inst.amount.toNumber() * rate;
    }, 0);

    const round2 = (v: number) => Math.round(v * 100) / 100;
    const perUser = [...memberNames.entries()].map(([userId, name]) => {
      const paid = round2(paidByUser.get(userId) ?? 0);
      const share = round2(shareByUser.get(userId) ?? 0);
      return { userId, name, paid, share, balance: round2(paid - share) };
    });
    const transfers = computeSettleTransfers(perUser.map((u) => ({ userId: u.userId, balance: u.balance }))).map(
      (t) => ({
        fromUserId: t.fromUserId,
        fromName: memberNames.get(t.fromUserId) ?? '',
        toUserId: t.toUserId,
        toName: memberNames.get(t.toUserId) ?? '',
        amount: t.amount,
      }),
    );

    const categoryRows = [...byCategory.values()].map((c) => ({ ...c, total: round2(c.total) }));
    const byGroup = groupCategories(categoryRows);

    const savings = await app.prisma.purchase.aggregate({
      where: {
        householdId,
        purchaseDate: { gte: range.gte, lt: range.lt },
        ...purchaseScopeWhere(viewerId, dashboardScope),
      },
      _sum: { discountAmount: true },
    });

    return {
      month: range.label,
      scope: dashboardScope,
      total: round2(total),
      byCategory: categoryRows.sort((a, b) => b.total - a.total),
      byGroup: byGroup.map((g) => ({
        groupId: g.id,
        name: g.name,
        icon: g.icon,
        color: g.color,
        total: g.total,
        categories: g.categories,
      })),
      byUser: [...byUser.values()].map((u) => ({ ...u, total: round2(u.total) })).sort((a, b) => b.total - a.total),
      byPaymentMethod: [...byPaymentMethod.values()]
        .map((p) => ({ ...p, total: round2(p.total) }))
        .sort((a, b) => b.total - a.total),
      totalSavings: savings._sum.discountAmount?.toNumber() ?? 0,
      settleUp: includeSettle
        ? {
            perUser: perUser.sort((a, b) => b.balance - a.balance),
            transfers,
          }
        : { perUser: [], transfers: [] },
      installments: installments.map((i) => ({
        id: i.id,
        amount: i.amount.toNumber(),
        dueDate: i.dueDate,
        number: i.number,
        totalInstallments: i.purchase.installmentsCount,
        paid: i.paid,
        store: i.purchase.store,
        category: i.purchase.category.name,
        userName: i.purchase.user.name,
        scope: i.purchase.scope,
      })),
    };
  });

  app.get('/dashboard/upcoming', { preHandler: [app.authenticate] }, async (request) => {
    const { scope: dashboardScope } = upcomingQuerySchema.parse(request.query);
    const householdId = request.user.householdId;
    const viewerId = request.user.userId;
    const start = new Date();
    start.setDate(1);
    start.setHours(0, 0, 0, 0);

    const rows = await app.prisma.installment.findMany({
      where: {
        householdId,
        dueDate: { gte: start },
        paid: false,
        purchase: purchaseWhere(viewerId, dashboardScope, {
          installmentsCount: { gte: 2 },
        }),
      },
      select: { amount: true, dueDate: true },
    });
    const byMonth = new Map<string, number>();
    for (const row of rows) {
      const key = `${row.dueDate.getFullYear()}-${String(row.dueDate.getMonth() + 1).padStart(2, '0')}`;
      byMonth.set(key, (byMonth.get(key) ?? 0) + row.amount.toNumber());
    }
    return [...byMonth.entries()]
      .map(([month, total]) => ({ month, total }))
      .sort((a, b) => a.month.localeCompare(b.month));
  });

  app.get('/dashboard/long-term', { preHandler: [app.authenticate] }, async (request) => {
    const { months: monthsParam, scope: dashboardScope } = longTermQuerySchema.parse(request.query);
    const monthsCount = monthsParam ?? 12;
    const householdId = request.user.householdId;
    const viewerId = request.user.userId;
    const includeBalance = dashboardScope === 'household';

    const round2 = (v: number) => Math.round(v * 100) / 100;
    let perUser: Array<{ userId: string; name: string; paid: number; share: number; balance: number }> = [];
    let transfers: Array<{
      fromUserId: string;
      fromName: string;
      toUserId: string;
      toName: string;
      amount: number;
    }> = [];

    if (includeBalance) {
      const purchases = await app.prisma.purchase.findMany({
        where: { householdId, scope: 'HOUSEHOLD' },
        include: {
          user: { select: { id: true, name: true } },
          paidBy: { select: { id: true, name: true } },
          paymentMethod: { select: { owner: { select: { id: true, name: true } } } },
          allocations: { include: { user: { select: { id: true, name: true } } } },
        },
      });

      const memberNames = new Map<string, string>();
      const paidByUser = new Map<string, number>();
      const shareByUser = new Map<string, number>();

      for (const purchase of purchases) {
        const rate = rateToArs(purchase.exchangeRateToArs);
        const payer = resolvePurchasePayer(purchase);
        memberNames.set(payer.id, payer.name);
        paidByUser.set(
          payer.id,
          (paidByUser.get(payer.id) ?? 0) + purchase.netAmount.toNumber() * rate,
        );
        for (const allocation of purchase.allocations) {
          memberNames.set(allocation.userId, allocation.user.name);
          shareByUser.set(
            allocation.userId,
            (shareByUser.get(allocation.userId) ?? 0) + allocation.amount.toNumber() * rate,
          );
        }
      }

      perUser = [...memberNames.entries()].map(([userId, name]) => {
        const paid = round2(paidByUser.get(userId) ?? 0);
        const share = round2(shareByUser.get(userId) ?? 0);
        return { userId, name, paid, share, balance: round2(paid - share) };
      });
      transfers = computeSettleTransfers(perUser.map((u) => ({ userId: u.userId, balance: u.balance }))).map((t) => ({
        fromUserId: t.fromUserId,
        fromName: memberNames.get(t.fromUserId) ?? '',
        toUserId: t.toUserId,
        toName: memberNames.get(t.toUserId) ?? '',
        amount: t.amount,
      }));
    }

    const windowMonths = recentMonths(monthsCount);
    const windowSet = new Set(windowMonths);
    const windowStart = new Date();
    windowStart.setMonth(windowStart.getMonth() - (monthsCount - 1), 1);
    windowStart.setHours(0, 0, 0, 0);
    const windowEnd = new Date();
    windowEnd.setMonth(windowEnd.getMonth() + 1, 1);
    windowEnd.setHours(0, 0, 0, 0);

    const windowInstallments = await app.prisma.installment.findMany({
      where: {
        householdId,
        OR: [
          {
            purchase: purchaseWhere(viewerId, dashboardScope, {
              installmentsCount: 1,
              purchaseDate: { gte: windowStart, lt: windowEnd },
            }),
          },
          {
            purchase: purchaseWhere(viewerId, dashboardScope, {
              installmentsCount: { gte: 2 },
            }),
            dueDate: { gte: windowStart, lt: windowEnd },
          },
        ],
      },
      include: {
        purchase: {
          select: {
            installmentsCount: true,
            purchaseDate: true,
            category: { select: { id: true, name: true, icon: true, color: true } },
          },
        },
      },
    });

    const monthTotals = new Map<string, number>(windowMonths.map((m) => [m, 0]));
    const categories = new Map<
      string,
      { categoryId: string; name: string; icon: string | null; color: string | null; total: number; byMonth: Map<string, number> }
    >();

    for (const inst of windowInstallments) {
      const month = attributionMonth(inst.purchase.installmentsCount, inst.purchase.purchaseDate, inst.dueDate);
      if (!windowSet.has(month)) continue;
      const amount = inst.amount.toNumber();
      monthTotals.set(month, (monthTotals.get(month) ?? 0) + amount);

      const cat = inst.purchase.category;
      const entry =
        categories.get(cat.id) ??
        {
          categoryId: cat.id,
          name: cat.name,
          icon: cat.icon,
          color: cat.color,
          total: 0,
          byMonth: new Map<string, number>(windowMonths.map((m) => [m, 0])),
        };
      entry.total += amount;
      entry.byMonth.set(month, (entry.byMonth.get(month) ?? 0) + amount);
      categories.set(cat.id, entry);
    }

    const categoryRows = [...categories.values()]
      .sort((a, b) => b.total - a.total)
      .map((c) => ({
        categoryId: c.categoryId,
        name: c.name,
        icon: c.icon,
        color: c.color,
        total: round2(c.total),
        byMonth: windowMonths.map((month) => ({ month, total: round2(c.byMonth.get(month) ?? 0) })),
      }));

    const groups = groupCategoriesByMonth(categoryRows, windowMonths).map((g) => ({
      groupId: g.id,
      name: g.name,
      icon: g.icon,
      color: g.color,
      total: g.total,
      byMonth: g.byMonth,
      categories: g.categories,
    }));

    return {
      scope: dashboardScope,
      balance: {
        perUser: perUser.sort((a, b) => b.balance - a.balance),
        transfers,
      },
      months: windowMonths.map((month) => ({ month, total: round2(monthTotals.get(month) ?? 0) })),
      categories: categoryRows,
      groups,
    };
  });
}
