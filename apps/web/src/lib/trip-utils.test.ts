import { describe, expect, it } from 'vitest';
import {
  memberMergeNameScore,
  normalizeMemberNameForMerge,
  rankMergeTargets,
} from './trip-utils';

describe('merge name ranking', () => {
  it('normalizes spaces and digits for comparison', () => {
    expect(normalizeMemberNameForMerge('Gime 2')).toBe('gime2');
    expect(normalizeMemberNameForMerge('Gimé')).toBe('gime');
  });

  it('scores near-duplicates above unrelated names', () => {
    expect(memberMergeNameScore('Gime 2', 'Gime')).toBeGreaterThan(
      memberMergeNameScore('Gime 2', 'Marian'),
    );
    expect(memberMergeNameScore('Gime2', 'Gime')).toBeGreaterThan(
      memberMergeNameScore('Gime2', 'Brasil'),
    );
    expect(memberMergeNameScore('Brasil', 'Brasil')).toBe(100);
  });

  it('ranks matching names first for Fusionar suggestions', () => {
    const ranked = rankMergeTargets('Gime 2', [
      { id: '1', displayName: 'Marian' },
      { id: '2', displayName: 'Gime' },
      { id: '3', displayName: 'Brasil' },
      { id: '4', displayName: 'Gime 3' },
    ]);
    expect(ranked.map((m) => m.displayName)).toEqual(['Gime', 'Gime 3', 'Brasil', 'Marian']);
  });
});
