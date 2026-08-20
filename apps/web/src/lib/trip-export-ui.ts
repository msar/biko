import type { TripExportPreview } from './trip-types';

export type TripExportCategoryMix = TripExportPreview['categoryMix'][number];
export type TripExportMember = NonNullable<TripExportPreview['members']>[number];

export interface TripExportMemberTotals {
  userId: string;
  name: string;
  paid: number;
  share: number;
}

/** Prefer plan.members (scaled to netShare); fall back to summing category rows. */
export function aggregateExportMemberTotals(
  categoryMix: TripExportCategoryMix[],
  members?: TripExportMember[] | null,
): TripExportMemberTotals[] {
  if (members && members.length > 0) {
    return [...members].sort((a, b) => a.name.localeCompare(b.name, 'es'));
  }
  const byUser = new Map<string, TripExportMemberTotals>();
  for (const category of categoryMix) {
    for (const member of category.members) {
      const prev = byUser.get(member.userId);
      if (prev) {
        prev.paid += member.paid;
        prev.share += member.share;
      } else {
        byUser.set(member.userId, {
          userId: member.userId,
          name: member.name,
          paid: member.paid,
          share: member.share,
        });
      }
    }
  }
  return [...byUser.values()].sort((a, b) => a.name.localeCompare(b.name, 'es'));
}

export function isTripExportDescription(description: string | null | undefined): boolean {
  return Boolean(description?.startsWith('Pasar a Biko'));
}
