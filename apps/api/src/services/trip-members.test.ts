import { describe, expect, it, vi } from 'vitest';
import {
  findClaimableMemberByDisplayName,
  getTripInvitePreview,
  joinTripByCode,
  memberDisplayNamesMatch,
  mergeTripMember,
} from './trip.js';

describe('memberDisplayNamesMatch', () => {
  it('matches case and diacritics insensitive', () => {
    expect(memberDisplayNamesMatch('Gime', 'gime')).toBe(true);
    expect(memberDisplayNamesMatch('José', 'jose')).toBe(true);
    expect(memberDisplayNamesMatch('  Brasil  ', 'brasil')).toBe(true);
  });

  it('does not match distinct names', () => {
    expect(memberDisplayNamesMatch('Gime', 'Gime 2')).toBe(false);
    expect(memberDisplayNamesMatch('Brasil', 'Brasilero')).toBe(false);
  });
});

describe('findClaimableMemberByDisplayName', () => {
  it('finds orphan seat by display name', () => {
    const members = [
      { id: '1', displayName: 'Gime' },
      { id: '2', displayName: 'Brasil' },
    ];
    expect(findClaimableMemberByDisplayName(members, 'gimé')?.id).toBe('1');
    expect(findClaimableMemberByDisplayName(members, 'Gime 2')).toBeUndefined();
  });
});

function inviteFixture(tripId = 'trip-1') {
  const trip = {
    id: tripId,
    name: 'Patagonia',
    shareSlug: 'patagonia-2026',
    destination: null,
    destinationTimezone: 'America/Argentina/Buenos_Aires',
    status: 'ACTIVE' as const,
    startDate: null,
    endDate: null,
  };
  return {
    code: 'invite-code',
    expiresAt: null,
    tripId,
    trip,
    createdAt: new Date(),
  };
}

describe('getTripInvitePreview reclaimable seats', () => {
  it('lists JOINED orphans alongside PENDING', async () => {
    const invite = inviteFixture();
    const joinedOrphan = {
      id: 'm-joined',
      tripId: invite.tripId,
      userId: null,
      displayName: 'Gime',
      role: 'MEMBER' as const,
      inviteStatus: 'JOINED' as const,
      tripHouseholdId: null,
      createdAt: new Date(),
    };
    const pending = {
      id: 'm-pending',
      tripId: invite.tripId,
      userId: null,
      displayName: 'Ayla',
      role: 'MEMBER' as const,
      inviteStatus: 'PENDING' as const,
      tripHouseholdId: null,
      createdAt: new Date(),
    };

    const db = {
      tripInvite: {
        findUnique: vi.fn().mockResolvedValue(invite),
      },
      tripMember: {
        findMany: vi.fn().mockResolvedValue([joinedOrphan, pending]),
      },
    };

    const preview = await getTripInvitePreview(db as never, invite.code);
    expect(preview.unclaimedMembers.map((m) => m.id).sort()).toEqual(['m-joined', 'm-pending']);
    expect(db.tripMember.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tripId: invite.tripId,
          userId: null,
          inviteStatus: { in: ['PENDING', 'JOINED'] },
        }),
      }),
    );
  });
});

describe('joinTripByCode reclaim', () => {
  it('reclaims JOINED orphan by claimMemberId', async () => {
    const invite = inviteFixture();
    const slot = {
      id: 'm-orphan',
      tripId: invite.tripId,
      userId: null,
      displayName: 'Gime',
      role: 'MEMBER' as const,
      inviteStatus: 'JOINED' as const,
    };
    const updated = { ...slot, inviteStatus: 'JOINED' as const, trip: invite.trip };

    const db = {
      tripInvite: { findUnique: vi.fn().mockResolvedValue(invite) },
      tripMember: {
        findFirst: vi.fn().mockResolvedValue(slot),
        update: vi.fn().mockResolvedValue(updated),
        findMany: vi.fn(),
        create: vi.fn(),
      },
    };

    const result = await joinTripByCode(db as never, null, '', invite.code, {
      claimMemberId: slot.id,
    });
    expect(result.id).toBe(slot.id);
    expect(db.tripMember.create).not.toHaveBeenCalled();
    expect(db.tripMember.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: slot.id },
        data: expect.objectContaining({ inviteStatus: 'JOINED', userId: null }),
      }),
    );
  });

  it('name-only join matching an orphan reclaims instead of creating', async () => {
    const invite = inviteFixture();
    const orphan = {
      id: 'm-orphan',
      tripId: invite.tripId,
      userId: null,
      displayName: 'Brasil',
      role: 'MEMBER' as const,
      inviteStatus: 'JOINED' as const,
    };
    const updated = { ...orphan, trip: invite.trip };

    const db = {
      tripInvite: { findUnique: vi.fn().mockResolvedValue(invite) },
      tripMember: {
        findFirst: vi.fn(),
        findMany: vi.fn().mockResolvedValue([orphan]),
        update: vi.fn().mockResolvedValue(updated),
        create: vi.fn(),
      },
    };

    const result = await joinTripByCode(db as never, null, '', invite.code, {
      displayName: 'brasil',
    });
    expect(result.id).toBe(orphan.id);
    expect(db.tripMember.create).not.toHaveBeenCalled();
    expect(db.tripMember.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: orphan.id } }),
    );
  });

  it('creates a new member when no name match exists', async () => {
    const invite = inviteFixture();
    const created = {
      id: 'm-new',
      tripId: invite.tripId,
      userId: null,
      displayName: 'Nuevo',
      role: 'MEMBER' as const,
      inviteStatus: 'JOINED' as const,
      trip: invite.trip,
    };

    const db = {
      tripInvite: { findUnique: vi.fn().mockResolvedValue(invite) },
      tripMember: {
        findFirst: vi.fn(),
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'm-other',
            displayName: 'Gime',
            userId: null,
            inviteStatus: 'JOINED',
          },
        ]),
        update: vi.fn(),
        create: vi.fn().mockResolvedValue(created),
      },
    };

    const result = await joinTripByCode(db as never, null, '', invite.code, {
      displayName: 'Nuevo',
    });
    expect(result.id).toBe('m-new');
    expect(db.tripMember.create).toHaveBeenCalled();
    expect(db.tripMember.update).not.toHaveBeenCalled();
  });
});

