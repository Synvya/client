import { describe, it, expect } from "vitest";
import { slugify, menuSlugFromMenuName, sectionNameFromTitle } from "./slug";

describe("siteExport slug", () => {
  it("slugify strips accents and punctuation", () => {
    expect(slugify("Bocadillo de Jamón")).toBe("bocadillo-de-jamon");
    expect(slugify("Ice-cream & Coffee!")).toBe("ice-cream-and-coffee");
  });

  it("menuSlugFromMenuName strips trailing Menu", () => {
    expect(menuSlugFromMenuName("Dinner Menu")).toBe("dinner");
    expect(menuSlugFromMenuName("Lunch Menu")).toBe("lunch");
  });

  it("sectionNameFromTitle strips Menu Section", () => {
    expect(sectionNameFromTitle("Entrees Menu Section")).toBe("Entrees");
  });
});


