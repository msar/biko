import {
  addUtcDays,
  monthlyDueDatesInRange,
  nextMonthlyDueDate,
  startOfUtcDay,
  toDateOnlyISO,
} from '@biko/shared';
import type { Prisma, PrismaClient, RecurringAmountType, ExpenseScope } from '@prisma/client';
import { createPurchaseWithAllocations } from './expense-purchase.js';
import { notifyUsers } from './notifications.js';

type Db = PrismaClient | Prisma.TransactionClient;

export const recurringInclude = {
  category: true,
  paymentMethod: {
    include: { definition: { include: { entity: true } }, owner: { select: { id: true, name: true } } },
  },
  createdBy: { select: { id: true, name: true } },
} as const;

export const occurrenceInclude = {
  recurringPayment: { include: recurringInclude },
  purchase: { select: { id: true, netAmount: true, store: true } },
} as const;

export class RecurringValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RecurringValidationError';
  }
}

export class RecurringNotFoundError extends Error {
  constructor() {
    super('Pago recurrente no encontrado');
    this.name = 'RecurringNotFoundError';
  }
}

export interface CreateRecurringInput {
  name: string;
  categoryId: string;
  paymentMethodId?: string | null;
  scope: ExpenseScope;
  dueDay: number;
  amountType: RecurringAmountType;
  amount?: number | null;
  reminderDaysBefore?: number;
  currency?: 'ARS' | 'USD';
  exchangeRateToArs?: number | null;
}

function assertDueDay(dueDay: number) {
  if (!Number.isInteger(dueDay) || dueDay < 1 || dueDay > 28) {
    throw new RecurringValidationError('El día de vencimiento debe ser entre 1 y 28');
  }
}

function assertAmount(amountType: RecurringAmountType, amount?: number | null) {
  if (amountType === 'FIXED') {
    if (amount == null || amount <= 0) {
      throw new RecurringValidationError('Los pagos fijos requieren un monto mayor a 0');
    }
  }
}

async function audienceUserIds(
  db: Db,
  householdId: string,
  scope: ExpenseScope,
  createdByUserId: string,
): Promise<string[]> {
  if (scope === 'PERSONAL') return [createdByUserId];
  const users = await db.user.findMany({ where: { householdId }, select: { id: true } });
  return users.map((u) => u.id);
}

export async function createRecurringPayment(
  db: Db,
  householdId: string,
  userId: string,
  input: CreateRecurringInput,
) {
  assertDueDay(input.dueDay);
  assertAmount(input.amountType, input.amount);

  const category = await db.category.findFirst({
    where: { id: input.categoryId, OR: [{ householdId: null }, { householdId }] },
  });
  if (!category) throw new RecurringValidationError('Categoría inválida');

  if (input.paymentMethodId) {
    const method = await db.paymentMethod.findFirst({
      where: { id: input.paymentMethodId, householdId },
    });
    if (!method) throw new RecurringValidationError('Medio de pago inválido');
  }

  const today = startOfUtcDay(new Date());
  const nextDueDate = nextMonthlyDueDate(today, input.dueDay);
  const amount = input.amountType === 'FIXED' ? input.amount! : null;

  const created = await db.recurringPayment.create({
    data: {
      householdId,
      createdByUserId: userId,
      name: input.name.trim(),
      categoryId: input.categoryId,
      paymentMethodId: input.paymentMethodId ?? null,
      scope: input.scope,
      dueDay: input.dueDay,
      amountType: input.amountType,
      amount,
      currency: input.currency ?? 'ARS',
      exchangeRateToArs: input.exchangeRateToArs ?? null,
      reminderDaysBefore: input.reminderDaysBefore ?? 3,
      nextDueDate,
      amountHistory:
        input.amountType === 'FIXED'
          ? {
              create: {
                amount: amount!,
                effectiveFrom: today,
                createdByUserId: userId,
              },
            }
          : undefined,
    },
    include: recurringInclude,
  });

  return created;
}

export interface UpdateRecurringInput {
  name?: string;
  categoryId?: string;
  paymentMethodId?: string | null;
  scope?: ExpenseScope;
  dueDay?: number;
  amountType?: RecurringAmountType;
  /** When FIXED and provided, updates amount from now on. */
  amount?: number | null;
  reminderDaysBefore?: number;
  active?: boolean;
}

