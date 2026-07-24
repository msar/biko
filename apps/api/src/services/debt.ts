import { generateDebtInstallments } from '@biko/shared';
import type { Prisma, PrismaClient } from '@prisma/client';

type Db = PrismaClient | Prisma.TransactionClient;

export class DebtValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DebtValidationError';
  }
}

export class DebtNotFoundError extends Error {
  constructor(message = 'Deuda no encontrada') {
    super(message);
    this.name = 'DebtNotFoundError';
  }
}

export const contactSelect = {
  id: true,
  name: true,
  phone: true,
  email: true,
  createdAt: true,
} as const;

export const debtInclude = {
  contact: { select: contactSelect },
  installments: { orderBy: { number: 'asc' as const } },
  purchase: {
    select: {
      id: true,
      store: true,
      purchaseDate: true,
      paymentMethodId: true,
    },
  },
} as const;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function debtStatusFromInstallments(installments: Array<{ paid: boolean }>): 'OPEN' | 'SETTLED' {
  return installments.length > 0 && installments.every((i) => i.paid) ? 'SETTLED' : 'OPEN';
}

export async function listContacts(db: Db, householdId: string) {
  return db.contact.findMany({
    where: { householdId },
    select: contactSelect,
    orderBy: { name: 'asc' },
  });
}

export async function createContact(
  db: Db,
  householdId: string,
  data: { name: string; phone?: string | null; email?: string | null },
) {
  const name = data.name.trim();
  if (!name) throw new DebtValidationError('El nombre del contacto es obligatorio');
  return db.contact.create({
    data: {
      householdId,
      name,
      phone: data.phone?.trim() || null,
      email: data.email?.trim() || null,
    },
    select: contactSelect,
  });
}

export async function updateContact(
  db: Db,
  householdId: string,
  id: string,
  data: { name?: string; phone?: string | null; email?: string | null },
) {
  const existing = await db.contact.findFirst({ where: { id, householdId } });
  if (!existing) throw new DebtNotFoundError('Contacto no encontrado');
  return db.contact.update({
    where: { id },
    data: {
      ...(data.name !== undefined ? { name: data.name.trim() } : {}),
      ...(data.phone !== undefined ? { phone: data.phone?.trim() || null } : {}),
      ...(data.email !== undefined ? { email: data.email?.trim() || null } : {}),
    },
    select: contactSelect,
  });
}

export async function deleteContact(db: Db, householdId: string, id: string) {
  const existing = await db.contact.findFirst({
    where: { id, householdId },
    include: { debts: { where: { status: 'OPEN' }, select: { id: true }, take: 1 } },
  });
  if (!existing) throw new DebtNotFoundError('Contacto no encontrado');
  if (existing.debts.length > 0) {
    throw new DebtValidationError('No se puede borrar un contacto con deudas abiertas');
  }
  await db.contact.delete({ where: { id } });
  return { ok: true };
}

async function resolveContactId(
  db: Db,
  householdId: string,
  args: {
    contactId?: string;
    newContact?: { name: string; phone?: string | null; email?: string | null };
  },
): Promise<string> {
  if (args.contactId) {
    const contact = await db.contact.findFirst({
      where: { id: args.contactId, householdId },
      select: { id: true },
    });
    if (!contact) throw new DebtValidationError('Contacto inválido');
    return contact.id;
  }
  if (args.newContact) {
    const created = await createContact(db, householdId, args.newContact);
    return created.id;
  }
  throw new DebtValidationError('Indicá un contacto o creá uno nuevo');
}

export type CreateDebtInput = {
  contactId?: string;
  newContact?: { name: string; phone?: string | null; email?: string | null };
  direction: 'OWED_TO_ME' | 'I_OWE';
  title: string;
  notes?: string | null;
  totalAmount: number;
  currency?: string;
  installmentsCount?: number;
  startDate: Date;
  purchaseId?: string | null;
  /** When linking to a purchase, copy schedule from these rows instead of generating. */
  mirroredInstallments?: Array<{
    number: number;
    amount: number;
    dueDate: Date;
    paid?: boolean;
    paidDate?: Date | null;
  }>;
};

