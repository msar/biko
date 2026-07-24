import type { Prisma, PrismaClient } from '@prisma/client';

type Db = PrismaClient | Prisma.TransactionClient;

export const DOLARAPI_TARJETA_SOURCE = 'dolarapi:tarjeta';

export class ExchangeRateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExchangeRateError';
  }
}

function utcNoon(date: Date | string): Date {
  const iso = typeof date === 'string' ? date.slice(0, 10) : date.toISOString().slice(0, 10);
  return new Date(`${iso}T12:00:00.000Z`);
}

export type UsdArsRate = {
  rate: number;
  source: string;
  date: Date;
};

async function fetchDolarApiTarjeta(): Promise<number> {
  const res = await fetch('https://dolarapi.com/v1/dolares/tarjeta', {
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) {
    throw new ExchangeRateError(`No se pudo obtener el dólar tarjeta (${res.status})`);
  }
  const body = (await res.json()) as { venta?: number; compra?: number };
  const rate = Number(body.venta ?? body.compra);
  if (!Number.isFinite(rate) || rate <= 0) {
    throw new ExchangeRateError('Respuesta inválida de dólar tarjeta');
  }
  return Math.round(rate * 1_000_000) / 1_000_000;
}

/**
 * Resolve USD→ARS rate for a calendar day: DB cache → dolarapi tarjeta → upsert.
 */
export async function getUsdToArsRate(db: Db, date: Date | string): Promise<UsdArsRate> {
  const day = utcNoon(date);
  const cached = await db.exchangeRate.findUnique({
    where: {
      date_fromCurrency_toCurrency_source: {
        date: day,
        fromCurrency: 'USD',
        toCurrency: 'ARS',
        source: DOLARAPI_TARJETA_SOURCE,
      },
    },
  });
  if (cached) {
    return { rate: cached.rate.toNumber(), source: cached.source, date: cached.date };
  }

  // Prefer any recent cached tarjeta rate if live fetch fails later
  const recent = await db.exchangeRate.findFirst({
    where: {
      fromCurrency: 'USD',
      toCurrency: 'ARS',
      source: DOLARAPI_TARJETA_SOURCE,
    },
    orderBy: { date: 'desc' },
  });

  let rate: number;
  try {
    rate = await fetchDolarApiTarjeta();
  } catch (err) {
    if (recent) {
      return { rate: recent.rate.toNumber(), source: recent.source, date: recent.date };
    }
    throw err instanceof ExchangeRateError
      ? err
      : new ExchangeRateError('No se pudo obtener el tipo de cambio USD→ARS');
  }

  const saved = await db.exchangeRate.upsert({
    where: {
      date_fromCurrency_toCurrency_source: {
        date: day,
        fromCurrency: 'USD',
        toCurrency: 'ARS',
        source: DOLARAPI_TARJETA_SOURCE,
      },
    },
    create: {
      date: day,
      fromCurrency: 'USD',
      toCurrency: 'ARS',
      rate,
      source: DOLARAPI_TARJETA_SOURCE,
    },
    update: { rate, fetchedAt: new Date() },
  });

  return { rate: saved.rate.toNumber(), source: saved.source, date: saved.date };
}
