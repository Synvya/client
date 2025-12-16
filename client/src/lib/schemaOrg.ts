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
  "@id": string;
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
  hasMenu?: { "@id": string } | Array<{ "@id": string }>;
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

/**
 * Builds Menu and MenuItem schemas from Square catalog events
 */
export function buildMenuSchema(
  merchantName: string,
  menuEvents: SquareEventTemplate[]
): SchemaOrgMenu[] {
  if (!menuEvents || menuEvents.length === 0) {
    return [];
  }

  // Separate products (30402) and collections (30405)
  const productEvents = menuEvents.filter((e) => e.kind === 30402);
  const collectionEvents = menuEvents.filter((e) => e.kind === 30405);

  // Build a map of collection d-tags to collection data
  const collectionsMap = new Map<string, { name: string; products: SchemaOrgMenuItem[] }>();

  for (const collectionEvent of collectionEvents) {
    const dTag = collectionEvent.tags.find((t) => t[0] === "d")?.[1];
    const titleTag = collectionEvent.tags.find((t) => t[0] === "title")?.[1];
    if (dTag && titleTag) {
      collectionsMap.set(dTag, {
        name: titleTag,
        products: []
      });
    }
  }

  // Build MenuItems and assign them to collections
  const uncategorizedItems: SchemaOrgMenuItem[] = [];

  for (const productEvent of productEvents) {
    const menuItem = buildMenuItem(productEvent);
    if (!menuItem) continue;

    // Find all collection references in 'a' tags
    const collectionRefs = productEvent.tags
      .filter((t) => t[0] === "a" && t[1]?.startsWith("30405:"))
      .map((t) => {
        // Extract d-tag from "30405:<pubkey>:<d-tag>"
        const parts = t[1].split(":");
        return parts[2];
      })
      .filter(Boolean);

    if (collectionRefs.length === 0) {
      // No collection reference, add to uncategorized
      uncategorizedItems.push(menuItem);
    } else {
      // Add to each referenced collection
      for (const collectionDTag of collectionRefs) {
        const collection = collectionsMap.get(collectionDTag);
        if (collection) {
          collection.products.push(menuItem);
        }
      }
    }
  }

  // Build Menu objects (one per top-level collection)
  const menus: SchemaOrgMenu[] = [];

  for (const [dTag, collection] of Array.from(collectionsMap.entries())) {
    // Check if this is a top-level menu (ends with "Menu") or a section
    const isTopLevel = collection.name.includes(" Menu") && !collection.name.includes("Menu Section");

    if (isTopLevel) {
      const menu: SchemaOrgMenu = {
        "@type": "Menu",
        "@id": `#${dTag.toLowerCase().replace(/\s+/g, "-")}`,
        "name": collection.name
      };

      // Add direct items (if any uncategorized items should go here)
      if (uncategorizedItems.length > 0 && menus.length === 0) {
        // Add uncategorized items to the first menu
        menu.hasMenuItem = [...uncategorizedItems];
      }

      // Find sub-sections that belong to this menu
      const menuSections: SchemaOrgMenuSection[] = [];
      for (const [subDTag, subCollection] of Array.from(collectionsMap.entries())) {
        const isSection = subCollection.name.includes("Menu Section");
        if (isSection && subCollection.products.length > 0) {
          menuSections.push({
            "@type": "MenuSection",
            "name": subCollection.name.replace(" Menu Section", ""),
            "hasMenuItem": subCollection.products
          });
        }
      }

      if (menuSections.length > 0) {
        menu.hasMenuSection = menuSections;
      } else if (collection.products.length > 0 && !menu.hasMenuItem) {
        // No sections and no uncategorized items, add products directly to menu
        menu.hasMenuItem = [...collection.products];
      }

      menus.push(menu);
    }
  }

  // If no menus were created but we have items, create a default menu
  if (menus.length === 0 && (uncategorizedItems.length > 0 || productEvents.length > 0)) {
    const allItems = uncategorizedItems.length > 0 ? uncategorizedItems : productEvents.map(buildMenuItem).filter(Boolean) as SchemaOrgMenuItem[];
    menus.push({
      "@type": "Menu",
      "@id": "#menu",
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

  // Price
  const priceTag = productEvent.tags.find((t) => t[0] === "price")?.[1];
  const currencyTag = productEvent.tags.find((t) => t[0] === "price")?.[2] || "USD";
  if (priceTag) {
    const priceInDollars = (parseInt(priceTag, 10) / 100).toFixed(2);
    menuItem.offers = {
      "@type": "Offer",
      "price": priceInDollars,
      "priceCurrency": currencyTag
    };
  }

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
 */
export function generateLDJsonScript(
  profile: BusinessProfile,
  menuEvents?: SquareEventTemplate[] | null,
  geohash?: string | null
): string {
  const graph: SchemaOrgThing[] = [];

  // Add FoodEstablishment
  const establishment = buildFoodEstablishmentSchema(profile, geohash);
  
  // Add menu references if menus exist
  if (menuEvents && menuEvents.length > 0) {
    const menus = buildMenuSchema(profile.displayName || profile.name, menuEvents);
    if (menus.length > 0) {
      establishment.hasMenu = menus.length === 1
        ? { "@id": menus[0]["@id"] }
        : menus.map((m) => ({ "@id": m["@id"] }));
      graph.push(establishment, ...menus);
    } else {
      graph.push(establishment);
    }
  } else {
    graph.push(establishment);
  }

  const schemaOrg: SchemaOrgGraph = {
    "@context": "https://schema.org",
    "@graph": graph
  };

  const jsonString = JSON.stringify(schemaOrg, null, 2);
  
  // Escape for HTML embedding
  const escapedJson = jsonString
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026");

  return `<script type="application/ld+json">\n${escapedJson}\n</script>`;
}

