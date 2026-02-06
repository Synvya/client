import { describe, it, expect } from "vitest";
import { buildSpreadsheetPreviewEvents } from "./menuSpreadsheet";

const MERCHANT_PUBKEY = "npub1merchant000000000000000000000000000000000000000000000000";

describe("buildSpreadsheetPreviewEvents", () => {
  it("emits two 30402 events with distinct d-tags when same item is in different submenus", () => {
    const menus = [
      { Name: "Lunch & Dinner", "Parent Menu": "", "Menu Type": "menu", Description: "Lunch & Dinner Menu" },
      { Name: "Brunch", "Parent Menu": "", "Menu Type": "menu", Description: "Brunch Menu" },
      { Name: "Sandos", "Parent Menu": "Lunch & Dinner", Description: "Sandos section" },
      { Name: "The 'Unch Part", "Parent Menu": "Brunch", Description: "The Unch Part section" },
    ];
    const items = [
      {
        Name: "Bigfoot Burger",
        Description: "A big burger",
        "Part of Menu": "Lunch & Dinner",
        "Part of Menu Section": "Sandos",
      },
      {
        Name: "Bigfoot Burger",
        Description: "A big burger",
        "Part of Menu": "Brunch",
        "Part of Menu Section": "The 'Unch Part",
      },
    ];

    const events = buildSpreadsheetPreviewEvents({
      merchantPubkey: MERCHANT_PUBKEY,
      menus,
      items,
    });

    const productEvents = events.filter((e) => e.kind === 30402);
    expect(productEvents).toHaveLength(2);

    const dTags = productEvents.map((e) => e.tags.find((t) => t[0] === "d")?.[1]).filter(Boolean);
    expect(dTags).toHaveLength(2);
    expect(dTags[0]).not.toBe(dTags[1]);
    expect(new Set(dTags).size).toBe(2);
  });

  it("emits two 30402 events with distinct d-tags when two rows have identical name, menu, and section", () => {
    const menus = [
      { Name: "Lunch", "Parent Menu": "", "Menu Type": "menu", Description: "Lunch" },
      { Name: "Mains", "Parent Menu": "Lunch", Description: "Mains section" },
    ];
    const items = [
      { Name: "Caesar Salad", Description: "Salad", "Part of Menu": "Lunch", "Part of Menu Section": "Mains" },
      { Name: "Caesar Salad", Description: "Salad", "Part of Menu": "Lunch", "Part of Menu Section": "Mains" },
    ];

    const events = buildSpreadsheetPreviewEvents({
      merchantPubkey: MERCHANT_PUBKEY,
      menus,
      items,
    });

    const productEvents = events.filter((e) => e.kind === 30402);
    expect(productEvents).toHaveLength(2);

    const dTags = productEvents.map((e) => e.tags.find((t) => t[0] === "d")?.[1]).filter(Boolean);
    expect(dTags).toHaveLength(2);
    expect(dTags[0]).not.toBe(dTags[1]);
    expect(dTags[1]).toMatch(/-2$/);
  });

  it("emits one 30402 event with slug(name) d-tag when single row has no menu or section", () => {
    const menus: Array<Record<string, string>> = [];
    const items = [
      { Name: "House Coffee", Description: "Fresh brew" },
    ];

    const events = buildSpreadsheetPreviewEvents({
      merchantPubkey: MERCHANT_PUBKEY,
      menus,
      items,
    });

    const productEvents = events.filter((e) => e.kind === 30402);
    expect(productEvents).toHaveLength(1);

    const dTag = productEvents[0].tags.find((t) => t[0] === "d")?.[1];
    expect(dTag).toBe("house-coffee");
  });
});
