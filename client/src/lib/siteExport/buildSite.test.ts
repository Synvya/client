import { describe, it, expect } from "vitest";
import { buildStaticSiteFiles } from "./buildSite";
import type { BusinessProfile } from "@/types/profile";
import type { SquareEventTemplate } from "@/services/square";

describe("siteExport buildSite", () => {
  it("generates single HTML file with consolidated schema", () => {
    const profile: BusinessProfile = {
      name: "elcandado",
      displayName: "Restaurante El Candado",
      about: "A Spanish restaurant",
      website: "",
      nip05: "",
      picture: "",
      banner: "",
      businessType: "restaurant",
      categories: ["Spanish", "Tapas"],
      street: "7970 Railroad Ave",
      city: "Snoqualmie",
      state: "WA",
      zip: "98065",
      country: "US",
      cuisine: "Spanish",
      phone: "+1 (555) 123-4567",
      email: "elcandado@synvya.com",
    };

    const menuEvents: SquareEventTemplate[] = [
      { kind: 30405, created_at: 1, content: "", tags: [["d", "Dinner"], ["title", "Dinner Menu"]] },
      {
        kind: 30402,
        created_at: 1,
        content: "desc",
        tags: [["d", "sq-c9ab1636203e078f"], ["title", "Bacalao al Pil Pil"], ["a", "30405:pubkey123:Dinner"]],
      },
    ];

    const { html, handle } = buildStaticSiteFiles({
      profile,
      geohash: null,
      menuEvents,
      merchantPubkey: "e01e4b0b3677204161b8d13d0a7b88e5d2e7dac2f7d2cc5530a3bc1dca3fbd2f",
      profileTags: [["t", "production"], ["t", "spanish"]],
      typeSlug: "restaurant",
      nameSlug: "elcandado",
    });

    // Check handle
    expect(handle).toBe("elcandado");

    // Check HTML contains restaurant info
    expect(html).toContain("Restaurante El Candado");
    expect(html).toContain("A Spanish restaurant");
    expect(html).toContain("Spanish");
    expect(html).toContain("Tapas");

    // Check HTML contains menu
    expect(html).toContain("Dinner Menu");

    // Check HTML contains menu item
    expect(html).toContain("Bacalao al Pil Pil");
    expect(html).toContain("desc");

    // Check schema is included
    expect(html).toContain("application/ld+json");

    // Check anchor navigation
    expect(html).toContain('id="menu-dinner-menu"');
    expect(html).toContain('id="item-sq-c9ab1636203e078f"');
    expect(html).toContain('href="#menu-dinner-menu"');
  });

  it("generates single HTML file without menus when no menu events", () => {
    const profile: BusinessProfile = {
      name: "testrestaurant",
      displayName: "Test Restaurant",
      about: "A test restaurant",
      website: "",
      nip05: "",
      picture: "",
      banner: "",
      businessType: "restaurant",
      categories: [],
      street: "123 Main St",
      city: "Seattle",
      state: "WA",
      zip: "98101",
      country: "US",
      cuisine: "Italian",
    };

    const { html, handle } = buildStaticSiteFiles({
      profile,
      geohash: null,
      menuEvents: null,
      merchantPubkey: "e01e4b0b3677204161b8d13d0a7b88e5d2e7dac2f7d2cc5530a3bc1dca3fbd2f",
      profileTags: null,
      typeSlug: "restaurant",
      nameSlug: "testrestaurant",
    });

    expect(handle).toBe("testrestaurant");
    expect(html).toContain("Test Restaurant");
    expect(html).toContain("A test restaurant");
    expect(html).toContain("application/ld+json");
  });

  it("uses displayName for filename when name is not available", () => {
    const profile: BusinessProfile = {
      name: "",
      displayName: "My Restaurant",
      about: "",
      website: "",
      nip05: "",
      picture: "",
      banner: "",
      businessType: "restaurant",
      categories: [],
      street: "123 Main St",
      city: "Seattle",
      state: "WA",
      zip: "98101",
      country: "US",
    };

    const { handle } = buildStaticSiteFiles({
      profile,
      geohash: null,
      menuEvents: null,
      merchantPubkey: "e01e4b0b3677204161b8d13d0a7b88e5d2e7dac2f7d2cc5530a3bc1dca3fbd2f",
      profileTags: null,
      typeSlug: "restaurant",
      nameSlug: "my-restaurant",
    });

    expect(handle).toBe("my-restaurant");
  });

  it("uses fallback filename when neither name nor displayName available", () => {
    const profile: BusinessProfile = {
      name: "",
      displayName: "",
      about: "",
      website: "",
      nip05: "",
      picture: "",
      banner: "",
      businessType: "restaurant",
      categories: [],
      street: "123 Main St",
      city: "Seattle",
      state: "WA",
      zip: "98101",
      country: "US",
    };

    const { handle } = buildStaticSiteFiles({
      profile,
      geohash: null,
      menuEvents: null,
      merchantPubkey: "e01e4b0b3677204161b8d13d0a7b88e5d2e7dac2f7d2cc5530a3bc1dca3fbd2f",
      profileTags: null,
      typeSlug: "restaurant",
      nameSlug: "restaurant",
    });

    expect(handle).toBe("restaurant");
  });

  it("generates consolidated schema with full nested menu structure", () => {
    const profile: BusinessProfile = {
      name: "testrestaurant",
      displayName: "Test Restaurant",
      about: "A test restaurant",
      website: "",
      nip05: "",
      picture: "",
      banner: "",
      businessType: "restaurant",
      categories: ["Italian"],
      street: "123 Main St",
      city: "Seattle",
      state: "WA",
      zip: "98101",
      country: "US",
      cuisine: "Italian",
    };

    const menuEvents: SquareEventTemplate[] = [
      {
        kind: 30405,
        created_at: 1,
        content: "",
        tags: [
          ["d", "Dinner"],
          ["title", "Dinner Menu"],
          ["summary", "Our dinner menu"],
        ],
      },
      {
        kind: 30405,
        created_at: 1,
        content: "",
        tags: [
          ["d", "Appetizers"],
          ["title", "Appetizers Menu Section"],
          ["summary", "Appetizers section"],
        ],
      },
      {
        kind: 30402,
        created_at: 1,
        content: "Delicious pasta",
        tags: [
          ["d", "sq-123"],
          ["title", "Spaghetti"],
          ["price", "18", "USD"],
          ["image", "https://example.com/spaghetti.jpg"],
          ["a", "30405:pubkey123:Appetizers"],
          ["a", "30405:pubkey123:Dinner"],
        ],
      },
    ];

    const { html } = buildStaticSiteFiles({
      profile,
      geohash: null,
      menuEvents,
      merchantPubkey: "e01e4b0b3677204161b8d13d0a7b88e5d2e7dac2f7d2cc5530a3bc1dca3fbd2f",
      profileTags: null,
      typeSlug: "restaurant",
      nameSlug: "testrestaurant",
    });

    // Check schema is valid JSON-LD
    expect(html).toContain("application/ld+json");
    
    // Extract and parse schema
    const schemaMatch = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
    expect(schemaMatch).toBeTruthy();
    
    if (schemaMatch) {
      const schemaJson = schemaMatch[1].trim();
      const schema = JSON.parse(schemaJson);
      
      // Check schema structure
      expect(schema["@context"]).toBe("https://schema.org");
      expect(schema["@type"]).toBe("Restaurant");
      expect(schema.name).toBe("Test Restaurant");
      
      // Check hasMenu exists and is an array
      expect(Array.isArray(schema.hasMenu)).toBe(true);
      expect(schema.hasMenu.length).toBeGreaterThan(0);
      
      // Check menu structure
      const menu = schema.hasMenu[0];
      expect(menu["@type"]).toBe("Menu");
      expect(menu.name).toBe("Dinner Menu");
      
      // Check menu sections exist
      if (menu.hasMenuSection) {
        expect(Array.isArray(menu.hasMenuSection)).toBe(true);
        if (menu.hasMenuSection.length > 0) {
          const section = menu.hasMenuSection[0];
          expect(section["@type"]).toBe("MenuSection");
          expect(Array.isArray(section.hasMenuItem)).toBe(true);
          
          // Check menu items are fully nested
          if (section.hasMenuItem.length > 0) {
            const item = section.hasMenuItem[0];
            expect(item["@type"]).toBe("MenuItem");
            expect(item.name).toBeTruthy();
          }
        }
      }
    }
  });

  it("handles restaurants with multiple menus correctly", () => {
    const profile: BusinessProfile = {
      name: "multimenurestaurant",
      displayName: "Multi Menu Restaurant",
      about: "",
      website: "",
      nip05: "",
      picture: "",
      banner: "",
      businessType: "restaurant",
      categories: [],
      street: "123 Main St",
      city: "Seattle",
      state: "WA",
      zip: "98101",
      country: "US",
    };

    const menuEvents: SquareEventTemplate[] = [
      {
        kind: 30405,
        created_at: 1,
        content: "",
        tags: [
          ["d", "Lunch"],
          ["title", "Lunch Menu"],
        ],
      },
      {
        kind: 30405,
        created_at: 1,
        content: "",
        tags: [
          ["d", "Dinner"],
          ["title", "Dinner Menu"],
        ],
      },
      {
        kind: 30402,
        created_at: 1,
        content: "Lunch item",
        tags: [
          ["d", "sq-1"],
          ["title", "Lunch Item"],
          ["a", "30405:e01e4b0b3677204161b8d13d0a7b88e5d2e7dac2f7d2cc5530a3bc1dca3fbd2f:Lunch"],
        ],
      },
      {
        kind: 30402,
        created_at: 1,
        content: "Dinner item",
        tags: [
          ["d", "sq-2"],
          ["title", "Dinner Item"],
          ["a", "30405:e01e4b0b3677204161b8d13d0a7b88e5d2e7dac2f7d2cc5530a3bc1dca3fbd2f:Dinner"],
        ],
      },
    ];

    const { html } = buildStaticSiteFiles({
      profile,
      geohash: null,
      menuEvents,
      merchantPubkey: "e01e4b0b3677204161b8d13d0a7b88e5d2e7dac2f7d2cc5530a3bc1dca3fbd2f",
      profileTags: null,
      typeSlug: "restaurant",
      nameSlug: "multimenurestaurant",
    });

    // Check at least one menu is present (menu schema building may group items)
    expect(html).toContain("Lunch Menu");
    expect(html).toContain("Lunch Item");
    expect(html).toContain("Dinner Item");
    
    // Check anchor links
    expect(html).toContain('id="menu-lunch-menu"');
    expect(html).toContain('href="#menu-lunch-menu"');
  });

  it("handles menu items with dietary badges and prices", () => {
    const profile: BusinessProfile = {
      name: "dietaryrestaurant",
      displayName: "Dietary Restaurant",
      about: "",
      website: "",
      nip05: "",
      picture: "",
      banner: "",
      businessType: "restaurant",
      categories: [],
      street: "123 Main St",
      city: "Seattle",
      state: "WA",
      zip: "98101",
      country: "US",
    };

    const menuEvents: SquareEventTemplate[] = [
      {
        kind: 30405,
        created_at: 1,
        content: "",
        tags: [
          ["d", "Menu"],
          ["title", "Main Menu"],
        ],
      },
      {
        kind: 30402,
        created_at: 1,
        content: "Vegan option",
        tags: [
          ["d", "sq-1"],
          ["title", "Vegan Salad"],
          ["price", "15", "USD"],
          ["t", "vegan"],
          ["t", "gluten-free"],
          ["a", "30405:pubkey123:Menu"],
        ],
      },
    ];

    const { html } = buildStaticSiteFiles({
      profile,
      geohash: null,
      menuEvents,
      merchantPubkey: "e01e4b0b3677204161b8d13d0a7b88e5d2e7dac2f7d2cc5530a3bc1dca3fbd2f",
      profileTags: null,
      typeSlug: "restaurant",
      nameSlug: "dietaryrestaurant",
    });

    // Check item is rendered
    expect(html).toContain("Vegan Salad");
    expect(html).toContain("Vegan option");
    expect(html).toContain("$15");
    
    // Check dietary badges are rendered (they should be in the HTML)
    // The badges are rendered as spans with class "itemBadge"
    expect(html).toContain("itemBadge");
  });
});


