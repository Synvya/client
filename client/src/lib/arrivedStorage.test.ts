/**
 * Tests for Arrived Reservation Storage
 */

import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  markReservationArrived,
  isReservationArrived,
  getArrivedTimestamp,
  clearArrivedStatus,
} from "./arrivedStorage";

describe("arrivedStorage", () => {
  const testRootRumorId = "test-root-rumor-id-12345";

  beforeEach(async () => {
    // Clear any existing data before each test
    try {
      await clearArrivedStatus(testRootRumorId);
    } catch {
      // Ignore errors if record doesn't exist
    }
  });

  afterEach(async () => {
    // Clean up after each test
    try {
      await clearArrivedStatus(testRootRumorId);
    } catch {
      // Ignore errors if record doesn't exist
    }
  });

  describe("markReservationArrived", () => {
    it("marks a reservation as arrived", async () => {
      await markReservationArrived(testRootRumorId);
      const isArrived = await isReservationArrived(testRootRumorId);
      expect(isArrived).toBe(true);
    });

    it("stores timestamp when marking as arrived", async () => {
      const beforeTime = Math.floor(Date.now() / 1000);
      await markReservationArrived(testRootRumorId);
      const afterTime = Math.floor(Date.now() / 1000);
      
      const timestamp = await getArrivedTimestamp(testRootRumorId);
      expect(timestamp).not.toBeNull();
      expect(timestamp).toBeGreaterThanOrEqual(beforeTime);
      expect(timestamp).toBeLessThanOrEqual(afterTime);
    });

    it("can mark multiple reservations as arrived", async () => {
      const rootId1 = "root-id-1";
      const rootId2 = "root-id-2";

      await markReservationArrived(rootId1);
      await markReservationArrived(rootId2);

      expect(await isReservationArrived(rootId1)).toBe(true);
      expect(await isReservationArrived(rootId2)).toBe(true);

      // Clean up
      await clearArrivedStatus(rootId1);
      await clearArrivedStatus(rootId2);
    });
  });

  describe("isReservationArrived", () => {
    it("returns false for unmarked reservations", async () => {
      const isArrived = await isReservationArrived(testRootRumorId);
      expect(isArrived).toBe(false);
    });

    it("returns true after marking as arrived", async () => {
      await markReservationArrived(testRootRumorId);
      const isArrived = await isReservationArrived(testRootRumorId);
      expect(isArrived).toBe(true);
    });

    it("returns false for different root rumor IDs", async () => {
      await markReservationArrived(testRootRumorId);
      const isArrived = await isReservationArrived("different-root-id");
      expect(isArrived).toBe(false);
    });
  });

  describe("getArrivedTimestamp", () => {
    it("returns null for unmarked reservations", async () => {
      const timestamp = await getArrivedTimestamp(testRootRumorId);
      expect(timestamp).toBeNull();
    });

    it("returns timestamp after marking as arrived", async () => {
      const beforeTime = Math.floor(Date.now() / 1000);
      await markReservationArrived(testRootRumorId);
      const afterTime = Math.floor(Date.now() / 1000);

      const timestamp = await getArrivedTimestamp(testRootRumorId);
      expect(timestamp).not.toBeNull();
      expect(timestamp).toBeGreaterThanOrEqual(beforeTime);
      expect(timestamp).toBeLessThanOrEqual(afterTime);
    });
  });

  describe("clearArrivedStatus", () => {
    it("removes arrived status for a reservation", async () => {
      await markReservationArrived(testRootRumorId);
      expect(await isReservationArrived(testRootRumorId)).toBe(true);

      await clearArrivedStatus(testRootRumorId);
      expect(await isReservationArrived(testRootRumorId)).toBe(false);
    });

    it("does not throw when clearing non-existent reservation", async () => {
      await expect(clearArrivedStatus("non-existent-id")).resolves.not.toThrow();
    });
  });

  describe("persistence", () => {
    it("persists arrived status across multiple calls", async () => {
      await markReservationArrived(testRootRumorId);
      
      // Check multiple times
      expect(await isReservationArrived(testRootRumorId)).toBe(true);
      expect(await isReservationArrived(testRootRumorId)).toBe(true);
      expect(await isReservationArrived(testRootRumorId)).toBe(true);
    });

    it("maintains timestamp after multiple checks", async () => {
      await markReservationArrived(testRootRumorId);
      const firstTimestamp = await getArrivedTimestamp(testRootRumorId);
      
      // Wait a bit and check again
      await new Promise((resolve) => setTimeout(resolve, 10));
      const secondTimestamp = await getArrivedTimestamp(testRootRumorId);
      
      expect(firstTimestamp).toBe(secondTimestamp);
    });
  });
});

