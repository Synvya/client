import type { BusinessProfile, BusinessType } from "@/types/profile";
import type { SquareEventTemplate } from "@/services/square";
import { nip19 } from "nostr-tools";
import { menuSlugFromMenuName, slugify } from "@/lib/siteExport/slug";
import { mapBusinessTypeToEstablishmentSlug } from "@/lib/siteExport/typeMapping";
import { naddrForAddressableEvent } from "@/lib/siteExport/naddr";

// ============================================================================
// Schema.org Type Definitions
// ============================================================================

interface SchemaOrgThing {
  "@type": string;
  [key: string]: unknown;
}

interface SchemaOrgPostalAddress extends SchemaOrgThing {
  "@type": "PostalAddress";
  streetAddress?: string;
  addressLocality?: string;
  addressRegion?: string;
  postalCode?: string;
  addressCountry?: string;
}

interface SchemaOrgGeoCoordinates extends SchemaOrgThing {
  "@type": "GeoCoordinates";
  latitude: number;
  longitude: number;
}

interface SchemaOrgOpeningHoursSpecification extends SchemaOrgThing {
  "@type": "OpeningHoursSpecification";
  dayOfWeek: string[];
  opens: string;
  closes: string;
}

interface SchemaOrgOffer extends SchemaOrgThing {
  "@type": "Offer";
  price: string;
  priceCurrency: string;
}

interface SchemaOrgEntryPoint extends SchemaOrgThing {
  "@type": "EntryPoint";
  urlTemplate: string;
  actionPlatform?: string;
}

interface SchemaOrgReservation extends SchemaOrgThing {
  "@type": "Reservation";
  name: string;
}

interface SchemaOrgReserveAction extends SchemaOrgThing {
  "@type": "ReserveAction";
  target: SchemaOrgEntryPoint;
  result: SchemaOrgReservation;
}

interface SchemaOrgMenuItem extends SchemaOrgThing {
  "@type": "MenuItem";
  "@id"?: string;
  identifier?: string;
  url?: string;
  name: string;
  description?: string;
  offers?: SchemaOrgOffer;
  suitableForDiet?: string[];
  image?: string;
}

interface SchemaOrgMenuSection extends SchemaOrgThing {
  "@type": "MenuSection";
  name: string;
  hasMenuItem?: SchemaOrgMenuItem[];
}

interface SchemaOrgMenu extends SchemaOrgThing {
  "@type": "Menu";
  "@id"?: string; // Optional - only needed when using @graph with references
  identifier?: string;
  name: string;
  description?: string;
  url?: string;
  hasMenuItem?: SchemaOrgMenuItem[];
  hasMenuSection?: SchemaOrgMenuSection[];
}

interface SchemaOrgFoodEstablishment extends SchemaOrgThing {
  "@type": string;
  "@id"?: string;
  name: string;
  alternateName?: string;
  description?: string;
  image?: string;
  logo?: string;
  address?: SchemaOrgPostalAddress;
  telephone?: string;
  email?: string;
  url?: string;
  servesCuisine?: string;
  keywords?: string;
  priceRange?: string;
  geo?: SchemaOrgGeoCoordinates;
  openingHoursSpecification?: SchemaOrgOpeningHoursSpecification[];
  acceptsReservations?: boolean;
  potentialAction?: SchemaOrgReserveAction;
  hasMenu?: SchemaOrgMenu | SchemaOrgMenu[];
}

interface SchemaOrgGraph {
  "@context": "https://schema.org";
  "@graph": SchemaOrgThing[];
}

// ============================================================================
// Mapping Functions
// ============================================================================

/**
 * Maps BusinessType to Schema.org FoodEstablishment types
 */
function mapBusinessTypeToSchemaOrg(businessType: BusinessType): string {
  const mapping: Record<BusinessType, string> = {
    "bakery": "Bakery",
    "barOrPub": "BarOrPub",
    "brewery": "Brewery",
    "cafeOrCoffeeShop": "CafeOrCoffeeShop",
    "distillery": "Distillery",
    "fastFoodRestaurant": "FastFoodRestaurant",
    "iceCreamShop": "IceCreamShop",
    "restaurant": "Restaurant",
    "winery": "Winery"
  };
  return mapping[businessType] || "Restaurant";
}

/**
 * Maps day abbreviations to full Schema.org day names
 */
