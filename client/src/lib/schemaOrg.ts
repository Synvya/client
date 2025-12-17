import type { BusinessProfile, BusinessType, OpeningHoursSpec } from "@/types/profile";
import type { SquareEventTemplate } from "@/services/square";

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
  name: string;
  hasMenuItem?: SchemaOrgMenuItem[];
  hasMenuSection?: SchemaOrgMenuSection[];
}

interface SchemaOrgFoodEstablishment extends SchemaOrgThing {
  "@type": string;
  name: string;
  description?: string;
  image?: string | string[];
  address?: SchemaOrgPostalAddress;
  telephone?: string;
  email?: string;
  url?: string;
  servesCuisine?: string;
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
    "vegan": "https://schema.org/VeganDiet",
    "vegetarian": "https://schema.org/VegetarianDiet",
    "glutenfree": "https://schema.org/GlutenFreeDiet",
    "kosher": "https://schema.org/KosherDiet",
    "halal": "https://schema.org/HalalDiet",
    "dairyfree": "https://schema.org/DiabeticDiet", // Closest match
    "nutfree": "https://schema.org/LowLactoseDiet" // No direct match, using placeholder
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

// ============================================================================
// Schema Generation Functions
// ============================================================================

/**
 * Builds a FoodEstablishment schema from a business profile
 */
export function buildFoodEstablishmentSchema(
  profile: BusinessProfile,
  geohash?: string | null
): SchemaOrgFoodEstablishment {
  const schema: SchemaOrgFoodEstablishment = {
    "@type": mapBusinessTypeToSchemaOrg(profile.businessType),
    "name": profile.displayName || profile.name
  };

  // Description
  if (profile.about) {
    schema.description = profile.about;
  }

  // Images
  const images: string[] = [];
  if (profile.picture) images.push(profile.picture);
  if (profile.banner) images.push(profile.banner);
  if (images.length === 1) {
    schema.image = images[0];
  } else if (images.length > 1) {
    schema.image = images;
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
    schema.telephone = profile.phone;
  }
  if (profile.email) {
    schema.email = profile.email;
  }
  if (profile.website) {
    schema.url = profile.website;
  }

  // Cuisine
  if (profile.cuisine) {
    schema.servesCuisine = profile.cuisine;
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
  merchantPubkey: string
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
      type: "menu" | "section";
      products: SchemaOrgMenuItem[];
    }
  >();

  for (const collectionEvent of collectionEvents) {
    const dTag = collectionEvent.tags.find((t) => t[0] === "d")?.[1];
    const titleTag = collectionEvent.tags.find((t) => t[0] === "title")?.[1];
    if (!dTag || !titleTag) continue;

    // Classify as menu or section
    const isTopLevel = titleTag.includes(" Menu") && !titleTag.includes("Menu Section");
    const type = isTopLevel ? "menu" : "section";

    collectionsMap.set(dTag, {
      name: dTag,
      title: titleTag,
      type,
      products: []
    });
  }

  // Step 2: Build menu items and extract product-to-collection references
  const uncategorizedItems: SchemaOrgMenuItem[] = [];
  const productToMenuItem = new Map<SquareEventTemplate, SchemaOrgMenuItem>();
  const productToCollectionRefs = new Map<SquareEventTemplate, string[]>();

  for (const productEvent of productEvents) {
    const menuItem = buildMenuItem(productEvent);
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
      "name": menuCollection.title
    };

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
        : (productEvents.map(buildMenuItem).filter(Boolean) as SchemaOrgMenuItem[]);

    menus.push({
      "@type": "Menu",
      "name": `${merchantName} Menu`,
      "hasMenuItem": allItems
    });
  }

  return menus;
}

/**
 * Builds a single MenuItem from a product event
 */
function buildMenuItem(productEvent: SquareEventTemplate): SchemaOrgMenuItem | null {
  const titleTag = productEvent.tags.find((t) => t[0] === "title")?.[1];
  if (!titleTag) return null;

  const menuItem: SchemaOrgMenuItem = {
    "@type": "MenuItem",
    "name": titleTag
  };

  // Description
  const summaryTag = productEvent.tags.find((t) => t[0] === "summary")?.[1];
  if (summaryTag) {
    menuItem.description = summaryTag;
  } else if (productEvent.content) {
    menuItem.description = productEvent.content;
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
  const dietaryTags = productEvent.tags
    .filter((t) => t[0] === "t")
    .map((t) => t[1])
    .map(mapDietaryToSchemaOrg)
    .filter((d): d is string => d !== null);

  if (dietaryTags.length > 0) {
    menuItem.suitableForDiet = dietaryTags;
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
  merchantPubkey?: string
): string {
  // Build FoodEstablishment with all properties
  const establishment = buildFoodEstablishmentSchema(profile, geohash);
  
  // If we have menu events, add them inline (no @id references needed)
  if (menuEvents && menuEvents.length > 0 && merchantPubkey) {
    const menus = buildMenuSchema(profile.displayName || profile.name, menuEvents, merchantPubkey);
    if (menus.length > 0) {
      // Inline the menus directly - remove @id since we're not using references
      establishment.hasMenu = menus.map((menu) => {
        // Remove @id property since we're inlining
        const { "@id": _, ...menuWithoutId } = menu;
        return menuWithoutId;
      });
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