describe('mergeTripMember financial reassignment', () => {
  it('coalesces allocations/payments onto keep member and deletes source', async () => {
    const tripId = 'trip-1';
    const actorUserId = 'user-org';
    const sourceId = 'm-dup';
    const intoId = 'm-keep';

    const actor = {
      id: 'm-org',
      tripId,
      userId: actorUserId,
      role: 'ORGANIZER' as const,
      inviteStatus: 'JOINED' as const,
      trip: { id: tripId, status: 'ACTIVE' },
    };
    const source = {
      id: sourceId,
      tripId,
      userId: null,
      role: 'MEMBER' as const,
      displayName: 'Gime 2',
    };
    const target = {
      id: intoId,
      tripId,
      userId: null,
      role: 'MEMBER' as const,
      displayName: 'Gime',
      inviteStatus: 'JOINED',
      tripHouseholdId: null,
      createdAt: new Date(),
    };

    const sourcePayments = [
      { id: 'pay-1', tripExpenseId: 'exp-1', tripMemberId: sourceId, amount: 10 },
    ];
    const sourceAllocs = [
      { id: 'alloc-1', tripExpenseId: 'exp-1', tripMemberId: sourceId, amount: 20 },
      { id: 'alloc-2', tripExpenseId: 'exp-2', tripMemberId: sourceId, amount: 30 },
    ];

    const tx = {
      tripExpense: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
      tripExpensePayment: {
        findMany: vi.fn().mockResolvedValue(sourcePayments),
        findFirst: vi.fn().mockResolvedValue({
          id: 'pay-keep',
          tripExpenseId: 'exp-1',
          tripMemberId: intoId,
          amount: 5,
        }),
        update: vi.fn().mockResolvedValue({}),
        delete: vi.fn().mockResolvedValue({}),
      },
      tripExpenseAllocation: {
        findMany: vi.fn().mockResolvedValue(sourceAllocs),
        findFirst: vi
          .fn()
          .mockResolvedValueOnce({
            id: 'alloc-keep',
            tripExpenseId: 'exp-1',
            tripMemberId: intoId,
            amount: 40,
          })
          .mockResolvedValueOnce(null),
        update: vi.fn().mockResolvedValue({}),
        delete: vi.fn().mockResolvedValue({}),
      },
      tripSettlement: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      tripItineraryItem: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
      tripListItemAssignee: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      tripMember: { delete: vi.fn().mockResolvedValue({}) },
    };

    const db = {
      tripMember: {
        findFirst: vi
          .fn()
          .mockResolvedValueOnce({ ...actor, include: undefined })
          .mockResolvedValueOnce(source)
          .mockResolvedValueOnce(target),
        findFirstOrThrow: vi.fn().mockResolvedValue(target),
      },
      trip: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({ id: tripId, status: 'ACTIVE' }),
      },
      $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<void>) => fn(tx)),
    };

    // requireTripMember looks up by userId first
    db.tripMember.findFirst = vi
      .fn()
      .mockResolvedValueOnce({ ...actor }) // requireTripOrganizer
      .mockResolvedValueOnce(source)
      .mockResolvedValueOnce(target);

    const result = await mergeTripMember(db as never, tripId, actorUserId, sourceId, intoId);

    expect(result.id).toBe(intoId);
    expect(tx.tripExpensePayment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'pay-keep' },
        data: { amount: 15 },
      }),
    );
    expect(tx.tripExpensePayment.delete).toHaveBeenCalledWith({ where: { id: 'pay-1' } });
    expect(tx.tripExpenseAllocation.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'alloc-keep' },
        data: { amount: 60 },
      }),
    );
    expect(tx.tripExpenseAllocation.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'alloc-2' },
        data: { tripMemberId: intoId },
      }),
    );
    expect(tx.tripMember.delete).toHaveBeenCalledWith({ where: { id: sourceId } });
  });
});
