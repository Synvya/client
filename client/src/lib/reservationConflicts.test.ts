/**
 * Tests for Reservation Conflict Detection Utilities
 */

import { describe, it, expect } from "vitest";
import {
  countOverlappingReservations,
  hasConflictingReservation,
} from "./reservationConflicts";
import type { ReservationMessage } from "@/services/reservationService";
import type { ReservationRequest, ReservationResponse } from "@/types/reservation";
import type { Rumor } from "@/lib/nip59";
import type { Event } from "nostr-tools";

// Helper to create a mock reservation message
function createMockReservationMessage(
  type: "request" | "response",
  time: number,
  tzid: string,
  status: "confirmed" | "declined" | "cancelled" = "confirmed",
  duration?: number
): ReservationMessage {
  const rumor: Rumor = {
    id: `rumor-${time}`,
    kind: type === "request" ? 9901 : 9902,
    pubkey: "sender-pubkey",
    created_at: Math.floor(Date.now() / 1000),
    tags: [],
    content: "",
  };

  const payload: ReservationRequest | ReservationResponse =
    type === "request"
      ? ({
          party_size: 2,
          time,
          tzid,
          ...(duration !== undefined && { duration }),
        } as ReservationRequest)
      : ({
          status,
          time: status === "confirmed" ? time : null,
          tzid: status === "confirmed" ? tzid : undefined,
          ...(duration !== undefined && { duration }),
        } as ReservationResponse);

  return {
    rumor,
    type: type === "request" ? "request" : "response",
    payload,
    senderPubkey: "sender-pubkey",
    giftWrap: {} as Event,
  };
}

