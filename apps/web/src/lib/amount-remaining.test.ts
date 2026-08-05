import { describe, expect, it } from 'vitest';
import {
  applyRemainingToAmount,
  moneyRemaining,
  parseMoneyInput,
  remainingBalance,
  remainingHintLabel,
  roundMoney,
} from './amount-remaining';

describe('amount-remaining', () => {
  it('parses comma decimals', () => {
    expect(parseMoneyInput('12,5')).toBe(12.5);
    expect(parseMoneyInput('')).toBe(0);
  });

  it('computes remaining', () => {
    expect(moneyRemaining(100, [40, 35])).toBe(25);
    expect(moneyRemaining(100, [60, 40])).toBe(0);
    expect(moneyRemaining(100, [70, 40])).toBe(-10);
  });

  it('applies remaining to empty or existing amount', () => {
    expect(applyRemainingToAmount('', 25)).toBe('25');
    expect(applyRemainingToAmount('10', 25)).toBe('35');
    expect(applyRemainingToAmount('10,5', 0.5)).toBe('11');
  });

  it('classifies balance and labels', () => {
    expect(remainingBalance(0)).toBe('ok');
    expect(remainingBalance(0.005)).toBe('ok');
    expect(remainingBalance(1)).toBe('short');
    expect(remainingBalance(-1)).toBe('over');
    expect(remainingHintLabel(12.5)).toBe('Faltan 12.50');
    expect(remainingHintLabel(-3)).toBe('Sobran 3.00');
    expect(remainingHintLabel(0)).toBe('Suma OK');
  });

  it('rounds money', () => {
    expect(roundMoney(10.005)).toBe(10.01);
  });
});
