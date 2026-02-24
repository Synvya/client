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
