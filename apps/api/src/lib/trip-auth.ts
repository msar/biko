import type { FastifyRequest } from 'fastify';
import { isTripGuestPayload } from '../plugins/auth.js';
import type { TripActor } from '../services/trip.js';

export function tripActorFromRequest(request: FastifyRequest): {
  actor: TripActor;
  isGuestSession: boolean;
  householdId: string | null;
  userId: string | null;
} {
  const user = request.user;
  if (isTripGuestPayload(user)) {
    return {
      actor: { tripMemberId: user.tripMemberId, guestTripId: user.tripId },
      isGuestSession: true,
      householdId: null,
      userId: null,
    };
  }
  return {
    actor: { userId: user.userId },
    isGuestSession: false,
    householdId: user.householdId || null,
    userId: user.userId,
  };
}