describe("reservationConflicts", () => {
  const baseTime = 1729458000; // Monday, October 20, 2025 at 2:00 PM
  const tzid = "America/Los_Angeles";
  const defaultDuration = 5400; // 90 minutes in seconds

  describe("countOverlappingReservations", () => {
    it("returns 0 when no reservations exist", () => {
      const count = countOverlappingReservations(
        baseTime,
        tzid,
        undefined,
        []
      );
      expect(count).toBe(0);
    });

    it("returns 0 when no confirmed reservations exist", () => {
      const messages: ReservationMessage[] = [
        createMockReservationMessage("response", baseTime, tzid, "declined"),
        createMockReservationMessage("response", baseTime, tzid, "cancelled"),
        createMockReservationMessage("request", baseTime, tzid), // Requests don't count
      ];

      const count = countOverlappingReservations(
        baseTime,
        tzid,
        undefined,
        messages
      );
      expect(count).toBe(0);
    });

    it("returns 1 when one confirmed reservation overlaps", () => {
      const messages: ReservationMessage[] = [
        createMockReservationMessage("response", baseTime, tzid, "confirmed"),
      ];

      const count = countOverlappingReservations(
        baseTime,
        tzid,
        undefined,
        messages
      );
      expect(count).toBe(1);
    });

    it("counts overlapping reservations correctly", () => {
      // Create two confirmed reservations that overlap with the request time
      const messages: ReservationMessage[] = [
        createMockReservationMessage("response", baseTime, tzid, "confirmed"),
        createMockReservationMessage(
          "response",
          baseTime + 1800,
          tzid,
          "confirmed"
        ), // 30 minutes later, still overlaps
      ];

      const count = countOverlappingReservations(
        baseTime,
        tzid,
        undefined,
        messages
      );
      expect(count).toBe(2);
    });

    it("does not count non-overlapping reservations", () => {
      const messages: ReservationMessage[] = [
        createMockReservationMessage(
          "response",
          baseTime - 7200,
          tzid,
          "confirmed"
        ), // 2 hours before (no overlap)
        createMockReservationMessage(
          "response",
          baseTime + 7200,
          tzid,
          "confirmed"
        ), // 2 hours after (no overlap)
      ];

      const count = countOverlappingReservations(
        baseTime,
        tzid,
        undefined,
        messages
      );
      expect(count).toBe(0);
    });

    it("uses default duration (90 minutes) when not specified", () => {
      const messages: ReservationMessage[] = [
        createMockReservationMessage("response", baseTime, tzid, "confirmed"),
      ];

      // Request at baseTime with no duration should use 90 min default
      // Existing reservation at baseTime with 90 min duration should overlap
      const count = countOverlappingReservations(
        baseTime,
        tzid,
        undefined, // No duration specified
        messages
      );
      expect(count).toBe(1);
    });

    it("uses provided duration when specified", () => {
      const messages: ReservationMessage[] = [
        createMockReservationMessage(
          "response",
          baseTime + 3600,
          tzid,
          "confirmed"
        ), // 1 hour later
      ];

      // Request with 2 hour duration should overlap with reservation 1 hour later
      const count = countOverlappingReservations(
        baseTime,
        tzid,
        7200, // 2 hours
        messages
      );
      expect(count).toBe(1);
    });

    it("handles reservations that end exactly when request starts (no overlap)", () => {
      const messages: ReservationMessage[] = [
        createMockReservationMessage(
          "response",
          baseTime - defaultDuration,
          tzid,
          "confirmed"
        ), // Ends exactly when request starts
      ];

      const count = countOverlappingReservations(
        baseTime,
        tzid,
        undefined,
        messages
      );
      expect(count).toBe(0);
    });

    it("handles reservations that start exactly when request ends (no overlap)", () => {
      const messages: ReservationMessage[] = [
        createMockReservationMessage(
          "response",
          baseTime + defaultDuration,
          tzid,
          "confirmed"
        ), // Starts exactly when request ends
      ];

      const count = countOverlappingReservations(
        baseTime,
        tzid,
        undefined,
        messages
      );
      expect(count).toBe(0);
    });

    it("counts reservations with different durations correctly", () => {
      const messages: ReservationMessage[] = [
        createMockReservationMessage(
          "response",
          baseTime,
          tzid,
          "confirmed",
          3600
        ), // 1 hour duration
        createMockReservationMessage(
          "response",
          baseTime + 1800,
          tzid,
          "confirmed",
          7200
        ), // 2 hour duration, starts 30 min later
      ];

      // Request at baseTime with 90 min duration should overlap with both
      const count = countOverlappingReservations(
        baseTime,
        tzid,
        undefined,
        messages
      );
      expect(count).toBe(2);
    });
  });

  describe("hasConflictingReservation", () => {
    it("returns false when no reservations exist", () => {
      const hasConflict = hasConflictingReservation(
        baseTime,
        tzid,
        undefined,
        [],
        2
      );
      expect(hasConflict).toBe(false);
    });

    it("returns false when count is less than maxSimultaneous", () => {
      const messages: ReservationMessage[] = [
        createMockReservationMessage("response", baseTime, tzid, "confirmed"),
      ];

      const hasConflict = hasConflictingReservation(
        baseTime,
        tzid,
        undefined,
        messages,
        2 // Max 2 simultaneous
      );
      expect(hasConflict).toBe(false);
    });

    it("returns false when count equals maxSimultaneous - 1", () => {
      const messages: ReservationMessage[] = [
        createMockReservationMessage("response", baseTime, tzid, "confirmed"),
      ];

      const hasConflict = hasConflictingReservation(
        baseTime,
        tzid,
        undefined,
        messages,
        2 // Max 2 simultaneous, we have 1
      );
      expect(hasConflict).toBe(false);
    });

    it("returns true when count equals maxSimultaneous", () => {
      const messages: ReservationMessage[] = [
        createMockReservationMessage("response", baseTime, tzid, "confirmed"),
        createMockReservationMessage(
          "response",
          baseTime + 1800,
          tzid,
          "confirmed"
        ),
      ];

      const hasConflict = hasConflictingReservation(
        baseTime,
        tzid,
        undefined,
        messages,
        2 // Max 2 simultaneous, we have 2
      );
      expect(hasConflict).toBe(true);
    });

    it("returns true when count exceeds maxSimultaneous", () => {
      const messages: ReservationMessage[] = [
        createMockReservationMessage("response", baseTime, tzid, "confirmed"),
        createMockReservationMessage(
          "response",
          baseTime + 1800,
          tzid,
          "confirmed"
        ),
        createMockReservationMessage(
          "response",
          baseTime + 3600,
          tzid,
          "confirmed"
        ),
      ];

      const hasConflict = hasConflictingReservation(
        baseTime,
        tzid,
        undefined,
        messages,
        2 // Max 2 simultaneous, we have 3
      );
      expect(hasConflict).toBe(true);
    });

    it("handles maxSimultaneous of 1 correctly", () => {
      const messages: ReservationMessage[] = [
        createMockReservationMessage("response", baseTime, tzid, "confirmed"),
      ];

      const hasConflict = hasConflictingReservation(
        baseTime,
        tzid,
        undefined,
        messages,
        1 // Max 1 simultaneous, we have 1
      );
      expect(hasConflict).toBe(true);
    });

    it("handles maxSimultaneous of 0 correctly", () => {
      const hasConflict = hasConflictingReservation(
        baseTime,
        tzid,
        undefined,
        [],
        0 // Max 0 simultaneous
      );
      expect(hasConflict).toBe(false); // No reservations, so no conflict
    });
  });
});

