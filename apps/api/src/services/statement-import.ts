import {
  detectSubscriptionMerchant,
  findStatementMatchCandidates,
  findStatementPickerCandidates,
  startOfUtcDay,
  type ParsedStatementLine,
  type StatementMatchablePurchase,
} from '@biko/shared';
import type { Prisma, PrismaClient } from '@prisma/client';
import {
  createPurchaseWithAllocations,
  ExpenseValidationError,
  purchaseInclude,
} from './expense-purchase.js';
import { ExchangeRateError, getUsdToArsRate } from './exchange-rate.js';
import { createRecurringPayment } from './recurring.js';

type Db = PrismaClient | Prisma.TransactionClient;

async function linkUsdSubscriptionRecurring(
  tx: Prisma.TransactionClient,
  args: {
    householdId: string;
    userId: string;
    paymentMethodId: string;
    categoryId: string;
    scope: 'HOUSEHOLD' | 'PERSONAL';
    store: string;
    amount: number;
    purchaseDate: Date;
    purchaseId: string;
    exchangeRateToArs: number;
  },
) {
  const sub = detectSubscriptionMerchant(args.store);
  if (!sub) return;

  const dueDay = Math.min(28, Math.max(1, args.purchaseDate.getUTCDate()));
  let recurring = await tx.recurringPayment.findFirst({
    where: {
      householdId: args.householdId,
      paymentMethodId: args.paymentMethodId,
      active: true,
      currency: 'USD',
      name: sub.name,
    },
  });

  if (!recurring) {
    const suscripciones = await tx.category.findFirst({
      where: {
        name: { equals: 'Suscripciones', mode: 'insensitive' },
        OR: [{ householdId: null }, { householdId: args.householdId }],
      },
    });
    recurring = await createRecurringPayment(tx, args.householdId, args.userId, {
      name: sub.name,
      categoryId: suscripciones?.id ?? args.categoryId,
      paymentMethodId: args.paymentMethodId,
      scope: args.scope,
      dueDay,
      amountType: 'FIXED',
      amount: args.amount,
      currency: 'USD',
      exchangeRateToArs: args.exchangeRateToArs,
    });
  } else {
    await tx.recurringPayment.update({
      where: { id: recurring.id },
      data: {
        amount: args.amount,
        exchangeRateToArs: args.exchangeRateToArs,
      },
    });
  }

  const dueDate = startOfUtcDay(
    new Date(Date.UTC(args.purchaseDate.getUTCFullYear(), args.purchaseDate.getUTCMonth(), dueDay)),
  );

  const existingOcc = await tx.recurringOccurrence.findUnique({
    where: {
      recurringPaymentId_dueDate: {
        recurringPaymentId: recurring.id,
        dueDate,
      },
    },
  });

  if (existingOcc) {
    if (existingOcc.purchaseId && existingOcc.purchaseId !== args.purchaseId) return;
    await tx.recurringOccurrence.update({
      where: { id: existingOcc.id },
      data: {
        status: 'COMPLETED',
        amount: args.amount,
        purchaseId: args.purchaseId,
      },
    });
  } else {
    await tx.recurringOccurrence.create({
      data: {
        recurringPaymentId: recurring.id,
        dueDate,
        status: 'COMPLETED',
        amount: args.amount,
        purchaseId: args.purchaseId,
      },
    });
  }
}

function toMatchable(p: {
  id: string;
  store: string;
  description: string | null;
  purchaseDate: Date;
  netAmount: { toNumber(): number };
  paymentMethodId: string;
  installmentsCount: number;
  statementFingerprint: string | null;
  installments: Array<{ number: number; amount: { toNumber(): number }; dueDate: Date }>;
}): StatementMatchablePurchase {
  return {
    id: p.id,
    store: p.store,
    description: p.description,
    purchaseDate: p.purchaseDate.toISOString(),
    netAmount: p.netAmount.toNumber(),
    paymentMethodId: p.paymentMethodId,
    installmentsCount: p.installmentsCount,
    statementFingerprint: p.statementFingerprint,
    installments: p.installments.map((i) => ({
      number: i.number,
      amount: i.amount.toNumber(),
      dueDate: i.dueDate.toISOString(),
    })),
  };
}

