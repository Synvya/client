import type { SquareEventTemplate } from "@/services/square";
import type { MenuExtractedMenu, MenuReviewItem, MenuReviewState } from "./types";

/**
 * Converts Square catalog preview events (30402 products + 30405 collections)
 * into a MenuReviewState for the unified review panel.
 */
export function squareEventsToReviewState(
  events: SquareEventTemplate[],
  fileName?: string,
): MenuReviewState {
  const collections = events.filter((e) => e.kind === 30405);
  const products = events.filter((e) => e.kind === 30402);

  // Parse collections into MenuExtractedMenu[]
  const menus: MenuExtractedMenu[] = [];
  const collectionDTagToName = new Map<string, string>();

  for (const col of collections) {
    const dTag = col.tags.find((t) => t[0] === "d")?.[1] || "";
    const title = col.tags.find((t) => t[0] === "title")?.[1] || dTag;
    const summary = col.tags.find((t) => t[0] === "summary")?.[1] || "";

    // Detect if it's a section or menu from title suffix
    const isSection = title.endsWith("Menu Section");
    const cleanName = title
      .replace(/ Menu Section$/, "")
      .replace(/ Menu$/, "")
      .trim() || dTag;

    collectionDTagToName.set(dTag, cleanName);

    // For sections, find parent menu by looking at other collections
    // that this section's products also reference
    let parentMenu = "";
    if (isSection) {
      // Find product events referencing this collection
      const sectionAddr = `30405:`;
      const productATags = products.flatMap((p) =>
        p.tags.filter((t) => t[0] === "a" && t[1]?.includes(`:${dTag}`))
      );
      // Find other collection references from same products
      for (const prod of products) {
        const refs = prod.tags
          .filter((t) => t[0] === "a" && t[1]?.startsWith("30405:"))
          .map((t) => t[1]);
        const refsDTags = refs.map((r) => r.split(":")[2]);
        if (refsDTags.includes(dTag)) {
          for (const otherDTag of refsDTags) {
            if (otherDTag !== dTag) {
              const otherCol = collections.find(
                (c) => c.tags.find((t) => t[0] === "d")?.[1] === otherDTag
              );
              if (otherCol) {
                const otherTitle = otherCol.tags.find((t) => t[0] === "title")?.[1] || "";
                if (!otherTitle.endsWith("Menu Section")) {
                  parentMenu = collectionDTagToName.get(otherDTag) ||
                    otherTitle.replace(/ Menu$/, "").trim() || otherDTag;
                  break;
                }
              }
            }
          }
          if (parentMenu) break;
        }
      }
    }

    menus.push({
      name: cleanName,
      description: summary,
      menuType: "food",
      parentMenu,
    });
  }

  // Parse products into MenuReviewItem[]
  const items: MenuReviewItem[] = [];

  for (const prod of products) {
    const titleTag = prod.tags.find((t) => t[0] === "title")?.[1] || "";
    const priceTag = prod.tags.find((t) => t[0] === "price");
    const price = priceTag?.[1] || "";
    const currency = priceTag?.[2] || "USD";
    const imageTag = prod.tags.find((t) => t[0] === "image");
    const imageUrl = imageTag?.[1] || "";

    // Extract description from content (format: **Title**\n\nDescription)
    let description = "";
    const content = prod.content || "";
    const titleMatch = content.match(/^\*\*.*?\*\*\s*\n\n?([\s\S]*)/);
    if (titleMatch) {
      description = titleMatch[1].trim();
    } else if (!content.startsWith("**")) {
      description = content.trim();
    }

    // Extract ingredients and diets from t tags
    const ingredients: string[] = [];
    const diets: string[] = [];
    const tags: string[] = [];
    for (const tag of prod.tags) {
      if (tag[0] !== "t") continue;
      const val = tag[1];
      if (val.startsWith("ingredients:")) {
        ingredients.push(val.replace("ingredients:", ""));
      } else if (val.endsWith("Diet") || val.endsWith("FreeDiet")) {
        diets.push(val);
      } else {
        tags.push(val);
      }
    }

    // Determine menu/section from a tags referencing 30405 collections
    let partOfMenu = "";
    let partOfMenuSection = "";
    const aRefs = prod.tags
      .filter((t) => t[0] === "a" && t[1]?.startsWith("30405:"))
      .map((t) => t[1].split(":")[2]);

    for (const refDTag of aRefs) {
      const col = collections.find(
        (c) => c.tags.find((t) => t[0] === "d")?.[1] === refDTag
      );
      if (!col) continue;
      const colTitle = col.tags.find((t) => t[0] === "title")?.[1] || "";
      const isSection = colTitle.endsWith("Menu Section");
      const cleanName = collectionDTagToName.get(refDTag) || refDTag;
      if (isSection) {
        partOfMenuSection = cleanName;
      } else {
        partOfMenu = cleanName;
      }
    }

    items.push({
      name: titleTag,
      description,
      price,
      currency,
      ingredients,
      suitableForDiets: diets,
      tags,
      partOfMenu,
      partOfMenuSection,
      imageDescription: "",
      imageGenEnabled: false,
      imageGenStatus: imageUrl ? "done" : "idle",
      generatedImageUrl: imageUrl || undefined,
    });
  }

  return {
    fileName: fileName || "Square Catalog",
    menus,
    items,
  };
}