function mapDayToSchemaOrg(day: string): string {
  const mapping: Record<string, string> = {
    "Mo": "Monday",
    "Tu": "Tuesday",
    "We": "Wednesday",
    "Th": "Thursday",
    "Fr": "Friday",
    "Sa": "Saturday",
    "Su": "Sunday"
  };
  return mapping[day] || day;
}

/**
 * Decodes geohash to approximate latitude and longitude
 * Simplified implementation for basic geohash decoding
 */
function decodeGeohash(geohash: string): { latitude: number; longitude: number } | null {
  if (!geohash || geohash.length < 4) {
    return null;
  }

  // This is a simplified geohash decoder. For production, consider using a library like ngeohash
  // For now, we'll use a basic approximation based on the geohash prefix
  const base32 = "0123456789bcdefghjkmnpqrstuvwxyz";
  let latMin = -90.0, latMax = 90.0;
  let lonMin = -180.0, lonMax = 180.0;
  let isEven = true;

  for (let i = 0; i < geohash.length; i++) {
    const char = geohash[i];
    const idx = base32.indexOf(char);
    if (idx === -1) continue;

    for (let j = 4; j >= 0; j--) {
      const bit = (idx >> j) & 1;
      if (isEven) {
        const lonMid = (lonMin + lonMax) / 2;
        if (bit === 1) {
          lonMin = lonMid;
        } else {
          lonMax = lonMid;
        }
      } else {
        const latMid = (latMin + latMax) / 2;
        if (bit === 1) {
          latMin = latMid;
        } else {
          latMax = latMid;
        }
      }
      isEven = !isEven;
    }
  }

  return {
    latitude: (latMin + latMax) / 2,
    longitude: (lonMin + lonMax) / 2
  };
}

/**
 * Maps dietary preferences from Nostr events to Schema.org diet types
 */
function mapDietaryToSchemaOrg(dietaryTag: string): string | null {
  const normalized = dietaryTag.toLowerCase().replace(/[_-\s]/g, "");
  const mapping: Record<string, string> = {
    "vegan": "http://schema.org/VeganDiet",
    "vegetarian": "http://schema.org/VegetarianDiet",
    "glutenfree": "http://schema.org/GlutenFreeDiet",
    "kosher": "http://schema.org/KosherDiet",
    "halal": "http://schema.org/HalalDiet",
    // Best-effort legacy mappings; keep outputs within allowed schema.org Diet URLs
    "dairyfree": "http://schema.org/LowLactoseDiet",
    "lowlactose": "http://schema.org/LowLactoseDiet",
    "lowfat": "http://schema.org/LowFatDiet",
    "lowcalorie": "http://schema.org/LowCalorieDiet",
    "lowsalt": "http://schema.org/LowSaltDiet",
    "diabetic": "http://schema.org/DiabeticDiet",
    "hindudiet": "http://schema.org/HinduDiet"
  };
  return mapping[normalized] || null;
}

/**
 * Exported helper: maps raw dietary tags (e.g. "DAIRY_FREE", "gluten-free") to schema.org Diet URLs.
 * Kept in sync with the MenuItem schema generation used in buildMenuItem().
 */
export function mapDietaryTagToSchemaOrgUrl(dietaryTag: string): string | null {
  return mapDietaryToSchemaOrg(dietaryTag);
}

export function extractRecipeIngredientsFromEventTags(tags: string[][]): string[] {
  return tags
    .filter((t) => Array.isArray(t) && t[0] === "schema.org:Recipe:recipeIngredient" && typeof t[1] === "string")
    .map((t) => t[1])
    .filter(Boolean);
}

