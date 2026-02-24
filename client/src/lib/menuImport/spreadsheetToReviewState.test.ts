import { describe, it, expect } from "vitest";
import { spreadsheetToReviewState } from "./spreadsheetToReviewState";
import type { MenuRow, MenuItemRow } from "@/lib/spreadsheet/menuSpreadsheet";

describe("spreadsheetToReviewState", () => {
  it("maps basic fields from spreadsheet rows to review state", () => {
    const menus: MenuRow[] = [
      { Name: "Dinner", Description: "Evening menu", "Menu Type": "food", "Parent Menu": "" },
      { Name: "Appetizers", Description: "Starters", "Menu Type": "food", "Parent Menu": "Dinner" },
    ];
    const items: MenuItemRow[] = [
      {
        Name: "Caesar Salad",
        Description: "Classic caesar",
        Price: "12.99",
        Currency: "USD",
        Pictures: "",
        Ingredients: "romaine; parmesan; croutons",
        "Suitable For Diets": "vegetarian",
        Tags: "appetizer; salad",
        "Part of Menu": "Dinner",
        "Part of Menu Section": "Appetizers",
      },
    ];

    const result = spreadsheetToReviewState({ fileName: "test.xlsx", menus, items });

    expect(result.fileName).toBe("test.xlsx");
    expect(result.menus).toHaveLength(2);
    expect(result.menus[0]).toEqual({
      name: "Dinner",
      description: "Evening menu",
      menuType: "food",
      parentMenu: "",
    });
    expect(result.menus[1]).toEqual({
      name: "Appetizers",
      description: "Starters",
      menuType: "food",
      parentMenu: "Dinner",
    });

    expect(result.items).toHaveLength(1);
    const item = result.items[0];
    expect(item.name).toBe("Caesar Salad");
    expect(item.description).toBe("Classic caesar");
    expect(item.price).toBe("12.99");
    expect(item.currency).toBe("USD");
    expect(item.ingredients).toEqual(["romaine", "parmesan", "croutons"]);
    expect(item.suitableForDiets).toEqual(["vegetarian"]);
    expect(item.tags).toEqual(["appetizer", "salad"]);
    expect(item.partOfMenu).toBe("Dinner");
    expect(item.partOfMenuSection).toBe("Appetizers");
    expect(item.imageGenStatus).toBe("idle");
    expect(item.generatedImageUrl).toBeUndefined();
  });

  it("splits semicolon-delimited strings into arrays", () => {
    const items: MenuItemRow[] = [
      {
        Name: "Burger",
        Ingredients: "beef; lettuce; tomato; onion",
        "Suitable For Diets": "gluten free; dairy free",
        Tags: "entree; popular",
      },
    ];

    const result = spreadsheetToReviewState({ fileName: "test.xlsx", menus: [], items });
    const item = result.items[0];
    expect(item.ingredients).toEqual(["beef", "lettuce", "tomato", "onion"]);
    expect(item.suitableForDiets).toEqual(["gluten free", "dairy free"]);
    expect(item.tags).toEqual(["entree", "popular"]);
  });

  it("pre-populates items with existing Pictures URLs as done", () => {
    const items: MenuItemRow[] = [
      {
        Name: "Pizza",
        Pictures: "https://example.com/pizza.jpg",
      },
      {
        Name: "Pasta",
        Pictures: "",
      },
    ];

    const result = spreadsheetToReviewState({ fileName: "test.xlsx", menus: [], items });
    expect(result.items[0].imageGenStatus).toBe("done");
    expect(result.items[0].generatedImageUrl).toBe("https://example.com/pizza.jpg");
    expect(result.items[1].imageGenStatus).toBe("idle");
    expect(result.items[1].generatedImageUrl).toBeUndefined();
  });

  it("defaults currency to USD when empty", () => {
    const items: MenuItemRow[] = [
      { Name: "Soup", Price: "8.00", Currency: "" },
    ];

    const result = spreadsheetToReviewState({ fileName: "test.xlsx", menus: [], items });
    expect(result.items[0].currency).toBe("USD");
  });

  it("skips rows with empty names", () => {
    const menus: MenuRow[] = [
      { Name: "Menu", Description: "" },
      { Name: "", Description: "empty name" },
    ];
    const items: MenuItemRow[] = [
      { Name: "Item", Description: "valid" },
      { Name: "", Description: "no name" },
    ];

    const result = spreadsheetToReviewState({ fileName: "test.xlsx", menus, items });
    expect(result.menus).toHaveLength(1);
    expect(result.items).toHaveLength(1);
  });

  it("handles numeric price values", () => {
    const items: MenuItemRow[] = [
      { Name: "Item", Price: 15.5 },
    ];

    const result = spreadsheetToReviewState({ fileName: "test.xlsx", menus: [], items });
    expect(result.items[0].price).toBe("15.5");
  });
});
