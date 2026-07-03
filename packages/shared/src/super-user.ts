export const SUPER_USER_EMAIL = 'marianojosesappia@gmail.com';

export function isSuperUser(email: string): boolean {
  return email.trim().toLowerCase() === SUPER_USER_EMAIL.toLowerCase();
}
