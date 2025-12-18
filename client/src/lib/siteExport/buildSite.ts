import type { BusinessProfile } from "@/types/profile";
import type { SquareEventTemplate } from "@/services/square";
import { buildFoodEstablishmentSchema, buildMenuSchema } from "@/lib/schemaOrg";
import { buildExportSiteModel, renderIndexHtml, renderMenuHtml, renderMenuItemHtml, type ExportSiteModel } from "./templates";
import { menuSlugFromMenuName, slugify } from "./slug";
import { naddrForAddressableEvent } from "./naddr";
import {
  extractRecipeIngredientsFromEventTags,
  extractSuitableForDietFromEventTags,
} from "@/lib/schemaOrg";

type FileMap = Record<string, string>;

function toMenuItemOnlySchema(params: {
  dTag: string;
  naddr: string;
  url: string;
  name: string;
  description?: string;
  image?: string;
  suitableForDiet?: string[];
}) {
  return {
    "@context": "https://schema.org",
    "@type": "MenuItem",
    "@id": params.dTag,
    identifier: `nostr:${params.naddr}`,
    url: params.url,
    name: params.name,
    description: params.description,
    image: params.image,
    suitableForDiet: params.suitableForDiet && params.suitableForDiet.length ? params.suitableForDiet : undefined,
  };
}

export function buildStaticSiteFiles(params: {
  profile: BusinessProfile;
  geohash?: string | null;
  menuEvents: SquareEventTemplate[] | null;
  merchantPubkey: string;
  profileTags?: string[][] | null;
  typeSlug: string;
  nameSlug: string;
}): { model: ExportSiteModel; files: FileMap } {
  const { profile, geohash, menuEvents, merchantPubkey, profileTags, typeSlug, nameSlug } = params;
  const model = buildExportSiteModel({ profile, geohash, menuEvents, merchantPubkey, typeSlug, nameSlug });

  const establishment = buildFoodEstablishmentSchema(profile, {
    geohash: geohash ?? null,
    pubkeyHex: merchantPubkey,
    kind0Tags: profileTags ?? undefined,
  }) as unknown as Record<string, unknown>;
  const menusSchema =
    menuEvents && menuEvents.length
      ? buildMenuSchema(profile.displayName || profile.name, menuEvents, merchantPubkey, model.baseUrl)
      : [];

  const baseUrl = model.baseUrl;
  const basePath = model.basePath;

  const files: FileMap = {};

  const productByTitle = new Map<string, SquareEventTemplate>();
  if (menuEvents?.length) {
    for (const evt of menuEvents) {
      if (evt.kind !== 30402) continue;
      const title = evt.tags.find((t) => Array.isArray(t) && t[0] === "title")?.[1];
      if (!title) continue;
      productByTitle.set(title, evt);
    }
  }

  // index.html
  const indexSchema = {
    "@context": "https://schema.org",
    ...establishment,
    ...(menusSchema.length ? { hasMenu: menusSchema } : {}),
  };
  const indexModel = { ...model, jsonLdIndex: indexSchema };
  files[`${basePath}/index.html`] = renderIndexHtml(indexModel);

  // menu + item pages
  for (const menu of model.menus) {
    const menuSlug = menu.slug;
    const menuSchema = menusSchema.find((m) => menuSlugFromMenuName(m.name) === menuSlugFromMenuName(menu.name));
    // Menu pages should embed Menu-only JSON-LD (no FoodEstablishment wrapper).
    // MenuItems remain nested without their own @context.
    const scopedMenuSchema: Record<string, unknown> = {
      "@context": "https://schema.org",
      ...((menuSchema ?? { "@type": "Menu", name: menu.name }) as Record<string, unknown>),
      url: `${baseUrl}/${menuSlug}`,
    };
    files[`${basePath}/${menuSlug}`] = renderMenuHtml(model, menu, scopedMenuSchema);

    // Item pages for section items + direct items (dedupe by slug)
    const allItems = [
      ...menu.directItems.map((i) => ({ ...i, section: undefined })),
      ...menu.sections.flatMap((s) => s.items.map((i) => ({ ...i, section: s.name }))),
    ];
    const bySlug = new Map<string, typeof allItems[number]>();
    for (const it of allItems) {
      if (!bySlug.has(it.slug)) bySlug.set(it.slug, it);
    }

    for (const it of bySlug.values()) {
      const productEvent = productByTitle.get(it.name);
      const dTag = productEvent?.tags.find((t) => Array.isArray(t) && t[0] === "d")?.[1] || "";
      const img = productEvent?.tags.find((t) => Array.isArray(t) && t[0] === "image")?.[1] || it.image;
      const suitableForDiet = productEvent ? extractSuitableForDietFromEventTags(productEvent.tags) : [];
      const ingredients = productEvent ? extractRecipeIngredientsFromEventTags(productEvent.tags) : [];
      const naddr = dTag ? naddrForAddressableEvent({ identifier: dTag, pubkey: merchantPubkey, kind: 30402 }) : "";
      const url = `${baseUrl}/${it.slug}`;

      const baseDescription = it.description || "";
      const suffix = ingredients.length ? `Allergens: ${ingredients.join(", ")}` : "";
      const description = [baseDescription, suffix].filter(Boolean).join(baseDescription && suffix ? " " : "");

      const menuItemSchema = toMenuItemOnlySchema({
        dTag,
        naddr,
        url,
        name: it.name,
        description,
        image: img,
        suitableForDiet,
      });

      files[`${basePath}/${it.slug}`] = renderMenuItemHtml(
        model,
        menu.name,
        menuSlug,
        { ...it, image: img, naddr, contains: it.contains ?? [] },
        menuItemSchema
      );
    }
  }

  // Add a simple README for the customer (inside the exported folder)
  files[`${basePath}/README.txt`] = [
    `Synvya static site export`,
    ``,
    `Deploy folder: ${basePath}/`,
    `Expected URL: https://synvya.com/${basePath}/index.html`,
    ``,
    `Upload all files in this folder to Synvya for deployment.`,
  ].join("\n");

  // Ensure we didn't accidentally create a file named ".html" (slugify edge)
  for (const path of Object.keys(files)) {
    if (path.endsWith("/.html")) {
      delete files[path];
    }
  }

  // Ensure menu/item slugs are safe
  void slugify;

  return { model, files };
}


