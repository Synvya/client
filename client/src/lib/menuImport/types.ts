export interface PdfExtractedItem {
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

export interface PdfExtractedMenu {
  name: string;
  description: string;
  menuType: string;
  parentMenu: string;
}

export interface PdfExtractionResult {
  menus: PdfExtractedMenu[];
  items: PdfExtractedItem[];
}

export interface PdfReviewItem extends PdfExtractedItem {
  enrichedDescription?: string;
  generatedImageUrl?: string;
  imageGenEnabled: boolean;
  imageGenStatus: "idle" | "generating" | "done" | "error";
  imageGenError?: string;
}

export interface PdfImportState {
  fileName: string;
  menus: PdfExtractedMenu[];
  items: PdfReviewItem[];
}