export async function updateRecurringPayment(
  db: Db,
  householdId: string,
  userId: string,
  id: string,
  input: UpdateRecurringInput,
) {
  const existing = await db.recurringPayment.findFirst({
    where: { id, householdId },
  });
  if (!existing) throw new RecurringNotFoundError();

  // PERSONAL templates are only editable by creator
  if (existing.scope === 'PERSONAL' && existing.createdByUserId !== userId) {
    throw new RecurringValidationError('No podés editar un recurrente personal ajeno');
  }

  const dueDay = input.dueDay ?? existing.dueDay;
  if (input.dueDay != null) assertDueDay(input.dueDay);

  const amountType = input.amountType ?? existing.amountType;
  const nextAmount =
    input.amount !== undefined
      ? input.amount
      : existing.amount != null
        ? existing.amount.toNumber()
        : null;
  assertAmount(amountType, amountType === 'FIXED' ? nextAmount : null);

  if (input.categoryId) {
    const category = await db.category.findFirst({
      where: { id: input.categoryId, OR: [{ householdId: null }, { householdId }] },
    });
    if (!category) throw new RecurringValidationError('Categoría inválida');
  }
  if (input.paymentMethodId) {
    const method = await db.paymentMethod.findFirst({
      where: { id: input.paymentMethodId, householdId },
    });
    if (!method) throw new RecurringValidationError('Medio de pago inválido');
  }

  const today = startOfUtcDay(new Date());
  const amountChanged =
    amountType === 'FIXED' &&
    input.amount != null &&
    (existing.amount == null || Math.abs(existing.amount.toNumber() - input.amount) > 0.001);

  const data: Prisma.RecurringPaymentUpdateInput = {
    name: input.name?.trim(),
    scope: input.scope,
    dueDay: input.dueDay,
    amountType: input.amountType,
    reminderDaysBefore: input.reminderDaysBefore,
    active: input.active,
    nextDueDate: nextMonthlyDueDate(today, dueDay),
  };
  if (input.categoryId) {
    data.category = { connect: { id: input.categoryId } };
  }
  if (input.paymentMethodId === null) {
    data.paymentMethod = { disconnect: true };
  } else if (input.paymentMethodId) {
    data.paymentMethod = { connect: { id: input.paymentMethodId } };
  }
  if (amountType === 'VARIABLE') {
    data.amount = null;
  } else if (input.amount != null) {
    data.amount = input.amount;
  }

  const updated = await db.recurringPayment.update({
    where: { id },
    data: {
      ...data,
      amountHistory: amountChanged
        ? {
            create: {
              amount: input.amount!,
              effectiveFrom: today,
              createdByUserId: userId,
            },
          }
        : undefined,
    },
    include: recurringInclude,
  });

  return updated;
}

async function ensurePaymentMethod(
  db: Db,
  householdId: string,
  preferredId: string | null | undefined,
): Promise<string> {
  if (preferredId) {
    const method = await db.paymentMethod.findFirst({
      where: { id: preferredId, householdId },
    });
    if (method) return method.id;
  }
  const fallback = await db.paymentMethod.findFirst({
    where: { householdId },
    orderBy: { id: 'asc' },
  });
  if (!fallback) {
    throw new RecurringValidationError('El hogar no tiene medios de pago para registrar el gasto');
  }
  return fallback.id;
}

async function autoCreateFixedPurchase(
  db: Prisma.TransactionClient,
  occurrenceId: string,
) {
  const occurrence = await db.recurringOccurrence.findUniqueOrThrow({
    where: { id: occurrenceId },
    include: { recurringPayment: true },
  });
  const rp = occurrence.recurringPayment;
  if (rp.amountType !== 'FIXED' || occurrence.status !== 'PENDING') return occurrence;
  if (occurrence.purchaseId) return occurrence;

  const amount = occurrence.amount?.toNumber() ?? rp.amount?.toNumber();
  if (amount == null || amount <= 0) {
    throw new RecurringValidationError('Monto fijo inválido para auto-crear el gasto');
  }

  const paymentMethodId = await ensurePaymentMethod(db, rp.householdId, rp.paymentMethodId);

  const purchase = await createPurchaseWithAllocations(db, rp.householdId, rp.createdByUserId, {
    paymentMethodId,
    categoryId: rp.categoryId,
    store: rp.name,
    description: `Recurrente: ${rp.name}`,
    purchaseDate: occurrence.dueDate,
    grossAmount: amount,
    installmentsCount: 1,
    promotionMode: 'off',
    scope: rp.scope,
    splitMode: rp.scope === 'PERSONAL' ? 'ASSIGN' : 'EQUAL',
    assignToUserId: rp.scope === 'PERSONAL' ? rp.createdByUserId : undefined,
    currency: (rp.currency === 'USD' ? 'USD' : 'ARS') as 'ARS' | 'USD',
    exchangeRateToArs: rp.exchangeRateToArs?.toNumber() ?? 1,
    exchangeRateSource: rp.currency === 'USD' ? 'recurring-snapshot' : null,
    exchangeRateDate: rp.currency === 'USD' ? occurrence.dueDate : null,
  });

  return db.recurringOccurrence.update({
    where: { id: occurrenceId },
    data: {
      status: 'COMPLETED',
      purchaseId: purchase.id,
      amount,
    },
    include: occurrenceInclude,
  });
}