export async function createDebt(
  db: Db,
  householdId: string,
  userId: string,
  input: CreateDebtInput,
) {
  const title = input.title.trim();
  if (!title) throw new DebtValidationError('El título es obligatorio');
  if (!(input.totalAmount > 0)) throw new DebtValidationError('El monto debe ser positivo');

  const contactId = await resolveContactId(db, householdId, input);
  const installmentsCount = Math.max(1, Math.min(36, Math.floor(input.installmentsCount ?? 1)));
  const currency = input.currency === 'USD' ? 'USD' : 'ARS';

  if (input.purchaseId) {
    const purchase = await db.purchase.findFirst({
      where: { id: input.purchaseId, householdId },
      include: { debt: { select: { id: true } } },
    });
    if (!purchase) throw new DebtValidationError('Compra vinculada inválida');
    if (purchase.debt) throw new DebtValidationError('Esa compra ya tiene una deuda vinculada');
  }

  const schedule =
    input.mirroredInstallments && input.mirroredInstallments.length > 0
      ? input.mirroredInstallments
      : generateDebtInstallments(input.totalAmount, installmentsCount, input.startDate).map((i) => ({
          ...i,
          paid: false,
          paidDate: null as Date | null,
        }));

  const status = debtStatusFromInstallments(
    schedule.map((i) => ({ paid: Boolean(i.paid) })),
  );

  return db.debt.create({
    data: {
      householdId,
      createdByUserId: userId,
      contactId,
      direction: input.direction,
      title,
      notes: input.notes?.trim() || null,
      totalAmount: round2(input.totalAmount),
      currency,
      installmentsCount: schedule.length,
      startDate: input.startDate,
      status,
      purchaseId: input.purchaseId ?? null,
      installments: {
        create: schedule.map((i) => ({
          number: i.number,
          amount: round2(i.amount),
          dueDate: i.dueDate,
          paid: Boolean(i.paid),
          paidDate: i.paidDate ?? null,
        })),
      },
    },
    include: debtInclude,
  });
}

/**
 * Creates a debt linked to a statement-imported purchase, mirroring bank installments
 * and marking cuotas before/at `installmentCurrent` as paid (person already "caught up").
 */
export async function createDebtFromPurchase(
  db: Db,
  args: {
    householdId: string;
    userId: string;
    contactId?: string;
    newContact?: { name: string; phone?: string | null; email?: string | null };
    direction: 'OWED_TO_ME' | 'I_OWE';
    purchaseId: string;
    title: string;
    installmentCurrent?: number;
  },
) {
  const purchase = await db.purchase.findFirst({
    where: { id: args.purchaseId, householdId: args.householdId },
    include: {
      installments: { orderBy: { number: 'asc' } },
      debt: { select: { id: true } },
    },
  });
  if (!purchase) throw new DebtValidationError('Compra inválida');
  if (purchase.debt) throw new DebtValidationError('Esa compra ya tiene una deuda vinculada');

  const current = args.installmentCurrent ?? 1;
  const mirrored = purchase.installments.map((i) => ({
    number: i.number,
    amount: i.amount.toNumber(),
    dueDate: i.dueDate,
    paid: i.number <= current,
    paidDate: i.number <= current ? (i.paidDate ?? i.dueDate) : null,
  }));

  return createDebt(db, args.householdId, args.userId, {
    contactId: args.contactId,
    newContact: args.newContact,
    direction: args.direction,
    title: args.title,
    totalAmount: purchase.netAmount.toNumber(),
    currency: purchase.currency,
    installmentsCount: purchase.installmentsCount,
    startDate: purchase.purchaseDate,
    purchaseId: purchase.id,
    mirroredInstallments: mirrored,
  });
}

export async function listDebts(
  db: Db,
  householdId: string,
  opts?: { status?: 'OPEN' | 'SETTLED'; contactId?: string },
) {
  return db.debt.findMany({
    where: {
      householdId,
      ...(opts?.status ? { status: opts.status } : {}),
      ...(opts?.contactId ? { contactId: opts.contactId } : {}),
    },
    include: debtInclude,
    orderBy: [{ status: 'asc' }, { startDate: 'desc' }],
  });
}

