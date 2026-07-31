import type { ExpenseScope, NotificationType, Prisma, PrismaClient } from '@prisma/client';
import { notifyUsers } from './notifications.js';

type Db = PrismaClient | Prisma.TransactionClient;

export type ExpenseNotifyKind = 'CREATED' | 'UPDATED' | 'DELETED';

const TYPE_BY_KIND: Record<ExpenseNotifyKind, NotificationType> = {
  CREATED: 'EXPENSE_CREATED',
  UPDATED: 'EXPENSE_UPDATED',
  DELETED: 'EXPENSE_DELETED',
};

const TITLE_BY_KIND: Record<ExpenseNotifyKind, string> = {
  CREATED: 'Nuevo gasto',
  UPDATED: 'Gasto actualizado',
  DELETED: 'Gasto eliminado',
};

const VERB_BY_KIND: Record<ExpenseNotifyKind, string> = {
  CREATED: 'cargó',
  UPDATED: 'modificó',
  DELETED: 'eliminó',
};

export function expenseNotificationLabel(
  store: string | null | undefined,
  description: string | null | undefined,
): string {
  const fromStore = store?.trim();
  if (fromStore) return fromStore;
  const fromDescription = description?.trim();
  if (fromDescription) return fromDescription;
  return 'un gasto';
}

/** Notify partners when any involved scope is HOUSEHOLD (create, update before/after, delete). */
export function shouldNotifyExpensePartners(scopes: ExpenseScope[]): boolean {
  return scopes.some((scope) => scope === 'HOUSEHOLD');
}

export async function notifyExpensePartners(
  db: Db,
  input: {
    householdId: string;
    actorUserId: string;
    kind: ExpenseNotifyKind;
    /** Notify if any scope is HOUSEHOLD (e.g. previous + new on update). */
    scopes: ExpenseScope[];
    purchaseId: string;
    store?: string | null;
    description?: string | null;
  },
) {
  if (!shouldNotifyExpensePartners(input.scopes)) return;

  const partners = await db.user.findMany({
    where: { householdId: input.householdId, id: { not: input.actorUserId } },
    select: { id: true },
  });
  if (partners.length === 0) return;

  const actor = await db.user.findUnique({
    where: { id: input.actorUserId },
    select: { name: true },
  });
  const name = actor?.name?.trim() || 'Alguien';
  const label = expenseNotificationLabel(input.store, input.description);
  const url =
    input.kind === 'DELETED' ? '/gastos' : `/gastos/${input.purchaseId}`;

  await notifyUsers(
    db,
    partners.map((p) => p.id),
    {
      householdId: input.householdId,
      type: TYPE_BY_KIND[input.kind],
      title: TITLE_BY_KIND[input.kind],
      body: `${name} ${VERB_BY_KIND[input.kind]} "${label}".`,
      data: {
        purchaseId: input.purchaseId,
        url,
      },
    },
  );
}