export function extractSuitableForDietFromEventTags(tags: string[][]): string[] {
  const ALLOWED = new Set([
    "http://schema.org/DiabeticDiet",
    "http://schema.org/GlutenFreeDiet",
    "http://schema.org/HalalDiet",
    "http://schema.org/HinduDiet",
    "http://schema.org/KosherDiet",
    "http://schema.org/LowCalorieDiet",
    "http://schema.org/LowFatDiet",
    "http://schema.org/LowLactoseDiet",
    "http://schema.org/LowSaltDiet",
    "http://schema.org/VeganDiet",
    "http://schema.org/VegetarianDiet",
  ]);

  const normalizeSchemaOrgDietUrl = (raw: string): string | null => {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    // Accept both http/https and normalize to http://schema.org/...
    const m = trimmed.match(/^https?:\/\/schema\.org\/([A-Za-z]+Diet)$/);
    if (m) {
      const normalizedUrl = `http://schema.org/${m[1]}`;
      return ALLOWED.has(normalizedUrl) ? normalizedUrl : null;
    }
    // If someone stored just the diet token, try mapping
    const mapped = mapDietaryToSchemaOrg(trimmed);
    return mapped && ALLOWED.has(mapped) ? mapped : null;
  };

  // Preferred (CSV): schema.org:MenuItem:suitableForDiet tag values already as schema.org URLs
  const explicit = tags
    .filter((t) => Array.isArray(t) && t[0] === "schema.org:MenuItem:suitableForDiet" && typeof t[1] === "string")
    .map((t) => normalizeSchemaOrgDietUrl(t[1]))
    .filter((v): v is string => typeof v === "string" && v.length > 0);
  if (explicit.length) return Array.from(new Set(explicit));

  // Fallback: map generic t-tags (historical)
  const mapped = tags
    .filter((t) => Array.isArray(t) && t[0] === "t" && typeof t[1] === "string")
    .map((t) => t[1])
    .map(mapDietaryToSchemaOrg)
    .filter((d): d is string => d !== null);
  return Array.from(new Set(mapped)).filter((u) => ALLOWED.has(u));
}

function menuUrlForTitle(baseUrl: string, menuTitle: string): string {
  return `${baseUrl}/${menuSlugFromMenuName(menuTitle)}.html`;
}

function menuItemUrlForTitle(baseUrl: string, itemTitle: string): string {
  return `${baseUrl}/${slugify(itemTitle)}.html`;
}

// ============================================================================
// Schema Generation Functions
// ============================================================================

/**
 * Builds a FoodEstablishment schema from a business profile
 */
export function buildFoodEstablishmentSchema(
  profile: BusinessProfile,
  geohashOrOptions?: string | null | { geohash?: string | null; pubkeyHex?: string; kind0Tags?: string[][] }
): SchemaOrgFoodEstablishment {
  const geohash = typeof geohashOrOptions === "string" || geohashOrOptions == null ? geohashOrOptions : geohashOrOptions.geohash;
  const pubkeyHex = typeof geohashOrOptions === "object" && geohashOrOptions ? geohashOrOptions.pubkeyHex : undefined;
  const kind0Tags = typeof geohashOrOptions === "object" && geohashOrOptions ? geohashOrOptions.kind0Tags : undefined;

  const schema: SchemaOrgFoodEstablishment = {
    "@type": mapBusinessTypeToSchemaOrg(profile.businessType),
    "name": profile.displayName || profile.name
  };

  // Identity
  if (pubkeyHex) {
    try {
      const npub = nip19.npubEncode(pubkeyHex);
      schema["@id"] = `nostr:${npub}`;
    } catch (e) {
      // If pubkey is invalid, skip @id
    }
  }
  if (profile.name) {
    schema.alternateName = profile.name;
  }

  // Description
  if (profile.about) {
    schema.description = profile.about;
  }

  // Images (CSV format)
  // - image = banner
  // - logo = picture
  if (profile.banner) {
    schema.image = profile.banner;
  }
  if (profile.picture) {
    schema.logo = profile.picture;
  }

  // Address
  if (profile.street || profile.city || profile.state || profile.zip) {
    const address: SchemaOrgPostalAddress = {
      "@type": "PostalAddress"
    };
    if (profile.street) address.streetAddress = profile.street;
    if (profile.city) address.addressLocality = profile.city;
    if (profile.state) address.addressRegion = profile.state;
    if (profile.zip) address.postalCode = profile.zip;
    if (profile.country) address.addressCountry = profile.country;
    schema.address = address;
  }

  // Contact information
  if (profile.phone) {
    const raw = profile.phone.trim();
    if (raw.toLowerCase().startsWith("tel:")) {
      schema.telephone = raw;
    } else {
      const sanitized = raw.replace(/[^\d+]/g, "");
      schema.telephone = `tel:${sanitized || raw}`;
    }
  }
  if (profile.email) {
    const raw = profile.email.trim();
    schema.email = raw.toLowerCase().startsWith("mailto:") ? raw : `mailto:${raw}`;
  }
  if (profile.website) {
    schema.url = profile.website;
  }

  // Cuisine
  if (profile.cuisine) {
    schema.servesCuisine = profile.cuisine;
  }

  // Keywords (CSV format): comma-separated from kind:0 `t` tags, fallback to profile categories
  const keywordValues =
    kind0Tags && kind0Tags.length
      ? kind0Tags.filter((t) => Array.isArray(t) && t[0] === "t" && typeof t[1] === "string").map((t) => t[1])
      : profile.categories ?? [];
  if (keywordValues.length) {
    schema.keywords = Array.from(new Set(keywordValues)).join(", ");
  }

  // Geo coordinates from geohash
  if (geohash) {
    const coords = decodeGeohash(geohash);
    if (coords) {
      schema.geo = {
        "@type": "GeoCoordinates",
        latitude: coords.latitude,
        longitude: coords.longitude
      };
    }
  }

  // Opening hours
  if (profile.openingHours && profile.openingHours.length > 0) {
    schema.openingHoursSpecification = profile.openingHours.map((spec) => ({
      "@type": "OpeningHoursSpecification",
      dayOfWeek: spec.days.map(mapDayToSchemaOrg),
      opens: spec.startTime,
      closes: spec.endTime
    }));
  }

  // Accepts reservations with potentialAction
  if (profile.acceptsReservations) {
    schema.acceptsReservations = true;
    schema.potentialAction = {
      "@type": "ReserveAction",
      target: {
        "@type": "EntryPoint",
        urlTemplate: "https://synvya.com",
        actionPlatform: "https://chatgpt.com/g/g-691d8219c93c819192573c805a6edfaf-synvya"
      },
      result: {
        "@type": "Reservation",
        name: "Restaurant Reservation"
      }
    };
  } else if (profile.acceptsReservations === false) {
    schema.acceptsReservations = false;
  }

  return schema;
}

