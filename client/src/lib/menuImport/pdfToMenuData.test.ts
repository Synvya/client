import { describe, it, expect } from "vitest";
import { reviewStateToSpreadsheetRows } from "./pdfToMenuData";
import type { MenuReviewState } from "./types";

describe("reviewStateToSpreadsheetRows", () => {
  it("converts PDF import state to spreadsheet rows", () => {
    const state: MenuReviewState = {
      fileName: "test.pdf",
      menus: [
        { name: "Dinner", description: "Evening menu", menuType: "food", parentMenu: "" },
        { name: "Appetizers", description: "Starters", menuType: "food", parentMenu: "Dinner" },
      ],
      items: [
        {
          name: "Caesar Salad",
          description: "Classic caesar",
          price: "12.99",
          currency: "USD",
          ingredients: ["romaine", "parmesan", "croutons"],
          suitableForDiets: ["vegetarian"],
          tags: ["appetizer"],
          partOfMenu: "Dinner",
          partOfMenuSection: "Appetizers",
          imageDescription: "A fresh caesar salad",
          imageGenEnabled: false,
          imageGenStatus: "idle",
        },
      ],
    };

    const { menus, items } = reviewStateToSpreadsheetRows(state);

    expect(menus).toHaveLength(2);
    expect(menus[0]).toEqual({
      Name: "Dinner",
      Description: "Evening menu",
      "Menu Type": "food",
      "Parent Menu": "",
    });
    expect(menus[1]).toEqual({
      Name: "Appetizers",
      Description: "Starters",
      "Menu Type": "food",
      "Parent Menu": "Dinner",
    });

    expect(items).toHaveLength(1);
    expect(items[0]).toEqual({
      Name: "Caesar Salad",
      Description: "Classic caesar",
      Price: "12.99",
      Currency: "USD",
      Pictures: "",
      Ingredients: "romaine; parmesan; croutons",
      "Suitable For Diets": "vegetarian",
      Tags: "appetizer",
      "Part of Menu": "Dinner",
      "Part of Menu Section": "Appetizers",
    });
  });

  it("prefers enriched description over original", () => {
    const state: MenuReviewState = {
      fileName: "test.pdf",
      menus: [{ name: "Menu", description: "", menuType: "food", parentMenu: "" }],
      items: [
        {
          name: "Burger",
          description: "A burger",
          enrichedDescription: "A juicy gourmet burger with aged cheddar.",
          price: "15.00",
          currency: "USD",
          ingredients: [],
          suitableForDiets: [],
          tags: [],
          partOfMenu: "Menu",
          partOfMenuSection: "",
          imageDescription: "",
          imageGenEnabled: false,
          imageGenStatus: "idle",
        },
      ],
    };

    const { items } = reviewStateToSpreadsheetRows(state);
    expect(items[0].Description).toBe("A juicy gourmet burger with aged cheddar.");
  });

  it("includes generated image URL in Pictures", () => {
    const state: MenuReviewState = {
      fileName: "test.pdf",
      menus: [{ name: "Menu", description: "", menuType: "food", parentMenu: "" }],
      items: [
        {
          name: "Pizza",
          description: "Margherita",
          price: "14.00",
          currency: "USD",
          ingredients: [],
          suitableForDiets: [],
          tags: [],
          partOfMenu: "Menu",
          partOfMenuSection: "",
          imageDescription: "",
          generatedImageUrl: "https://nostr.build/abc123.jpg",
          imageGenEnabled: true,
          imageGenStatus: "done",
        },
      ],
    };

    const { items } = reviewStateToSpreadsheetRows(state);
    expect(items[0].Pictures).toBe("https://nostr.build/abc123.jpg");
  });

  it("defaults currency to USD when empty", () => {
    const state: MenuReviewState = {
      fileName: "test.pdf",
      menus: [{ name: "Menu", description: "", menuType: "food", parentMenu: "" }],
      items: [
        {
          name: "Soup",
          description: "Tomato soup",
          price: "8.00",
          currency: "",
          ingredients: [],
          suitableForDiets: [],
          tags: [],
          partOfMenu: "Menu",
          partOfMenuSection: "",
          imageDescription: "",
          imageGenEnabled: false,
          imageGenStatus: "idle",
        },
      ],
    };

    const { items } = reviewStateToSpreadsheetRows(state);
    expect(items[0].Currency).toBe("USD");
  });
});