/**
 * Create missing occurrences through `asOf + horizonDays`, auto-create FIXED on/before asOf.
 */
export async function generateDueOccurrences(
  db: PrismaClient,
  asOf = new Date(),
  horizonDays = 7,
) {
  const today = startOfUtcDay(asOf);
  const through = addUtcDays(today, horizonDays);
  const templates = await db.recurringPayment.findMany({ where: { active: true } });

  let created = 0;
  let autoCompleted = 0;

  for (const template of templates) {
    const dueDates = monthlyDueDatesInRange(today, through, template.dueDay);
    for (const dueDate of dueDates) {
      const existing = await db.recurringOccurrence.findUnique({
        where: {
          recurringPaymentId_dueDate: {
            recurringPaymentId: template.id,
            dueDate,
          },
        },
      });
      if (existing) continue;

      const amount =
        template.amountType === 'FIXED' && template.amount != null ? template.amount.toNumber() : null;

      const occurrence = await db.recurringOccurrence.create({
        data: {
          recurringPaymentId: template.id,
          dueDate,
          status: 'PENDING',
          amount,
        },
      });
      created++;

      if (template.amountType === 'FIXED' && dueDate <= today) {
        await db.$transaction(async (tx) => {
          const completed = await autoCreateFixedPurchase(tx, occurrence.id);
          if (completed.status === 'COMPLETED') {
            autoCompleted++;
            const recipients = await audienceUserIds(
              tx,
              template.householdId,
              template.scope,
              template.createdByUserId,
            );
            await notifyUsers(tx, recipients, {
              householdId: template.householdId,
              type: 'RECURRING_AUTO_CREATED',
              title: `${template.name} registrado`,
              body: `Se cargó automáticamente el gasto de ${template.name}.`,
              data: {
                recurringPaymentId: template.id,
                occurrenceId: occurrence.id,
                purchaseId: completed.purchaseId,
                url: `/gastos/${completed.purchaseId}/edit`,
              },
            });
          }
        });
      }
    }

    await db.recurringPayment.update({
      where: { id: template.id },
      data: { nextDueDate: nextMonthlyDueDate(addUtcDays(today, 1), template.dueDay) },
    });
  }

  return { created, autoCompleted };
}

export async function sendRecurringReminders(db: PrismaClient, asOf = new Date()) {
  const today = startOfUtcDay(asOf);
  const pending = await db.recurringOccurrence.findMany({
    where: { status: 'PENDING' },
    include: { recurringPayment: true },
  });

  let reminders = 0;
  let dues = 0;

  for (const occ of pending) {
    const rp = occ.recurringPayment;
    if (!rp.active) continue;
    const due = startOfUtcDay(occ.dueDate);
    const reminderDay = addUtcDays(due, -rp.reminderDaysBefore);
    const recipients = await audienceUserIds(db, rp.householdId, rp.scope, rp.createdByUserId);

    if (!occ.reminderSentAt && toDateOnlyISO(reminderDay) === toDateOnlyISO(today)) {
      await notifyUsers(db, recipients, {
        householdId: rp.householdId,
        type: 'RECURRING_REMINDER',
        title: `Recordatorio: ${rp.name}`,
        body:
          rp.amountType === 'VARIABLE'
            ? `${rp.name} vence el ${toDateOnlyISO(due)}. Completá el monto.`
            : `${rp.name} vence el ${toDateOnlyISO(due)}.`,
        data: {
          recurringPaymentId: rp.id,
          occurrenceId: occ.id,
          url: '/recurrentes',
        },
      });
      await db.recurringOccurrence.update({
        where: { id: occ.id },
        data: { reminderSentAt: new Date() },
      });
      reminders++;
    }

    if (!occ.dueNotifiedAt && toDateOnlyISO(due) === toDateOnlyISO(today)) {
      // FIXED may already be COMPLETED by generate; only notify still-pending (VARIABLE or failed auto)
      if (occ.status === 'PENDING') {
        await notifyUsers(db, recipients, {
          householdId: rp.householdId,
          type: 'RECURRING_DUE',
          title: `Vence hoy: ${rp.name}`,
          body:
            rp.amountType === 'VARIABLE'
              ? `Ingresá el monto de ${rp.name}.`
              : `${rp.name} vence hoy.`,
          data: {
            recurringPaymentId: rp.id,
            occurrenceId: occ.id,
            url: '/recurrentes',
          },
        });
        dues++;
      }
      await db.recurringOccurrence.update({
        where: { id: occ.id },
        data: { dueNotifiedAt: new Date() },
      });
    }
  }

  return { reminders, dues };
}

