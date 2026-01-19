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

    const { html, filename } = buildStaticSiteFiles({
      profile,
      geohash: null,
      menuEvents,
      merchantPubkey: "e01e4b0b3677204161b8d13d0a7b88e5d2e7dac2f7d2cc5530a3bc1dca3fbd2f",
      profileTags: [["t", "production"], ["t", "spanish"]],
      typeSlug: "restaurant",
      nameSlug: "elcandado",
    });

    // Check filename
    expect(filename).toBe("elcandado.html");

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
    expect(html).toContain('id="item-bacalao-al-pil-pil"');
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

    const { html, filename } = buildStaticSiteFiles({
      profile,
      geohash: null,
      menuEvents: null,
      merchantPubkey: "e01e4b0b3677204161b8d13d0a7b88e5d2e7dac2f7d2cc5530a3bc1dca3fbd2f",
      profileTags: null,
      typeSlug: "restaurant",
      nameSlug: "testrestaurant",
    });

    expect(filename).toBe("testrestaurant.html");
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

    const { filename } = buildStaticSiteFiles({
      profile,
      geohash: null,
      menuEvents: null,
      merchantPubkey: "e01e4b0b3677204161b8d13d0a7b88e5d2e7dac2f7d2cc5530a3bc1dca3fbd2f",
      profileTags: null,
      typeSlug: "restaurant",
      nameSlug: "my-restaurant",
    });

    expect(filename).toBe("my-restaurant.html");
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

    const { filename } = buildStaticSiteFiles({
      profile,
      geohash: null,
      menuEvents: null,
      merchantPubkey: "e01e4b0b3677204161b8d13d0a7b88e5d2e7dac2f7d2cc5530a3bc1dca3fbd2f",
      profileTags: null,
      typeSlug: "restaurant",
      nameSlug: "restaurant",
    });

    expect(filename).toBe("restaurant.html");
  });
});


