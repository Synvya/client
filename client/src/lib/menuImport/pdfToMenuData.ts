import type { MenuRow, MenuItemRow } from "@/lib/spreadsheet/menuSpreadsheet";
import type { MenuReviewState } from "./types";

export function reviewStateToSpreadsheetRows(state: MenuReviewState): {
  menus: MenuRow[];
  items: MenuItemRow[];
} {
  const menus: MenuRow[] = state.menus.map((m) => ({
    Name: m.name,
    Description: m.description,
    "Menu Type": m.menuType,
    "Parent Menu": m.parentMenu,
  }));

  const items: MenuItemRow[] = state.items.map((item) => ({
    Name: item.name,
    Description: item.enrichedDescription || item.description,
    Price: item.price,
    Currency: item.currency || "USD",
    Pictures: item.generatedImageUrl || "",
    Ingredients: item.ingredients.join("; "),
    "Suitable For Diets": item.suitableForDiets.join("; "),
    Tags: item.tags.join("; "),
    "Part of Menu": item.partOfMenu,
    "Part of Menu Section": item.partOfMenuSection,
  }));

  return { menus, items };
}
