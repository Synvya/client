import * as XLSX from "xlsx";
import type { SquareEventTemplate } from "@/services/square";
import { slugify } from "@/lib/siteExport/slug";

type MenuRow = {
  Name?: string;
  Description?: string;
  "Menu Type"?: string;
  "Parent Menu"?: string;
};

type MenuItemRow = {
  Name?: string;
  Description?: string;
  Price?: number | string;
  Currency?: string;
  Pictures?: string;
  Ingredients?: string;
  "Suitable For Diets"?: string;
  "Part of Menu"?: string;
  "Part of Menu Section"?: string;
};

function normalizeHeaderKey(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asString(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number") return String(value);
  return String(value).trim();
}

function splitList(value: string): string[] {
  // Template uses semicolons for Pictures; ingredients may use comma.
  // We'll accept comma OR semicolon OR pipe.
  return value
    .split(/[;,|]/g)
    .map((s) => s.trim())
    .filter(Boolean);
}

function firstNonEmpty(...values: Array<string | undefined | null>): string {
  for (const v of values) {
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

export async function parseMenuSpreadsheetXlsx(file: File): Promise<{
  menus: MenuRow[];
  items: MenuItemRow[];
}> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });

  const menusSheet = wb.Sheets["Menus"];
  const itemsSheet = wb.Sheets["Menu Items"];

  if (!menusSheet) {
    throw new Error('Missing required sheet "Menus".');
  }
  if (!itemsSheet) {
    throw new Error('Missing required sheet "Menu Items".');
  }

  const menus = XLSX.utils.sheet_to_json(menusSheet, { defval: "" }) as MenuRow[];
  const items = XLSX.utils.sheet_to_json(itemsSheet, { defval: "" }) as MenuItemRow[];

  // Normalize header keys (SheetJS already uses first row strings as keys; ensure trimming)
  const normalizedMenus = menus.map((row) => {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(row)) out[normalizeHeaderKey(k)] = v;
    return out as MenuRow;
  });
  const normalizedItems = items.map((row) => {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(row)) out[normalizeHeaderKey(k)] = v;
    return out as MenuItemRow;
  });

  return { menus: normalizedMenus, items: normalizedItems };
}

export function buildSpreadsheetPreviewEvents(params: {
  merchantPubkey: string;
  menus: MenuRow[];
  items: MenuItemRow[];
}): SquareEventTemplate[] {
  const createdAt = Math.floor(Date.now() / 1000);
  const { merchantPubkey, menus, items } = params;

  const parentByMenuName = new Map<string, string>();
  const titleByMenuName = new Map<string, string>();
  const typeByMenuName = new Map<string, string>();

  for (const row of menus) {
    const name = asString(row.Name);
    if (!name) continue;
    const menuType = asString((row as any)["Menu Type"]);
    const parent = asString((row as any)["Parent Menu"]);
    const description = asString(row.Description);
    parentByMenuName.set(name, parent);
    typeByMenuName.set(name, menuType);
    titleByMenuName.set(name, description);
  }

  // Build 30402 items first and keep a map name -> dTag for collection a-tags.
  const itemEvents: SquareEventTemplate[] = [];
  const dTagByItemName = new Map<string, string>();

  for (const row of items) {
    const name = asString(row.Name);
    if (!name) continue;
    const description = asString(row.Description);
    const content = `**${name}**\n\n${description}`.trim();

    const dTag = slugify(name) || `item-${itemEvents.length + 1}`;
    dTagByItemName.set(name, dTag);

    const tags: string[][] = [];
    tags.push(["d", dTag]);
    tags.push(["title", name]);

    const priceRaw = (row as any).Price;
    const currency = firstNonEmpty(asString((row as any).Currency), "USD");
    const priceStr = typeof priceRaw === "number" ? String(priceRaw) : asString(priceRaw);
    if (priceStr) {
      tags.push(["price", priceStr, currency]);
    }

    const pictures = splitList(asString((row as any).Pictures));
    for (const url of pictures) {
      tags.push(["image", url]);
    }

    const ingredients = splitList(asString((row as any).Ingredients));
    for (const ing of ingredients) {
      tags.push(["t", `ingredients:${ing.toLowerCase()}`]);
    }

    const diets = splitList(asString((row as any)["Suitable For Diets"]));
    for (const diet of diets) {
      tags.push(["t", diet]);
    }

    // Collection membership: section + parent menu + explicit menu
    const menu = asString((row as any)["Part of Menu"]);
    const section = asString((row as any)["Part of Menu Section"]);
    const collectionNames = new Set<string>();

    if (section) {
      collectionNames.add(section);
      const parent = parentByMenuName.get(section);
      if (parent) collectionNames.add(parent);
    }
    if (menu) collectionNames.add(menu);

    for (const c of collectionNames) {
      tags.push(["a", `30405:${merchantPubkey}:${c}`]);
    }

    itemEvents.push({
      kind: 30402,
      created_at: createdAt,
      content,
      tags,
    });
  }

  // Build 30405 collections and reference products via a tags.
  const collectionEvents: SquareEventTemplate[] = [];

  // Build membership map: collection name -> item dTags
  const collectionToProductDTags = new Map<string, string[]>();
  for (const row of items) {
    const name = asString(row.Name);
    if (!name) continue;
    const dTag = dTagByItemName.get(name);
    if (!dTag) continue;

    const menu = asString((row as any)["Part of Menu"]);
    const section = asString((row as any)["Part of Menu Section"]);
    const add = (c: string) => {
      if (!c) return;
      if (!collectionToProductDTags.has(c)) collectionToProductDTags.set(c, []);
      collectionToProductDTags.get(c)!.push(dTag);
    };
    if (menu) add(menu);
    if (section) {
      add(section);
      const parent = parentByMenuName.get(section);
      if (parent) add(parent);
    }
  }

  for (const row of menus) {
    const name = asString(row.Name);
    if (!name) continue;

    const menuType = asString((row as any)["Menu Type"]);
    const description = asString(row.Description);
    const parent = asString((row as any)["Parent Menu"]);

    // Title: MUST include suffix so downstream menu/section classification works.
    // - If Parent Menu is set -> section
    // - Otherwise -> menu
    const isSection = Boolean(parent);
    const title = `${name} ${isSection ? "Menu Section" : "Menu"}`;

    const productDTags = collectionToProductDTags.get(name) || [];
    if (!productDTags.length) {
      // Skip empty collections (keeps output cleaner)
      continue;
    }

    const tags: string[][] = [];
    tags.push(["d", name]);
    tags.push(["title", title]);
    tags.push(["summary", description || title]);

    for (const dTag of Array.from(new Set(productDTags))) {
      tags.push(["a", `30402:${merchantPubkey}:${dTag}`]);
    }

    collectionEvents.push({
      kind: 30405,
      created_at: createdAt,
      content: "",
      tags,
    });
  }

  return [...itemEvents, ...collectionEvents];
}