import { extractCollectionRefs } from "./nostrEventProcessing";

/**
 * Builds Menu and MenuItem schemas from Square catalog events
 * Properly handles menu/section hierarchy and item placement
 */
export function buildMenuSchema(
  merchantName: string,
  menuEvents: SquareEventTemplate[],
  merchantPubkey: string,
  baseUrl?: string
): SchemaOrgMenu[] {
  if (!menuEvents || menuEvents.length === 0) {
    return [];
  }

  // Separate products (30402) and collections (30405)
  const productEvents = menuEvents.filter((e) => e.kind === 30402);
  const collectionEvents = menuEvents.filter((e) => e.kind === 30405);

  // Step 1: Classify collections (menus vs sections)
  // Build a map of collection d-tags to collection data
  const collectionsMap = new Map<
    string,
    {
      name: string;
      title: string;
      summary?: string;
      type: "menu" | "section";
      products: SchemaOrgMenuItem[];
    }
  >();

  for (const collectionEvent of collectionEvents) {
    const dTag = collectionEvent.tags.find((t) => t[0] === "d")?.[1];
    const titleTag = collectionEvent.tags.find((t) => t[0] === "title")?.[1];
    const summaryTag = collectionEvent.tags.find((t) => t[0] === "summary")?.[1];
    if (!dTag || !titleTag) continue;

    // Classify as menu or section
    const isTopLevel = titleTag.includes(" Menu") && !titleTag.includes("Menu Section");
    const type = isTopLevel ? "menu" : "section";

    collectionsMap.set(dTag, {
      name: dTag,
      title: titleTag,
      summary: summaryTag,
      type,
      products: []
    });
  }

  // Step 2: Build menu items and extract product-to-collection references
  const uncategorizedItems: SchemaOrgMenuItem[] = [];
  const productToMenuItem = new Map<SquareEventTemplate, SchemaOrgMenuItem>();
  const productToCollectionRefs = new Map<SquareEventTemplate, string[]>();

  for (const productEvent of productEvents) {
    const menuItem = buildMenuItem(productEvent, { merchantPubkey, baseUrl });
    if (!menuItem) continue;

    productToMenuItem.set(productEvent, menuItem);

    // Extract collection references using proper parsing
    const collectionRefs = extractCollectionRefs(productEvent, merchantPubkey);
    productToCollectionRefs.set(productEvent, collectionRefs);

    if (collectionRefs.length === 0) {
      // No collection reference, add to uncategorized
      uncategorizedItems.push(menuItem);
    } else {
      // Add item to each referenced collection
      for (const collectionDTag of collectionRefs) {
        const collection = collectionsMap.get(collectionDTag);
        if (collection) {
          collection.products.push(menuItem);
        }
      }
    }
  }

  // Step 3: Build section-to-menu relationships
  // A section belongs to a menu if items in that section also reference the menu
  const sectionToMenuMap = new Map<string, string>(); // section-d-tag -> menu-d-tag

  for (const [sectionDTag, sectionCollection] of collectionsMap.entries()) {
    if (sectionCollection.type !== "section") continue;

    // Get all products that reference this section
    const productsInSection = Array.from(productToCollectionRefs.entries())
      .filter(([, refs]) => refs.includes(sectionDTag))
      .map(([product]) => product);

    // Check if any of those products also reference a top-level menu
    for (const product of productsInSection) {
      const refs = productToCollectionRefs.get(product) || [];
      for (const refDTag of refs) {
        const refCollection = collectionsMap.get(refDTag);
        if (refCollection && refCollection.type === "menu") {
          // This section belongs to this menu
          sectionToMenuMap.set(sectionDTag, refDTag);
          break; // One menu per section is enough
        }
      }
      if (sectionToMenuMap.has(sectionDTag)) break;
    }
  }

  // Step 4: Categorize items
  // Items in sections should only appear in sections, not directly in menus
  const itemsInSections = new Set<SchemaOrgMenuItem>();

  for (const [dTag, collection] of collectionsMap.entries()) {
    if (collection.type === "section") {
      // Mark all items in sections
      for (const item of collection.products) {
        itemsInSections.add(item);
      }
    }
  }

  // Step 5: Build menu structure
  const menus: SchemaOrgMenu[] = [];

  // Build top-level menus
  for (const [menuDTag, menuCollection] of collectionsMap.entries()) {
    if (menuCollection.type !== "menu") continue;

    const menu: SchemaOrgMenu = {
      "@type": "Menu",
      "@id": menuDTag,
      "name": menuCollection.title
    };

    // CSV format: description from summary if present, else fallback
    menu.description = menuCollection.summary || `${menuCollection.title} for ${merchantName}`;
    if (baseUrl) {
      menu.url = menuUrlForTitle(baseUrl, menuCollection.title);
    }
    // CSV format: identifier as nostr:naddr
    try {
      const naddr = naddrForAddressableEvent({ identifier: menuDTag, pubkey: merchantPubkey, kind: 30405 });
      menu.identifier = `nostr:${naddr}`;
    } catch (e) {
      // ignore
    }

    // Find sections that belong to this menu
    const menuSections: SchemaOrgMenuSection[] = [];
    for (const [sectionDTag, sectionCollection] of collectionsMap.entries()) {
      if (sectionCollection.type !== "section") continue;
      if (sectionToMenuMap.get(sectionDTag) !== menuDTag) continue;
      if (sectionCollection.products.length === 0) continue;

      menuSections.push({
        "@type": "MenuSection",
        "name": sectionCollection.title.replace(" Menu Section", ""),
        "hasMenuItem": sectionCollection.products
      });
    }

    if (menuSections.length > 0) {
      menu.hasMenuSection = menuSections;
    }

    // Add items directly to menu if they:
    // 1. Reference this menu but are NOT in any section, OR
    // 2. Are uncategorized (only for first menu)
    const directMenuItems: SchemaOrgMenuItem[] = [];

    // Add uncategorized items to the first menu only
    if (menus.length === 0 && uncategorizedItems.length > 0) {
      directMenuItems.push(...uncategorizedItems);
    }

    // Add items from this collection that aren't in sections
    for (const item of menuCollection.products) {
      if (!itemsInSections.has(item)) {
        directMenuItems.push(item);
      }
    }

    if (directMenuItems.length > 0) {
      menu.hasMenuItem = directMenuItems;
    }

    // Only add menu if it has sections or items
    if (menuSections.length > 0 || directMenuItems.length > 0) {
      menus.push(menu);
    }
  }

  // If no menus were created but we have items, create a default menu
  if (menus.length === 0 && (uncategorizedItems.length > 0 || productEvents.length > 0)) {
    const allItems =
      uncategorizedItems.length > 0
        ? uncategorizedItems
        : (productEvents
            .map((evt) => buildMenuItem(evt, { merchantPubkey, baseUrl }))
            .filter(Boolean) as SchemaOrgMenuItem[]);

    const fallbackMenu: SchemaOrgMenu = {
      "@type": "Menu",
      "name": `${merchantName} Menu`,
      "hasMenuItem": allItems
    };
    fallbackMenu.description = `${merchantName} Menu`;
    if (baseUrl) {
      fallbackMenu.url = menuUrlForTitle(baseUrl, fallbackMenu.name);
    }
    menus.push(fallbackMenu);
  }

  return menus;
}

