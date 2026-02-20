import type { PdfExtractionResult, PdfExtractedItem } from "@/lib/menuImport/types";

function getMenuImportBaseUrl(): string {
  const base = import.meta.env.VITE_MENU_IMPORT_URL as string | undefined;
  if (!base) {
    throw new Error("Missing VITE_MENU_IMPORT_URL");
  }
  return base.replace(/\/+$/, "");
}

function getApiBaseUrl(): string {
  const base = import.meta.env.VITE_API_BASE_URL as string | undefined;
  if (!base) {
    throw new Error("Missing VITE_API_BASE_URL");
  }
  return base.replace(/\/+$/, "");
}

async function handleResponse<T>(response: Response): Promise<T> {
  let json: unknown = null;
  try {
    json = await response.json();
  } catch {
    // Ignore JSON parsing errors; we'll throw a generic message below.
  }
  if (!response.ok) {
    const message =
      typeof json === "object" && json && "error" in json
        ? String((json as Record<string, unknown>).error)
        : `Request failed with status ${response.status}`;
    throw new Error(message);
  }
  return json as T;
}

/**
 * Extracts menu data from PDF page images.
 * Calls the Lambda Function URL directly (bypasses API Gateway 30s timeout).
 */
export async function extractPdfMenu(
  pageImages: string[],
  restaurantName: string,
): Promise<PdfExtractionResult> {
  const base = getMenuImportBaseUrl();
  const response = await fetch(`${base}/menu-import/extract`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ pageImages, restaurantName }),
  });
  return handleResponse<PdfExtractionResult>(response);
}

export async function enrichMenuDescriptions(
  items: Pick<PdfExtractedItem, "name" | "description" | "ingredients">[],
  restaurantContext: { name: string; cuisine: string; about: string },
): Promise<{ items: { name: string; enrichedDescription: string }[] }> {
  const base = getMenuImportBaseUrl();
  const response = await fetch(`${base}/menu-import/enrich`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ items, restaurantContext }),
  });
  return handleResponse<{ items: { name: string; enrichedDescription: string }[] }>(response);
}

export async function generateMenuItemImage(params: {
  itemName: string;
  imageDescription: string;
  cuisineContext: string;
}): Promise<{ url: string }> {
  const base = getMenuImportBaseUrl();
  const response = await fetch(`${base}/menu-import/generate-image`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(params),
  });
  return handleResponse<{ url: string }>(response);
}
