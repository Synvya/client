export interface MenuExtractedItem {
  name: string;
  description: string;
  price: string;
  currency: string;
  ingredients: string[];
  suitableForDiets: string[];
  tags: string[];
  partOfMenu: string;
  partOfMenuSection: string;
  imageDescription: string;
  featured?: boolean;
}

export interface MenuExtractedMenu {
  name: string;
  description: string;
  menuType: string;
  parentMenu: string;
}

export interface MenuExtractionResult {
  menus: MenuExtractedMenu[];
  items: MenuExtractedItem[];
}

const DIET_TERMS = new Set([
  "vegetarian", "vegan", "gluten-free", "glutenfree", "gluten free",
  "dairy-free", "dairyfree", "dairy free", "nut-free", "nutfree", "nut free",
  "halal", "kosher", "paleo", "keto", "low-carb", "lowcarb", "low carb",
  "pescatarian",
]);

/** Returns true if a tag value looks like a dietary term rather than a custom tag. */
function isDietTerm(tag: string): boolean {
  const lower = tag.toLowerCase().trim();
  return DIET_TERMS.has(lower) || /diet$/i.test(tag);
}

/**
 * Removes from `tags` any values that are already in `suitableForDiets`
 * or are common dietary terms (which belong in suitableForDiets instead).
 */
export function deduplicateTags(item: MenuExtractedItem): MenuExtractedItem {
  const dietSet = new Set(item.suitableForDiets.map((d) => d.toLowerCase()));
  const filteredTags = item.tags.filter(
    (tag) => !dietSet.has(tag.toLowerCase()) && !isDietTerm(tag)
  );
  return { ...item, tags: filteredTags };
}

export interface MenuReviewItem extends MenuExtractedItem {
  enrichedDescription?: string;
  generatedImageUrl?: string;
  imageGenEnabled: boolean;
  imageGenStatus: "idle" | "generating" | "done" | "error";
  imageGenError?: string;
}

export interface MenuReviewState {
  fileName: string;
  menus: MenuExtractedMenu[];
  items: MenuReviewItem[];
}
