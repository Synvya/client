import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  fetchDiscoveryData,
  publishDiscoveryToSynvya,
  fetchAndPublishDiscovery,
  buildDiscoveryUrl
} from "./discoveryPublish";
import type { BusinessProfile } from "@/types/profile";

// Mock dependencies
vi.mock("@/lib/relayPool", () => ({
  getPool: vi.fn()
}));

vi.mock("@/components/BusinessProfileForm", () => ({
  parseKind0ProfileEvent: vi.fn()
}));

vi.mock("@/lib/nostrEventProcessing", () => ({
  deduplicateEvents: vi.fn()
}));

vi.mock("@/lib/siteExport/buildSite", () => ({
  buildStaticSiteFiles: vi.fn()
}));

vi.mock("@/services/discovery", () => ({
  publishDiscoveryPage: vi.fn()
}));

vi.mock("@/state/useWebsiteData", () => ({
  useWebsiteData: {
    getState: vi.fn()
  }
}));

import { getPool } from "@/lib/relayPool";
import { parseKind0ProfileEvent } from "@/components/BusinessProfileForm";
import { deduplicateEvents } from "@/lib/nostrEventProcessing";
import { buildStaticSiteFiles } from "@/lib/siteExport/buildSite";
import { publishDiscoveryPage } from "@/services/discovery";
import { useWebsiteData } from "@/state/useWebsiteData";