/**
 * Builds a single MenuItem from a product event
 */
function buildMenuItem(
  productEvent: SquareEventTemplate,
  opts: { merchantPubkey?: string; baseUrl?: string }
): SchemaOrgMenuItem | null {
  const titleTag = productEvent.tags.find((t) => t[0] === "title")?.[1];
  if (!titleTag) return null;

  const menuItem: SchemaOrgMenuItem = {
    "@type": "MenuItem",
    "name": titleTag
  };

  // Description
  const summaryTag = productEvent.tags.find((t) => t[0] === "summary")?.[1];
  const baseDescription = summaryTag || productEvent.content || "";
  const ingredients = extractRecipeIngredientsFromEventTags(productEvent.tags);
  if (baseDescription || ingredients.length) {
    const suffix = ingredients.length ? `Allergens: ${ingredients.join(", ")}` : "";
    menuItem.description = [baseDescription, suffix].filter(Boolean).join(baseDescription && suffix ? " " : "");
  }

  // Price - only include if present in Nostr event
  const priceTag = productEvent.tags.find((t) => t[0] === "price")?.[1];
  if (priceTag) {
    const currencyTag = productEvent.tags.find((t) => t[0] === "price")?.[2] || "USD";
    const priceInDollars = (parseInt(priceTag, 10) / 100).toFixed(2);
    menuItem.offers = {
      "@type": "Offer",
      "price": priceInDollars,
      "priceCurrency": currencyTag
    };
  }
  // If no price tag, don't include offers property at all

  // Image
  const imageTag = productEvent.tags.find((t) => t[0] === "image")?.[1];
  if (imageTag) {
    menuItem.image = imageTag;
  }

  // Dietary preferences
  const dietaryTags = extractSuitableForDietFromEventTags(productEvent.tags);
  if (dietaryTags.length > 0) menuItem.suitableForDiet = dietaryTags;

  // CSV format: @id, identifier, url
  const dTag = productEvent.tags.find((t) => t[0] === "d")?.[1];
  if (dTag) {
    menuItem["@id"] = dTag;
    if (opts.merchantPubkey) {
      try {
        const naddr = naddrForAddressableEvent({ identifier: dTag, pubkey: opts.merchantPubkey, kind: 30402 });
        menuItem.identifier = `nostr:${naddr}`;
      } catch (e) {
        // ignore
      }
    }
  }
  if (opts.baseUrl) {
    menuItem.url = menuItemUrlForTitle(opts.baseUrl, titleTag);
  }

  return menuItem;
}

