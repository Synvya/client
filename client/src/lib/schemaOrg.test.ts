import { describe, it, expect } from "vitest";
import { buildFoodEstablishmentSchema, buildMenuSchema, generateLDJsonScript } from "./schemaOrg";
import type { BusinessProfile } from "@/types/profile";
import type { SquareEventTemplate } from "@/services/square";

describe("schemaOrg", () => {
  describe("buildFoodEstablishmentSchema", () => {
    it("should generate basic restaurant schema", () => {
      const profile: BusinessProfile = {
        name: "testrestaurant",
        displayName: "Test Restaurant",
        about: "A great place to eat",
        website: "https://test.com",
        nip05: "test@synvya.com",
        picture: "https://example.com/pic.jpg",
        banner: "https://example.com/banner.jpg",
        businessType: "restaurant",
        categories: [],
        street: "123 Main St",
        city: "Seattle",
        state: "WA",
        zip: "98101",
        country: "US",
        phone: "(206) 555-1234",
        email: "info@test.com"
      };

      const schema = buildFoodEstablishmentSchema(profile);

      expect(schema["@type"]).toBe("Restaurant");
      expect(schema.name).toBe("Test Restaurant");
      expect(schema.description).toBe("A great place to eat");
      expect(schema.telephone).toBe("(206) 555-1234");
      expect(schema.email).toBe("info@test.com");
      expect(schema.url).toBe("https://test.com");
      expect(schema.address).toEqual({
        "@type": "PostalAddress",
        streetAddress: "123 Main St",
        addressLocality: "Seattle",
        addressRegion: "WA",
        postalCode: "98101",
        addressCountry: "US"
      });
    });

    it("should map all business types correctly", () => {
      const businessTypes = [
        { type: "bakery" as const, expected: "Bakery" },
        { type: "barOrPub" as const, expected: "BarOrPub" },
        { type: "brewery" as const, expected: "Brewery" },
        { type: "cafeOrCoffeeShop" as const, expected: "CafeOrCoffeeShop" },
        { type: "distillery" as const, expected: "Distillery" },
        { type: "fastFoodRestaurant" as const, expected: "FastFoodRestaurant" },
        { type: "iceCreamShop" as const, expected: "IceCreamShop" },
        { type: "restaurant" as const, expected: "Restaurant" },
        { type: "winery" as const, expected: "Winery" }
      ];

      for (const { type, expected } of businessTypes) {
        const profile: BusinessProfile = {
          name: "test",
          displayName: "Test",
          about: "",
          website: "",
          nip05: "",
          picture: "",
          banner: "",
          businessType: type,
          categories: []
        };

        const schema = buildFoodEstablishmentSchema(profile);
        expect(schema["@type"]).toBe(expected);
      }
    });

    it("should include multiple images", () => {
      const profile: BusinessProfile = {
        name: "test",
        displayName: "Test",
        about: "",
        website: "",
        nip05: "",
        picture: "https://example.com/pic.jpg",
        banner: "https://example.com/banner.jpg",
        businessType: "restaurant",
        categories: []
      };

      const schema = buildFoodEstablishmentSchema(profile);
      expect(schema.image).toEqual([
        "https://example.com/pic.jpg",
        "https://example.com/banner.jpg"
      ]);
    });

    it("should include single image when only one is provided", () => {
      const profile: BusinessProfile = {
        name: "test",
        displayName: "Test",
        about: "",
        website: "",
        nip05: "",
        picture: "https://example.com/pic.jpg",
        banner: "",
        businessType: "restaurant",
        categories: []
      };

      const schema = buildFoodEstablishmentSchema(profile);
      expect(schema.image).toBe("https://example.com/pic.jpg");
    });

    it("should include cuisine", () => {
      const profile: BusinessProfile = {
        name: "test",
        displayName: "Test",
        about: "",
        website: "",
        nip05: "",
        picture: "",
        banner: "",
        businessType: "restaurant",
        categories: [],
        cuisine: "Italian"
      };

      const schema = buildFoodEstablishmentSchema(profile);
      expect(schema.servesCuisine).toBe("Italian");
    });

    it("should convert opening hours", () => {
      const profile: BusinessProfile = {
        name: "test",
        displayName: "Test",
        about: "",
        website: "",
        nip05: "",
        picture: "",
        banner: "",
        businessType: "restaurant",
        categories: [],
        openingHours: [
          {
            days: ["Mo", "Tu", "We", "Th", "Fr"],
            startTime: "11:00",
            endTime: "21:00"
          },
          {
            days: ["Sa", "Su"],
            startTime: "12:00",
            endTime: "22:00"
          }
        ]
      };

      const schema = buildFoodEstablishmentSchema(profile);
      expect(schema.openingHoursSpecification).toHaveLength(2);
      expect(schema.openingHoursSpecification![0]).toEqual({
        "@type": "OpeningHoursSpecification",
        dayOfWeek: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
        opens: "11:00",
        closes: "21:00"
      });
      expect(schema.openingHoursSpecification![1]).toEqual({
        "@type": "OpeningHoursSpecification",
        dayOfWeek: ["Saturday", "Sunday"],
        opens: "12:00",
        closes: "22:00"
      });
    });

    it("should include geo coordinates from geohash", () => {
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

      // Seattle area geohash
      const schema = buildFoodEstablishmentSchema(profile, "c23nb62w20sth");
      expect(schema.geo).toBeDefined();
      expect(schema.geo?.["@type"]).toBe("GeoCoordinates");
      expect(schema.geo?.latitude).toBeCloseTo(47.6, 0);
      expect(schema.geo?.longitude).toBeCloseTo(-122.3, 0);
    });

    it("should set acceptsReservations", () => {
      const profileTrue: BusinessProfile = {
        name: "test",
        displayName: "Test",
        about: "",
        website: "",
        nip05: "",
        picture: "",
        banner: "",
        businessType: "restaurant",
        categories: [],
        acceptsReservations: true
      };

      const schemaTrue = buildFoodEstablishmentSchema(profileTrue);
      expect(schemaTrue.acceptsReservations).toBe("https://synvya.com");

      const profileFalse: BusinessProfile = {
        ...profileTrue,
        acceptsReservations: false
      };

      const schemaFalse = buildFoodEstablishmentSchema(profileFalse);
      expect(schemaFalse.acceptsReservations).toBe(false);
    });

    it("should handle minimal profile", () => {
      const profile: BusinessProfile = {
        name: "test",
        displayName: "",
        about: "",
        website: "",
        nip05: "",
        picture: "",
        banner: "",
        businessType: "restaurant",
        categories: []
      };

      const schema = buildFoodEstablishmentSchema(profile);
      expect(schema["@type"]).toBe("Restaurant");
      expect(schema.name).toBe("test");
      expect(schema.address).toBeUndefined();
      expect(schema.telephone).toBeUndefined();
      expect(schema.geo).toBeUndefined();
    });
  });

  describe("buildMenuSchema", () => {
    it("should build menu with uncategorized items", () => {
      const events: SquareEventTemplate[] = [
        {
          kind: 30402,
          created_at: Date.now(),
          content: "Delicious pasta",
          tags: [
            ["d", "pasta"],
            ["title", "Spaghetti Carbonara"],
            ["summary", "Classic Italian pasta"],
            ["price", "1499", "USD"]
          ]
        },
        {
          kind: 30402,
          created_at: Date.now(),
          content: "Fresh salad",
          tags: [
            ["d", "salad"],
            ["title", "Caesar Salad"],
            ["summary", "Crisp romaine lettuce"],
            ["price", "1099", "USD"]
          ]
        }
      ];

      const menus = buildMenuSchema("Test Restaurant", events);
      expect(menus).toHaveLength(1);
      expect(menus[0]["@type"]).toBe("Menu");
      expect(menus[0].name).toBe("Test Restaurant Menu");
      expect(menus[0].hasMenuItem).toHaveLength(2);
      expect(menus[0].hasMenuItem![0].name).toBe("Spaghetti Carbonara");
      expect(menus[0].hasMenuItem![0].description).toBe("Classic Italian pasta");
      expect(menus[0].hasMenuItem![0].offers).toEqual({
        "@type": "Offer",
        "price": "14.99",
        "priceCurrency": "USD"
      });
    });

    it("should build menu with sections", () => {
      const events: SquareEventTemplate[] = [
        {
          kind: 30405,
          created_at: Date.now(),
          content: "",
          tags: [
            ["d", "Lunch"],
            ["title", "Lunch Menu"]
          ]
        },
        {
          kind: 30405,
          created_at: Date.now(),
          content: "",
          tags: [
            ["d", "Appetizers"],
            ["title", "Appetizers Menu Section"]
          ]
        },
        {
          kind: 30402,
          created_at: Date.now(),
          content: "Bruschetta description",
          tags: [
            ["d", "bruschetta"],
            ["title", "Bruschetta"],
            ["summary", "Toasted bread with tomatoes"],
            ["price", "899", "USD"],
            ["a", "30405:pubkey123:Appetizers"],
            ["a", "30405:pubkey123:Lunch"]
          ]
        }
      ];

      const menus = buildMenuSchema("Test Restaurant", events);
      expect(menus).toHaveLength(1);
      expect(menus[0].name).toBe("Lunch Menu");
      expect(menus[0].hasMenuSection).toHaveLength(1);
      expect(menus[0].hasMenuSection![0].name).toBe("Appetizers");
      expect(menus[0].hasMenuSection![0].hasMenuItem).toHaveLength(1);
      expect(menus[0].hasMenuSection![0].hasMenuItem![0].name).toBe("Bruschetta");
    });

    it("should handle dietary tags", () => {
      const events: SquareEventTemplate[] = [
        {
          kind: 30402,
          created_at: Date.now(),
          content: "Vegan burger",
          tags: [
            ["d", "vegan-burger"],
            ["title", "Beyond Burger"],
            ["price", "1599", "USD"],
            ["t", "vegan"],
            ["t", "gluten-free"]
          ]
        }
      ];

      const menus = buildMenuSchema("Test Restaurant", events);
      expect(menus[0].hasMenuItem![0].suitableForDiet).toContain("https://schema.org/VeganDiet");
      expect(menus[0].hasMenuItem![0].suitableForDiet).toContain("https://schema.org/GlutenFreeDiet");
    });

    it("should handle items with images", () => {
      const events: SquareEventTemplate[] = [
        {
          kind: 30402,
          created_at: Date.now(),
          content: "Pasta description",
          tags: [
            ["d", "pasta"],
            ["title", "Pasta Special"],
            ["price", "1899", "USD"],
            ["image", "https://example.com/pasta.jpg"]
          ]
        }
      ];

      const menus = buildMenuSchema("Test Restaurant", events);
      expect(menus[0].hasMenuItem![0].image).toBe("https://example.com/pasta.jpg");
    });

    it("should handle empty menu events", () => {
      const menus = buildMenuSchema("Test Restaurant", []);
      expect(menus).toHaveLength(0);
    });

    it("should handle menu items without required fields", () => {
      const events: SquareEventTemplate[] = [
        {
          kind: 30402,
          created_at: Date.now(),
          content: "Item without title",
          tags: [
            ["d", "invalid-item"],
            ["price", "999", "USD"]
          ]
        }
      ];

      const menus = buildMenuSchema("Test Restaurant", events);
      expect(menus[0].hasMenuItem).toHaveLength(0);
    });

    it("should support mixed categorized and uncategorized items", () => {
      const events: SquareEventTemplate[] = [
        {
          kind: 30405,
          created_at: Date.now(),
          content: "",
          tags: [
            ["d", "Dinner"],
            ["title", "Dinner Menu"]
          ]
        },
        {
          kind: 30402,
          created_at: Date.now(),
          content: "Daily special",
          tags: [
            ["d", "daily-special"],
            ["title", "Daily Special"],
            ["price", "1999", "USD"]
          ]
        },
        {
          kind: 30402,
          created_at: Date.now(),
          content: "Steak",
          tags: [
            ["d", "steak"],
            ["title", "Ribeye Steak"],
            ["price", "2999", "USD"],
            ["a", "30405:pubkey123:Dinner"]
          ]
        }
      ];

      const menus = buildMenuSchema("Test Restaurant", events);
      expect(menus).toHaveLength(1);
      expect(menus[0].hasMenuItem).toHaveLength(1);
      expect(menus[0].hasMenuItem![0].name).toBe("Daily Special");
    });
  });

  describe("generateLDJsonScript", () => {
    it("should generate complete script tag", () => {
      const profile: BusinessProfile = {
        name: "testcafe",
        displayName: "Test Cafe",
        about: "A cozy cafe",
        website: "https://testcafe.com",
        nip05: "testcafe@synvya.com",
        picture: "https://example.com/pic.jpg",
        banner: "",
        businessType: "cafeOrCoffeeShop",
        categories: [],
        street: "456 Coffee Lane",
        city: "Portland",
        state: "OR",
        zip: "97201",
        country: "US"
      };

      const script = generateLDJsonScript(profile);

      expect(script).toContain('<script type="application/ld+json">');
      expect(script).toContain('</script>');
      expect(script).toContain('"@context": "https://schema.org"');
      expect(script).toContain('"@graph"');
      expect(script).toContain('"@type": "CafeOrCoffeeShop"');
      expect(script).toContain('"name": "Test Cafe"');
    });

    it("should generate script with menu", () => {
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
          content: "Coffee description",
          tags: [
            ["d", "coffee"],
            ["title", "Espresso"],
            ["price", "399", "USD"]
          ]
        }
      ];

      const script = generateLDJsonScript(profile, menuEvents);

      expect(script).toContain('"@type": "Menu"');
      expect(script).toContain('"@type": "MenuItem"');
      expect(script).toContain('"name": "Espresso"');
      expect(script).toContain('"hasMenu"');
    });

    it("should escape HTML special characters", () => {
      const profile: BusinessProfile = {
        name: "test",
        displayName: "Test <Restaurant> & Cafe",
        about: "Great food <3",
        website: "",
        nip05: "",
        picture: "",
        banner: "",
        businessType: "restaurant",
        categories: []
      };

      const script = generateLDJsonScript(profile);

      // JSON should be escaped for safe HTML embedding
      expect(script).toContain("\\u003c");
      expect(script).toContain("\\u003e");
      expect(script).toContain("\\u0026");
    });

    it("should handle profile without menu", () => {
      const profile: BusinessProfile = {
        name: "bakery",
        displayName: "Bakery",
        about: "",
        website: "",
        nip05: "",
        picture: "",
        banner: "",
        businessType: "bakery",
        categories: []
      };

      const script = generateLDJsonScript(profile, null);

      expect(script).toContain('"@type": "Bakery"');
      expect(script).not.toContain('"@type": "Menu"');
      expect(script).not.toContain('"hasMenu"');
    });

    it("should include geohash coordinates", () => {
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

      const script = generateLDJsonScript(profile, null, "c23nb62w20sth");

      expect(script).toContain('"@type": "GeoCoordinates"');
      expect(script).toContain('"latitude"');
      expect(script).toContain('"longitude"');
    });

    it("should generate valid JSON", () => {
      const profile: BusinessProfile = {
        name: "valid",
        displayName: "Valid Restaurant",
        about: "",
        website: "",
        nip05: "",
        picture: "",
        banner: "",
        businessType: "restaurant",
        categories: []
      };

      const script = generateLDJsonScript(profile);

      // Extract JSON from script tag
      const jsonMatch = script.match(/<script type="application\/ld\+json">\n([\s\S]*)\n<\/script>/);
      expect(jsonMatch).toBeTruthy();

      if (jsonMatch) {
        const jsonString = jsonMatch[1];
        // Unescape the JSON
        const unescaped = jsonString
          .replace(/\\u003c/g, "<")
          .replace(/\\u003e/g, ">")
          .replace(/\\u0026/g, "&");

        expect(() => JSON.parse(unescaped)).not.toThrow();
        const parsed = JSON.parse(unescaped);
        expect(parsed["@context"]).toBe("https://schema.org");
        expect(parsed["@graph"]).toBeInstanceOf(Array);
      }
    });
  });
});

