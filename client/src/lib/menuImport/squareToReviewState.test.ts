import { describe, it, expect } from "vitest";
import { squareEventsToReviewState } from "./squareToReviewState";
import type { SquareEventTemplate } from "@/services/square";

function makeProduct(opts: {
  dTag: string;
  title: string;
  price?: string;
  currency?: string;
  content?: string;
  imageUrl?: string;
  tTags?: string[];
  aTags?: string[];
}): SquareEventTemplate {
  const tags: string[][] = [
    ["d", opts.dTag],
    ["title", opts.title],
    ["simple", "physical"],
  ];
  if (opts.price) {
    tags.push(["price", opts.price, opts.currency || "USD"]);
  }
  if (opts.imageUrl) {
    tags.push(["image", opts.imageUrl]);
  }
  for (const t of opts.tTags || []) {
    tags.push(["t", t]);
  }
  for (const a of opts.aTags || []) {
    tags.push(["a", a]);
  }
  return {
    kind: 30402,
    created_at: 1000,
    content: opts.content || `**${opts.title}**\n\nA great dish.`,
    tags,
  };
}

function makeCollection(opts: {
  dTag: string;
  title: string;
  summary?: string;
  productDTags?: string[];
  pubkey?: string;
}): SquareEventTemplate {
  const pk = opts.pubkey || "abc123";
  const tags: string[][] = [
    ["d", opts.dTag],
    ["title", opts.title],
    ["summary", opts.summary || opts.title],
  ];
  for (const dt of opts.productDTags || []) {
    tags.push(["a", `30402:${pk}:${dt}`]);
  }
  return {
    kind: 30405,
    created_at: 1000,
    content: "",
    tags,
  };
}

describe("squareEventsToReviewState", () => {
  it("parses product events into review items", () => {
    const events: SquareEventTemplate[] = [
      makeProduct({
        dTag: "burger",
        title: "Cheeseburger",
        price: "12.99",
        content: "**Cheeseburger**\n\nJuicy beef patty with cheddar.",
      }),
    ];

    const result = squareEventsToReviewState(events);
    expect(result.items).toHaveLength(1);
    expect(result.items[0].name).toBe("Cheeseburger");
    expect(result.items[0].price).toBe("12.99");
    expect(result.items[0].currency).toBe("USD");
    expect(result.items[0].description).toBe("Juicy beef patty with cheddar.");
    expect(result.items[0].imageGenStatus).toBe("idle");
  });

  it("extracts ingredients and diets from t tags", () => {
    const events: SquareEventTemplate[] = [
      makeProduct({
        dTag: "salad",
        title: "Green Salad",
        tTags: ["ingredients:romaine", "ingredients:tomato", "VeganDiet", "GlutenFreeDiet"],
      }),
    ];

    const result = squareEventsToReviewState(events);
    const item = result.items[0];
    expect(item.ingredients).toEqual(["romaine", "tomato"]);
    expect(item.suitableForDiets).toEqual(["VeganDiet", "GlutenFreeDiet"]);
  });

  it("classifies NutFreeDiet and PescatarianDiet as diets", () => {
    const events: SquareEventTemplate[] = [
      makeProduct({
        dTag: "fish",
        title: "Grilled Salmon",
        tTags: ["NutFreeDiet", "PescatarianDiet", "popular"],
      }),
    ];

    const result = squareEventsToReviewState(events);
    const item = result.items[0];
    expect(item.suitableForDiets).toEqual(["NutFreeDiet", "PescatarianDiet"]);
    expect(item.tags).toEqual(["popular"]);
  });

  it("detects menu vs section from collection title suffix", () => {
    const events: SquareEventTemplate[] = [
      makeCollection({
        dTag: "Dinner",
        title: "Dinner Menu",
        productDTags: ["burger"],
      }),
      makeCollection({
        dTag: "Appetizers",
        title: "Appetizers Menu Section",
        productDTags: ["salad"],
      }),
      makeProduct({
        dTag: "burger",
        title: "Burger",
        aTags: ["30405:abc123:Dinner"],
      }),
      makeProduct({
        dTag: "salad",
        title: "Salad",
        aTags: ["30405:abc123:Appetizers", "30405:abc123:Dinner"],
      }),
    ];

    const result = squareEventsToReviewState(events);

    // Menus should be detected
    const dinnerMenu = result.menus.find((m) => m.name === "Dinner");
    const appSection = result.menus.find((m) => m.name === "Appetizers");
    expect(dinnerMenu).toBeDefined();
    expect(dinnerMenu?.parentMenu).toBe("");
    expect(appSection).toBeDefined();
    expect(appSection?.parentMenu).toBe("Dinner");

    // Items should have correct menu/section assignment
    const burger = result.items.find((i) => i.name === "Burger");
    expect(burger?.partOfMenu).toBe("Dinner");

    const salad = result.items.find((i) => i.name === "Salad");
    expect(salad?.partOfMenuSection).toBe("Appetizers");
    expect(salad?.partOfMenu).toBe("Dinner");
  });

  it("pre-populates items with existing image tags as done", () => {
    const events: SquareEventTemplate[] = [
      makeProduct({
        dTag: "pizza",
        title: "Pizza",
        imageUrl: "https://nostr.build/pizza.jpg",
      }),
      makeProduct({
        dTag: "pasta",
        title: "Pasta",
      }),
    ];

    const result = squareEventsToReviewState(events);
    expect(result.items[0].imageGenStatus).toBe("done");
    expect(result.items[0].generatedImageUrl).toBe("https://nostr.build/pizza.jpg");
    expect(result.items[1].imageGenStatus).toBe("idle");
    expect(result.items[1].generatedImageUrl).toBeUndefined();
  });

  it("uses default fileName when not provided", () => {
    const result = squareEventsToReviewState([]);
    expect(result.fileName).toBe("Square Catalog");
  });

  it("uses custom fileName when provided", () => {
    const result = squareEventsToReviewState([], "My Catalog");
    expect(result.fileName).toBe("My Catalog");
  });

  it("handles products with no description content", () => {
    const events: SquareEventTemplate[] = [
      {
        kind: 30402,
        created_at: 1000,
        content: "",
        tags: [["d", "water"], ["title", "Water"], ["price", "2.00", "USD"]],
      },
    ];

    const result = squareEventsToReviewState(events);
    expect(result.items[0].description).toBe("");
  });

  it("classifies non-ingredient non-diet t tags as tags", () => {
    const events: SquareEventTemplate[] = [
      makeProduct({
        dTag: "item",
        title: "Item",
        tTags: ["popular", "seasonal", "ingredients:beef"],
      }),
    ];

    const result = squareEventsToReviewState(events);
    expect(result.items[0].tags).toEqual(["popular", "seasonal"]);
    expect(result.items[0].ingredients).toEqual(["beef"]);
  });
});
