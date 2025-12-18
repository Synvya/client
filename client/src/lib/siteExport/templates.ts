import type { BusinessProfile } from "@/types/profile";
import type { SquareEventTemplate } from "@/services/square";
import { buildFoodEstablishmentSchema, buildMenuSchema } from "@/lib/schemaOrg";
import { jsonLdScriptTag } from "./schemaEmbed";
import { menuSlugFromMenuName, sectionNameFromTitle, slugify } from "./slug";
import { naddrForAddressableEvent } from "./naddr";

type MenuItemLink = {
  name: string;
  slug: string;
  description?: string;
  dietaryBadges: string[];
  contains: string[];
  price?: { amount: string; currency: string };
  image?: string;
  naddr?: string;
  section?: string;
};

type MenuLink = {
  name: string;
  slug: string;
  sections: Array<{ name: string; items: MenuItemLink[] }>;
  directItems: MenuItemLink[];
  naddr?: string;
};

export type ExportSiteModel = {
  typeSlug: string;
  nameSlug: string;
  displayName: string;
  cuisine?: string;
  addressLines: string[];
  phone?: string;
  email?: string;
  openingHoursLines: string[];
  categoryBadges: string[];
  bannerUrl?: string;
  logoUrl?: string;
  basePath: string; // e.g. restaurant/elcandado
  baseUrl: string; // e.g. https://synvya.com/restaurant/elcandado
  menus: MenuLink[];
  jsonLdIndex: unknown;
  merchantPubkey: string;
};

function extractTag(tags: string[][], key: string): string | undefined {
  return tags.find((t) => t[0] === key)?.[1];
}

