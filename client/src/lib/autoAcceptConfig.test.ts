/**
 * Tests for Auto-Acceptance Configuration
 */

import { describe, it, expect } from "vitest";
import { DEFAULT_AUTO_ACCEPT_CONFIG, type AutoAcceptConfig } from "./autoAcceptConfig";

describe("autoAcceptConfig", () => {
  describe("DEFAULT_AUTO_ACCEPT_CONFIG", () => {
    it("has all required fields", () => {
      expect(DEFAULT_AUTO_ACCEPT_CONFIG.enabled).toBeDefined();
      expect(DEFAULT_AUTO_ACCEPT_CONFIG.checkBusinessHours).toBeDefined();
      expect(DEFAULT_AUTO_ACCEPT_CONFIG.checkConflicts).toBeDefined();
      expect(DEFAULT_AUTO_ACCEPT_CONFIG.minPartySize).toBeDefined();
      expect(DEFAULT_AUTO_ACCEPT_CONFIG.maxPartySize).toBeDefined();
      expect(DEFAULT_AUTO_ACCEPT_CONFIG.defaultDurationMinutes).toBeDefined();
      expect(DEFAULT_AUTO_ACCEPT_CONFIG.maxSimultaneousReservations).toBeDefined();
      expect(DEFAULT_AUTO_ACCEPT_CONFIG.conflictBufferMinutes).toBeDefined();
    });

    it("matches business rules: 90 minute duration", () => {
      expect(DEFAULT_AUTO_ACCEPT_CONFIG.defaultDurationMinutes).toBe(90);
    });

    it("matches business rules: max 8 party size", () => {
      expect(DEFAULT_AUTO_ACCEPT_CONFIG.maxPartySize).toBe(8);
    });

    it("matches business rules: max 2 simultaneous reservations", () => {
      expect(DEFAULT_AUTO_ACCEPT_CONFIG.maxSimultaneousReservations).toBe(2);
    });

    it("has enabled set to true by default", () => {
      expect(DEFAULT_AUTO_ACCEPT_CONFIG.enabled).toBe(true);
    });

    it("has checkBusinessHours enabled by default", () => {
      expect(DEFAULT_AUTO_ACCEPT_CONFIG.checkBusinessHours).toBe(true);
    });

    it("has checkConflicts enabled by default", () => {
      expect(DEFAULT_AUTO_ACCEPT_CONFIG.checkConflicts).toBe(true);
    });

    it("has minPartySize of 1", () => {
      expect(DEFAULT_AUTO_ACCEPT_CONFIG.minPartySize).toBe(1);
    });

    it("has conflictBufferMinutes of 15", () => {
      expect(DEFAULT_AUTO_ACCEPT_CONFIG.conflictBufferMinutes).toBe(15);
    });
  });

  describe("AutoAcceptConfig interface", () => {
    it("allows custom configuration", () => {
      const customConfig: AutoAcceptConfig = {
        enabled: false,
        checkBusinessHours: false,
        checkConflicts: false,
        minPartySize: 2,
        maxPartySize: 10,
        defaultDurationMinutes: 120,
        maxSimultaneousReservations: 3,
        conflictBufferMinutes: 30,
      };

      expect(customConfig.enabled).toBe(false);
      expect(customConfig.maxPartySize).toBe(10);
      expect(customConfig.defaultDurationMinutes).toBe(120);
    });
  });
});

