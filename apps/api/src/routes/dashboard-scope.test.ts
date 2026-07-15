import { describe, expect, it } from 'vitest';
import { purchaseMatchesScope } from './dashboard.js';

describe('purchaseMatchesScope', () => {
  const viewer = 'u1';
  const partner = 'u2';

  it('household includes only HOUSEHOLD', () => {
    expect(purchaseMatchesScope({ scope: 'HOUSEHOLD', userId: viewer }, viewer, 'household')).toBe(true);
    expect(purchaseMatchesScope({ scope: 'PERSONAL', userId: viewer }, viewer, 'household')).toBe(false);
  });

  it('personal includes only viewer PERSONAL', () => {
    expect(purchaseMatchesScope({ scope: 'PERSONAL', userId: viewer }, viewer, 'personal')).toBe(true);
    expect(purchaseMatchesScope({ scope: 'PERSONAL', userId: partner }, viewer, 'personal')).toBe(false);
    expect(purchaseMatchesScope({ scope: 'HOUSEHOLD', userId: viewer }, viewer, 'personal')).toBe(false);
  });

  it('all includes household and viewer personal only', () => {
    expect(purchaseMatchesScope({ scope: 'HOUSEHOLD', userId: partner }, viewer, 'all')).toBe(true);
    expect(purchaseMatchesScope({ scope: 'PERSONAL', userId: viewer }, viewer, 'all')).toBe(true);
    expect(purchaseMatchesScope({ scope: 'PERSONAL', userId: partner }, viewer, 'all')).toBe(false);
  });
});
