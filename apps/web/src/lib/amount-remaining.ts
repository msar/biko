/** Round to 2 decimal places (centavos). */
export function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Parse a money input that may use comma or dot as decimal separator. */
export function parseMoneyInput(raw: string): number {
  const n = Number(String(raw).replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

/** total − sum(parts), rounded to centavos. */
export function moneyRemaining(total: number, parts: number[]): number {
  const sum = roundMoney(parts.reduce((s, p) => s + (Number.isFinite(p) ? p : 0), 0));
  return roundMoney(total - sum);
}

/**
 * Assign remaining to a field: empty → remaining; otherwise current + remaining.
 * Only call when remaining > 0.
 */
export function applyRemainingToAmount(currentRaw: string, remaining: number): string {
  const trimmed = currentRaw.trim();
  if (trimmed === '') return String(remaining);
  const current = Number(trimmed.replace(',', '.'));
  if (!Number.isFinite(current)) return String(remaining);
  return String(roundMoney(current + remaining));
}

export type RemainingBalance = 'ok' | 'short' | 'over';

export function remainingBalance(remaining: number, epsilon = 0.01): RemainingBalance {
  if (Math.abs(remaining) <= epsilon) return 'ok';
  return remaining > 0 ? 'short' : 'over';
}

/** Spanish hint for how entered amounts compare to a total. */
export function remainingHintLabel(remaining: number, epsilon = 0.01): string {
  const status = remainingBalance(remaining, epsilon);
  if (status === 'ok') return 'Suma OK';
  if (status === 'short') return `Faltan ${remaining.toFixed(2)}`;
  return `Sobran ${Math.abs(remaining).toFixed(2)}`;
}
