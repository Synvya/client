import { describe, it, expect } from "vitest";
import { buildStaticSiteFiles } from "./buildSite";
import type { BusinessProfile } from "@/types/profile";
import type { SquareEventTemplate } from "@/services/square";

describe("siteExport buildSite", () => {
  it("generates index/menu/item html files under <type>/<name>/", () => {
    const profile: BusinessProfile = {
      name: "elcandado",
      displayName: "Restaurante El Candado",
      about: "",
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

    const { files } = buildStaticSiteFiles({
      profile,
      geohash: null,
      menuEvents,
      merchantPubkey: "e01e4b0b3677204161b8d13d0a7b88e5d2e7dac2f7d2cc5530a3bc1dca3fbd2f",
      typeSlug: "restaurant",
      nameSlug: "elcandado",
    });

    expect(Object.keys(files)).toContain("restaurant/elcandado/index.html");
    expect(Object.keys(files).some((p) => p === "restaurant/elcandado/dinner.html")).toBe(true);
    expect(Object.keys(files).some((p) => p === "restaurant/elcandado/bacalao-al-pil-pil.html")).toBe(true);

    expect(files["restaurant/elcandado/index.html"]).toContain("Restaurante El Candado");
    expect(files["restaurant/elcandado/index.html"]).toContain("application/ld+json");
  });
});


