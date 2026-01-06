/**
 * Tests for Auto-Acceptance Evaluation Logic
 */

import { describe, it, expect } from "vitest";
import { shouldAutoAcceptReservation } from "./autoAcceptReservation";
import { DEFAULT_AUTO_ACCEPT_CONFIG, type AutoAcceptConfig } from "./autoAcceptConfig";
import type { ReservationMessage } from "@/services/reservationService";
import type { ReservationRequest } from "@/types/reservation";
import type { BusinessProfile } from "@/types/profile";
import type { Rumor } from "./nip59";
import type { Event } from "nostr-tools";

// Helper to create a mock reservation request message
function createMockRequestMessage(
  partySize: number,
  time: number,
  tzid: string,
  duration?: number
): ReservationMessage {
  const rumor: Rumor = {
    id: "rumor-id",
    kind: 9901,
    pubkey: "sender-pubkey",
    created_at: Math.floor(Date.now() / 1000),
    tags: [],
    content: "",
  };

  const payload: ReservationRequest = {
    party_size: partySize,
    time,
    tzid,
    ...(duration !== undefined && { duration }),
  };

  return {
    rumor,
    type: "request",
    payload,
    senderPubkey: "sender-pubkey",
    giftWrap: {} as Event,
  };
}

// Helper to create a mock business profile with opening hours
function createMockBusinessProfile(
  openingHours?: BusinessProfile["openingHours"]
): BusinessProfile {
  return {
    name: "Test Restaurant",
    displayName: "Test Restaurant",
    about: "A test restaurant",
    website: "https://test.com",
    nip05: "test@example.com",
    picture: "",
    banner: "",
    businessType: "restaurant",
    categories: [],
    ...(openingHours && { openingHours }),
  };
}

