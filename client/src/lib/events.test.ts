import { describe, it, expect } from "vitest";
import { buildProfileEvent } from "./events";
import type { BusinessProfile, BusinessType, OpeningHoursSpec } from "@/types/profile";

describe("buildProfileEvent", () => {
  const baseProfile: BusinessProfile = {
    name: "testshop",
    displayName: "Test Shop",
    about: "A test shop",
    website: "https://testshop.com",
    nip05: "testshop@synvya.com",
    picture: "https://example.com/pic.jpg",
    banner: "https://example.com/banner.jpg",
    businessType: "restaurant",
    categories: ["test", "shop"]
  };

  it("should build profile event without memberOf", () => {
    const event = buildProfileEvent(baseProfile);

    expect(event.kind).toBe(0);
    expect(event.tags).toContainEqual(["t", "foodEstablishment:Restaurant"]);
    expect(event.tags).toContainEqual(["t", "test"]);
    expect(event.tags).toContainEqual(["t", "shop"]);
    
    // Should NOT contain memberOf tags
    expect(event.tags).not.toContainEqual(["L", "com.synvya.chamber"]);
  });

  it("should include memberOf tag when memberOf is specified", () => {
    const profileWithChamber: BusinessProfile = {
      ...baseProfile,
      memberOf: "snovalley.org"
    };

    const event = buildProfileEvent(profileWithChamber);

    expect(event.kind).toBe(0);
    expect(event.tags).toContainEqual(["schema.org:FoodEstablishment:memberOf", "https://snovalley.org", "https://schema.org/memberOf"]);
    // Should NOT contain namespace tags
    expect(event.tags).not.toContainEqual(["L", "com.synvya.chamber"]);
    expect(event.tags.some(tag => tag[0] === "l" && tag[2] === "com.synvya.chamber")).toBe(false);
  });

  it("should support different organization domains", () => {
    const profileWithEastside: BusinessProfile = {
      ...baseProfile,
      memberOf: "eastsidechamber.org"
    };

    const event = buildProfileEvent(profileWithEastside);

    expect(event.tags).toContainEqual(["schema.org:FoodEstablishment:memberOf", "https://eastsidechamber.org", "https://schema.org/memberOf"]);
    // Should NOT contain namespace tags
    expect(event.tags).not.toContainEqual(["L", "com.synvya.chamber"]);
    expect(event.tags.some(tag => tag[0] === "l" && tag[2] === "com.synvya.chamber")).toBe(false);
  });

  it("should include memberOf tag along with other tags", () => {
    const profileWithChamber: BusinessProfile = {
      ...baseProfile,
      phone: "(555) 123-4567",
      street: "123 Main St",
      city: "Seattle",
      state: "WA",
      zip: "98101",
      memberOf: "snovalley.org"
    };

    const event = buildProfileEvent(profileWithChamber);

    // Should include all standard tags
    expect(event.tags).toContainEqual(["t", "foodEstablishment:Restaurant"]);
    expect(event.tags).toContainEqual(["telephone", "tel:+15551234567"]);
    expect(event.tags).toContainEqual(["location", "123 Main St, Seattle, WA, 98101, USA"]);
    
    // Should also include memberOf tag
    expect(event.tags).toContainEqual(["schema.org:FoodEstablishment:memberOf", "https://snovalley.org", "https://schema.org/memberOf"]);
    expect(event.tags).not.toContainEqual(["L", "com.synvya.chamber"]);
    expect(event.tags.some(tag => tag[0] === "l" && tag[2] === "com.synvya.chamber")).toBe(false);
  });

  it("should not add memberOf tags when memberOf is undefined", () => {
    const profileWithoutChamber: BusinessProfile = {
      ...baseProfile,
      memberOf: undefined
    };

    const event = buildProfileEvent(profileWithoutChamber);

    expect(event.tags).not.toContainEqual(["L", "com.synvya.chamber"]);
    expect(event.tags.some(tag => tag[0] === "l" && tag[2] === "com.synvya.chamber")).toBe(false);
    expect(event.tags.some(tag => tag[0] === "schema.org:FoodEstablishment:memberOf")).toBe(false);
  });

  it("should not add memberOf tags when memberOf is empty string", () => {
    const profileWithEmptyChamber: BusinessProfile = {
      ...baseProfile,
      memberOf: ""
    };

    const event = buildProfileEvent(profileWithEmptyChamber);

    expect(event.tags).not.toContainEqual(["L", "com.synvya.chamber"]);
    expect(event.tags.some(tag => tag[0] === "l" && tag[2] === "com.synvya.chamber")).toBe(false);
    expect(event.tags.some(tag => tag[0] === "schema.org:FoodEstablishment:memberOf")).toBe(false);
  });

  it("should place memberOf tag after address tags", () => {
    const profileWithChamber: BusinessProfile = {
      ...baseProfile,
      street: "123 Main St",
      city: "Seattle",
      state: "WA",
      zip: "98101",
      memberOf: "snovalley.org"
    };

    const event = buildProfileEvent(profileWithChamber);

    // Find last address index (ES2020 compatible - findLastIndex requires ES2023)
    let lastAddressIndex = -1;
    for (let i = event.tags.length - 1; i >= 0; i--) {
      const tag = event.tags[i];
      if (Array.isArray(tag) && typeof tag[0] === "string" && tag[0].startsWith("schema.org:PostalAddress:")) {
        lastAddressIndex = i;
        break;
      }
    }
    const memberOfTagIndex = event.tags.findIndex(
      (tag: string[]) => tag[0] === "schema.org:FoodEstablishment:memberOf"
    );

    expect(lastAddressIndex).toBeGreaterThan(-1);
    expect(memberOfTagIndex).toBeGreaterThan(-1);
    expect(memberOfTagIndex).toBeGreaterThan(lastAddressIndex);
  });

  it("should verify memberOf tag structure", () => {
    const profileWithChamber: BusinessProfile = {
      ...baseProfile,
      memberOf: "snovalley.org"
    };

    const event = buildProfileEvent(profileWithChamber);

    // Find all memberOf-related tags
    const memberOfTags = event.tags.filter(
      tag => tag[0] === "schema.org:FoodEstablishment:memberOf"
    );

    expect(memberOfTags).toHaveLength(1);
    expect(memberOfTags).toContainEqual(["schema.org:FoodEstablishment:memberOf", "https://snovalley.org", "https://schema.org/memberOf"]);
    
    // Verify no namespace tags are present
    expect(event.tags.some(tag => tag[0] === "L" && tag[1] === "com.synvya.chamber")).toBe(false);
    expect(event.tags.some(tag => tag[0] === "l" && tag[2] === "com.synvya.chamber")).toBe(false);
  });

  it("should preserve content structure with memberOf", () => {
    const profileWithChamber: BusinessProfile = {
      ...baseProfile,
      memberOf: "snovalley.org"
    };

    const event = buildProfileEvent(profileWithChamber);

    const content = JSON.parse(event.content);
    expect(content.name).toBe("testshop");
    expect(content.display_name).toBe("Test Shop");
    expect(content.about).toBe("A test shop");
    expect(content.website).toBe("https://testshop.com");
    expect(content.picture).toBe("https://example.com/pic.jpg");
    expect(content.banner).toBe("https://example.com/banner.jpg");
    expect(content.nip05).toBe("testshop@synvya.com");
    
    // memberOf should not be in content, only in tags
    expect(content.memberOf).toBeUndefined();
  });

  it("should include geo tags when geohash, latitude, and longitude are provided", () => {
    const profileWithLocation: BusinessProfile = {
      ...baseProfile,
      street: "123 Main St",
      city: "Seattle",
      state: "WA",
      zip: "98101"
    };

    const event = buildProfileEvent(profileWithLocation, { 
      geohash: "c23q6sydb",
      latitude: 47.6062,
      longitude: -122.3321
    });

    // Geo coordinates in lat, lon format
    expect(event.tags).toContainEqual(["geoCoordinates", "47.6062, -122.3321"]);
    expect(event.tags).toContainEqual(["g", "c23q6sydb"]);
  });

  it("should not include geo tags when geo data is not provided", () => {
    const profileWithLocation: BusinessProfile = {
      ...baseProfile,
      street: "123 Main St",
      city: "Seattle",
      state: "WA",
      zip: "98101"
    };

    const event = buildProfileEvent(profileWithLocation);

    expect(event.tags.some(tag => tag[0] === "g")).toBe(false);
    expect(event.tags.some(tag => tag[0] === "geoCoordinates")).toBe(false);
  });

  it("should not include geo tags when geo data is null", () => {
    const profileWithLocation: BusinessProfile = {
      ...baseProfile,
      street: "123 Main St",
      city: "Seattle",
      state: "WA",
      zip: "98101"
    };

    const event = buildProfileEvent(profileWithLocation, { 
      geohash: null,
      latitude: null,
      longitude: null
    });

    expect(event.tags.some(tag => tag[0] === "g")).toBe(false);
    expect(event.tags.some(tag => tag[0] === "geoCoordinates")).toBe(false);
  });

  it("should trim geohash before adding tag", () => {
    const profileWithLocation: BusinessProfile = {
      ...baseProfile,
      street: "123 Main St",
      city: "Seattle",
      state: "WA",
      zip: "98101"
    };

    const event = buildProfileEvent(profileWithLocation, { 
      geohash: "  c23q6sydb  ",
      latitude: 47.6062,
      longitude: -122.3321
    });

    // Geo coordinates in lat, lon format
    expect(event.tags).toContainEqual(["geoCoordinates", "47.6062, -122.3321"]);
    expect(event.tags).toContainEqual(["g", "c23q6sydb"]);
  });

  it("should place geo tags after location tag", () => {
    const profileWithLocation: BusinessProfile = {
      ...baseProfile,
      street: "123 Main St",
      city: "Seattle",
      state: "WA",
      zip: "98101"
    };

    const event = buildProfileEvent(profileWithLocation, { 
      geohash: "c23q6sydb",
      latitude: 47.6062,
      longitude: -122.3321
    });

    // Find location tag index
    const locationIndex = event.tags.findIndex(
      (tag: string[]) => tag[0] === "location"
    );
    const firstGeoIndex = event.tags.findIndex(
      (tag: string[]) => tag[0] === "geoCoordinates" || tag[0] === "g"
    );

    expect(locationIndex).toBeGreaterThan(-1);
    expect(firstGeoIndex).toBeGreaterThan(-1);
    expect(firstGeoIndex).toBeGreaterThan(locationIndex);
  });

  it("should include location tag when address fields are provided", () => {
    const profileWithAddress: BusinessProfile = {
      ...baseProfile,
      street: "123 Main St",
      city: "Seattle",
      state: "WA",
      zip: "98101"
    };

    const event = buildProfileEvent(profileWithAddress);

    expect(event.tags).toContainEqual(["location", "123 Main St, Seattle, WA, 98101, USA"]);
    // Should NOT contain old schema.org address tags
    expect(event.tags.some(tag => tag[0]?.startsWith("schema.org:PostalAddress:"))).toBe(false);
  });

  it("should include geo tags along with location and memberOf tags", () => {
    const profileWithAll: BusinessProfile = {
      ...baseProfile,
      street: "123 Main St",
      city: "Seattle",
      state: "WA",
      zip: "98101",
      memberOf: "snovalley.org"
    };

    const event = buildProfileEvent(profileWithAll, { 
      geohash: "c23q6sydb",
      latitude: 47.6062,
      longitude: -122.3321
    });

    expect(event.tags).toContainEqual(["location", "123 Main St, Seattle, WA, 98101, USA"]);
    // Geo coordinates in lat, lon format
    expect(event.tags).toContainEqual(["geoCoordinates", "47.6062, -122.3321"]);
    expect(event.tags).toContainEqual(["g", "c23q6sydb"]);
    expect(event.tags).toContainEqual(["schema.org:FoodEstablishment:memberOf", "https://snovalley.org", "https://schema.org/memberOf"]);
    // Should NOT contain namespace tags
    expect(event.tags).not.toContainEqual(["L", "com.synvya.chamber"]);
    expect(event.tags.some(tag => tag[0] === "l" && tag[2] === "com.synvya.chamber")).toBe(false);
  });

  it("should include servesCuisine tag when cuisine is provided", () => {
    const profileWithCuisine: BusinessProfile = {
      ...baseProfile,
      cuisine: "Spanish"
    };

    const event = buildProfileEvent(profileWithCuisine);

    expect(event.tags).toContainEqual(["t", "servesCuisine:Spanish"]);
  });

  it("should not include servesCuisine tag when cuisine is not provided", () => {
    const event = buildProfileEvent(baseProfile);

    expect(event.tags.some(tag => tag[0] === "t" && tag[1]?.startsWith("servesCuisine:"))).toBe(false);
  });

  it("should not include servesCuisine tag when cuisine is undefined", () => {
    const profileWithoutCuisine: BusinessProfile = {
      ...baseProfile,
      cuisine: undefined
    };

    const event = buildProfileEvent(profileWithoutCuisine);

    expect(event.tags.some(tag => tag[0] === "t" && tag[1]?.startsWith("servesCuisine:"))).toBe(false);
  });

  it("should place servesCuisine tag after categories", () => {
    const profileWithCuisine: BusinessProfile = {
      ...baseProfile,
      categories: ["test", "shop"],
      cuisine: "Italian"
    };

    const event = buildProfileEvent(profileWithCuisine);

    // Find last category index (ES2020 compatible - findLastIndex requires ES2023)
    let lastCategoryIndex = -1;
    for (let i = event.tags.length - 1; i >= 0; i--) {
      const tag = event.tags[i];
      if (Array.isArray(tag) && tag[0] === "t" && !tag[1]?.startsWith("servesCuisine:") && !tag[1]?.startsWith("foodEstablishment:")) {
        lastCategoryIndex = i;
        break;
      }
    }
    const cuisineIndex = event.tags.findIndex(
      (tag: string[]) => tag[0] === "t" && tag[1]?.startsWith("servesCuisine:")
    );

    expect(lastCategoryIndex).toBeGreaterThan(-1);
    expect(cuisineIndex).toBeGreaterThan(-1);
    expect(cuisineIndex).toBeGreaterThan(lastCategoryIndex);
  });

  it("should include email tag when email is provided", () => {
    const profileWithEmail: BusinessProfile = {
      ...baseProfile,
      email: "contact@example.com"
    };

    const event = buildProfileEvent(profileWithEmail);

    expect(event.tags).toContainEqual(["email", "mailto:contact@example.com"]);
  });

  it("should not include email tag when email is not provided", () => {
    const event = buildProfileEvent(baseProfile);

    expect(event.tags.some(tag => tag[0] === "email")).toBe(false);
  });

  it("should not include email tag when email is undefined", () => {
    const profileWithoutEmail: BusinessProfile = {
      ...baseProfile,
      email: undefined
    };

    const event = buildProfileEvent(profileWithoutEmail);

    expect(event.tags.some(tag => tag[0] === "email")).toBe(false);
  });

  it("should place email tag after phone tag", () => {
    const profileWithContact: BusinessProfile = {
      ...baseProfile,
      phone: "(555) 123-4567",
      email: "contact@example.com"
    };

    const event = buildProfileEvent(profileWithContact);

    const phoneIndex = event.tags.findIndex(
      tag => tag[0] === "telephone"
    );
    const emailIndex = event.tags.findIndex(
      tag => tag[0] === "email"
    );

    expect(phoneIndex).toBeGreaterThan(-1);
    expect(emailIndex).toBeGreaterThan(-1);
    expect(emailIndex).toBeGreaterThan(phoneIndex);
  });

  it("should use new format for business type", () => {
    const event = buildProfileEvent(baseProfile);

    expect(event.tags).toContainEqual(["t", "foodEstablishment:Restaurant"]);
    expect(event.tags.some(tag => tag[0] === "L" && tag[1] === "com.synvya.merchant")).toBe(false);
    expect(event.tags.some(tag => tag[0] === "l" && tag[2] === "com.synvya.merchant")).toBe(false);
  });

  it("should map all Food Establishment types to new format", () => {
    const types: Array<{ type: BusinessProfile["businessType"]; expected: string }> = [
      { type: "bakery", expected: "Bakery" },
      { type: "barOrPub", expected: "BarOrPub" },
      { type: "brewery", expected: "Brewery" },
      { type: "cafeOrCoffeeShop", expected: "CafeOrCoffeeShop" },
      { type: "distillery", expected: "Distillery" },
      { type: "fastFoodRestaurant", expected: "FastFoodRestaurant" },
      { type: "iceCreamShop", expected: "IceCreamShop" },
      { type: "restaurant", expected: "Restaurant" },
      { type: "winery", expected: "Winery" }
    ];

    for (const { type, expected } of types) {
      const profile: BusinessProfile = {
        ...baseProfile,
        businessType: type
      };
      const event = buildProfileEvent(profile);
      expect(event.tags).toContainEqual(["t", `foodEstablishment:${expected}`]);
    }
  });

  it("should include acceptsReservations False tag when unchecked", () => {
    const profileWithReservations: BusinessProfile = {
      ...baseProfile,
      acceptsReservations: false
    };

    const event = buildProfileEvent(profileWithReservations);

    expect(event.tags).toContainEqual(["acceptsReservations", "False"]);
    expect(event.tags.some(tag => tag[0] === "acceptsReservations" && tag[1] === "https://synvya.com")).toBe(false);
    expect(event.tags.some(tag => tag[0] === "i" && tag[1] === "rp")).toBe(false);
    expect(event.tags.some(tag => tag[0] === "k" && tag[1] === "nip")).toBe(false);
  });

  it("should include acceptsReservations and nip:rp tags when checked", () => {
    const profileWithReservations: BusinessProfile = {
      ...baseProfile,
      acceptsReservations: true
    };

    const event = buildProfileEvent(profileWithReservations);

    expect(event.tags).toContainEqual(["acceptsReservations", "https://synvya.com"]);
    expect(event.tags).toContainEqual(["i", "rp", "https://github.com/Synvya/reservation-protocol/blob/main/nostr-protocols/nips/rp.md"]);
    expect(event.tags).toContainEqual(["k", "nip"]);
    expect(event.tags.some(tag => tag[0] === "acceptsReservations" && tag[1] === "False")).toBe(false);
  });

  it("should not include acceptsReservations tags when undefined", () => {
    const event = buildProfileEvent(baseProfile);

    expect(event.tags.some(tag => tag[0] === "acceptsReservations")).toBe(false);
    expect(event.tags.some(tag => tag[0] === "schema.org:FoodEstablishment:acceptsReservations")).toBe(false);
    expect(event.tags.some(tag => tag[0] === "i" && tag[1] === "rp")).toBe(false);
    expect(event.tags.some(tag => tag[0] === "k" && tag[1] === "nip")).toBe(false);
  });

  it("should include openingHours tag when opening hours are provided", () => {
    const openingHours: OpeningHoursSpec[] = [
      { days: ["Tu", "We", "Th"], startTime: "11:00", endTime: "21:00" },
      { days: ["Fr", "Sa"], startTime: "11:00", endTime: "00:00" },
      { days: ["Su"], startTime: "12:00", endTime: "21:00" }
    ];

    const profileWithHours: BusinessProfile = {
      ...baseProfile,
      openingHours
    };

    const event = buildProfileEvent(profileWithHours);

    expect(event.tags).toContainEqual(["openingHours", "Tu-Th 11:00-21:00, Fr-Sa 11:00-00:00, Su 12:00-21:00"]);
  });

  it("should not include openingHours tag when opening hours are not provided", () => {
    const event = buildProfileEvent(baseProfile);

    expect(event.tags.some(tag => tag[0] === "openingHours")).toBe(false);
  });

  it("should handle single day opening hours", () => {
    const openingHours: OpeningHoursSpec[] = [
      { days: ["Mo"], startTime: "09:00", endTime: "17:00" }
    ];

    const profileWithHours: BusinessProfile = {
      ...baseProfile,
      openingHours
    };

    const event = buildProfileEvent(profileWithHours);

    expect(event.tags).toContainEqual(["openingHours", "Mo 09:00-17:00"]);
  });

  it("should map diet categories to proper format", () => {
    const profileWithDiets: BusinessProfile = {
      ...baseProfile,
      categories: ["vegetarian", "gluten-free", "vegan", "regular-category"]
    };

    const event = buildProfileEvent(profileWithDiets);

    expect(event.tags).toContainEqual(["t", "VegetarianDiet"]);
    expect(event.tags).toContainEqual(["t", "GlutenFreeDiet"]);
    expect(event.tags).toContainEqual(["t", "VeganDiet"]);
    expect(event.tags).toContainEqual(["t", "regular-category"]);
  });

  it("should handle diet categories that already end with Diet", () => {
    const profileWithDiets: BusinessProfile = {
      ...baseProfile,
      categories: ["VegetarianDiet", "GlutenFreeDiet"]
    };

    const event = buildProfileEvent(profileWithDiets);

    expect(event.tags).toContainEqual(["t", "VegetarianDiet"]);
    expect(event.tags).toContainEqual(["t", "GlutenFreeDiet"]);
  });
});

