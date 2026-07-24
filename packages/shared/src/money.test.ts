import { describe, expect, it } from 'vitest';
import { detectSubscriptionMerchant, formatMoneyExact, toArs } from './money';

describe('money helpers', () => {
  it('converts with rate', () => {
    expect(toArs(3.94, 1400)).toBe(5516);
    expect(toArs(10, 1)).toBe(10);
  });

  it('formats USD', () => {
    expect(formatMoneyExact(3.94, 'USD')).toMatch(/3[,.]94/);
  });

  it('detects subscription merchants', () => {
    expect(detectSubscriptionMerchant('Spotify')).toEqual({ key: 'spotify', name: 'Spotify' });
    expect(detectSubscriptionMerchant('GOOGLE *YouTubeP P1me2NTx')).toEqual({
      key: 'youtube',
      name: 'YouTube',
    });
    expect(detectSubscriptionMerchant('EQUUS')).toBeNull();
  });
});
