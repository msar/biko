import type { Prisma, PrismaClient } from '@prisma/client';

type Db = PrismaClient | Prisma.TransactionClient;

/** Medios de pago sin entidad disponibles para todos los hogares. */
const DEFAULT_METHODS: Array<{ type: 'CASH' | 'BANK_TRANSFER'; name: string }> = [
  { type: 'CASH', name: 'Efectivo' },
  { type: 'BANK_TRANSFER', name: 'Transferencia' },
];

async function ensureGenericDefinition(db: Db, type: 'CASH' | 'BANK_TRANSFER', name: string) {
  const existing = await db.paymentMethodDefinition.findFirst({ where: { entityId: null, type } });
  if (existing) return existing;
  return db.paymentMethodDefinition.create({
    data: { entityId: null, type, network: 'NONE', name },
  });
}

/**
 * Da de alta (idempotente) los medios de pago por defecto del hogar: Efectivo y
 * Transferencia genérica. Crea las definiciones globales si faltan y solo agrega
 * los medios que el hogar todavía no tenga (no re-agrega los que se hayan
 * eliminado en una corrida posterior; el caller usa un flag para correrlo una vez).
 */
export async function ensureDefaultPaymentMethods(db: Db, householdId: string): Promise<void> {
  const definitionIds: string[] = [];
  for (const method of DEFAULT_METHODS) {
    const def = await ensureGenericDefinition(db, method.type, method.name);
    definitionIds.push(def.id);
  }

  const existing = await db.paymentMethod.findMany({
    where: { householdId, definitionId: { in: definitionIds } },
    select: { definitionId: true },
  });
  const have = new Set(existing.map((m) => m.definitionId));
  const toCreate = definitionIds.filter((id) => !have.has(id));
  if (toCreate.length > 0) {
    await db.paymentMethod.createMany({
      data: toCreate.map((definitionId) => ({ householdId, definitionId })),
    });
  }
}