describe("discoveryPublish", () => {
  const mockPubkey = "abc123pubkey";
  const mockRelays = ["wss://relay1.example.com", "wss://relay2.example.com"];

  const mockProfile: BusinessProfile = {
    name: "testrestaurant",
    displayName: "Test Restaurant",
    about: "A great place to eat",
    website: "https://testrestaurant.com",
    nip05: "testrestaurant@synvya.com",
    picture: "https://example.com/pic.jpg",
    banner: "https://example.com/banner.jpg",
    businessType: "restaurant",
    categories: ["food", "dining"],
    phone: "555-1234",
    email: "test@restaurant.com",
    street: "123 Main St",
    city: "Seattle",
    state: "WA",
    zip: "98101",
    country: "US"
  };

  const mockProfileEvent = {
    kind: 0,
    content: JSON.stringify({
      name: "testrestaurant",
      display_name: "Test Restaurant",
      about: "A great place to eat"
    }),
    tags: [
      ["g", "c23nb"],
      ["t", "production"]
    ]
  };

  const mockMenuEvents = [
    { kind: 30402, tags: [["d", "burger"]], content: "", created_at: 1700000000 },
    { kind: 30405, tags: [["d", "lunch"]], content: "", created_at: 1700000001 }
  ];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("fetchDiscoveryData", () => {
    it("throws error when pubkey is missing", async () => {
      await expect(fetchDiscoveryData("", mockRelays)).rejects.toThrow(
        "Missing pubkey or relays"
      );
    });

    it("throws error when relays is empty", async () => {
      await expect(fetchDiscoveryData(mockPubkey, [])).rejects.toThrow(
        "Missing pubkey or relays"
      );
    });

    it("returns null when no profile exists", async () => {
      const mockPool = {
        get: vi.fn().mockResolvedValue(null),
        querySync: vi.fn()
      };
      vi.mocked(getPool).mockReturnValue(mockPool as any);

      const result = await fetchDiscoveryData(mockPubkey, mockRelays);

      expect(result).toBeNull();
      expect(mockPool.get).toHaveBeenCalledWith(mockRelays, {
        kinds: [0],
        authors: [mockPubkey]
      });
    });

    it("fetches and returns profile and menu data", async () => {
      const mockPool = {
        get: vi.fn().mockResolvedValue(mockProfileEvent),
        querySync: vi.fn().mockResolvedValue(mockMenuEvents)
      };
      vi.mocked(getPool).mockReturnValue(mockPool as any);
      vi.mocked(parseKind0ProfileEvent).mockReturnValue({
        patch: mockProfile,
        categories: []
      });
      vi.mocked(deduplicateEvents).mockReturnValue(mockMenuEvents);

      const result = await fetchDiscoveryData(mockPubkey, mockRelays);

      expect(result).not.toBeNull();
      expect(result?.profile.name).toBe("testrestaurant");
      expect(result?.profile.displayName).toBe("Test Restaurant");
      expect(result?.menuEvents).toHaveLength(2);
      expect(result?.geohash).toBe("c23nb");
      expect(result?.profileTags).toEqual(mockProfileEvent.tags);
    });

    it("returns null menuEvents when no menu events exist", async () => {
      const mockPool = {
        get: vi.fn().mockResolvedValue(mockProfileEvent),
        querySync: vi.fn().mockResolvedValue([])
      };
      vi.mocked(getPool).mockReturnValue(mockPool as any);
      vi.mocked(parseKind0ProfileEvent).mockReturnValue({
        patch: mockProfile,
        categories: []
      });
      vi.mocked(deduplicateEvents).mockReturnValue([]);

      const result = await fetchDiscoveryData(mockPubkey, mockRelays);

      expect(result?.menuEvents).toBeNull();
    });

    it("uses localMenuEvents when relay returns empty", async () => {
      const localEvents = [
        { kind: 30402, tags: [["d", "pizza"]], content: "", created_at: 1700000000 },
        { kind: 30405, tags: [["d", "dinner"]], content: "", created_at: 1700000001 }
      ];
      const mockPool = {
        get: vi.fn().mockResolvedValue(mockProfileEvent),
        querySync: vi.fn().mockResolvedValue([])
      };
      vi.mocked(getPool).mockReturnValue(mockPool as any);
      vi.mocked(parseKind0ProfileEvent).mockReturnValue({
        patch: mockProfile,
        categories: []
      });
      vi.mocked(deduplicateEvents).mockReturnValue([]);

      const result = await fetchDiscoveryData(mockPubkey, mockRelays, localEvents as any);

      expect(result?.menuEvents).toEqual(localEvents);
    });

    it("uses relay events when both relay and local events exist", async () => {
      const localEvents = [
        { kind: 30402, tags: [["d", "pizza"]], content: "", created_at: 1700000000 }
      ];
      const mockPool = {
        get: vi.fn().mockResolvedValue(mockProfileEvent),
        querySync: vi.fn().mockResolvedValue(mockMenuEvents)
      };
      vi.mocked(getPool).mockReturnValue(mockPool as any);
      vi.mocked(parseKind0ProfileEvent).mockReturnValue({
        patch: mockProfile,
        categories: []
      });
      vi.mocked(deduplicateEvents).mockReturnValue(mockMenuEvents);

      const result = await fetchDiscoveryData(mockPubkey, mockRelays, localEvents as any);

      expect(result?.menuEvents).toEqual(mockMenuEvents);
    });

    it("returns null geohash when profile has no g tag", async () => {
      const profileWithoutGeohash = {
        ...mockProfileEvent,
        tags: [["t", "production"]]
      };
      const mockPool = {
        get: vi.fn().mockResolvedValue(profileWithoutGeohash),
        querySync: vi.fn().mockResolvedValue([])
      };
      vi.mocked(getPool).mockReturnValue(mockPool as any);
      vi.mocked(parseKind0ProfileEvent).mockReturnValue({
        patch: mockProfile,
        categories: []
      });
      vi.mocked(deduplicateEvents).mockReturnValue([]);

      const result = await fetchDiscoveryData(mockPubkey, mockRelays);

      expect(result?.geohash).toBeNull();
    });
  });

  describe("publishDiscoveryToSynvya", () => {
    const mockData = {
      profile: mockProfile,
      menuEvents: mockMenuEvents as any,
      geohash: "c23nb",
      profileTags: [["g", "c23nb"]] as string[][]
    };

    it("generates HTML and publishes to Synvya.com", async () => {
      vi.mocked(buildStaticSiteFiles).mockReturnValue({
        html: "<html>Test</html>",
        handle: "testrestaurant"
      });
      vi.mocked(publishDiscoveryPage).mockResolvedValue(
        "https://synvya.com/restaurant/testrestaurant/"
      );

      const result = await publishDiscoveryToSynvya(mockPubkey, mockData);

      expect(buildStaticSiteFiles).toHaveBeenCalledWith({
        profile: mockProfile,
        geohash: "c23nb",
        menuEvents: mockMenuEvents,
        merchantPubkey: mockPubkey,
        profileTags: [["g", "c23nb"]],
        typeSlug: "restaurant",
        nameSlug: "testrestaurant"
      });
      expect(publishDiscoveryPage).toHaveBeenCalledWith(
        "restaurant",
        "testrestaurant",
        "<html>Test</html>"
      );
      expect(result.url).toBe("https://synvya.com/restaurant/testrestaurant/");
      expect(result.profile).toBe(mockProfile);
    });

    it("uses displayName for slug when name is empty", async () => {
      const profileWithoutName = { ...mockProfile, name: "" };
      const dataWithoutName = { ...mockData, profile: profileWithoutName };

      vi.mocked(buildStaticSiteFiles).mockReturnValue({
        html: "<html>Test</html>",
        handle: "test-restaurant"
      });
      vi.mocked(publishDiscoveryPage).mockResolvedValue(
        "https://synvya.com/restaurant/test-restaurant/"
      );

      await publishDiscoveryToSynvya(mockPubkey, dataWithoutName);

      expect(buildStaticSiteFiles).toHaveBeenCalledWith(
        expect.objectContaining({
          nameSlug: "test-restaurant"
        })
      );
    });
  });

  describe("fetchAndPublishDiscovery", () => {
    it("throws error when no profile exists", async () => {
      const mockPool = {
        get: vi.fn().mockResolvedValue(null),
        querySync: vi.fn()
      };
      vi.mocked(getPool).mockReturnValue(mockPool as any);

      await expect(fetchAndPublishDiscovery(mockPubkey, mockRelays)).rejects.toThrow(
        "No profile found. Please publish your profile first."
      );
    });

    it("fetches data and publishes in one call", async () => {
      const mockPool = {
        get: vi.fn().mockResolvedValue(mockProfileEvent),
        querySync: vi.fn().mockResolvedValue(mockMenuEvents)
      };
      vi.mocked(getPool).mockReturnValue(mockPool as any);
      vi.mocked(parseKind0ProfileEvent).mockReturnValue({
        patch: mockProfile,
        categories: []
      });
      vi.mocked(deduplicateEvents).mockReturnValue(mockMenuEvents);
      vi.mocked(buildStaticSiteFiles).mockReturnValue({
        html: "<html>Test</html>",
        handle: "testrestaurant"
      });
      vi.mocked(publishDiscoveryPage).mockResolvedValue(
        "https://synvya.com/restaurant/testrestaurant/"
      );

      const updateSchema = vi.fn();
      vi.mocked(useWebsiteData.getState).mockReturnValue({ updateSchema } as any);

      const result = await fetchAndPublishDiscovery(mockPubkey, mockRelays);

      expect(result.url).toBe("https://synvya.com/restaurant/testrestaurant/");
      expect(result.profile.name).toBe("testrestaurant");
      expect(updateSchema).toHaveBeenCalledTimes(1);
      expect(updateSchema).toHaveBeenCalledWith(
        mockProfile,
        mockMenuEvents,
        "c23nb",
        mockPubkey,
        mockProfileEvent.tags
      );
    });

    it("does not call updateSchema when no profile exists", async () => {
      const mockPool = {
        get: vi.fn().mockResolvedValue(null),
        querySync: vi.fn()
      };
      vi.mocked(getPool).mockReturnValue(mockPool as any);

      const updateSchema = vi.fn();
      vi.mocked(useWebsiteData.getState).mockReturnValue({ updateSchema } as any);

      await expect(fetchAndPublishDiscovery(mockPubkey, mockRelays)).rejects.toThrow(
        "No profile found. Please publish your profile first."
      );

      expect(updateSchema).not.toHaveBeenCalled();
    });

    it("does not call updateSchema when publish fails", async () => {
      const mockPool = {
        get: vi.fn().mockResolvedValue(mockProfileEvent),
        querySync: vi.fn().mockResolvedValue(mockMenuEvents)
      };
      vi.mocked(getPool).mockReturnValue(mockPool as any);
      vi.mocked(parseKind0ProfileEvent).mockReturnValue({
        patch: mockProfile,
        categories: []
      });
      vi.mocked(deduplicateEvents).mockReturnValue(mockMenuEvents);
      vi.mocked(buildStaticSiteFiles).mockReturnValue({
        html: "<html>Test</html>",
        handle: "testrestaurant"
      });
      vi.mocked(publishDiscoveryPage).mockRejectedValue(new Error("Network error"));

      const updateSchema = vi.fn();
      vi.mocked(useWebsiteData.getState).mockReturnValue({ updateSchema } as any);

      await expect(fetchAndPublishDiscovery(mockPubkey, mockRelays)).rejects.toThrow(
        "Network error"
      );

      expect(updateSchema).not.toHaveBeenCalled();
    });
  });

  describe("buildDiscoveryUrl", () => {
    it("builds correct URL for restaurant", () => {
      const url = buildDiscoveryUrl(mockProfile);
      expect(url).toBe("https://synvya.com/restaurant/testrestaurant/");
    });

    it("builds correct URL for bakery", () => {
      const bakeryProfile = { ...mockProfile, businessType: "bakery" as const };
      const url = buildDiscoveryUrl(bakeryProfile);
      expect(url).toBe("https://synvya.com/bakery/testrestaurant/");
    });

    it("uses displayName when name is empty", () => {
      const profileWithoutName = { ...mockProfile, name: "" };
      const url = buildDiscoveryUrl(profileWithoutName);
      expect(url).toBe("https://synvya.com/restaurant/test-restaurant/");
    });

    it("uses 'business' as fallback when both name and displayName are empty", () => {
      const emptyProfile = { ...mockProfile, name: "", displayName: "" };
      const url = buildDiscoveryUrl(emptyProfile);
      expect(url).toBe("https://synvya.com/restaurant/business/");
    });
  });
});