function extractAllTags(tags: string[][], key: string): string[] {
  return tags.filter((t) => t[0] === key && typeof t[1] === "string").map((t) => t[1]);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Minimal markdown rendering for exported static pages.
// Supports:
// - **bold**
// - paragraphs separated by blank lines
// - single newlines -> <br/>
function markdownToHtml(markdown: string): string {
  const src = (markdown || "").trim();
  if (!src) return "";

  // Escape HTML first, then render markdown tokens.
  const escaped = escapeHtml(src);

  // Bold: **text**
  const withBold = escaped.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");

  // Paragraphs: split on blank lines
  const paragraphs = withBold.split(/\n{2,}/g);
  return paragraphs
    .map((p) => p.replace(/\n/g, "<br/>"))
    .map((p) => `<p style="margin:0 0 10px 0">${p}</p>`)
    .join("");
}

function buildMenuItemLink(
  itemEvent: SquareEventTemplate,
  merchantPubkey: string,
  baseUrl: string,
  section?: string
): MenuItemLink | null {
  const dTag = extractTag(itemEvent.tags, "d");
  const title = extractTag(itemEvent.tags, "title");
  if (!title) return null;

  const slug = `${slugify(title)}.html`;
  const description = itemEvent.content || "";
  const image = extractTag(itemEvent.tags, "image");

  const dietaryBadges = extractAllTags(itemEvent.tags, "t").map((t) =>
    t
      .replace(/_/g, " ")
      .toLowerCase()
      .replace(/\b\w/g, (c) => c.toUpperCase())
  );

  const contains = extractAllTags(itemEvent.tags, "t")
    .filter((t) => t.toLowerCase().startsWith("ingredients:"))
    .map((t) => t.slice("ingredients:".length).trim())
    .filter(Boolean);

  const priceTag = itemEvent.tags.find((t) => t[0] === "price");
  const price = priceTag?.[1] ? { amount: priceTag[1], currency: priceTag[2] || "USD" } : undefined;

  const naddr = dTag ? naddrForAddressableEvent({ identifier: dTag, pubkey: merchantPubkey, kind: 30402 }) : undefined;
  void baseUrl; // reserved if we later want absolute URLs

  return { name: title, slug, description, dietaryBadges, contains, price, image, naddr, section };
}

export function buildExportSiteModel(params: {
  profile: BusinessProfile;
  geohash?: string | null;
  menuEvents: SquareEventTemplate[] | null;
  merchantPubkey: string;
  typeSlug: string;
  nameSlug: string;
}): ExportSiteModel {
  const { profile, geohash, menuEvents, merchantPubkey, typeSlug, nameSlug } = params;
  const basePath = `${typeSlug}/${nameSlug}`;
  const baseUrl = `https://synvya.com/${basePath}`;

  const addressLines: string[] = [];
  if (profile.street) addressLines.push(profile.street);
  const cityLine = [profile.city, profile.state, profile.zip].filter(Boolean).join(", ");
  if (cityLine) addressLines.push(cityLine);

  const openingHoursLines: string[] = [];
  if (profile.openingHours?.length) {
    for (const spec of profile.openingHours) {
      const days = spec.days.join("-");
      openingHoursLines.push(`${days}: ${spec.startTime} - ${spec.endTime}`);
    }
  }

  const categoryBadges = (profile.categories || []).filter(Boolean);

  const establishment = buildFoodEstablishmentSchema(profile, geohash ?? null);
  const menusSchema =
    menuEvents && menuEvents.length ? buildMenuSchema(profile.displayName || profile.name, menuEvents, merchantPubkey) : [];

  // Index schema: FoodEstablishment + minimal menu list
  const jsonLdIndex = {
    "@context": "https://schema.org",
    ...establishment,
    hasMenu: menusSchema.map((m) => ({
      "@type": "Menu",
      name: m.name,
      url: `${baseUrl}/${menuSlugFromMenuName(m.name)}.html`,
    })),
  };

  // Build menu/item link model from menu schema (already places items into sections correctly)
  const menus: MenuLink[] = menusSchema.map((menu) => {
    const menuSlug = `${menuSlugFromMenuName(menu.name)}.html`;
    // Collection naddr requires the collection d-tag; schemaOrg Menu.name is the title.
    // We'll compute naddr later once we thread through the actual 30405 d-tags.

    const sections =
      menu.hasMenuSection?.map((sec) => ({
        name: sec.name,
        items:
          sec.hasMenuItem?.map((mi) => ({
            name: mi.name,
            slug: `${slugify(mi.name)}.html`,
            description: mi.description,
            dietaryBadges: Array.isArray(mi.suitableForDiet) ? mi.suitableForDiet.map((u) => u.split("/").pop() || u) : [],
            contains: [],
            price: mi.offers ? { amount: String(mi.offers.price), currency: String(mi.offers.priceCurrency) } : undefined,
            image: mi.image,
            section: sec.name,
          })) ?? [],
      })) ?? [];

    const directItems =
      menu.hasMenuItem?.map((mi) => ({
        name: mi.name,
        slug: `${slugify(mi.name)}.html`,
        description: mi.description,
        dietaryBadges: Array.isArray(mi.suitableForDiet) ? mi.suitableForDiet.map((u) => u.split("/").pop() || u) : [],
        contains: [],
        price: mi.offers ? { amount: String(mi.offers.price), currency: String(mi.offers.priceCurrency) } : undefined,
        image: mi.image,
      })) ?? [];

    return { name: menu.name, slug: menuSlug, sections, directItems };
  });

  return {
    typeSlug,
    nameSlug,
    displayName: profile.displayName || profile.name,
    cuisine: profile.cuisine,
    addressLines,
    phone: profile.phone,
    email: profile.email,
    openingHoursLines,
    categoryBadges,
    bannerUrl: profile.banner,
    logoUrl: profile.picture,
    basePath,
    baseUrl,
    menus,
    jsonLdIndex,
    merchantPubkey,
  };
}

function baseHtml(title: string, schemaTag: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${title}</title>
<style>
body{font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Arial;max-width:1100px;margin:0 auto;padding:24px;line-height:1.5}
.header{border-bottom:1px solid #eee;padding-bottom:16px;margin-bottom:16px}
.badges{display:flex;flex-wrap:wrap;gap:8px;margin:12px 0}
.badge{display:inline-block;padding:8px 14px;border-radius:999px;background:#eff6ff;color:#1d4ed8;font-size:14px}
.card{border:1px solid #eee;border-radius:12px;padding:16px;margin:12px 0}
.small{color:#6b7280;font-size:14px}
a{color:#2563eb;text-decoration:none}
a:hover{text-decoration:underline}
.menuGrid{display:grid;gap:12px}
@media(min-width:768px){.menuGrid{grid-template-columns:1fr 1fr}}

/* Hero */
.hero{position:relative;border-radius:16px;overflow:hidden;border:1px solid #eee}
.heroImg{width:100%;height:300px;object-fit:cover;display:block;filter:saturate(1.05)}
.heroShade{position:absolute;inset:0;background:linear-gradient(180deg, rgba(0,0,0,.25) 0%, rgba(0,0,0,.35) 55%, rgba(0,0,0,.0) 100%)}
.heroInner{position:absolute;left:24px;right:24px;bottom:18px;display:flex;align-items:flex-end;gap:18px}
.avatar{width:104px;height:104px;border-radius:999px;object-fit:cover;border:4px solid #fff;box-shadow:0 10px 30px rgba(0,0,0,.25);background:#fff}
.heroTitle{margin:0;font-size:44px;line-height:1.05;color:#fff;text-shadow:0 2px 16px rgba(0,0,0,.45)}
.heroSub{margin-top:6px;font-size:18px;color:rgba(255,255,255,.88);text-shadow:0 2px 16px rgba(0,0,0,.45)}
.heroText{padding-bottom:8px}

@media(max-width:640px){
  .heroImg{height:220px}
  .heroInner{left:16px;right:16px}
  .avatar{width:84px;height:84px}
  .heroTitle{font-size:32px}
}
</style>
${schemaTag}
</head>
<body>
${body}
</body>
</html>`;
}

export function renderIndexHtml(model: ExportSiteModel): string {
  const schemaTag = jsonLdScriptTag(model.jsonLdIndex);
  const menusHtml = model.menus
    .map((m) => `<div class=\"card\"><a href=\"./${m.slug}\"><strong>${m.name}</strong></a><div class=\"small\">View menu</div></div>`)
    .join("\n");

  const body = `
<div class="hero">
  ${model.bannerUrl ? `<img class="heroImg" src="${model.bannerUrl}" alt="${model.displayName} banner" />` : `<div class="heroImg" style="background:#111"></div>`}
  <div class="heroShade"></div>
  <div class="heroInner">
    ${model.logoUrl ? `<img class="avatar" src="${model.logoUrl}" alt="${model.displayName} logo" />` : ""}
    <div class="heroText">
      <h1 class="heroTitle">${model.displayName}</h1>
      <div class="heroSub">${[model.cuisine, model.addressLines[1]].filter(Boolean).join(" • ")}</div>
    </div>
  </div>
</div>

<div class="header" style="margin-top:14px">
  ${
    model.categoryBadges.length
      ? `<div class="badges">${model.categoryBadges.map((c) => `<span class="badge">${c}</span>`).join("")}</div>`
      : ""
  }
  <div class="card">
    ${model.addressLines.length ? `<div><strong>Address:</strong><br/>${model.addressLines.join("<br/>")}</div>` : ""}
    ${model.phone ? `<div style="margin-top:8px"><strong>Phone:</strong> ${model.phone}</div>` : ""}
    ${model.email ? `<div><strong>Email:</strong> ${model.email}</div>` : ""}
    ${
      model.openingHoursLines.length
        ? `<div style="margin-top:8px"><strong>Hours:</strong><br/>${model.openingHoursLines.join("<br/>")}</div>`
        : ""
    }
  </div>
</div>

<h2>Our Menus</h2>
<div class="menuGrid">
${menusHtml}
</div>

<div class="card">
  <div class="small">Generated by Synvya.</div>
</div>
`;
  return baseHtml(model.displayName, schemaTag, body);
}

export function renderMenuHtml(model: ExportSiteModel, menu: MenuLink, menuSchema: unknown): string {
  const schemaTag = jsonLdScriptTag(menuSchema);
  const sectionsHtml = menu.sections
    .map((sec) => {
      const items = sec.items
        .map(
          (it) =>
            `<div class="card" style="display:flex;gap:12px;align-items:flex-start">
              ${it.image ? `<img src="${it.image}" alt="${it.name}" style="width:56px;height:56px;border-radius:10px;object-fit:cover;border:1px solid #eee;flex:0 0 auto" />` : ""}
              <div style="min-width:0">
                <a href="./${it.slug}"><strong>${it.name}</strong></a>
                <div class="small">${markdownToHtml(it.description || "")}</div>
              </div>
            </div>`
        )
        .join("\n");
      return `<h2>${sec.name}</h2>\n${items}`;
    })
    .join("\n");

  const directHtml = menu.directItems.length
    ? `<h2>Items</h2>\n${menu.directItems
        .map(
          (it) =>
            `<div class="card" style="display:flex;gap:12px;align-items:flex-start">
              ${it.image ? `<img src="${it.image}" alt="${it.name}" style="width:56px;height:56px;border-radius:10px;object-fit:cover;border:1px solid #eee;flex:0 0 auto" />` : ""}
              <div style="min-width:0">
                <a href="./${it.slug}"><strong>${it.name}</strong></a>
                <div class="small">${markdownToHtml(it.description || "")}</div>
              </div>
            </div>`
        )
        .join("\n")}`
    : "";

  const body = `
<a href="./index.html">← Back to ${model.displayName}</a>
<div class="header">
  <h1>${menu.name}</h1>
  <div class="small">${model.displayName}</div>
</div>
${sectionsHtml}
${directHtml}
`;
  return baseHtml(`${model.displayName} / ${menu.name}`, schemaTag, body);
}

export function renderMenuItemHtml(model: ExportSiteModel, menuName: string, menuSlug: string, item: MenuItemLink, itemSchema: unknown): string {
  const schemaTag = jsonLdScriptTag(itemSchema);
  const badges = item.dietaryBadges.length
    ? `<div class="badges">${item.dietaryBadges.map((b) => `<span class="badge">${b}</span>`).join("")}</div>`
    : "";
  const contains = item.contains.length ? `<div class="small"><strong>Contains:</strong> ${item.contains.join(", ")}</div>` : "";
  const availableOn = `<div class="card"><div><strong>Available On</strong></div><div class="small">${menuName}${
    item.section ? ` - ${sectionNameFromTitle(item.section)} Section` : ""
  }</div></div>`;

  const body = `
<a href="./${menuSlug}">← Back to ${menuName}</a>
<div class="header">
  <h1>${item.name}</h1>
  ${item.image ? `<div class="card" style="padding:0;overflow:hidden"><img src="${item.image}" alt="${item.name}" style="width:100%;max-height:360px;object-fit:contain;background:#fff;display:block"/></div>` : ""}
  <div class="small">${markdownToHtml(item.description || "")}</div>
  ${badges}
  ${contains}
</div>
${availableOn}
`;
  return baseHtml(`${model.displayName} / ${menuName} / ${item.name}`, schemaTag, body);
}


