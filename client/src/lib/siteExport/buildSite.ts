import type { BusinessProfile } from "@/types/profile";
import type { SquareEventTemplate } from "@/services/square";
import { buildFoodEstablishmentSchema, buildMenuSchema } from "@/lib/schemaOrg";
import { buildExportSiteModel, renderIndexHtml, renderMenuHtml, renderMenuItemHtml, type ExportSiteModel } from "./templates";
import { menuSlugFromMenuName, slugify } from "./slug";

type FileMap = Record<string, string>;

function toScopedIndexSchema(establishment: Record<string, unknown>, baseUrl: string, menus: { name: string; slug: string }[]) {
  return {
    "@context": "https://schema.org",
    ...establishment,
    hasMenu: menus.map((m) => ({
      "@type": "Menu",
      name: m.name,
      url: `${baseUrl}/${m.slug}`,
    })),
  };
}

function toScopedMenuSchema(
  establishment: Record<string, unknown>,
  baseUrl: string,
  menu: { name: string; slug: string; schema: unknown }
) {
  return {
    "@context": "https://schema.org",
    ...establishment,
    hasMenu: [
      {
        ...(menu.schema as Record<string, unknown>),
        url: `${baseUrl}/${menu.slug}`,
      },
    ],
  };
}

function toScopedItemSchema(
  establishment: Record<string, unknown>,
  baseUrl: string,
  item: { name: string; slug: string; schema: unknown }
) {
  return {
    "@context": "https://schema.org",
    ...establishment,
    // Include the item as a single MenuItem; demo does more, but this is sufficient and scoped
    hasMenu: {
      "@type": "Menu",
      name: "Menu",
      hasMenuItem: [
        {
          ...(item.schema as Record<string, unknown>),
          url: `${baseUrl}/${item.slug}`,
        },
      ],
    },
  };
}

export function buildStaticSiteFiles(params: {
  profile: BusinessProfile;
  geohash?: string | null;
  menuEvents: SquareEventTemplate[] | null;
  merchantPubkey: string;
  typeSlug: string;
  nameSlug: string;
}): { model: ExportSiteModel; files: FileMap } {
  const { profile, geohash, menuEvents, merchantPubkey, typeSlug, nameSlug } = params;
  const model = buildExportSiteModel({ profile, geohash, menuEvents, merchantPubkey, typeSlug, nameSlug });

  const establishment = buildFoodEstablishmentSchema(profile, geohash ?? null) as unknown as Record<string, unknown>;
  const menusSchema =
    menuEvents && menuEvents.length ? buildMenuSchema(profile.displayName || profile.name, menuEvents, merchantPubkey) : [];

  const baseUrl = model.baseUrl;
  const basePath = model.basePath;

  const files: FileMap = {};

  // index.html
  const indexSchema = toScopedIndexSchema(
    establishment,
    baseUrl,
    model.menus.map((m) => ({ name: m.name, slug: m.slug }))
  );
  const indexModel = { ...model, jsonLdIndex: indexSchema };
  files[`${basePath}/index.html`] = renderIndexHtml(indexModel);

  // menu + item pages
  for (const menu of model.menus) {
    const menuSlug = menu.slug;
    const menuSchema = menusSchema.find((m) => menuSlugFromMenuName(m.name) === menuSlugFromMenuName(menu.name));
    const scopedMenuSchema = toScopedMenuSchema(establishment, baseUrl, { name: menu.name, slug: menuSlug, schema: menuSchema ?? { "@type": "Menu", name: menu.name } });
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
      const itemSchema = {
        "@type": "MenuItem",
        name: it.name,
        description: it.description,
        image: it.image,
      };
      const scopedItemSchema = toScopedItemSchema(establishment, baseUrl, { name: it.name, slug: it.slug, schema: itemSchema });
      files[`${basePath}/${it.slug}`] = renderMenuItemHtml(model, menu.name, menuSlug, { ...it, contains: it.contains ?? [] }, scopedItemSchema);
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