export async function loadMatchablePurchases(
  db: Db,
  householdId: string,
  paymentMethodId: string,
): Promise<StatementMatchablePurchase[]> {
  const purchases = await db.purchase.findMany({
    where: { householdId, paymentMethodId },
    select: {
      id: true,
      store: true,
      description: true,
      purchaseDate: true,
      netAmount: true,
      paymentMethodId: true,
      installmentsCount: true,
      statementFingerprint: true,
      installments: {
        select: { number: true, amount: true, dueDate: true },
        orderBy: { number: 'asc' },
      },
    },
  });
  return purchases.map(toMatchable);
}

export function matchLinesAgainstPurchases(
  lines: ParsedStatementLine[],
  purchases: StatementMatchablePurchase[],
  paymentMethodId: string,
) {
  return lines.map((line) => {
    const alreadyImported = purchases.find((p) => p.statementFingerprint === line.fingerprint);
    const candidates = findStatementMatchCandidates(line, purchases, paymentMethodId);
    // When strict match is empty, offer nearby same-card expenses for manual Fusionar.
    const pickerCandidates =
      candidates.length > 0
        ? candidates
        : findStatementPickerCandidates(line, purchases, paymentMethodId);
    return {
      line,
      alreadyImported: Boolean(alreadyImported),
      alreadyImportedPurchaseId: alreadyImported?.id ?? null,
      candidates: pickerCandidates,
      topMatch: candidates[0] ?? null,
      strictMatchCount: candidates.length,
    };
  });
}

export type CommitLineDecision =
  | {
      fingerprint: string;
      action: 'SKIP';
    }
  | {
      fingerprint: string;
      action: 'NEW';
      categoryId: string;
      scope: 'HOUSEHOLD' | 'PERSONAL';
      splitMode?: 'EQUAL' | 'ASSIGN' | 'AMOUNT' | 'SHARES' | 'PERCENTAGE';
      assignToUserId?: string;
    }
  | {
      fingerprint: string;
      action: 'MERGE';
      matchedPurchaseId: string;
      amountResolution: 'KEEP_EXISTING' | 'USE_STATEMENT';
    };

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

async function applyStatementInstallmentState(
  tx: Prisma.TransactionClient,
  purchaseId: string,
  installmentCurrent: number | undefined,
  statementAmount: number,
  useStatementAmount: boolean,
): Promise<void> {
  const installments = await tx.installment.findMany({
    where: { purchaseId },
    orderBy: { number: 'asc' },
  });
  if (installments.length === 0) return;

  const current = installmentCurrent ?? 1;
  for (const inst of installments) {
    if (inst.number < current) {
      await tx.installment.update({
        where: { id: inst.id },
        data: {
          paid: true,
          paidDate: inst.paidDate ?? inst.dueDate,
        },
      });
    } else if (inst.number === current && useStatementAmount) {
      await tx.installment.update({
        where: { id: inst.id },
        data: {
          amount: statementAmount,
          paid: true,
          paidDate: inst.dueDate,
        },
      });
    } else if (inst.number === current) {
      await tx.installment.update({
        where: { id: inst.id },
        data: {
          paid: true,
          paidDate: inst.dueDate,
        },
      });
    }
  }

  if (useStatementAmount) {
    const refreshed = await tx.installment.findMany({ where: { purchaseId } });
    const net = round2(refreshed.reduce((s, i) => s + i.amount.toNumber(), 0));
    await tx.purchase.update({
      where: { id: purchaseId },
      data: { netAmount: net, grossAmount: net, discountAmount: 0 },
    });
  }
}

