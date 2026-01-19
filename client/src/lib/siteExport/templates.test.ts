import { describe, it, expect } from "vitest";
import { renderSinglePageHtml, buildExportSiteModel } from "./templates";
import type { BusinessProfile } from "@/types/profile";
import type { SquareEventTemplate } from "@/services/square";

describe("templates", () => {
  describe("renderSinglePageHtml", () => {
    it("renders single page HTML with all menus and items", () => {
      const profile: BusinessProfile = {
        name: "testrestaurant",
        displayName: "Test Restaurant",
        about: "A test restaurant",
        website: "",
        nip05: "",
        picture: "https://example.com/logo.jpg",
        banner: "https://example.com/banner.jpg",
        businessType: "restaurant",
        categories: ["Italian", "Pizza"],
        street: "123 Main St",
        city: "Seattle",
        state: "WA",
        zip: "98101",
        country: "US",
        cuisine: "Italian",
        phone: "+1 (555) 123-4567",
        email: "test@example.com",
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
          kind: 30402,
          created_at: 1,
          content: "Delicious pasta dish",
          tags: [
            ["d", "sq-123"],
            ["title", "Spaghetti Carbonara"],
            ["price", "18", "USD"],
            ["image", "https://example.com/carbonara.jpg"],
            ["a", "30405:pubkey123:Dinner"],
          ],
        },
        {
          kind: 30402,
          created_at: 1,
          content: "Fresh salad",
          tags: [
            ["d", "sq-456"],
            ["title", "Caesar Salad"],
            ["price", "12", "USD"],
            ["a", "30405:pubkey123:Dinner"],
          ],
        },
      ];

      const model = buildExportSiteModel({
        profile,
        geohash: null,
        menuEvents,
        merchantPubkey: "e01e4b0b3677204161b8d13d0a7b88e5d2e7dac2f7d2cc5530a3bc1dca3fbd2f",
        typeSlug: "restaurant",
        nameSlug: "testrestaurant",
      });

      const consolidatedSchema = {
        "@context": "https://schema.org",
        "@type": "Restaurant",
        name: "Test Restaurant",
        hasMenu: [],
      };

      const html = renderSinglePageHtml(model, consolidatedSchema);

      // Check basic structure
      expect(html).toContain("Test Restaurant");
      expect(html).toContain("A test restaurant");
      expect(html).toContain("Italian");
      expect(html).toContain("Pizza");

      // Check menu rendering
      expect(html).toContain("Dinner Menu");
      expect(html).toContain("Our dinner menu");

      // Check menu items are rendered inline
      expect(html).toContain("Spaghetti Carbonara");
      expect(html).toContain("Delicious pasta dish");
      expect(html).toContain("$18");
      expect(html).toContain("Caesar Salad");
      expect(html).toContain("Fresh salad");
      expect(html).toContain("$12");

      // Check anchor links
      expect(html).toContain('id="menu-dinner-menu"');
      expect(html).toContain('id="item-spaghetti-carbonara"');
      expect(html).toContain('id="item-caesar-salad"');
      expect(html).toContain('href="#menu-dinner-menu"');

      // Check schema is included
      expect(html).toContain("application/ld+json");

      // Check images
      expect(html).toContain("https://example.com/logo.jpg");
      expect(html).toContain("https://example.com/banner.jpg");
      expect(html).toContain("https://example.com/carbonara.jpg");
    });

    it("renders page without menus when no menu events provided", () => {
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

      const model = buildExportSiteModel({
        profile,
        geohash: null,
        menuEvents: null,
        merchantPubkey: "e01e4b0b3677204161b8d13d0a7b88e5d2e7dac2f7d2cc5530a3bc1dca3fbd2f",
        typeSlug: "restaurant",
        nameSlug: "testrestaurant",
      });

      const consolidatedSchema = {
        "@context": "https://schema.org",
        "@type": "Restaurant",
        name: "Test Restaurant",
      };

      const html = renderSinglePageHtml(model, consolidatedSchema);

      expect(html).toContain("Test Restaurant");
      expect(html).toContain("A test restaurant");
      expect(html).not.toContain("Our Menus");
    });
  });
});
