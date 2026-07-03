// Domain enums shared by api and web. Defined here (instead of importing
// @prisma/client) so the web app can use the domain logic offline without
// depending on the generated Prisma client. Values must stay in sync with
// the enums in apps/api/prisma/schema.prisma.

export const PaymentMethodType = {
  DEBIT_CARD: 'DEBIT_CARD',
  CREDIT_CARD: 'CREDIT_CARD',
  WALLET: 'WALLET',
  CASH: 'CASH',
  BANK_TRANSFER: 'BANK_TRANSFER',
} as const;
export type PaymentMethodType = (typeof PaymentMethodType)[keyof typeof PaymentMethodType];

export const DayOfWeek = {
  MONDAY: 'MONDAY',
  TUESDAY: 'TUESDAY',
  WEDNESDAY: 'WEDNESDAY',
  THURSDAY: 'THURSDAY',
  FRIDAY: 'FRIDAY',
  SATURDAY: 'SATURDAY',
  SUNDAY: 'SUNDAY',
} as const;
export type DayOfWeek = (typeof DayOfWeek)[keyof typeof DayOfWeek];

export const CardNetwork = {
  VISA: 'VISA',
  MASTERCARD: 'MASTERCARD',
  AMEX: 'AMEX',
  CABAL: 'CABAL',
  NONE: 'NONE',
} as const;
export type CardNetwork = (typeof CardNetwork)[keyof typeof CardNetwork];

export const EntityKind = {
  BANK: 'BANK',
  WALLET: 'WALLET',
  OTHER: 'OTHER',
} as const;
export type EntityKind = (typeof EntityKind)[keyof typeof EntityKind];

/** JS Date.getDay() (0=Sunday) to domain DayOfWeek. */
export function dayOfWeekFromDate(date: Date): DayOfWeek {
  const map: DayOfWeek[] = [
    DayOfWeek.SUNDAY,
    DayOfWeek.MONDAY,
    DayOfWeek.TUESDAY,
    DayOfWeek.WEDNESDAY,
    DayOfWeek.THURSDAY,
    DayOfWeek.FRIDAY,
    DayOfWeek.SATURDAY,
  ];
  return map[date.getDay()]!;
}
