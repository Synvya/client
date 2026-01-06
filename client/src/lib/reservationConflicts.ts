/**
 * Reservation Conflict Detection Utilities
 * 
 * Detects overlapping reservations and enforces maximum simultaneous reservations.
 */

import type { ReservationMessage } from "@/services/reservationService";
import type { ReservationRequest, ReservationResponse } from "@/types/reservation";

/**
 * Counts how many existing reservations overlap with the requested time.
 * 
 * @param requestTime - Requested reservation time as Unix timestamp in seconds
 * @param requestTzid - IANA timezone identifier for the requested time
 * @param requestDuration - Duration of the requested reservation in seconds (undefined uses default)
 * @param existingReservations - Array of existing reservation messages
 * @returns Number of overlapping reservations
 * 
 * @example
 * ```typescript
 * const count = countOverlappingReservations(
 *   1729458000,
 *   "America/Los_Angeles",
 *   5400, // 90 minutes
 *   existingReservations
 * );
 * ```
 */
export function countOverlappingReservations(
  requestTime: number,
  requestTzid: string,
  requestDuration: number | undefined,
  existingReservations: ReservationMessage[]
): number {
  if (!existingReservations || existingReservations.length === 0) {
    return 0;
  }

  // Use provided duration or default to 90 minutes (5400 seconds)
  const duration = requestDuration ?? 5400;
  const requestEndTime = requestTime + duration;

  let overlapCount = 0;

  for (const message of existingReservations) {
    // Only check confirmed reservations (responses with status "confirmed")
    if (message.type !== "response") {
      continue;
    }

    const response = message.payload as ReservationResponse;
    if (response.status !== "confirmed" || !response.time || !response.tzid) {
      continue;
    }

    // Get duration for existing reservation (default to 90 minutes)
    const existingDuration = response.duration ?? 5400;
    const existingEndTime = response.time + existingDuration;

    // Check if reservations overlap
    // Two reservations overlap if:
    // - Request starts before existing ends AND request ends after existing starts
    if (requestTime < existingEndTime && requestEndTime > response.time) {
      overlapCount++;
    }
  }

  return overlapCount;
}

/**
 * Checks if a reservation request conflicts with existing reservations.
 * 
 * A conflict exists if the number of overlapping reservations is greater than or equal to
 * the maximum allowed simultaneous reservations.
 * 
 * @param requestTime - Requested reservation time as Unix timestamp in seconds
 * @param requestTzid - IANA timezone identifier for the requested time
 * @param requestDuration - Duration of the requested reservation in seconds (undefined uses default)
 * @param existingReservations - Array of existing reservation messages
 * @param maxSimultaneous - Maximum number of simultaneous reservations allowed
 * @returns true if there is a conflict (too many overlapping reservations), false otherwise
 * 
 * @example
 * ```typescript
 * const hasConflict = hasConflictingReservation(
 *   1729458000,
 *   "America/Los_Angeles",
 *   5400, // 90 minutes
 *   existingReservations,
 *   2 // Max 2 simultaneous
 * );
 * ```
 */
export function hasConflictingReservation(
  requestTime: number,
  requestTzid: string,
  requestDuration: number | undefined,
  existingReservations: ReservationMessage[],
  maxSimultaneous: number
): boolean {
  const overlapCount = countOverlappingReservations(
    requestTime,
    requestTzid,
    requestDuration,
    existingReservations
  );

  // Conflict exists if we already have maxSimultaneous or more overlapping reservations
  // (allowing up to maxSimultaneous means rejecting when count >= maxSimultaneous)
  return overlapCount >= maxSimultaneous;
}

