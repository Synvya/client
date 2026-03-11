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

  it("synthesizes section collection events from items partOfMenuSection when section is absent from menus array", () => {
    // Regression test: the extraction LLM populates partOfMenuSection on items but sometimes
    // omits those section names from the menus array.  The client must auto-infer sections so
    // that 30405 collection events are published for every referenced section.
    const menus = [
      { Name: "Dinner", "Parent Menu": "", "Menu Type": "food", Description: "Evening menu" },
    ];
    const items = [
      { Name: "Cedar-Smoked Salmon", Description: "Salmon", "Part of Menu": "Dinner", "Part of Menu Section": "Main" },
      { Name: "Wild Mushroom Risotto", Description: "Risotto", "Part of Menu": "Dinner", "Part of Menu Section": "Main" },
      { Name: "Crispy Brussels Sprouts", Description: "Brussels", "Part of Menu": "Dinner", "Part of Menu Section": "Sides" },
    ];

    const events = buildSpreadsheetPreviewEvents({
      merchantPubkey: MERCHANT_PUBKEY,
      menus,
      items,
    });

    const collectionEvents = events.filter((e) => e.kind === 30405);
    const collectionDTags = collectionEvents.map((e) => e.tags.find((t) => t[0] === "d")?.[1]);

    // Three collections: Dinner (menu), Main (section), Sides (section)
    expect(collectionDTags).toContain("Dinner");
    expect(collectionDTags).toContain("Main");
    expect(collectionDTags).toContain("Sides");

    // "Main" section must have menu-type: section and parent pointing to Dinner
    const mainEvent = collectionEvents.find((e) => e.tags.find((t) => t[0] === "d")?.[1] === "Main")!;
    expect(mainEvent.tags).toContainEqual(["menu-type", "section"]);
    expect(mainEvent.tags).toContainEqual(["parent", `30405:${MERCHANT_PUBKEY}:Dinner`]);

    // "Sides" section must also be typed as section
    const sidesEvent = collectionEvents.find((e) => e.tags.find((t) => t[0] === "d")?.[1] === "Sides")!;
    expect(sidesEvent.tags).toContainEqual(["menu-type", "section"]);
    expect(sidesEvent.tags).toContainEqual(["parent", `30405:${MERCHANT_PUBKEY}:Dinner`]);

    // "Dinner" must be typed as menu (no parent)
    const dinnerEvent = collectionEvents.find((e) => e.tags.find((t) => t[0] === "d")?.[1] === "Dinner")!;
    expect(dinnerEvent.tags).toContainEqual(["menu-type", "menu"]);
    expect(dinnerEvent.tags.find((t) => t[0] === "parent")).toBeUndefined();

    // "Main" section contains the two salmon/risotto items, not the brussels sprout
    const mainItemATags = mainEvent.tags.filter((t) => t[0] === "a").map((t) => t[1]);
    expect(mainItemATags).toHaveLength(2);
    const sidesItemATags = sidesEvent.tags.filter((t) => t[0] === "a").map((t) => t[1]);
    expect(sidesItemATags).toHaveLength(1);
  });

  it("does not duplicate a section collection when it already appears in menus array", () => {
    // If the LLM does include sections in the menus array, we should not emit duplicate events.
    const menus = [
      { Name: "Dinner", "Parent Menu": "", "Menu Type": "food", Description: "Evening" },
      { Name: "Main", "Parent Menu": "Dinner", "Menu Type": "food", Description: "Main dishes" },
    ];
    const items = [
      { Name: "Salmon", Description: "Salmon", "Part of Menu": "Dinner", "Part of Menu Section": "Main" },
    ];

    const events = buildSpreadsheetPreviewEvents({
      merchantPubkey: MERCHANT_PUBKEY,
      menus,
      items,
    });

    const collectionEvents = events.filter((e) => e.kind === 30405);
    const mainEvents = collectionEvents.filter((e) => e.tags.find((t) => t[0] === "d")?.[1] === "Main");

    // Only one "Main" collection event — no duplicate from implicit synthesis
    expect(mainEvents).toHaveLength(1);
    expect(mainEvents[0].tags).toContainEqual(["menu-type", "section"]);
  });
});
