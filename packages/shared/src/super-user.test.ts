import { describe, expect, it } from 'vitest';
import { isSuperUser, SUPER_USER_EMAIL } from './super-user';

describe('isSuperUser', () => {
  it('returns true for the configured super user email', () => {
    expect(isSuperUser(SUPER_USER_EMAIL)).toBe(true);
    expect(isSuperUser('  Marianojosesappia@gmail.com  ')).toBe(true);
  });

  it('returns false for other emails', () => {
    expect(isSuperUser('other@example.com')).toBe(false);
  });
});
