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
  description?: string;
  sections: Array<{ name: string; items: MenuItemLink[] }>;
  directItems: MenuItemLink[];
  naddr?: string;
};

export type ExportSiteModel = {
  typeSlug: string;
  nameSlug: string;
  displayName: string;
  about?: string;
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

    return { name: menu.name, slug: menuSlug, description: menu.description, sections, directItems };
  });

  return {
    typeSlug,
    nameSlug,
    displayName: profile.displayName || profile.name,
    about: profile.about,
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
*{box-sizing:border-box}
body{font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Helvetica Neue,Arial,sans-serif;max-width:1100px;margin:0 auto;padding:0;line-height:1.6;color:#1f2937;background:#fff}
.container{padding:24px;max-width:1100px;margin:0 auto}
.header{border-bottom:1px solid #e5e7eb;padding-bottom:20px;margin-bottom:24px}
.badges{display:flex;flex-wrap:wrap;gap:8px;margin:16px 0}
.badge{display:inline-block;padding:6px 12px;border-radius:6px;background:#f3f4f6;color:#374151;font-size:13px;font-weight:500}
.card{border:1px solid #e5e7eb;border-radius:12px;padding:20px;margin:16px 0;background:#fff;transition:box-shadow 0.2s}
.card:hover{box-shadow:0 4px 6px -1px rgba(0,0,0,0.1),0 2px 4px -1px rgba(0,0,0,0.06)}
.small{color:#6b7280;font-size:14px;line-height:1.5}
a{color:#2563eb;text-decoration:none;transition:color 0.2s}
a:hover{color:#1d4ed8;text-decoration:underline}
h1,h2,h3{margin:0 0 16px 0;font-weight:600;line-height:1.2}
h1{font-size:32px;color:#111827}
h2{font-size:24px;color:#1f2937;margin-top:32px;margin-bottom:20px}
h3{font-size:20px;color:#374151}
.menuGrid{display:grid;gap:16px;margin:24px 0}
@media(min-width:768px){.menuGrid{grid-template-columns:1fr 1fr}}
.menuCard{display:block;border:1px solid #e5e7eb;border-radius:12px;padding:20px;background:#fff;transition:all 0.2s;text-decoration:none;color:inherit}
.menuCard:hover{border-color:#d1d5db;box-shadow:0 4px 6px -1px rgba(0,0,0,0.1),0 2px 4px -1px rgba(0,0,0,0.06);transform:translateY(-2px)}
.menuCard h3{margin:0 0 8px 0;font-size:20px;color:#111827}
.menuCard p{margin:0;color:#6b7280;font-size:15px;line-height:1.5}
.ctaSection{margin:48px 0;padding:32px;background:#f9fafb;border-radius:12px;border:1px solid #e5e7eb}
.ctaSection h2{margin:0 0 12px 0;font-size:28px;color:#111827}
.ctaSection p{margin:0 0 20px 0;color:#4b5563;font-size:16px;line-height:1.6}
.ctaLink{display:inline-flex;align-items:center;gap:8px;padding:12px 24px;background:#2563eb;color:#fff;border-radius:8px;font-weight:500;font-size:16px;text-decoration:none;transition:all 0.2s}
.ctaLink:hover{background:#1d4ed8;text-decoration:none;transform:translateY(-1px);box-shadow:0 4px 6px -1px rgba(0,0,0,0.1)}
.ctaExample{margin-top:16px;padding:12px;background:#fff;border-radius:8px;border:1px solid #e5e7eb;color:#6b7280;font-size:14px;font-style:italic}
.footer{margin-top:64px;padding:32px 0;border-top:1px solid #e5e7eb;text-align:center;color:#6b7280;font-size:14px}
.footer a{color:#2563eb}
.description{margin:24px 0;color:#4b5563;font-size:16px;line-height:1.7}
.backLink{display:inline-block;margin-bottom:20px;color:#2563eb;font-size:14px;text-decoration:none}
.backLink:hover{text-decoration:underline}
.itemImage{width:100%;max-width:600px;border-radius:12px;margin:20px 0;object-fit:cover}
.itemPrice{font-size:28px;font-weight:600;color:#2563eb;margin:16px 0}
.itemBadges{display:flex;flex-wrap:wrap;gap:8px;margin:16px 0}
.itemBadge{display:inline-block;padding:6px 12px;border-radius:6px;background:#eff6ff;color:#1e40af;font-size:13px;font-weight:500}
.itemCard{display:flex;gap:16px;padding:16px;border:1px solid #e5e7eb;border-radius:12px;margin:12px 0;background:#fff;transition:all 0.2s}
.itemCard:hover{border-color:#d1d5db;box-shadow:0 2px 4px rgba(0,0,0,0.05)}
.itemCardImage{width:80px;height:80px;border-radius:8px;object-fit:cover;flex-shrink:0;border:1px solid #e5e7eb}
.itemCardContent{flex:1;min-width:0}
.itemCardTitle{margin:0 0 6px 0;font-size:18px;font-weight:600;color:#111827}
.itemCardPrice{font-size:18px;font-weight:600;color:#2563eb;white-space:nowrap}
.itemCardRow{display:flex;justify-content:space-between;align-items:flex-start;gap:16px}

/* Book Restaurant Button */
.book-restaurant-btn{position:fixed;top:16px;right:16px;z-index:1000;display:inline-flex;align-items:center;justify-content:center;gap:8px;white-space:nowrap;border-radius:6px;font-size:14px;font-weight:500;height:36px;padding:0 12px;background:linear-gradient(to right, #2db85c 0%, #1f8f47 100%);color:#ffffff;text-decoration:none;border:0;box-shadow:0 1px 2px 0 rgba(0, 0, 0, 0.05);transition:all 0.2s ease;cursor:pointer}
.book-restaurant-btn:hover{background:linear-gradient(to right, #289c52 0%, #1a7d3d 100%);box-shadow:0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)}
.book-restaurant-btn:focus{outline:2px solid #2db85c;outline-offset:2px}
.book-restaurant-btn .btn-icon{width:16px;height:16px;flex-shrink:0;stroke:currentColor;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
@media(max-width:640px){.book-restaurant-btn{top:12px;right:12px;font-size:13px;height:32px;padding:0 10px}}

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
<a href="https://chatgpt.com/g/g-691d8219c93c819192573c805a6edfaf-synvya" target="_blank" rel="noopener noreferrer" class="book-restaurant-btn" aria-label="Book Restaurant with Synvya AI Assistant">
  <svg class="btn-icon" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
  </svg>
  Book Restaurant
</a>
${body}
</body>
</html>`;
}

export function renderIndexHtml(model: ExportSiteModel): string {
  const schemaTag = jsonLdScriptTag(model.jsonLdIndex);
  
  const menusHtml = model.menus
    .map((m) => {
      return `<a href="./${m.slug}" class="menuCard">
  <h3>${escapeHtml(m.name)}</h3>
  ${m.description ? `<p>${escapeHtml(m.description)}</p>` : ""}
</a>`;
    })
    .join("\n");

  const body = `
<div class="hero">
  ${model.bannerUrl ? `<img class="heroImg" src="${model.bannerUrl}" alt="${model.displayName} banner" />` : `<div class="heroImg" style="background:#111"></div>`}
  <div class="heroShade"></div>
  <div class="heroInner">
    ${model.logoUrl ? `<img class="avatar" src="${model.logoUrl}" alt="${model.displayName} logo" />` : ""}
    <div class="heroText">
      <h1 class="heroTitle">${escapeHtml(model.displayName)}</h1>
      <div class="heroSub">${escapeHtml([model.cuisine, model.addressLines[1]].filter(Boolean).join(" • "))}</div>
    </div>
  </div>
</div>

<div class="container">
  ${model.about ? `<div class="description">${markdownToHtml(model.about)}</div>` : ""}
  
  ${model.categoryBadges.length ? `<div class="badges">${model.categoryBadges.map((c) => `<span class="badge">${escapeHtml(c)}</span>`).join("")}</div>` : ""}
  
  ${model.menus.length > 0 ? `<h2>Our Menus</h2>
  <div class="menuGrid">
${menusHtml}
  </div>` : ""}
  
  <div class="ctaSection">
    <h2>Ready to Experience ${escapeHtml(model.displayName)}?</h2>
    <p>Chat with our AI assistant to explore our menu, make a reservation, or learn more about ${escapeHtml(model.displayName)}.</p>
    <a href="https://chatgpt.com/g/g-691d8219c93c819192573c805a6edfaf-synvya" target="_blank" rel="noopener noreferrer" class="ctaLink">
      Chat with Synvya Assistant →
    </a>
    <div class="ctaExample">
      Try asking: "Make a reservation at ${escapeHtml(model.displayName)}" or "What are your vegan options?"
    </div>
  </div>
  
  <footer class="footer">
    <div>© ${new Date().getFullYear()} ${escapeHtml(model.displayName)} • Powered by <a href="https://synvya.com" target="_blank" rel="noopener noreferrer">Synvya</a></div>
  </footer>
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
            `<div class="itemCard">
              ${it.image ? `<img src="${it.image}" alt="${escapeHtml(it.name)}" class="itemCardImage" />` : ""}
              <div class="itemCardContent">
                <div class="itemCardRow">
                  <div style="flex:1">
                    <a href="./${it.slug}" class="itemCardTitle">${escapeHtml(it.name)}</a>
                    ${it.description ? `<div class="small" style="margin-top:4px">${markdownToHtml(it.description)}</div>` : ""}
                  </div>
                  ${it.price ? `<div class="itemCardPrice">$${escapeHtml(it.price.amount)}</div>` : ""}
                </div>
              </div>
            </div>`
        )
        .join("\n");
      return `<h2>${escapeHtml(sec.name)}</h2>\n${items}`;
    })
    .join("\n");

  const directHtml = menu.directItems.length
    ? `<h2>Items</h2>\n${menu.directItems
        .map(
          (it) =>
            `<div class="itemCard">
              ${it.image ? `<img src="${it.image}" alt="${escapeHtml(it.name)}" class="itemCardImage" />` : ""}
              <div class="itemCardContent">
                <div class="itemCardRow">
                  <div style="flex:1">
                    <a href="./${it.slug}" class="itemCardTitle">${escapeHtml(it.name)}</a>
                    ${it.description ? `<div class="small" style="margin-top:4px">${markdownToHtml(it.description)}</div>` : ""}
                  </div>
                  ${it.price ? `<div class="itemCardPrice">$${escapeHtml(it.price.amount)}</div>` : ""}
                </div>
              </div>
            </div>`
        )
        .join("\n")}`
    : "";

  const body = `
<div class="container">
  <a href="./index.html" class="backLink">← Back to ${escapeHtml(model.displayName)}</a>
  <div class="header">
    <h1>${escapeHtml(menu.name)}</h1>
    ${menu.description ? `<div class="description">${markdownToHtml(menu.description)}</div>` : `<div class="small">${escapeHtml(model.displayName)}</div>`}
  </div>
  ${sectionsHtml}
  ${directHtml}
  
  <div class="ctaSection">
    <h2>Ready to Order ${escapeHtml(menu.name)}?</h2>
    <p>Chat with our AI assistant for menu details, dietary options, and reservations.</p>
    <a href="https://chatgpt.com/g/g-691d8219c93c819192573c805a6edfaf-synvya" target="_blank" rel="noopener noreferrer" class="ctaLink">
      Chat with Synvya Assistant →
    </a>
    <div class="ctaExample">
      Try asking: "Show me vegan ${escapeHtml(menu.name.toLowerCase())} options" or "Book a table for ${escapeHtml(menu.name.toLowerCase())} tomorrow"
    </div>
  </div>
  
  <footer class="footer">
    <div>© ${new Date().getFullYear()} ${escapeHtml(model.displayName)} • Powered by <a href="https://synvya.com" target="_blank" rel="noopener noreferrer">Synvya</a></div>
  </footer>
</div>
`;
  return baseHtml(`${model.displayName} / ${menu.name}`, schemaTag, body);
}

export function renderMenuItemHtml(model: ExportSiteModel, menuName: string, menuSlug: string, item: MenuItemLink, itemSchema: unknown): string {
  const schemaTag = jsonLdScriptTag(itemSchema);
  const badges = item.dietaryBadges.length
    ? `<div class="itemBadges">${item.dietaryBadges.map((b) => `<span class="itemBadge">${escapeHtml(b)}</span>`).join("")}</div>`
    : "";
  const contains = item.contains.length ? `<div class="small" style="margin-top:12px"><strong>Contains:</strong> ${item.contains.map(c => escapeHtml(c)).join(", ")}</div>` : "";
  const availableOn = `<div class="card"><div style="font-weight:600;margin-bottom:8px">Available On</div><div class="small">${escapeHtml(menuName)}${
    item.section ? ` - ${escapeHtml(sectionNameFromTitle(item.section))} Section` : ""
  }</div></div>`;

  const priceHtml = item.price ? `<div class="itemPrice">$${escapeHtml(item.price.amount)} ${escapeHtml(item.price.currency)}</div>` : "";

  const body = `
<div class="container">
  <a href="./${menuSlug}" class="backLink">← Back to ${escapeHtml(menuName)}</a>
  <div class="header">
    <h1>${escapeHtml(item.name)}</h1>
    ${item.image ? `<img src="${item.image}" alt="${escapeHtml(item.name)}" class="itemImage" />` : ""}
    ${priceHtml}
    ${item.description ? `<div class="description">${markdownToHtml(item.description)}</div>` : ""}
    ${badges}
    ${contains}
  </div>
  ${availableOn}
  
  <div class="ctaSection">
    <h2>Want to Try This Dish?</h2>
    <p>Chat with our AI assistant to make a reservation or ask about our menu.</p>
    <a href="https://chatgpt.com/g/g-691d8219c93c819192573c805a6edfaf-synvya" target="_blank" rel="noopener noreferrer" class="ctaLink">
      Chat with Synvya Assistant →
    </a>
    <div class="ctaExample">
      Try asking: "Reserve a table for tonight" or "Tell me about ${escapeHtml(item.name)}"
    </div>
  </div>
  
  <footer class="footer">
    <div>© ${new Date().getFullYear()} ${escapeHtml(model.displayName)} • Powered by <a href="https://synvya.com" target="_blank" rel="noopener noreferrer">Synvya</a></div>
  </footer>
</div>
`;
  return baseHtml(`${model.displayName} / ${menuName} / ${item.name}`, schemaTag, body);
}

/**
 * Renders a single-page HTML with all restaurant information, menus, and menu items.
 * All content is rendered inline (not as links) with anchor navigation.
 */
export function renderSinglePageHtml(model: ExportSiteModel, consolidatedSchema: unknown): string {
  const schemaTag = jsonLdScriptTag(consolidatedSchema);

  // Generate anchor slugs (without .html extension)
  const menuAnchorSlug = (menuName: string) => `menu-${slugify(menuName)}`;
  const itemAnchorSlug = (itemName: string) => `item-${slugify(itemName)}`;

  // Render all menus with all items inline
  const menusHtml = model.menus
    .map((menu) => {
      const menuAnchor = menuAnchorSlug(menu.name);
      
      // Render sections with items
      const sectionsHtml = menu.sections
        .map((sec) => {
          const itemsHtml = sec.items
            .map((item) => {
              const itemAnchor = itemAnchorSlug(item.name);
              const badges = item.dietaryBadges.length
                ? `<div class="itemBadges">${item.dietaryBadges.map((b) => `<span class="itemBadge">${escapeHtml(b)}</span>`).join("")}</div>`
                : "";
              const contains = item.contains.length
                ? `<div class="small" style="margin-top:12px"><strong>Contains:</strong> ${item.contains.map((c) => escapeHtml(c)).join(", ")}</div>`
                : "";
              const priceHtml = item.price
                ? `<div class="itemCardPrice">$${escapeHtml(item.price.amount)}</div>`
                : "";

              return `<div id="${itemAnchor}" class="itemCard" style="scroll-margin-top:80px">
                ${item.image ? `<img src="${item.image}" alt="${escapeHtml(item.name)}" class="itemCardImage" />` : ""}
                <div class="itemCardContent">
                  <div class="itemCardRow">
                    <div style="flex:1">
                      <h3 class="itemCardTitle" style="margin:0 0 6px 0">${escapeHtml(item.name)}</h3>
                      ${item.description ? `<div class="small" style="margin-top:4px">${markdownToHtml(item.description)}</div>` : ""}
                      ${badges}
                      ${contains}
                    </div>
                    ${priceHtml}
                  </div>
                </div>
              </div>`;
            })
            .join("\n");

          return `<h3 style="margin-top:32px;margin-bottom:16px;font-size:20px;color:#374151">${escapeHtml(sec.name)}</h3>\n${itemsHtml}`;
        })
        .join("\n");

      // Render direct items (not in sections)
      const directItemsHtml = menu.directItems.length
        ? `<h3 style="margin-top:32px;margin-bottom:16px;font-size:20px;color:#374151">Items</h3>\n${menu.directItems
            .map((item) => {
              const itemAnchor = itemAnchorSlug(item.name);
              const badges = item.dietaryBadges.length
                ? `<div class="itemBadges">${item.dietaryBadges.map((b) => `<span class="itemBadge">${escapeHtml(b)}</span>`).join("")}</div>`
                : "";
              const contains = item.contains.length
                ? `<div class="small" style="margin-top:12px"><strong>Contains:</strong> ${item.contains.map((c) => escapeHtml(c)).join(", ")}</div>`
                : "";
              const priceHtml = item.price
                ? `<div class="itemCardPrice">$${escapeHtml(item.price.amount)}</div>`
                : "";

              return `<div id="${itemAnchor}" class="itemCard" style="scroll-margin-top:80px">
                ${item.image ? `<img src="${item.image}" alt="${escapeHtml(item.name)}" class="itemCardImage" />` : ""}
                <div class="itemCardContent">
                  <div class="itemCardRow">
                    <div style="flex:1">
                      <h3 class="itemCardTitle" style="margin:0 0 6px 0">${escapeHtml(item.name)}</h3>
                      ${item.description ? `<div class="small" style="margin-top:4px">${markdownToHtml(item.description)}</div>` : ""}
                      ${badges}
                      ${contains}
                    </div>
                    ${priceHtml}
                  </div>
                </div>
              </div>`;
            })
            .join("\n")}`
        : "";

      return `<div id="${menuAnchor}" style="scroll-margin-top:80px;margin-top:48px">
        <h2 style="font-size:28px;color:#1f2937;margin-bottom:12px;border-bottom:2px solid #e5e7eb;padding-bottom:12px">${escapeHtml(menu.name)}</h2>
        ${menu.description ? `<div class="description" style="margin-bottom:24px">${markdownToHtml(menu.description)}</div>` : ""}
        ${sectionsHtml}
        ${directItemsHtml}
      </div>`;
    })
    .join("\n");

  const body = `
<div class="hero">
  ${model.bannerUrl ? `<img class="heroImg" src="${model.bannerUrl}" alt="${model.displayName} banner" />` : `<div class="heroImg" style="background:#111"></div>`}
  <div class="heroShade"></div>
  <div class="heroInner">
    ${model.logoUrl ? `<img class="avatar" src="${model.logoUrl}" alt="${model.displayName} logo" />` : ""}
    <div class="heroText">
      <h1 class="heroTitle">${escapeHtml(model.displayName)}</h1>
      <div class="heroSub">${escapeHtml([model.cuisine, model.addressLines[1]].filter(Boolean).join(" • "))}</div>
    </div>
  </div>
</div>

<div class="container">
  ${model.about ? `<div class="description">${markdownToHtml(model.about)}</div>` : ""}
  
  ${model.categoryBadges.length ? `<div class="badges">${model.categoryBadges.map((c) => `<span class="badge">${escapeHtml(c)}</span>`).join("")}</div>` : ""}
  
  ${model.menus.length > 0 ? `<div style="margin-top:48px">
    <h2 style="font-size:32px;color:#111827;margin-bottom:24px">Our Menus</h2>
    <div style="margin-bottom:32px">
      ${model.menus
        .map(
          (menu) =>
            `<a href="#${menuAnchorSlug(menu.name)}" style="display:inline-block;margin-right:16px;margin-bottom:8px;padding:8px 16px;background:#f3f4f6;border-radius:6px;color:#374151;text-decoration:none;font-weight:500;transition:all 0.2s" onmouseover="this.style.background='#e5e7eb'" onmouseout="this.style.background='#f3f4f6'">${escapeHtml(menu.name)}</a>`
        )
        .join("")}
    </div>
    ${menusHtml}
  </div>` : ""}
  
  <div class="ctaSection">
    <h2>Ready to Experience ${escapeHtml(model.displayName)}?</h2>
    <p>Chat with our AI assistant to explore our menu, make a reservation, or learn more about ${escapeHtml(model.displayName)}.</p>
    <a href="https://chatgpt.com/g/g-691d8219c93c819192573c805a6edfaf-synvya" target="_blank" rel="noopener noreferrer" class="ctaLink">
      Chat with Synvya Assistant →
    </a>
    <div class="ctaExample">
      Try asking: "Make a reservation at ${escapeHtml(model.displayName)}" or "What are your vegan options?"
    </div>
  </div>
  
  <footer class="footer">
    <div>© ${new Date().getFullYear()} ${escapeHtml(model.displayName)} • Powered by <a href="https://synvya.com" target="_blank" rel="noopener noreferrer">Synvya</a></div>
  </footer>
</div>
`;
  return baseHtml(model.displayName, schemaTag, body);
}


