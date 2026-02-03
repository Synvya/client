/**
 * Tests for Business Profile Loading Utilities
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { loadBusinessProfile, clearProfileCache } from "./loadBusinessProfile";
import { getPool } from "./relayPool";
import type { Event } from "nostr-tools";
import type { BusinessProfile } from "@/types/profile";

// Mock the relay pool
vi.mock("./relayPool", () => ({
  getPool: vi.fn(),
}));

describe("loadBusinessProfile", () => {
  const mockPubkey = "abc123def456";
  const mockRelays = ["wss://relay.example.com"];

  beforeEach(() => {
    clearProfileCache();
    vi.clearAllMocks();
  });

  it("returns null when pubkey is empty", async () => {
    const result = await loadBusinessProfile("", mockRelays);
    expect(result).toBeNull();
  });

  it("returns null when relays array is empty", async () => {
    const result = await loadBusinessProfile(mockPubkey, []);
    expect(result).toBeNull();
  });

  it("returns null when no profile event is found", async () => {
    const mockPool = {
      get: vi.fn().mockResolvedValue(null),
    };
    vi.mocked(getPool).mockReturnValue(mockPool as any);

    const result = await loadBusinessProfile(mockPubkey, mockRelays);
    expect(result).toBeNull();
    expect(mockPool.get).toHaveBeenCalledWith(mockRelays, {
      kinds: [0],
      authors: [mockPubkey],
    });
  });

  it("parses profile with opening hours from new format tag", async () => {
    const mockEvent: Event = {
      id: "event-id",
      kind: 0,
      pubkey: mockPubkey,
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ["openingHours", "Mo-Fr 11:00-21:00, Sa-Su 10:00-20:00"],
      ],
      content: JSON.stringify({
        name: "test-restaurant",
        display_name: "Test Restaurant",
        about: "A test restaurant",
        website: "https://test.com",
        nip05: "test@example.com",
        picture: "https://example.com/pic.jpg",
        banner: "https://example.com/banner.jpg",
      }),
      sig: "sig",
    };

    const mockPool = {
      get: vi.fn().mockResolvedValue(mockEvent),
    };
    vi.mocked(getPool).mockReturnValue(mockPool as any);

    const result = await loadBusinessProfile(mockPubkey, mockRelays);

    expect(result).not.toBeNull();
    expect(result?.openingHours).toBeDefined();
    expect(result?.openingHours?.length).toBe(2);
    expect(result?.openingHours?.[0].days).toEqual(["Mo", "Tu", "We", "Th", "Fr"]);
    expect(result?.openingHours?.[0].startTime).toBe("11:00");
    expect(result?.openingHours?.[0].endTime).toBe("21:00");
    expect(result?.openingHours?.[1].days).toEqual(["Sa", "Su"]);
    expect(result?.openingHours?.[1].startTime).toBe("10:00");
    expect(result?.openingHours?.[1].endTime).toBe("20:00");
  });

  it("parses profile with opening hours from old format tag", async () => {
    const mockEvent: Event = {
      id: "event-id",
      kind: 0,
      pubkey: mockPubkey,
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ["schema.org:FoodEstablishment:openingHours", "Mo-Fr 11:00-21:00"],
      ],
      content: JSON.stringify({
        name: "test-restaurant",
        display_name: "Test Restaurant",
        about: "A test restaurant",
        website: "https://test.com",
        nip05: "test@example.com",
        picture: "https://example.com/pic.jpg",
        banner: "https://example.com/banner.jpg",
      }),
      sig: "sig",
    };

    const mockPool = {
      get: vi.fn().mockResolvedValue(mockEvent),
    };
    vi.mocked(getPool).mockReturnValue(mockPool as any);

    const result = await loadBusinessProfile(mockPubkey, mockRelays);

    expect(result).not.toBeNull();
    expect(result?.openingHours).toBeDefined();
    expect(result?.openingHours?.length).toBe(1);
  });

  it("parses profile without opening hours", async () => {
    const mockEvent: Event = {
      id: "event-id",
      kind: 0,
      pubkey: mockPubkey,
      created_at: Math.floor(Date.now() / 1000),
      tags: [],
      content: JSON.stringify({
        name: "test-restaurant",
        display_name: "Test Restaurant",
        about: "A test restaurant",
        website: "https://test.com",
        nip05: "test@example.com",
        picture: "https://example.com/pic.jpg",
        banner: "https://example.com/banner.jpg",
      }),
      sig: "sig",
    };

    const mockPool = {
      get: vi.fn().mockResolvedValue(mockEvent),
    };
    vi.mocked(getPool).mockReturnValue(mockPool as any);

    const result = await loadBusinessProfile(mockPubkey, mockRelays);

    expect(result).not.toBeNull();
    expect(result?.openingHours).toBeUndefined();
  });

  it("filters out production, diet, foodEstablishment, and servesCuisine tags from categories", async () => {
    const mockEvent: Event = {
      id: "event-id",
      kind: 0,
      pubkey: mockPubkey,
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ["t", "production"],
        ["t", "VegetarianDiet"],
        ["t", "foodEstablishment:Restaurant"],
        ["t", "servesCuisine:Italian"],
        ["t", "pizza"],
        ["t", "italian"],
      ],
      content: JSON.stringify({
        name: "test-restaurant",
        display_name: "Test Restaurant",
        about: "A test restaurant",
        website: "https://test.com",
        nip05: "test@example.com",
        picture: "https://example.com/pic.jpg",
        banner: "https://example.com/banner.jpg",
      }),
      sig: "sig",
    };

    const mockPool = {
      get: vi.fn().mockResolvedValue(mockEvent),
    };
    vi.mocked(getPool).mockReturnValue(mockPool as any);

    const result = await loadBusinessProfile(mockPubkey, mockRelays);

    expect(result).not.toBeNull();
    expect(result?.categories).toEqual(["pizza", "italian"]);
  });

  it("caches profile results", async () => {
    const mockEvent: Event = {
      id: "event-id",
      kind: 0,
      pubkey: mockPubkey,
      created_at: Math.floor(Date.now() / 1000),
      tags: [],
      content: JSON.stringify({
        name: "test-restaurant",
        display_name: "Test Restaurant",
        about: "A test restaurant",
        website: "https://test.com",
        nip05: "test@example.com",
        picture: "https://example.com/pic.jpg",
        banner: "https://example.com/banner.jpg",
      }),
      sig: "sig",
    };

    const mockPool = {
      get: vi.fn().mockResolvedValue(mockEvent),
    };
    vi.mocked(getPool).mockReturnValue(mockPool as any);

    // First call
    const result1 = await loadBusinessProfile(mockPubkey, mockRelays);
    expect(mockPool.get).toHaveBeenCalledTimes(1);

    // Second call should use cache
    const result2 = await loadBusinessProfile(mockPubkey, mockRelays);
    expect(mockPool.get).toHaveBeenCalledTimes(1); // Still 1, not 2

    expect(result1).toEqual(result2);
  });

  it("handles parsing errors gracefully", async () => {
    const mockEvent: Event = {
      id: "event-id",
      kind: 0,
      pubkey: mockPubkey,
      created_at: Math.floor(Date.now() / 1000),
      tags: [],
      content: "invalid json{{{", // Invalid JSON
      sig: "sig",
    };

    const mockPool = {
      get: vi.fn().mockResolvedValue(mockEvent),
    };
    vi.mocked(getPool).mockReturnValue(mockPool as any);

    const result = await loadBusinessProfile(mockPubkey, mockRelays);
    expect(result).toBeNull();
  });

  it("handles relay query errors gracefully", async () => {
    const mockPool = {
      get: vi.fn().mockRejectedValue(new Error("Relay error")),
    };
    vi.mocked(getPool).mockReturnValue(mockPool as any);

    const result = await loadBusinessProfile(mockPubkey, mockRelays);
    expect(result).toBeNull();
  });

  it("parses single day opening hours", async () => {
    const mockEvent: Event = {
      id: "event-id",
      kind: 0,
      pubkey: mockPubkey,
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ["openingHours", "Mo 09:00-17:00"],
      ],
      content: JSON.stringify({
        name: "test-restaurant",
        display_name: "Test Restaurant",
        about: "A test restaurant",
        website: "https://test.com",
        nip05: "test@example.com",
        picture: "https://example.com/pic.jpg",
        banner: "https://example.com/banner.jpg",
      }),
      sig: "sig",
    };

    const mockPool = {
      get: vi.fn().mockResolvedValue(mockEvent),
    };
    vi.mocked(getPool).mockReturnValue(mockPool as any);

    const result = await loadBusinessProfile(mockPubkey, mockRelays);

    expect(result).not.toBeNull();
    expect(result?.openingHours?.length).toBe(1);
    expect(result?.openingHours?.[0].days).toEqual(["Mo"]);
  });

  it("parses opening hours with multiple segments for the same day (split format)", async () => {
    const mockEvent: Event = {
      id: "event-id",
      kind: 0,
      pubkey: mockPubkey,
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ["openingHours", "Mo 09:00-11:00, Mo 13:00-17:00"],
      ],
      content: JSON.stringify({
        name: "test-restaurant",
        display_name: "Test Restaurant",
        about: "A test restaurant",
        website: "https://test.com",
        nip05: "test@example.com",
        picture: "https://example.com/pic.jpg",
        banner: "https://example.com/banner.jpg",
      }),
      sig: "sig",
    };

    const mockPool = {
      get: vi.fn().mockResolvedValue(mockEvent),
    };
    vi.mocked(getPool).mockReturnValue(mockPool as any);

    const result = await loadBusinessProfile(mockPubkey, mockRelays);

    expect(result).not.toBeNull();
    expect(result?.openingHours).toBeDefined();
    expect(result?.openingHours?.length).toBe(2);
    expect(result?.openingHours?.[0].days).toEqual(["Mo"]);
    expect(result?.openingHours?.[0].startTime).toBe("09:00");
    expect(result?.openingHours?.[0].endTime).toBe("11:00");
    expect(result?.openingHours?.[1].days).toEqual(["Mo"]);
    expect(result?.openingHours?.[1].startTime).toBe("13:00");
    expect(result?.openingHours?.[1].endTime).toBe("17:00");
  });
});

describe("clearProfileCache", () => {
  beforeEach(() => {
    clearProfileCache(); // Clear cache before each test
  });

  it("clears cache for specific pubkey", async () => {
    const mockEvent: Event = {
      id: "event-id",
      kind: 0,
      pubkey: "pubkey1",
      created_at: Math.floor(Date.now() / 1000),
      tags: [],
      content: JSON.stringify({
        name: "test",
        display_name: "Test",
        about: "Test",
        website: "https://test.com",
        nip05: "test@example.com",
        picture: "",
        banner: "",
      }),
      sig: "sig",
    };

    const mockGet = vi.fn().mockResolvedValue(mockEvent);
    const mockPool = {
      get: mockGet,
    };
    vi.mocked(getPool).mockReturnValue(mockPool as any);

    // Load and cache
    await loadBusinessProfile("pubkey1", ["wss://relay.example.com"]);
    expect(mockGet).toHaveBeenCalledTimes(1);

    // Clear cache for this pubkey
    clearProfileCache("pubkey1");

    // Load again - should query again
    await loadBusinessProfile("pubkey1", ["wss://relay.example.com"]);
    expect(mockGet).toHaveBeenCalledTimes(2);
  });

  it("clears all cache when no pubkey provided", async () => {
    const mockEvent: Event = {
      id: "event-id",
      kind: 0,
      pubkey: "pubkey1",
      created_at: Math.floor(Date.now() / 1000),
      tags: [],
      content: JSON.stringify({
        name: "test",
        display_name: "Test",
        about: "Test",
        website: "https://test.com",
        nip05: "test@example.com",
        picture: "",
        banner: "",
      }),
      sig: "sig",
    };

    const mockGet = vi.fn().mockResolvedValue(mockEvent);
    const mockPool = {
      get: mockGet,
    };
    vi.mocked(getPool).mockReturnValue(mockPool as any);

    // Load and cache
    await loadBusinessProfile("pubkey1", ["wss://relay.example.com"]);
    expect(mockGet).toHaveBeenCalledTimes(1);

    // Clear all cache
    clearProfileCache();

    // Load again - should query again
    await loadBusinessProfile("pubkey1", ["wss://relay.example.com"]);
    expect(mockGet).toHaveBeenCalledTimes(2);
  });
});