export async function commitStatementImport(
  tx: Prisma.TransactionClient,
  args: {
    householdId: string;
    userId: string;
    paymentMethodId: string;
    fileName: string;
    bankSource: string;
    lines: ParsedStatementLine[];
    decisions: CommitLineDecision[];
  },
) {
  const paymentMethod = await tx.paymentMethod.findFirst({
    where: { id: args.paymentMethodId, householdId: args.householdId },
  });
  if (!paymentMethod) throw new ExpenseValidationError('Medio de pago inválido');

  const decisionByFp = new Map(args.decisions.map((d) => [d.fingerprint, d]));

  // Skip fingerprints already committed for this household
  const existingFingerprints = await tx.statementImportLine.findMany({
    where: {
      householdId: args.householdId,
      fingerprint: { in: args.lines.map((l) => l.fingerprint) },
      status: { in: ['NEW', 'MERGED'] },
    },
    select: { fingerprint: true },
  });
  const alreadyDone = new Set(existingFingerprints.map((e) => e.fingerprint));

  // Clear prior SKIPPED rows so the same fingerprint can be imported later
  await tx.statementImportLine.deleteMany({
    where: {
      householdId: args.householdId,
      fingerprint: { in: args.lines.map((l) => l.fingerprint) },
      status: 'SKIPPED',
    },
  });

  const imp = await tx.statementImport.create({
    data: {
      householdId: args.householdId,
      userId: args.userId,
      paymentMethodId: args.paymentMethodId,
      fileName: args.fileName,
      bankSource: args.bankSource,
      status: 'PENDING',
    },
  });

  let processed = 0;
  const results: Array<{ fingerprint: string; status: string; purchaseId?: string }> = [];

  for (const line of args.lines) {
    const decision = decisionByFp.get(line.fingerprint);
    const action = decision?.action ?? (line.suggestedSkip ? 'SKIP' : undefined);

    if (!action) {
      throw new ExpenseValidationError(`Falta decisión para ${line.store} (${line.date})`);
    }

    if (alreadyDone.has(line.fingerprint) && action !== 'SKIP') {
      results.push({ fingerprint: line.fingerprint, status: 'SKIPPED_DUP' });
      continue;
    }

    if (action === 'SKIP') {
      const skipFp = alreadyDone.has(line.fingerprint)
        ? `${line.fingerprint}#skip-${imp.id}`
        : line.fingerprint;
      try {
        await tx.statementImportLine.create({
          data: {
            importId: imp.id,
            householdId: args.householdId,
            fingerprint: skipFp,
            lineDate: new Date(`${line.date}T12:00:00.000Z`),
            store: line.store,
            amount: line.amount,
            currency: line.currency,
            installmentCurrent: line.installment?.current,
            installmentTotal: line.installment?.total,
            rawText: line.raw,
            suggestedSkip: true,
            status: 'SKIPPED',
          },
        });
      } catch {
        // Fingerprint already recorded — ignore duplicate skip
      }
      results.push({ fingerprint: line.fingerprint, status: 'SKIPPED' });
      continue;
    }

    if (action === 'NEW') {
      if (decision?.action !== 'NEW') {
        throw new ExpenseValidationError(`Decisión inválida para ${line.store}`);
      }
      const installmentsCount = line.installment?.total ?? 1;
      const lineGross =
        installmentsCount > 1 ? round2(line.amount * installmentsCount) : line.amount;
      const statementDiscount = round2(line.discountAmount ?? 0);
      const purchaseDate = new Date(`${line.date}T12:00:00.000Z`);

      let currency: 'ARS' | 'USD' = line.currency === 'USD' ? 'USD' : 'ARS';
      let exchangeRateToArs = 1;
      let exchangeRateSource: string | null = null;
      let exchangeRateDate: Date | null = null;
      if (currency === 'USD') {
        try {
          const fx = await getUsdToArsRate(tx, line.date);
          exchangeRateToArs = fx.rate;
          exchangeRateSource = fx.source;
          exchangeRateDate = fx.date;
        } catch (err) {
          const msg =
            err instanceof ExchangeRateError
              ? err.message
              : 'No se pudo obtener el tipo de cambio USD→ARS';
          throw new ExpenseValidationError(msg);
        }
      }

      const storeName = line.store;
      const created = await createPurchaseWithAllocations(
        tx,
        args.householdId,
        args.userId,
        {
          paymentMethodId: args.paymentMethodId,
          categoryId: decision.categoryId,
          store: storeName,
          description: line.description?.trim()
            ? line.description.trim()
            : line.installment
              ? `Importado · cuota ${line.installment.current}/${line.installment.total}`
              : statementDiscount > 0
                ? 'Importado del resumen (con bonificación)'
                : currency === 'USD'
                  ? 'Importado del resumen (USD)'
                  : 'Importado del resumen',
          purchaseDate,
          grossAmount: lineGross,
          installmentsCount,
          promotionMode: statementDiscount > 0 ? 'manual' : 'off',
          manualDiscount:
            statementDiscount > 0
              ? {
                  discountPercentage: Math.min(
                    100,
                    Math.max(0.01, round2((statementDiscount / lineGross) * 100)),
                  ),
                  discountCap: statementDiscount,
                  label: 'Bonificación del resumen',
                }
              : undefined,
          scope: decision.scope,
          splitMode: decision.scope === 'PERSONAL' ? 'EQUAL' : (decision.splitMode ?? 'EQUAL'),
          assignToUserId: decision.assignToUserId,
          currency,
          exchangeRateToArs,
          exchangeRateSource,
          exchangeRateDate,
        },
      );

      await tx.purchase.update({
        where: { id: created.id },
        data: { statementFingerprint: line.fingerprint },
      });

      await applyStatementInstallmentState(
        tx,
        created.id,
        line.installment?.current,
        line.amount,
        true,
      );

      if (currency === 'USD') {
        await linkUsdSubscriptionRecurring(tx, {
          householdId: args.householdId,
          userId: args.userId,
          paymentMethodId: args.paymentMethodId,
          categoryId: decision.categoryId,
          scope: decision.scope,
          store: storeName,
          amount: line.amount,
          purchaseDate,
          purchaseId: created.id,
          exchangeRateToArs,
        });
      }

      await tx.statementImportLine.create({
        data: {
          importId: imp.id,
          householdId: args.householdId,
          fingerprint: line.fingerprint,
          lineDate: purchaseDate,
          store: line.store,
          amount: line.amount,
          currency: line.currency,
          installmentCurrent: line.installment?.current,
          installmentTotal: line.installment?.total,
          rawText: line.raw,
          suggestedSkip: false,
          status: 'NEW',
          categoryId: decision.categoryId,
          scope: decision.scope,
          splitMode: decision.scope === 'PERSONAL' ? 'EQUAL' : (decision.splitMode ?? 'EQUAL'),
          createdPurchaseId: created.id,
          matchedPurchaseId: created.id,
        },
      });

      processed += 1;
      results.push({ fingerprint: line.fingerprint, status: 'NEW', purchaseId: created.id });
      continue;
    }

    // MERGE
    if (decision?.action !== 'MERGE') {
      throw new ExpenseValidationError(`Decisión inválida para ${line.store}`);
    }
    const purchase = await tx.purchase.findFirst({
      where: {
        id: decision.matchedPurchaseId,
        householdId: args.householdId,
        paymentMethodId: args.paymentMethodId,
      },
      include: { installments: true },
    });
    if (!purchase) throw new ExpenseValidationError('Gasto a fusionar no encontrado');

    const useStatement = decision.amountResolution === 'USE_STATEMENT';
    const current = line.installment?.current;
    await applyStatementInstallmentState(tx, purchase.id, current, line.amount, useStatement);

    if (!purchase.statementFingerprint) {
      await tx.purchase.update({
        where: { id: purchase.id },
        data: { statementFingerprint: line.fingerprint },
      });
    }

    await tx.statementImportLine.create({
      data: {
        importId: imp.id,
        householdId: args.householdId,
        fingerprint: line.fingerprint,
        lineDate: new Date(`${line.date}T12:00:00.000Z`),
        store: line.store,
        amount: line.amount,
        currency: line.currency,
        installmentCurrent: line.installment?.current,
        installmentTotal: line.installment?.total,
        rawText: line.raw,
        suggestedSkip: false,
        status: 'MERGED',
        matchedPurchaseId: purchase.id,
        amountResolution: decision.amountResolution,
        createdPurchaseId: purchase.id,
      },
    });

    processed += 1;
    results.push({ fingerprint: line.fingerprint, status: 'MERGED', purchaseId: purchase.id });
  }

  const committed = await tx.statementImport.update({
    where: { id: imp.id },
    data: {
      status: 'PROCESSED',
      processedCount: processed,
      committedAt: new Date(),
    },
    include: {
      lines: true,
    },
  });

  return { import: committed, results };
}

export async function getPurchaseSummary(db: Db, purchaseId: string) {
  return db.purchase.findUnique({
    where: { id: purchaseId },
    include: purchaseInclude,
  });
}
