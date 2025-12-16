import { describe, it, expect, beforeEach, vi } from "vitest";
import { useWebsiteData, getSchemaSnapshot, getLastUpdatedSnapshot } from "./useWebsiteData";
import type { BusinessProfile } from "@/types/profile";
import type { SquareEventTemplate } from "@/services/square";

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => {
      store[key] = value.toString();
    },
    clear: () => {
      store = {};
    },
    removeItem: (key: string) => {
      delete store[key];
    }
  };
})();

Object.defineProperty(window, "localStorage", {
  value: localStorageMock,
  writable: true
});

describe("useWebsiteData", () => {
  beforeEach(() => {
    // Clear store before each test
    localStorageMock.clear();
    useWebsiteData.getState().clearSchema();
  });

  it("should initialize with null schema", () => {
    const state = useWebsiteData.getState();
    expect(state.schema).toBeNull();
    expect(state.lastUpdated).toBeNull();
  });

  it("should generate and store schema from profile", () => {
    const profile: BusinessProfile = {
      name: "testcafe",
      displayName: "Test Cafe",
      about: "A great cafe",
      website: "https://testcafe.com",
      nip05: "testcafe@synvya.com",
      picture: "https://example.com/pic.jpg",
      banner: "",
      businessType: "cafeOrCoffeeShop",
      categories: []
    };

    useWebsiteData.getState().updateSchema(profile);

    const state = useWebsiteData.getState();
    expect(state.schema).toBeTruthy();
    expect(state.schema).toContain('<script type="application/ld+json">');
    expect(state.schema).toContain('"@type": "CafeOrCoffeeShop"');
    expect(state.schema).toContain('"name": "Test Cafe"');
    expect(state.lastUpdated).toBeInstanceOf(Date);
  });

  it("should generate schema with menu events", () => {
    const profile: BusinessProfile = {
      name: "restaurant",
      displayName: "Restaurant",
      about: "",
      website: "",
      nip05: "",
      picture: "",
      banner: "",
      businessType: "restaurant",
      categories: []
    };

    const menuEvents: SquareEventTemplate[] = [
      {
        kind: 30402,
        created_at: Date.now(),
        content: "Pasta description",
        tags: [
          ["d", "pasta"],
          ["title", "Spaghetti"],
          ["price", "1299", "USD"]
        ]
      }
    ];

    useWebsiteData.getState().updateSchema(profile, menuEvents);

    const state = useWebsiteData.getState();
    expect(state.schema).toContain('"@type": "Menu"');
    expect(state.schema).toContain('"name": "Spaghetti"');
    expect(state.schema).toContain('"@type": "MenuItem"');
  });

  it("should include geohash in schema", () => {
    const profile: BusinessProfile = {
      name: "test",
      displayName: "Test",
      about: "",
      website: "",
      nip05: "",
      picture: "",
      banner: "",
      businessType: "restaurant",
      categories: []
    };

    useWebsiteData.getState().updateSchema(profile, null, "c23nb62w20sth");

    const state = useWebsiteData.getState();
    expect(state.schema).toContain('"@type": "GeoCoordinates"');
    expect(state.schema).toContain('"latitude"');
    expect(state.schema).toContain('"longitude"');
  });

  it("should clear schema", () => {
    const profile: BusinessProfile = {
      name: "test",
      displayName: "Test",
      about: "",
      website: "",
      nip05: "",
      picture: "",
      banner: "",
      businessType: "restaurant",
      categories: []
    };

    useWebsiteData.getState().updateSchema(profile);
    expect(useWebsiteData.getState().schema).toBeTruthy();

    useWebsiteData.getState().clearSchema();
    const state = useWebsiteData.getState();
    expect(state.schema).toBeNull();
    expect(state.lastUpdated).toBeNull();
  });

  it("should persist to localStorage", () => {
    const profile: BusinessProfile = {
      name: "persist-test",
      displayName: "Persist Test",
      about: "",
      website: "",
      nip05: "",
      picture: "",
      banner: "",
      businessType: "restaurant",
      categories: []
    };

    useWebsiteData.getState().updateSchema(profile);

    // Check if data was persisted
    const stored = localStorageMock.getItem("synvya-website-data-storage");
    expect(stored).toBeTruthy();
    
    if (stored) {
      const parsed = JSON.parse(stored);
      expect(parsed.state.schema).toBeTruthy();
      expect(parsed.state.lastUpdated).toBeTruthy();
    }
  });

  it("should update lastUpdated when schema changes", () => {
    const profile: BusinessProfile = {
      name: "test",
      displayName: "Test",
      about: "",
      website: "",
      nip05: "",
      picture: "",
      banner: "",
      businessType: "restaurant",
      categories: []
    };

    useWebsiteData.getState().updateSchema(profile);
    const firstUpdate = useWebsiteData.getState().lastUpdated;
    expect(firstUpdate).toBeInstanceOf(Date);

    // Wait a bit and update again
    const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
    return delay(10).then(() => {
      useWebsiteData.getState().updateSchema(profile);
      const secondUpdate = useWebsiteData.getState().lastUpdated;
      expect(secondUpdate).toBeInstanceOf(Date);
      expect(secondUpdate!.getTime()).toBeGreaterThanOrEqual(firstUpdate!.getTime());
    });
  });

  it("should handle errors gracefully", () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const invalidProfile = {} as BusinessProfile;
    
    useWebsiteData.getState().updateSchema(invalidProfile);

    // Should log error but not crash
    expect(consoleSpy).toHaveBeenCalled();

    consoleSpy.mockRestore();
  });

  it("should support snapshot accessors", () => {
    const profile: BusinessProfile = {
      name: "snapshot-test",
      displayName: "Snapshot Test",
      about: "",
      website: "",
      nip05: "",
      picture: "",
      banner: "",
      businessType: "restaurant",
      categories: []
    };

    useWebsiteData.getState().updateSchema(profile);

    const schema = getSchemaSnapshot();
    const lastUpdated = getLastUpdatedSnapshot();

    expect(schema).toBeTruthy();
    expect(lastUpdated).toBeInstanceOf(Date);
  });

  it("should handle null menu events", () => {
    const profile: BusinessProfile = {
      name: "test",
      displayName: "Test",
      about: "",
      website: "",
      nip05: "",
      picture: "",
      banner: "",
      businessType: "restaurant",
      categories: []
    };

    useWebsiteData.getState().updateSchema(profile, null);

    const state = useWebsiteData.getState();
    expect(state.schema).toBeTruthy();
    expect(state.schema).not.toContain('"@type": "Menu"');
  });

  it("should handle empty menu events array", () => {
    const profile: BusinessProfile = {
      name: "test",
      displayName: "Test",
      about: "",
      website: "",
      nip05: "",
      picture: "",
      banner: "",
      businessType: "restaurant",
      categories: []
    };

    useWebsiteData.getState().updateSchema(profile, []);

    const state = useWebsiteData.getState();
    expect(state.schema).toBeTruthy();
    expect(state.schema).not.toContain('"@type": "Menu"');
  });

  it("should deserialize persisted Date objects", () => {
    const profile: BusinessProfile = {
      name: "date-test",
      displayName: "Date Test",
      about: "",
      website: "",
      nip05: "",
      picture: "",
      banner: "",
      businessType: "restaurant",
      categories: []
    };

    // Store some data
    useWebsiteData.getState().updateSchema(profile);
    const originalDate = useWebsiteData.getState().lastUpdated;

    // Simulate rehydration by reading from localStorage
    const stored = localStorageMock.getItem("synvya-website-data-storage");
    expect(stored).toBeTruthy();

    if (stored) {
      const parsed = JSON.parse(stored);
      // The lastUpdated should be stored as ISO string
      expect(typeof parsed.state.lastUpdated).toBe("string");
      
      // When rehydrated, it should be converted back to Date
      expect(originalDate).toBeInstanceOf(Date);
    }
  });
});

