import type { MenuRow, MenuItemRow } from "@/lib/spreadsheet/menuSpreadsheet";
import type { MenuExtractedMenu, MenuReviewItem, MenuReviewState } from "./types";

function splitSemicolons(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
}

function asString(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number") return String(value);
  return String(value).trim();
}

export function spreadsheetToReviewState(params: {
  fileName: string;
  menus: MenuRow[];
  items: MenuItemRow[];
}): MenuReviewState {
  const { fileName, menus: menuRows, items: itemRows } = params;

  const menus: MenuExtractedMenu[] = menuRows
    .filter((row) => asString(row.Name))
    .map((row) => ({
      name: asString(row.Name),
      description: asString(row.Description),
      menuType: asString(row["Menu Type"]),
      parentMenu: asString(row["Parent Menu"]),
    }));

  const items: MenuReviewItem[] = itemRows
    .filter((row) => asString(row.Name))
    .map((row) => {
      const pictureUrl = asString(row.Pictures);
      return {
        name: asString(row.Name),
        description: asString(row.Description),
        price: asString(row.Price),
        currency: asString(row.Currency) || "USD",
        ingredients: splitSemicolons(asString(row.Ingredients)),
        suitableForDiets: splitSemicolons(asString(row["Suitable For Diets"])),
        tags: splitSemicolons(asString(row.Tags)),
        partOfMenu: asString(row["Part of Menu"]),
        partOfMenuSection: asString(row["Part of Menu Section"]),
        imageDescription: "",
        imageGenEnabled: false,
        imageGenStatus: pictureUrl ? "done" as const : "idle" as const,
        generatedImageUrl: pictureUrl || undefined,
      };
    });

  return { fileName, menus, items };
}
