import { allocationShareForInstallment, computeSettleTransfers } from '@biko/shared';
import { FastifyInstance } from 'fastify';
import { z } from 'zod';

const monthQuerySchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/).optional(),
});

function monthRange(month?: string): { gte: Date; lt: Date; label: string } {
  const now = new Date();
  const [y, m] = month ? month.split('-').map(Number) : [now.getFullYear(), now.getMonth() + 1];
  return {
    gte: new Date(y!, m! - 1, 1),
    lt: new Date(y!, m!, 1),
    label: `${y}-${String(m).padStart(2, '0')}`,
  };
}

export default async function dashboardRoutes(app: FastifyInstance) {
  app.get('/dashboard/monthly', { preHandler: [app.authenticate] }, async (request) => {
    const { month } = monthQuerySchema.parse(request.query);
    const range = monthRange(month);
    const householdId = request.user.householdId;

    const installments = await app.prisma.installment.findMany({
      where: { householdId, dueDate: { gte: range.gte, lt: range.lt } },
      include: {
        purchase: {
          include: {
            category: true,
            user: { select: { id: true, name: true } },
            paymentMethod: {
              include: { definition: { include: { entity: true } }, owner: { select: { id: true, name: true } } },
            },
            allocations: { include: { user: { select: { id: true, name: true } } } },
          },
        },
      },
      orderBy: { dueDate: 'asc' },
    });

    const total = installments.reduce((sum, inst) => {
      if (inst.purchase.scope === 'PERSONAL') return sum;
      return sum + inst.amount.toNumber();
    }, 0);

    const byCategory = new Map<string, { categoryId: string; name: string; icon: string | null; color: string | null; total: number }>();
    const byUser = new Map<string, { userId: string; name: string; total: number }>();
    const byPaymentMethod = new Map<string, { paymentMethodId: string; name: string; total: number }>();

    // Settle-up: only HOUSEHOLD spend creates shared debt.
    const memberNames = new Map<string, string>();
    const paidByUser = new Map<string, number>();
    const shareByUser = new Map<string, number>();

    for (const inst of installments) {
      const amount = inst.amount.toNumber();
      const purchase = inst.purchase;
      const netAmount = purchase.netAmount.toNumber();
      const isHousehold = purchase.scope === 'HOUSEHOLD';

      if (isHousehold) {
        const cat = purchase.category;
        const catEntry = byCategory.get(cat.id) ?? { categoryId: cat.id, name: cat.name, icon: cat.icon, color: cat.color, total: 0 };
        catEntry.total += amount;
        byCategory.set(cat.id, catEntry);

        const pm = purchase.paymentMethod;
        const pmName = pm.nickname ?? pm.definition.name;
        const pmEntry = byPaymentMethod.get(pm.id) ?? { paymentMethodId: pm.id, name: pmName, total: 0 };
        pmEntry.total += amount;
        byPaymentMethod.set(pm.id, pmEntry);

        const payer = purchase.paymentMethod.owner ?? purchase.user;
        memberNames.set(payer.id, payer.name);
        paidByUser.set(payer.id, (paidByUser.get(payer.id) ?? 0) + amount);
      }

      for (const allocation of purchase.allocations) {
        const share = allocationShareForInstallment(amount, allocation.amount.toNumber(), netAmount);
        if (share <= 0) continue;
        const userEntry = byUser.get(allocation.userId) ?? {
          userId: allocation.userId,
          name: allocation.user.name,
          total: 0,
        };
        userEntry.total += share;
        byUser.set(allocation.userId, userEntry);

        if (isHousehold) {
          memberNames.set(allocation.userId, allocation.user.name);
          shareByUser.set(allocation.userId, (shareByUser.get(allocation.userId) ?? 0) + share);
        }
      }
    }

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

    const savings = await app.prisma.purchase.aggregate({
      where: { householdId, purchaseDate: { gte: range.gte, lt: range.lt } },
      _sum: { discountAmount: true },
    });

    return {
      month: range.label,
      total,
      byCategory: [...byCategory.values()].sort((a, b) => b.total - a.total),
      byUser: [...byUser.values()].sort((a, b) => b.total - a.total),
      byPaymentMethod: [...byPaymentMethod.values()].sort((a, b) => b.total - a.total),
      totalSavings: savings._sum.discountAmount?.toNumber() ?? 0,
      settleUp: {
        perUser: perUser.sort((a, b) => b.balance - a.balance),
        transfers,
      },
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
    const householdId = request.user.householdId;
    const start = new Date();
    start.setDate(1);
    start.setHours(0, 0, 0, 0);

    const rows = await app.prisma.installment.findMany({
      where: { householdId, dueDate: { gte: start }, paid: false },
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
}
