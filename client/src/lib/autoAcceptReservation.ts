/**
 * Auto-Acceptance Evaluation Logic
 * 
 * Evaluates reservation requests against all auto-acceptance rules to determine
 * if a reservation should be automatically accepted.
 */

import type { ReservationMessage } from "@/services/reservationService";
import type { ReservationRequest } from "@/types/reservation";
import type { BusinessProfile } from "@/types/profile";
import type { AutoAcceptConfig } from "./autoAcceptConfig";
import { isWithinBusinessHours } from "./businessHoursUtils";
import { hasConflictingReservation } from "./reservationConflicts";

/**
 * Result of auto-acceptance evaluation
 */
export interface AutoAcceptDecision {
  /** Whether the reservation should be automatically accepted */
  shouldAutoAccept: boolean;
  /** Optional reason for the decision (provided when shouldAutoAccept is false) */
  reason?: string;
}

/**
 * Evaluates a reservation request against all auto-acceptance rules.
 * 
 * Checks the following rules in order:
 * 1. Auto-acceptance enabled
 * 2. Party size limits
 * 3. Business hours (if enabled and profile available)
 * 4. Reservation conflicts (if enabled)
 * 
 * @param request - The reservation message (must be type "request")
 * @param config - Auto-acceptance configuration
 * @param existingReservations - Array of existing reservation messages
 * @param businessProfile - Business profile with opening hours (can be null)
 * @returns Decision object indicating whether to auto-accept and optional reason
 * 
 * @example
 * ```typescript
 * const decision = await shouldAutoAcceptReservation(
 *   reservationMessage,
 *   DEFAULT_AUTO_ACCEPT_CONFIG,
 *   existingReservations,
 *   businessProfile
 * );
 * 
 * if (decision.shouldAutoAccept) {
 *   // Auto-accept the reservation
 * } else {
 *   console.log(`Cannot auto-accept: ${decision.reason}`);
 * }
 * ```
 */
export async function shouldAutoAcceptReservation(
  request: ReservationMessage,
  config: AutoAcceptConfig,
  existingReservations: ReservationMessage[],
  businessProfile: BusinessProfile | null
): Promise<AutoAcceptDecision> {
  // Only process request type messages
  if (request.type !== "request") {
    return {
      shouldAutoAccept: false,
      reason: "Only reservation requests can be auto-accepted",
    };
  }

  const payload = request.payload as ReservationRequest;

  // 1. Check if auto-acceptance is enabled
  if (!config.enabled) {
    return {
      shouldAutoAccept: false,
      reason: "Auto-acceptance disabled",
    };
  }

  // 2. Check party size
  const partySize = payload.party_size;
  if (partySize < config.minPartySize || partySize > config.maxPartySize) {
    return {
      shouldAutoAccept: false,
      reason: "Party size out of range",
    };
  }

  // 3. Check business hours (if enabled)
  if (config.checkBusinessHours) {
    // Skip business hours check if profile is not available
    if (businessProfile && businessProfile.openingHours && businessProfile.openingHours.length > 0) {
      const isWithinHours = isWithinBusinessHours(
        payload.time,
        payload.tzid,
        businessProfile.openingHours
      );

      if (!isWithinHours) {
        return {
          shouldAutoAccept: false,
          reason: "Outside business hours",
        };
      }
    }
    // If profile is null or has no opening hours, skip the check (don't block auto-acceptance)
  }

  // 4. Check conflicts (if enabled)
  if (config.checkConflicts) {
    // Convert duration from minutes to seconds if provided, otherwise use default
    const durationSeconds = payload.duration ?? (config.defaultDurationMinutes * 60);

    const hasConflict = hasConflictingReservation(
      payload.time,
      payload.tzid,
      durationSeconds,
      existingReservations,
      config.maxSimultaneousReservations
    );

    if (hasConflict) {
      return {
        shouldAutoAccept: false,
        reason: "Too many simultaneous reservations",
      };
    }
  }

  // All checks passed
  return {
    shouldAutoAccept: true,
  };
}