/**
 * Generates a complete LD-JSON script tag with FoodEstablishment and Menu schemas
 * Uses inline menus (no @graph) for simpler, single-entity structure
 */
export function generateLDJsonScript(
  profile: BusinessProfile,
  menuEvents?: SquareEventTemplate[] | null,
  geohash?: string | null,
  merchantPubkey?: string,
  kind0Tags?: string[][]
): string {
  // For menu URLs, prefer synvya.com base path unless profile.website is already a synvya.com URL.
  const typeSlug = mapBusinessTypeToEstablishmentSlug(profile.businessType);
  const nameSlug = slugify(profile.name || profile.displayName || "business");
  const synvyaBaseUrl = `https://synvya.com/${typeSlug}/${nameSlug}`;
  const baseUrlForMenus =
    profile.website && profile.website.startsWith("https://synvya.com") ? profile.website : synvyaBaseUrl;

  // Build FoodEstablishment with all properties (CSV format)
  const establishment = buildFoodEstablishmentSchema(profile, { geohash, pubkeyHex: merchantPubkey, kind0Tags });
  
  // If we have menu events, add them inline (no @id references needed)
  if (menuEvents && menuEvents.length > 0 && merchantPubkey) {
    const menus = buildMenuSchema(profile.displayName || profile.name, menuEvents, merchantPubkey, baseUrlForMenus);
    if (menus.length > 0) {
      establishment.hasMenu = menus;
    }
  }

  // Create simple single-entity structure (no @graph)
  const schemaOrg = {
    "@context": "https://schema.org",
    ...establishment
  };

  const jsonString = JSON.stringify(schemaOrg, null, 2);
  
  // Escape for HTML embedding
  const escapedJson = jsonString
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026");

  return `<script type="application/ld+json">\n${escapedJson}\n</script>`;
}

