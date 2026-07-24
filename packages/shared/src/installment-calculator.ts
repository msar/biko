import { PaymentMethodType } from './enums';

/**
 * Calcula el ahorro real de una compra respetando el tope de la promoción.
 * Ej: 100.000 con 25% de descuento y tope de 20.000 -> ahorro = 20.000, no 25.000.
 */
export function calculateDiscount(
  grossAmount: number,
  discountPercentage?: number | null,
  discountCap?: number | null,
): { discountAmount: number; netAmount: number } {
  if (!discountPercentage) {
    return { discountAmount: 0, netAmount: grossAmount };
  }

  const rawDiscount = grossAmount * (discountPercentage / 100);
  const discountAmount = discountCap != null ? Math.min(rawDiscount, discountCap) : rawDiscount;

  return {
    discountAmount: round2(discountAmount),
    netAmount: round2(grossAmount - discountAmount),
  };
}

export interface PaymentMethodCycle {
  type: PaymentMethodType;
  closingDay?: number | null;
  dueDay?: number | null;
}

export interface GeneratedInstallment {
  number: number;
  amount: number;
  dueDate: Date;
}

/**
 * Genera las cuotas de una compra.
 *
 * - CASH / DEBIT_CARD / WALLET / BANK_TRANSFER: se considera pagado en el acto,
 *   una sola "cuota" con dueDate = purchaseDate (ya paga).
 * - CREDIT_CARD: respeta el ciclo de cierre/vencimiento de la tarjeta. Si la
 *   compra se hizo después del día de cierre, la primera cuota se corre un
 *   mes (cae en el resumen siguiente).
 */
export function generateInstallments(
  netAmount: number,
  installmentsCount: number,
  purchaseDate: Date,
  paymentMethod: PaymentMethodCycle,
): GeneratedInstallment[] {
  if (paymentMethod.type !== PaymentMethodType.CREDIT_CARD) {
    // Medios de pago inmediatos: no hay financiación, un único movimiento ya pago.
    return [{ number: 1, amount: netAmount, dueDate: purchaseDate }];
  }

  const firstDueDate = getFirstDueDate(purchaseDate, paymentMethod.closingDay, paymentMethod.dueDay);

  return splitAmount(netAmount, installmentsCount).map((amount, i) => ({
    number: i + 1,
    amount,
    dueDate: addMonths(firstDueDate, i),
  }));
}

/**
 * Determina el vencimiento de la primera cuota según el ciclo de la tarjeta.
 * Si no hay closingDay/dueDay configurados, se asume que la compra cae en el
 * resumen del mes siguiente con vencimiento el mismo día de la compra
 * (fallback razonable mientras el usuario no cargue el detalle de su tarjeta).
 */
function getFirstDueDate(purchaseDate: Date, closingDay?: number | null, dueDay?: number | null): Date {
  const day = purchaseDate.getDate();

  let closingMonth = purchaseDate.getMonth();
  let closingYear = purchaseDate.getFullYear();

  // Si la compra fue después del cierre, pasa a capturarse en el ciclo siguiente.
  if (closingDay != null && day > closingDay) {
    closingMonth += 1;
  }

  let dueMonth = closingMonth + 1; // el vencimiento cae en el mes siguiente al cierre
  let dueYear = closingYear;
  if (dueMonth > 11) {
    dueMonth -= 12;
    dueYear += 1;
  }

  const finalDueDay = dueDay ?? day;
  return new Date(dueYear, dueMonth, finalDueDay);
}

/**
 * Divide un monto en N cuotas iguales, ajustando la última para absorber
 * el redondeo (evita que 100/3 pierda centavos por el camino).
 */
function splitAmount(total: number, count: number): number[] {
  const base = round2(total / count);
  const amounts = new Array(count).fill(base);
  const drift = round2(total - base * count);
  amounts[count - 1] = round2(amounts[count - 1] + drift);
  return amounts;
}

function addMonths(date: Date, months: number): Date {
  const result = new Date(date);
  result.setMonth(result.getMonth() + months);
  return result;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Genera cuotas mensuales para una deuda externa (sin ciclo de tarjeta).
 * La primera cuota vence en `startDate`; las siguientes suman un mes.
 */
export function generateDebtInstallments(
  totalAmount: number,
  installmentsCount: number,
  startDate: Date,
): GeneratedInstallment[] {
  const count = Math.max(1, Math.min(36, Math.floor(installmentsCount)));
  return splitAmount(totalAmount, count).map((amount, i) => ({
    number: i + 1,
    amount,
    dueDate: addMonths(startDate, i),
  }));
}