describe("shouldAutoAcceptReservation", () => {
  const baseTime = 1760994000; // Monday, October 20, 2025 at 2:00 PM PDT
  const tzid = "America/Los_Angeles";
  const existingReservations: ReservationMessage[] = [];

  describe("auto-acceptance enabled check", () => {
    it("returns false when auto-acceptance is disabled", async () => {
      const config: AutoAcceptConfig = {
        ...DEFAULT_AUTO_ACCEPT_CONFIG,
        enabled: false,
      };

      const request = createMockRequestMessage(4, baseTime, tzid);
      const decision = await shouldAutoAcceptReservation(
        request,
        config,
        existingReservations,
        null
      );

      expect(decision.shouldAutoAccept).toBe(false);
      expect(decision.reason).toBe("Auto-acceptance disabled");
    });

    it("returns true when auto-acceptance is enabled and all checks pass", async () => {
      const request = createMockRequestMessage(4, baseTime, tzid);
      const decision = await shouldAutoAcceptReservation(
        request,
        DEFAULT_AUTO_ACCEPT_CONFIG,
        existingReservations,
        null
      );

      expect(decision.shouldAutoAccept).toBe(true);
      expect(decision.reason).toBeUndefined();
    });
  });

  describe("party size checks", () => {
    it("returns false when party size is below minimum", async () => {
      const request = createMockRequestMessage(0, baseTime, tzid);
      const decision = await shouldAutoAcceptReservation(
        request,
        DEFAULT_AUTO_ACCEPT_CONFIG,
        existingReservations,
        null
      );

      expect(decision.shouldAutoAccept).toBe(false);
      expect(decision.reason).toBe("Party size out of range");
    });

    it("returns false when party size is above maximum", async () => {
      const request = createMockRequestMessage(9, baseTime, tzid);
      const decision = await shouldAutoAcceptReservation(
        request,
        DEFAULT_AUTO_ACCEPT_CONFIG,
        existingReservations,
        null
      );

      expect(decision.shouldAutoAccept).toBe(false);
      expect(decision.reason).toBe("Party size out of range");
    });

    it("returns true when party size is at minimum boundary", async () => {
      const request = createMockRequestMessage(1, baseTime, tzid);
      const decision = await shouldAutoAcceptReservation(
        request,
        DEFAULT_AUTO_ACCEPT_CONFIG,
        existingReservations,
        null
      );

      expect(decision.shouldAutoAccept).toBe(true);
    });

    it("returns true when party size is at maximum boundary", async () => {
      const request = createMockRequestMessage(8, baseTime, tzid);
      const decision = await shouldAutoAcceptReservation(
        request,
        DEFAULT_AUTO_ACCEPT_CONFIG,
        existingReservations,
        null
      );

      expect(decision.shouldAutoAccept).toBe(true);
    });
  });

  describe("business hours checks", () => {
    it("skips business hours check when checkBusinessHours is false", async () => {
      const config: AutoAcceptConfig = {
        ...DEFAULT_AUTO_ACCEPT_CONFIG,
        checkBusinessHours: false,
      };

      const profile = createMockBusinessProfile([
        { days: ["Mo", "Tu", "We", "Th", "Fr"], startTime: "11:00", endTime: "21:00" },
      ]);

      // Request at 10:00 AM (before opening) - should still pass because check is disabled
      const request = createMockRequestMessage(4, baseTime - 4 * 3600, tzid);
      const decision = await shouldAutoAcceptReservation(
        request,
        config,
        existingReservations,
        profile
      );

      expect(decision.shouldAutoAccept).toBe(true);
    });

    it("skips business hours check when profile is null", async () => {
      const request = createMockRequestMessage(4, baseTime, tzid);
      const decision = await shouldAutoAcceptReservation(
        request,
        DEFAULT_AUTO_ACCEPT_CONFIG,
        existingReservations,
        null
      );

      expect(decision.shouldAutoAccept).toBe(true);
    });

    it("skips business hours check when profile has no opening hours", async () => {
      const profile = createMockBusinessProfile();
      const request = createMockRequestMessage(4, baseTime, tzid);
      const decision = await shouldAutoAcceptReservation(
        request,
        DEFAULT_AUTO_ACCEPT_CONFIG,
        existingReservations,
        profile
      );

      expect(decision.shouldAutoAccept).toBe(true);
    });

    it("returns false when time is outside business hours", async () => {
      const profile = createMockBusinessProfile([
        { days: ["Mo", "Tu", "We", "Th", "Fr"], startTime: "11:00", endTime: "21:00" },
      ]);

      // Request at 10:00 AM (before opening)
      const request = createMockRequestMessage(4, baseTime - 4 * 3600, tzid);
      const decision = await shouldAutoAcceptReservation(
        request,
        DEFAULT_AUTO_ACCEPT_CONFIG,
        existingReservations,
        profile
      );

      expect(decision.shouldAutoAccept).toBe(false);
      expect(decision.reason).toBe("Outside business hours");
    });

    it("returns true when time is within business hours", async () => {
      const profile = createMockBusinessProfile([
        { days: ["Mo", "Tu", "We", "Th", "Fr"], startTime: "11:00", endTime: "21:00" },
      ]);

      // Request at 2:00 PM (within hours)
      const request = createMockRequestMessage(4, baseTime, tzid);
      const decision = await shouldAutoAcceptReservation(
        request,
        DEFAULT_AUTO_ACCEPT_CONFIG,
        existingReservations,
        profile
      );

      expect(decision.shouldAutoAccept).toBe(true);
    });
  });

  describe("conflict checks", () => {
    it("skips conflict check when checkConflicts is false", async () => {
      const config: AutoAcceptConfig = {
        ...DEFAULT_AUTO_ACCEPT_CONFIG,
        checkConflicts: false,
      };

      // Create existing reservations that would conflict
      const existing: ReservationMessage[] = [
        createMockRequestMessage(2, baseTime, tzid),
        createMockRequestMessage(3, baseTime, tzid),
      ];

      const request = createMockRequestMessage(4, baseTime, tzid);
      const decision = await shouldAutoAcceptReservation(
        request,
        config,
        existing,
        null
      );

      expect(decision.shouldAutoAccept).toBe(true);
    });

    it("uses default duration when request doesn't specify duration", async () => {
      // Create 2 existing confirmed reservations at the same time
      const existing: ReservationMessage[] = [
        {
          ...createMockRequestMessage(2, baseTime, tzid),
          type: "response",
          payload: {
            status: "confirmed",
            time: baseTime,
            tzid,
          } as any,
        },
        {
          ...createMockRequestMessage(3, baseTime, tzid),
          type: "response",
          payload: {
            status: "confirmed",
            time: baseTime,
            tzid,
          } as any,
        },
      ];

      // Request at same time without duration - should use default 90 minutes
      const request = createMockRequestMessage(4, baseTime, tzid);
      const decision = await shouldAutoAcceptReservation(
        request,
        DEFAULT_AUTO_ACCEPT_CONFIG,
        existing,
        null
      );

      expect(decision.shouldAutoAccept).toBe(false);
      expect(decision.reason).toBe("Too many simultaneous reservations");
    });

    it("uses request duration when provided", async () => {
      // Create 2 existing confirmed reservations
      const existing: ReservationMessage[] = [
        {
          ...createMockRequestMessage(2, baseTime, tzid),
          type: "response",
          payload: {
            status: "confirmed",
            time: baseTime,
            tzid,
          } as any,
        },
        {
          ...createMockRequestMessage(3, baseTime, tzid),
          type: "response",
          payload: {
            status: "confirmed",
            time: baseTime,
            tzid,
          } as any,
        },
      ];

      // Request at same time with custom duration
      const request = createMockRequestMessage(4, baseTime, tzid, 60 * 60); // 1 hour
      const decision = await shouldAutoAcceptReservation(
        request,
        DEFAULT_AUTO_ACCEPT_CONFIG,
        existing,
        null
      );

      expect(decision.shouldAutoAccept).toBe(false);
      expect(decision.reason).toBe("Too many simultaneous reservations");
    });

    it("returns false when max simultaneous reservations reached", async () => {
      // Create 2 existing confirmed reservations (max is 2)
      const existing: ReservationMessage[] = [
        {
          ...createMockRequestMessage(2, baseTime, tzid),
          type: "response",
          payload: {
            status: "confirmed",
            time: baseTime,
            tzid,
          } as any,
        },
        {
          ...createMockRequestMessage(3, baseTime, tzid),
          type: "response",
          payload: {
            status: "confirmed",
            time: baseTime,
            tzid,
          } as any,
        },
      ];

      const request = createMockRequestMessage(4, baseTime, tzid);
      const decision = await shouldAutoAcceptReservation(
        request,
        DEFAULT_AUTO_ACCEPT_CONFIG,
        existing,
        null
      );

      expect(decision.shouldAutoAccept).toBe(false);
      expect(decision.reason).toBe("Too many simultaneous reservations");
    });

    it("returns true when below max simultaneous reservations", async () => {
      // Create 1 existing confirmed reservation (max is 2, so we can accept 1 more)
      const existing: ReservationMessage[] = [
        {
          ...createMockRequestMessage(2, baseTime, tzid),
          type: "response",
          payload: {
            status: "confirmed",
            time: baseTime,
            tzid,
          } as any,
        },
      ];

      const request = createMockRequestMessage(4, baseTime, tzid);
      const decision = await shouldAutoAcceptReservation(
        request,
        DEFAULT_AUTO_ACCEPT_CONFIG,
        existing,
        null
      );

      expect(decision.shouldAutoAccept).toBe(true);
    });
  });

  describe("non-request messages", () => {
    it("returns false for response messages", async () => {
      const responseMessage: ReservationMessage = {
        ...createMockRequestMessage(4, baseTime, tzid),
        type: "response",
        payload: {
          status: "confirmed",
          time: baseTime,
          tzid,
        } as any,
      };

      const decision = await shouldAutoAcceptReservation(
        responseMessage,
        DEFAULT_AUTO_ACCEPT_CONFIG,
        existingReservations,
        null
      );

      expect(decision.shouldAutoAccept).toBe(false);
      expect(decision.reason).toBe("Only reservation requests can be auto-accepted");
    });
  });

  describe("all checks passing", () => {
    it("returns true when all rules pass", async () => {
      const profile = createMockBusinessProfile([
        { days: ["Mo", "Tu", "We", "Th", "Fr"], startTime: "11:00", endTime: "21:00" },
      ]);

      const request = createMockRequestMessage(4, baseTime, tzid);
      const decision = await shouldAutoAcceptReservation(
        request,
        DEFAULT_AUTO_ACCEPT_CONFIG,
        existingReservations,
        profile
      );

      expect(decision.shouldAutoAccept).toBe(true);
      expect(decision.reason).toBeUndefined();
    });
  });
});