export async function completeVariableOccurrence(
  db: PrismaClient,
  householdId: string,
  userId: string,
  occurrenceId: string,
  amount: number,
  paymentMethodId?: string | null,
) {
  if (amount <= 0) throw new RecurringValidationError('El monto debe ser mayor a 0');

  return db.$transaction(async (tx) => {
    const occurrence = await tx.recurringOccurrence.findFirst({
      where: { id: occurrenceId, recurringPayment: { householdId } },
      include: { recurringPayment: true },
    });
    if (!occurrence) throw new RecurringNotFoundError();
    const rp = occurrence.recurringPayment;
    if (rp.scope === 'PERSONAL' && rp.createdByUserId !== userId) {
      throw new RecurringValidationError('No podés completar un recurrente personal ajeno');
    }
    if (occurrence.status !== 'PENDING') {
      throw new RecurringValidationError('Esta ocurrencia ya fue resuelta');
    }
    if (rp.amountType !== 'VARIABLE') {
      throw new RecurringValidationError('Solo los pagos variables se completan manualmente');
    }

    const methodId = await ensurePaymentMethod(tx, householdId, paymentMethodId ?? rp.paymentMethodId);
    const purchase = await createPurchaseWithAllocations(tx, householdId, userId, {
      paymentMethodId: methodId,
      categoryId: rp.categoryId,
      store: rp.name,
      description: `Recurrente: ${rp.name}`,
      purchaseDate: occurrence.dueDate,
      grossAmount: amount,
      installmentsCount: 1,
      promotionMode: 'off',
      scope: rp.scope,
      splitMode: rp.scope === 'PERSONAL' ? 'ASSIGN' : 'EQUAL',
      assignToUserId: rp.scope === 'PERSONAL' ? rp.createdByUserId : undefined,
    });

    return tx.recurringOccurrence.update({
      where: { id: occurrenceId },
      data: {
        status: 'COMPLETED',
        amount,
        purchaseId: purchase.id,
      },
      include: occurrenceInclude,
    });
  });
}

export async function skipOccurrence(
  db: Db,
  householdId: string,
  userId: string,
  occurrenceId: string,
) {
  const occurrence = await db.recurringOccurrence.findFirst({
    where: { id: occurrenceId, recurringPayment: { householdId } },
    include: { recurringPayment: true },
  });
  if (!occurrence) throw new RecurringNotFoundError();
  if (occurrence.recurringPayment.scope === 'PERSONAL' && occurrence.recurringPayment.createdByUserId !== userId) {
    throw new RecurringValidationError('No podés saltear un recurrente personal ajeno');
  }
  if (occurrence.status !== 'PENDING') {
    throw new RecurringValidationError('Esta ocurrencia ya fue resuelta');
  }
  return db.recurringOccurrence.update({
    where: { id: occurrenceId },
    data: { status: 'SKIPPED' },
    include: occurrenceInclude,
  });
}

/** Visible templates for a viewer (HOUSEHOLD + own PERSONAL). */
export function recurringVisibilityWhere(householdId: string, userId: string) {
  return {
    householdId,
    OR: [{ scope: 'HOUSEHOLD' as const }, { scope: 'PERSONAL' as const, createdByUserId: userId }],
  };
}
