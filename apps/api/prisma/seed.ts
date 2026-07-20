import { CardNetwork, EntityKind, PaymentMethodType, PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const ENTITIES: Array<{ name: string; kind: EntityKind }> = [
  { name: 'Santander', kind: 'BANK' },
  { name: 'BBVA', kind: 'BANK' },
  { name: 'Galicia', kind: 'BANK' },
  { name: 'Nación', kind: 'BANK' },
  { name: 'Provincia', kind: 'BANK' },
  { name: 'Macro', kind: 'BANK' },
  { name: 'ICBC', kind: 'BANK' },
  { name: 'Comafi', kind: 'BANK' },
  { name: 'Credicoop', kind: 'BANK' },
  { name: 'Supervielle', kind: 'BANK' },
  { name: 'Ciudad', kind: 'BANK' },
  { name: 'Banco Santa Fe', kind: 'BANK' },
  { name: 'Hipotecario', kind: 'BANK' },
  { name: 'Banco San Juan', kind: 'BANK' },
  { name: 'Banco Columbia', kind: 'BANK' },
  { name: 'Naranja X', kind: 'WALLET' },
  { name: 'MODO', kind: 'WALLET' },
  { name: 'MercadoPago', kind: 'WALLET' },
  { name: 'Ualá', kind: 'WALLET' },
  { name: 'Personal Pay', kind: 'WALLET' },
];

const BANK_CARD_NETWORKS: CardNetwork[] = ['VISA', 'MASTERCARD', 'AMEX'];

const CATEGORIES: Array<{ name: string; icon: string; color: string }> = [
  { name: 'Supermercado', icon: '🛒', color: '#4f8a5b' },
  { name: 'Carnicería', icon: '🥩', color: '#b3423f' },
  { name: 'Verdulería', icon: '🥬', color: '#5c9e4f' },
  { name: 'Pollería', icon: '🍗', color: '#c98a3d' },
  { name: 'Panadería', icon: '🥖', color: '#b98a55' },
  { name: 'Farmacia', icon: '💊', color: '#4a7fb5' },
  { name: 'Servicios', icon: '💡', color: '#7a6bb5' },
  { name: 'Transporte', icon: '🚌', color: '#5b8a9e' },
  { name: 'Combustible', icon: '⛽', color: '#8a6b4f' },
  { name: 'Restaurante', icon: '🍽️', color: '#b5567a' },
  { name: 'Compras', icon: '🛍️', color: '#6b8ab5' },
  { name: 'Hogar', icon: '🏠', color: '#8a7f5b' },
  { name: 'Salud', icon: '🏥', color: '#5ba38a' },
  { name: 'Deportes', icon: '⚽', color: '#3d8a6b' },
  { name: 'Entretenimiento', icon: '🎬', color: '#8a5b9e' },
  { name: 'Viajes', icon: '✈️', color: '#4a7fb5' },
  { name: 'Otros', icon: '📦', color: '#888888' },
];

const NETWORK_LABEL: Record<CardNetwork, string> = {
  VISA: 'Visa',
  MASTERCARD: 'Mastercard',
  AMEX: 'Amex',
  CABAL: 'Cabal',
  NONE: '',
};

async function main() {
  // --- Entidades ---
  const entityByName = new Map<string, string>();
  for (const entity of ENTITIES) {
    const row = await prisma.entity.upsert({
      where: { name: entity.name },
      create: entity,
      update: { kind: entity.kind },
    });
    entityByName.set(row.name, row.id);
  }

  // --- Definiciones estándar de medios de pago ---
  async function upsertDefinition(params: {
    entityName: string | null;
    type: PaymentMethodType;
    network: CardNetwork;
    name: string;
  }) {
    const entityId = params.entityName ? entityByName.get(params.entityName)! : null;
    const existing = await prisma.paymentMethodDefinition.findFirst({
      where: { entityId, type: params.type, network: params.network },
    });
    if (existing) {
      await prisma.paymentMethodDefinition.update({ where: { id: existing.id }, data: { name: params.name, active: true } });
    } else {
      await prisma.paymentMethodDefinition.create({
        data: { entityId, type: params.type, network: params.network, name: params.name },
      });
    }
  }

  for (const entity of ENTITIES) {
    if (entity.kind === 'BANK') {
      for (const network of BANK_CARD_NETWORKS) {
        await upsertDefinition({
          entityName: entity.name,
          type: 'CREDIT_CARD',
          network,
          name: `${entity.name} ${NETWORK_LABEL[network]} (crédito)`,
        });
      }
      await upsertDefinition({
        entityName: entity.name,
        type: 'DEBIT_CARD',
        network: 'VISA',
        name: `${entity.name} Visa (débito)`,
      });
      await upsertDefinition({
        entityName: entity.name,
        type: 'DEBIT_CARD',
        network: 'MASTERCARD',
        name: `${entity.name} Mastercard (débito)`,
      });
      await upsertDefinition({
        entityName: entity.name,
        type: 'BANK_TRANSFER',
        network: 'NONE',
        name: `Transferencia ${entity.name}`,
      });
    } else if (entity.kind === 'WALLET') {
      await upsertDefinition({ entityName: entity.name, type: 'WALLET', network: 'NONE', name: entity.name });
      if (entity.name === 'Naranja X') {
        await upsertDefinition({
          entityName: entity.name,
          type: 'CREDIT_CARD',
          network: 'VISA',
          name: 'Naranja X Visa (crédito)',
        });
        await upsertDefinition({
          entityName: entity.name,
          type: 'CREDIT_CARD',
          network: 'MASTERCARD',
          name: 'Naranja X Mastercard (crédito)',
        });
      }
      if (entity.name === 'MercadoPago' || entity.name === 'Ualá') {
        await upsertDefinition({
          entityName: entity.name,
          type: 'DEBIT_CARD',
          network: 'MASTERCARD',
          name: `${entity.name} Mastercard (débito)`,
        });
      }
    }
  }

  // Sin entidad: efectivo y transferencia genérica (disponibles para todos).
  const cash = await prisma.paymentMethodDefinition.findFirst({ where: { entityId: null, type: 'CASH' } });
  if (!cash) {
    await prisma.paymentMethodDefinition.create({
      data: { entityId: null, type: 'CASH', network: 'NONE', name: 'Efectivo' },
    });
  }
  const transfer = await prisma.paymentMethodDefinition.findFirst({
    where: { entityId: null, type: 'BANK_TRANSFER' },
  });
  if (!transfer) {
    await prisma.paymentMethodDefinition.create({
      data: { entityId: null, type: 'BANK_TRANSFER', network: 'NONE', name: 'Transferencia' },
    });
  }

  // --- Categorías globales ---
  // One-time rename: Indumentaria → Compras (preserve IDs when possible).
  const comprasMeta = CATEGORIES.find((c) => c.name === 'Compras')!;
  const oldIndumentaria = await prisma.category.findFirst({
    where: { householdId: null, name: 'Indumentaria' },
  });
  const existingCompras = await prisma.category.findFirst({
    where: { householdId: null, name: 'Compras' },
  });
  if (oldIndumentaria && !existingCompras) {
    await prisma.category.update({
      where: { id: oldIndumentaria.id },
      data: { name: comprasMeta.name, icon: comprasMeta.icon, color: comprasMeta.color },
    });
  } else if (oldIndumentaria && existingCompras) {
    await prisma.purchase.updateMany({
      where: { categoryId: oldIndumentaria.id },
      data: { categoryId: existingCompras.id },
    });
    await prisma.recurringPayment.updateMany({
      where: { categoryId: oldIndumentaria.id },
      data: { categoryId: existingCompras.id },
    });
    const promoLinks = await prisma.promotionCategory.findMany({
      where: { categoryId: oldIndumentaria.id },
    });
    for (const link of promoLinks) {
      const already = await prisma.promotionCategory.findUnique({
        where: {
          promotionId_categoryId: {
            promotionId: link.promotionId,
            categoryId: existingCompras.id,
          },
        },
      });
      if (already) {
        await prisma.promotionCategory.delete({
          where: {
            promotionId_categoryId: {
              promotionId: link.promotionId,
              categoryId: oldIndumentaria.id,
            },
          },
        });
      } else {
        await prisma.promotionCategory.update({
          where: {
            promotionId_categoryId: {
              promotionId: link.promotionId,
              categoryId: oldIndumentaria.id,
            },
          },
          data: { categoryId: existingCompras.id },
        });
      }
    }
    await prisma.category.delete({ where: { id: oldIndumentaria.id } });
  }

  for (const category of CATEGORIES) {
    const existing = await prisma.category.findFirst({ where: { householdId: null, name: category.name } });
    if (existing) {
      await prisma.category.update({ where: { id: existing.id }, data: { icon: category.icon, color: category.color } });
    } else {
      await prisma.category.create({ data: { ...category, householdId: null } });
    }
  }

  // --- Promos de ejemplo: omitidas; Mi semana usa promos scrapeadas de MODO con link.

  console.log('Seed completado: entidades, definiciones, categorías y promos de ejemplo.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