export async function getDebtSummary(db: Db, householdId: string, month?: string) {
  const now = new Date();
  const [y, m] = month
    ? month.split('-').map(Number)
    : [now.getFullYear(), now.getMonth() + 1];
  const gte = new Date(Date.UTC(y!, m! - 1, 1));
  const lt = new Date(Date.UTC(y!, m!, 1));
  const label = `${y}-${String(m).padStart(2, '0')}`;

  const debts = await db.debt.findMany({
    where: { householdId, status: 'OPEN' },
    include: {
      contact: { select: contactSelect },
      installments: true,
    },
  });

  type ContactBucket = {
    contactId: string;
    contactName: string;
    owedToMeThisMonth: number;
    iOweThisMonth: number;
    owedToMeRemaining: number;
    iOweRemaining: number;
  };

  const byContact = new Map<string, ContactBucket>();
  let owedToMeThisMonth = 0;
  let iOweThisMonth = 0;
  let owedToMeRemaining = 0;
  let iOweRemaining = 0;

  for (const debt of debts) {
    const bucket = byContact.get(debt.contactId) ?? {
      contactId: debt.contactId,
      contactName: debt.contact.name,
      owedToMeThisMonth: 0,
      iOweThisMonth: 0,
      owedToMeRemaining: 0,
      iOweRemaining: 0,
    };

    for (const inst of debt.installments) {
      if (inst.paid) continue;
      const amount = inst.amount.toNumber();
      const inMonth = inst.dueDate >= gte && inst.dueDate < lt;

      if (debt.direction === 'OWED_TO_ME') {
        bucket.owedToMeRemaining += amount;
        owedToMeRemaining += amount;
        if (inMonth) {
          bucket.owedToMeThisMonth += amount;
          owedToMeThisMonth += amount;
        }
      } else {
        bucket.iOweRemaining += amount;
        iOweRemaining += amount;
        if (inMonth) {
          bucket.iOweThisMonth += amount;
          iOweThisMonth += amount;
        }
      }
    }

    byContact.set(debt.contactId, bucket);
  }

  const roundBucket = (b: ContactBucket) => ({
    ...b,
    owedToMeThisMonth: round2(b.owedToMeThisMonth),
    iOweThisMonth: round2(b.iOweThisMonth),
    owedToMeRemaining: round2(b.owedToMeRemaining),
    iOweRemaining: round2(b.iOweRemaining),
  });

  return {
    month: label,
    owedToMeThisMonth: round2(owedToMeThisMonth),
    iOweThisMonth: round2(iOweThisMonth),
    owedToMeRemaining: round2(owedToMeRemaining),
    iOweRemaining: round2(iOweRemaining),
    byContact: [...byContact.values()].map(roundBucket).sort((a, b) =>
      a.contactName.localeCompare(b.contactName, 'es'),
    ),
  };
}

export async function updateDebt(
  db: Db,
  householdId: string,
  id: string,
  data: { title?: string; notes?: string | null },
) {
  const existing = await db.debt.findFirst({ where: { id, householdId } });
  if (!existing) throw new DebtNotFoundError();
  return db.debt.update({
    where: { id },
    data: {
      ...(data.title !== undefined ? { title: data.title.trim() } : {}),
      ...(data.notes !== undefined ? { notes: data.notes?.trim() || null } : {}),
    },
    include: debtInclude,
  });
}

export async function markDebtInstallmentPaid(
  db: Db,
  householdId: string,
  debtId: string,
  number: number,
  paidDate?: Date,
) {
  const debt = await db.debt.findFirst({
    where: { id: debtId, householdId },
    include: { installments: { orderBy: { number: 'asc' } } },
  });
  if (!debt) throw new DebtNotFoundError();

  const inst = debt.installments.find((i) => i.number === number);
  if (!inst) throw new DebtValidationError('Cuota no encontrada');

  await db.debtInstallment.update({
    where: { id: inst.id },
    data: { paid: true, paidDate: paidDate ?? new Date() },
  });

  const refreshed = await db.debtInstallment.findMany({
    where: { debtId },
    orderBy: { number: 'asc' },
  });
  const status = debtStatusFromInstallments(refreshed);
  return db.debt.update({
    where: { id: debtId },
    data: { status },
    include: debtInclude,
  });
}

export async function markDebtInstallmentUnpaid(
  db: Db,
  householdId: string,
  debtId: string,
  number: number,
) {
  const debt = await db.debt.findFirst({
    where: { id: debtId, householdId },
    include: { installments: true },
  });
  if (!debt) throw new DebtNotFoundError();

  const inst = debt.installments.find((i) => i.number === number);
  if (!inst) throw new DebtValidationError('Cuota no encontrada');

  await db.debtInstallment.update({
    where: { id: inst.id },
    data: { paid: false, paidDate: null },
  });

  return db.debt.update({
    where: { id: debtId },
    data: { status: 'OPEN' },
    include: debtInclude,
  });
}
