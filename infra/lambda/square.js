import { createHash, webcrypto } from "node:crypto";
// Square integration Lambda function
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import WebSocket from "ws";
import { SimplePool } from "nostr-tools";
// Minor touch to trigger deploy workflow
// Second minor touch to ensure deploy trigger

if (typeof globalThis.WebSocket === "undefined") {
  globalThis.WebSocket = WebSocket;
}

if (typeof globalThis.crypto === "undefined") {
  globalThis.crypto = webcrypto;
}

const profileRelays = (process.env.NOSTR_RELAYS || "wss://relay.damus.io,wss://relay.snort.social,wss://nos.lol")
  .split(",")
  .map((relay) => relay.trim())
  .filter(Boolean);

const nostrPool = profileRelays.length ? new SimplePool() : null;
import ngeohash from "ngeohash";

const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const squareConnectionsTable = process.env.SQUARE_CONNECTIONS_TABLE;
const squarePrimaryKey = process.env.SQUARE_PRIMARY_KEY || "pubkey";
const squareEnv = (process.env.SQUARE_ENV || "sandbox").toLowerCase();
const squareAppId = process.env.SQUARE_APPLICATION_ID;
const squareClientSecret = process.env.SQUARE_CLIENT_SECRET;
const squareRedirectUri = process.env.SQUARE_REDIRECT_URI;
const squareVersion = process.env.SQUARE_VERSION || "2025-01-23";
const geocodeEndpoint =
  process.env.GEOCODE_ENDPOINT || "https://nominatim.openstreetmap.org/search";
const geocodeUserAgent =
  process.env.GEOCODE_USER_AGENT || "SynvyaSquareIntegration/1.0 (contact@synvya.com)";
const geocodeContactEmail = process.env.GEOCODE_CONTACT_EMAIL || "contact@synvya.com";
const fallbackGeocodeEndpoint =
  process.env.FALLBACK_GEOCODE_ENDPOINT || "https://geocode.maps.co/search";
const geohashPrecision =
  Number.parseInt(process.env.GEOHASH_PRECISION ?? "", 10) || 9;

const geocodeCache = new Map();

function extractLocationFromKind0(event) {
  if (!event) return null;
  for (const tag of event.tags || []) {
    if (Array.isArray(tag) && tag.length >= 2 && tag[0] === "i" && typeof tag[1] === "string") {
      if (tag[1].toLowerCase().startsWith("location:")) {
        const value = tag[1].slice("location:".length).trim();
        if (value) return value;
      }
    }
  }
  if (event.content) {
    try {
      const parsed = JSON.parse(event.content);
      const value = parsed?.location;
      if (typeof value === "string" && value.trim()) {
        return value.trim();
      }
    } catch (error) {
      console.warn("Failed to parse kind 0 content for location", error);
    }
  }
  return null;
}

function extractNameFromKind0(event) {
  if (!event) return null;
  if (event.content) {
    try {
      const parsed = JSON.parse(event.content);
      // Priority: display_name > name > handle
      if (typeof parsed?.display_name === "string" && parsed.display_name.trim()) {
        return parsed.display_name.trim();
      }
      if (typeof parsed?.name === "string" && parsed.name.trim()) {
        return parsed.name.trim();
      }
      if (typeof parsed?.handle === "string" && parsed.handle.trim()) {
        return parsed.handle.trim();
      }
    } catch (error) {
      console.warn("Failed to parse kind 0 content for name", error);
    }
  }
  return null;
}

async function fetchProfileLocationFromRelays(pubkey) {
  if (!nostrPool || !profileRelays.length) {
    return null;
  }
  try {
    const timeoutMs = Number.parseInt(process.env.PROFILE_FETCH_TIMEOUT_MS ?? "5000", 10);
    const timeoutPromise = new Promise((resolve) => setTimeout(() => resolve(null), timeoutMs));
    const getPromise = nostrPool
      .get(profileRelays, {
        kinds: [0],
        authors: [pubkey]
      })
      .catch((error) => {
        console.warn("Failed to fetch kind 0 profile", { pubkey, error: error?.message || error });
        return null;
      });
    const event = await Promise.race([getPromise, timeoutPromise]);
    if (!event) {
      console.warn("No kind 0 profile found on configured relays", { pubkey, relays: profileRelays });
      return null;
    }
    const derived = extractLocationFromKind0(event);
    if (!derived) {
      console.warn("Kind 0 profile missing location tag", { pubkey, event });
    }
    return derived;
  } catch (error) {
    console.warn("Failed to load kind 0 profile from relays", { pubkey, error: error?.message || error });
    return null;
  }
  // Don't close the pool here - it's shared and might be used by other functions
}

async function fetchProfileNameFromRelays(pubkey) {
  if (!nostrPool || !profileRelays.length) {
    console.log("fetchProfileNameFromRelays: missing pool or relays", {
      hasPool: !!nostrPool,
      relayCount: profileRelays?.length || 0
    });
    return null;
  }
  try {
    const timeoutMs = Number.parseInt(process.env.PROFILE_FETCH_TIMEOUT_MS ?? "5000", 10);
    console.log("fetchProfileNameFromRelays: starting query", {
      pubkey,
      relays: profileRelays,
      timeoutMs
    });
    
    const timeoutPromise = new Promise((resolve) => setTimeout(() => {
      console.warn("fetchProfileNameFromRelays: timeout", { pubkey, timeoutMs });
      resolve(null);
    }, timeoutMs));
    
    const getPromise = nostrPool
      .get(profileRelays, {
        kinds: [0],
        authors: [pubkey]
      })
      .then((event) => {
        console.log("fetchProfileNameFromRelays: got event", {
          pubkey,
          hasEvent: !!event,
          eventId: event?.id?.substring(0, 16) + "...",
          eventKind: event?.kind
        });
        return event;
      })
      .catch((error) => {
        console.warn("fetchProfileNameFromRelays: query error", { 
          pubkey, 
          error: error?.message || error,
          errorStack: error instanceof Error ? error.stack : undefined
        });
        return null;
      });
    
    const event = await Promise.race([getPromise, timeoutPromise]);
    if (!event) {
      console.warn("fetchProfileNameFromRelays: no event found", { 
        pubkey, 
        relays: profileRelays,
        timedOut: true
      });
      return null;
    }
    
    const derived = extractNameFromKind0(event);
    console.log("fetchProfileNameFromRelays: extracted name", {
      pubkey,
      derived,
      eventContent: event?.content ? JSON.parse(event.content) : null
    });
    return derived;
  } catch (error) {
    console.warn("fetchProfileNameFromRelays: exception", { 
      pubkey, 
      error: error?.message || error,
      errorStack: error instanceof Error ? error.stack : undefined
    });
    return null;
  }
  // Don't close the pool here - it's shared and might be used by other functions
}

/**
 * Validates that an event's 'a' tags use the correct format.
 * Correct format: ["a", "30405:<pubkey>:<d-tag>"] or ["a", "30402:<pubkey>:<d-tag>"]
 * Wrong format: ["a", "30402", "<pubkey>", "<d-tag>"]
 * 
 * @param {Object} event - The Nostr event to validate
 * @returns {boolean} - true if event is valid, false if it has invalid a tags
 */
function isValidEventFormat(event) {
  if (!event || !event.tags || !Array.isArray(event.tags)) {
    return false;
  }
  
  const aTags = event.tags.filter((tag) => Array.isArray(tag) && tag[0] === "a");
  
  // Check each 'a' tag
  for (const aTag of aTags) {
    // Correct format: ["a", "30405:<pubkey>:<d-tag>"] - second element is a single string
    // Wrong format: ["a", "30402", "<pubkey>", "<d-tag>"] - multiple elements
    if (aTag.length !== 2 || typeof aTag[1] !== "string") {
      console.warn("Event has invalid 'a' tag format (wrong number of elements or non-string)", {
        eventId: event.id?.substring(0, 16) + "...",
        kind: event.kind,
        aTag: aTag
      });
      return false;
    }
    
    // Validate the format of the address string: "kind:pubkey:d-tag"
    const address = aTag[1];
    const parts = address.split(":");
    if (parts.length !== 3) {
      console.warn("Event has invalid 'a' tag format (address string format incorrect)", {
        eventId: event.id?.substring(0, 16) + "...",
        kind: event.kind,
        address: address
      });
      return false;
    }
    
    // Validate kind matches expected format
    const [kindStr, pubkey, dTag] = parts;
    if (kindStr !== "30402" && kindStr !== "30405") {
      console.warn("Event has invalid 'a' tag format (unexpected kind)", {
        eventId: event.id?.substring(0, 16) + "...",
        kind: event.kind,
        aTagKind: kindStr
      });
      return false;
    }
  }
  
  return true;
}

async function queryEventIdsByDTags(pubkey, dTags, relays) {
  if (!nostrPool || !relays || !relays.length || !dTags || !dTags.length || !pubkey) {
    return {};
  }
  
  const result = {};
  
  try {
    const timeoutMs = Number.parseInt(process.env.EVENT_QUERY_TIMEOUT_MS ?? "5000", 10);
    const timeoutPromise = new Promise((resolve) => setTimeout(() => resolve(null), timeoutMs));
    
    // Query for all d-tags at once using #d filter (both products and collections)
    const queryPromise = nostrPool
      .querySync(relays, {
        kinds: [30402, 30405],
        authors: [pubkey],
        "#d": dTags
      })
      .catch((error) => {
        console.warn("Failed to query events by d-tags", { pubkey, dTags, error: error?.message || error });
        return [];
      });
    
    const events = await Promise.race([queryPromise, timeoutPromise]);
    
    if (!events || !Array.isArray(events)) {
      console.warn("No events returned from relay query", { pubkey, dTags });
      return {};
    }
    
    // Build map of d-tag -> event ID
    // Track created_at to handle multiple events with same d-tag (use most recent)
    // Ignore events with invalid 'a' tag format
    const dTagToEvent = {};
    for (const event of events) {
      if (!event || !event.id) continue;
      
      // Skip events with invalid 'a' tag format
      if (!isValidEventFormat(event)) {
        console.warn("Skipping event with invalid 'a' tag format", {
          eventId: event.id?.substring(0, 16) + "...",
          kind: event.kind
        });
        continue;
      }
      
      const dTag = event.tags?.find((tag) => Array.isArray(tag) && tag[0] === "d")?.[1];
      if (dTag && dTags.includes(dTag)) {
        // If multiple events have the same d-tag, use the most recent one
        const existing = dTagToEvent[dTag];
        if (!existing || (event.created_at > existing.created_at)) {
          dTagToEvent[dTag] = { id: event.id, created_at: event.created_at || 0 };
        }
      }
    }
    
    // Convert to simple d-tag -> event ID map
    for (const [dTag, eventInfo] of Object.entries(dTagToEvent)) {
      result[dTag] = eventInfo.id;
    }
    
    return result;
  } catch (error) {
    console.warn("Failed to query event IDs by d-tags", { pubkey, dTags, error: error?.message || error });
    return {};
  } finally {
    try {
      nostrPool?.close(relays);
    } catch {
      // ignore
    }
  }
}

async function queryEventsByDTags(pubkey, dTags, relays) {
  if (!nostrPool || !relays || !relays.length || !dTags || !dTags.length || !pubkey) {
    return {};
  }
  
  const result = {};
  
  try {
    const timeoutMs = Number.parseInt(process.env.EVENT_QUERY_TIMEOUT_MS ?? "5000", 10);
    const timeoutPromise = new Promise((resolve) => setTimeout(() => resolve(null), timeoutMs));
    
    // Query for all d-tags at once using #d filter (both products and collections)
    const queryPromise = nostrPool
      .querySync(relays, {
        kinds: [30402, 30405],
        authors: [pubkey],
        "#d": dTags
      })
      .catch((error) => {
        console.warn("Failed to query events by d-tags", { pubkey, dTags, error: error?.message || error });
        return [];
      });
    
    const events = await Promise.race([queryPromise, timeoutPromise]);
    
    if (!events || !Array.isArray(events)) {
      console.warn("No events returned from relay query", { pubkey, dTags });
      return {};
    }
    
    // Build map of d-tag -> event (use most recent if multiple)
    // Ignore events with invalid 'a' tag format
    for (const event of events) {
      if (!event || !event.id) continue;
      
      // Skip events with invalid 'a' tag format
      if (!isValidEventFormat(event)) {
        console.warn("Skipping event with invalid 'a' tag format", {
          eventId: event.id?.substring(0, 16) + "...",
          kind: event.kind
        });
        continue;
      }
      
      const dTag = event.tags?.find((tag) => Array.isArray(tag) && tag[0] === "d")?.[1];
      if (dTag && dTags.includes(dTag)) {
        // If multiple events have the same d-tag, use the most recent one
        const existing = result[dTag];
        if (!existing || (event.created_at > existing.created_at)) {
          result[dTag] = event;
        }
      }
    }
    
    return result;
  } catch (error) {
    console.warn("Error querying events by d-tags", { pubkey, dTags, error: error?.message || error });
    return {};
  } finally {
    try {
      nostrPool?.close(relays);
    } catch {
      // ignore
    }
  }
}

function isCompleteAddress(location) {
  if (!location) return false;
  const parts = location
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((part) => part.toUpperCase() !== "USA");
  return parts.length >= 4;
}

function getCorsOrigin(requestOrigin) {
  const allowedOrigins = (process.env.CORS_ALLOW_ORIGIN || "*").split(",").map((o) => o.trim());
  
  // Allow wildcard
  if (allowedOrigins.includes("*")) {
    return "*";
  }
  
  // If no request origin provided, return first allowed origin (for same-origin requests)
  if (!requestOrigin) {
    return allowedOrigins[0] || null;
  }
  
  // Check if request origin is in allowed list
  if (allowedOrigins.includes(requestOrigin)) {
    return requestOrigin;
  }
  
  // Request origin not allowed - return null to prevent CORS header
  // Browser will reject the request, which is the secure behavior
  return null;
}

function jsonResponse(statusCode, body, headers = {}, requestOrigin = null) {
  const corsOrigin = getCorsOrigin(requestOrigin);
  
  const responseHeaders = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Headers": "*",
    "Access-Control-Allow-Methods": "OPTIONS,GET,POST",
    ...headers
  };
  
  // Only set Access-Control-Allow-Origin if origin is allowed
  // This prevents unauthorized origins from receiving CORS headers
  if (corsOrigin !== null) {
    responseHeaders["Access-Control-Allow-Origin"] = corsOrigin;
  }
  
  return {
    statusCode,
    headers: responseHeaders,
    body: JSON.stringify(body)
  };
}

function withErrorHandling(fn) {
  return async (event) => {
    try {
      return await fn(event);
    } catch (error) {
      console.error("Error handling request", error);
      console.error("Error stack:", error instanceof Error ? error.stack : String(error));
      const requestOrigin = event?.headers?.["origin"] || event?.headers?.["Origin"] || null;
      const message = error instanceof Error ? error.message : "Unexpected error";
      return jsonResponse(500, { error: message }, {}, requestOrigin);
    }
  };
}

function requiredEnv(name, value) {
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function extractPubkey(record) {
  if (!record) {
    throw new Error("Missing record for pubkey extraction");
  }
  const value = record.pubkey ?? record[squarePrimaryKey];
  if (!value) {
    throw new Error("Record missing pubkey field");
  }
  return value;
}

function resolveSquareBase() {
  return squareEnv === "production"
    ? "https://connect.squareup.com"
    : "https://connect.squareupsandbox.com";
}

function computeFingerprint(event) {
  const stableTags = (event.tags || [])
    .filter((tag) => Array.isArray(tag) && tag.length)
    .filter((tag) => tag[0] !== "published_at")
    .map((tag) => {
      const [name = "", value = "", extra = ""] = tag;
      return [name, value, extra];
    })
    .sort((a, b) => {
      if (a[0] === b[0]) {
        return (a[1] || "").localeCompare(b[1] || "");
      }
      return (a[0] || "").localeCompare(b[0] || "");
    });

  const minimal = {
    content: event.content,
    tags: stableTags
  };
  return createHash("sha256").update(JSON.stringify(minimal)).digest("hex");
}

function parseJson(body) {
  if (!body) return {};
  try {
    return JSON.parse(body);
  } catch {
    return {};
  }
}

function slug(itemId, variationId) {
  const src = `square:${itemId}:${variationId || "default"}`;
  const h = createHash("sha256").update(src).digest("hex").slice(0, 16);
  return `sq-${h}`;
}

function mapSquareDietaryPreferenceToTag(squareValue) {
  const raw = typeof squareValue === "string" ? squareValue.trim() : String(squareValue || "").trim();
  if (!raw) return null;

  const upper = raw.toUpperCase();
  const isFree = upper.endsWith("_FREE");
  const base = isFree ? upper.slice(0, -"_FREE".length) : upper;
  const parts = base.split("_").filter(Boolean);
  if (!parts.length) return null;

  const word = parts.map((p) => p.slice(0, 1) + p.slice(1).toLowerCase()).join("");
  return isFree ? `${word}FreeDiet` : `${word}Diet`;
}

function precisionWithinBounds(value) {
  if (!Number.isInteger(value)) return 9;
  return Math.min(Math.max(value, 1), 12);
}

function buildAddressVariants(location) {
  const base = location.trim();
  const variants = new Set();
  if (base) variants.add(base);

  const parts = base
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length >= 3) {
    variants.add(parts.slice(1).join(", "));
    variants.add(parts.slice(-3).join(", "));
  }

  if (parts.length) {
    variants.add(parts.join(" "));
  }
  return Array.from(variants);
}

async function queryGeocoder(endpoint, address) {
  if (!endpoint) return null;
  try {
    const url = new URL(endpoint);
    url.searchParams.set("q", address);
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("limit", "1");
    url.searchParams.set("addressdetails", "0");
    if (geocodeContactEmail) {
      url.searchParams.set("email", geocodeContactEmail);
    }

    const response = await fetch(url.toString(), {
      headers: {
        "User-Agent": geocodeUserAgent,
        Accept: "application/json"
      }
    });
    if (!response.ok) {
      console.warn("Geocode request failed", {
        endpoint,
        status: response.status,
        address
      });
      return null;
    }
    const payload = await response.json().catch(() => null);
    const entry = Array.isArray(payload) ? payload[0] : null;
    if (!entry) {
      console.warn("Geocode returned empty results", { endpoint, address });
      return null;
    }
    const lat = entry?.lat ? Number.parseFloat(entry.lat) : Number.NaN;
    const lon = entry?.lon ? Number.parseFloat(entry.lon) : Number.NaN;
    if (Number.isNaN(lat) || Number.isNaN(lon)) {
      console.warn("Geocode returned invalid coordinates", { endpoint, address, entry });
      return null;
    }
    return { latitude: lat, longitude: lon };
  } catch (error) {
    console.warn("Geocode fetch error", {
      endpoint,
      address,
      error: error instanceof Error ? error.message : error
    });
    return null;
  }
}

async function geocodeLocation(location) {
  if (!location) return { geohash: null, latitude: null, longitude: null };
  const trimmed = location.trim();
  if (!trimmed) {
    return { geohash: null, latitude: null, longitude: null };
  }
  const cacheKey = trimmed.toLowerCase();
  if (geocodeCache.has(cacheKey)) {
    return geocodeCache.get(cacheKey);
  }

  const variants = buildAddressVariants(trimmed);
  try {
    for (const variant of variants) {
      const primary = await queryGeocoder(geocodeEndpoint, variant);
      if (primary) {
        const safePrecision = precisionWithinBounds(geohashPrecision);
        const geohash = ngeohash.encode(primary.latitude, primary.longitude, safePrecision);
        const result = { geohash, latitude: primary.latitude, longitude: primary.longitude };
        geocodeCache.set(cacheKey, result);
        return result;
      }
    }

    if (fallbackGeocodeEndpoint) {
      for (const variant of variants) {
        const fallback = await queryGeocoder(fallbackGeocodeEndpoint, variant);
        if (fallback) {
          const safePrecision = precisionWithinBounds(geohashPrecision);
          const geohash = ngeohash.encode(fallback.latitude, fallback.longitude, safePrecision);
          const result = { geohash, latitude: fallback.latitude, longitude: fallback.longitude };
          geocodeCache.set(cacheKey, result);
          return result;
        }
      }
    }

    console.warn("Unable to geocode address after attempts", { location: trimmed });
    geocodeCache.set(cacheKey, { geohash: null, latitude: null, longitude: null });
    return { geohash: null, latitude: null, longitude: null };
  } catch (error) {
    console.warn("Failed to geocode location", {
      location: trimmed,
      error: error instanceof Error ? error.message : error
    });
    geocodeCache.set(cacheKey, { geohash: null, latitude: null, longitude: null });
    return { geohash: null, latitude: null, longitude: null };
  }
}

function buildEvents(catalog, profileLocation, profileGeoHash, businessName = null, merchantPubkey = null) {
  // Build map from category ID to full category object
  const catById = new Map((catalog.categories || []).map((c) => [c.id, c]));
  const imgById = new Map((catalog.images || []).map((i) => [i.id, i.url]));
  const locationTagValue =
    typeof profileLocation === "string" && profileLocation.trim() ? profileLocation.trim() : null;
  const geohashTagValue =
    typeof profileGeoHash === "string" && profileGeoHash.trim() ? profileGeoHash.trim() : null;

  // Build map of category ID -> all parent category IDs (for hierarchy traversal)
  const categoryToParents = new Map();
  for (const category of catalog.categories || []) {
    if (category.parent_category_id) {
      const parents = [];
      let currentParentId = category.parent_category_id;
      while (currentParentId) {
        parents.push(currentParentId);
        const parentCat = catById.get(currentParentId);
        if (parentCat && parentCat.parent_category_id) {
          currentParentId = parentCat.parent_category_id;
        } else {
          break;
        }
      }
      categoryToParents.set(category.id, parents);
    }
  }

  const events = [];
  for (const item of catalog.items || []) {
    const variations =
      item.variations && item.variations.length
        ? item.variations
        : [{ id: "default", name: "Default", price_money: null }];

    for (const variation of variations) {
      // Content: item name and description only
      const content = `**${item.name}**

${item.description || ""}`.trim();

      const tags = [];
      
      // d: use SKU if available, otherwise create identifier
      const dTag = variation.sku && typeof variation.sku === "string" && variation.sku.trim()
        ? variation.sku.trim()
        : slug(item.id, variation.id);
      tags.push(["d", dTag]);
      
      // title: use item.name directly (no variation suffix)
      tags.push(["title", item.name]);

      // image: 2-element tag
      for (const imageId of item.imageIds || []) {
        const url = imgById.get(imageId);
        if (url) {
          tags.push(["image", url]);
        }
      }
      
      // location: use the full address from kind:0
      if (locationTagValue) {
        tags.push(["location", locationTagValue]);
      }
      
      // g: use the geohash from kind:0
      if (geohashTagValue) {
        tags.push(["g", geohashTagValue]);
      }
      
      // price: from variation.price_money
      if (variation.price_money?.amount && variation.price_money.currency) {
        tags.push([
          "price",
          String(variation.price_money.amount / 100),
          variation.price_money.currency
        ]);
      }

      // t: ingredients tags (one per ingredient)
      if (Array.isArray(item.ingredients)) {
        for (const ingredient of item.ingredients) {
          if (typeof ingredient === "string" && ingredient.trim()) {
            tags.push(["t", `ingredients:${ingredient.trim().toLowerCase()}`]);
          }
        }
      }

      // t: dietary preferences tags (transformed)
      if (Array.isArray(item.dietaryPreferences)) {
        for (const pref of item.dietaryPreferences) {
          if (typeof pref === "string" && pref.trim()) {
            const mapped = mapSquareDietaryPreferenceToTag(pref.trim());
            if (mapped) {
              tags.push(["t", mapped]);
            }
          }
        }
      }

      // a: reference to collection(s) - format: ["a", "30405:<pubkey>:<d-tag>"]
      // Include all MENU_CATEGORY collections (both direct and parent categories)
      if (merchantPubkey && typeof merchantPubkey === "string" && merchantPubkey.trim()) {
        const menuCategoryNames = new Set();
        
        for (const categoryId of item.categoryIds || []) {
          const category = catById.get(categoryId);
          if (!category) continue;
          
          // If this is a MENU_CATEGORY, add it
          if (category.category_type === "MENU_CATEGORY" && category.name) {
            menuCategoryNames.add(category.name.trim());
          }
          
          // Also add all parent MENU_CATEGORY collections
          const parentIds = categoryToParents.get(categoryId) || [];
          for (const parentId of parentIds) {
            const parentCategory = catById.get(parentId);
            if (parentCategory && parentCategory.category_type === "MENU_CATEGORY" && parentCategory.name) {
              menuCategoryNames.add(parentCategory.name.trim());
            }
          }
        }
        
        // Add a tags in correct format: ["a", "30405:<pubkey>:<d-tag>"]
        for (const categoryName of menuCategoryNames) {
          tags.push(["a", `30405:${merchantPubkey.trim()}:${categoryName}`]);
        }
      }
      const createdAt = Math.floor(Date.now() / 1000);

      if (process.env.DEBUG_SQUARE_SYNC === "true") {
        console.debug(
          "Prepared NIP-99 template",
          JSON.stringify({
            itemId: item.id,
            variationId: variation.id,
            dTag,
            tags
          })
        );
      }

      events.push({
        kind: 30402,
        created_at: createdAt,
        content,
        tags
      });
    }
  }
  return events;
}

function normalizeAddressComponent(component) {
  if (!component) return "";
  return component
    .trim()
    .toLowerCase()
    .replace(/\b(street|st)\b/gi, "st")
    .replace(/\b(avenue|ave)\b/gi, "ave")
    .replace(/\b(road|rd)\b/gi, "rd")
    .replace(/\b(boulevard|blvd)\b/gi, "blvd")
    .replace(/\b(drive|dr)\b/gi, "dr")
    .replace(/\b(usa|united states)\b/gi, "us")
    .replace(/[.,]/g, "")
    .replace(/\s+/g, " ");
}

function findLocationNameByAddress(catalog, profileLocation) {
  if (!profileLocation || !catalog.locations || !Array.isArray(catalog.locations)) {
    console.log("findLocationNameByAddress: missing inputs", {
      hasProfileLocation: !!profileLocation,
      hasLocations: !!(catalog.locations && Array.isArray(catalog.locations)),
      locationsCount: catalog.locations?.length || 0
    });
    return null;
  }
  
  const normalizedProfileLocation = normalizeAddressComponent(profileLocation);
  console.log("findLocationNameByAddress: searching", {
    profileLocation: profileLocation.trim(),
    normalizedProfileLocation,
    locationsCount: catalog.locations.length
  });
  
  // Try to match location by comparing address components
  // Match by checking if key address components (street, city, state, zip) appear in profileLocation
  for (const location of catalog.locations) {
    if (!location.name || typeof location.name !== "string") {
      continue;
    }
    
    console.log("findLocationNameByAddress: checking location", {
      name: location.name,
      fullAddress: location.fullAddress,
      address: location.address
    });
    
    // Try matching by address components (more reliable than full address match)
    if (location.address) {
      const addr = location.address;
      const components = [
        addr.address_line_1,
        addr.locality,
        addr.administrative_district_level_1,
        addr.postal_code
      ].filter(Boolean);
      
      if (components.length >= 2) {
        // Normalize and check if components match
        const normalizedComponents = components.map(c => normalizeAddressComponent(c));
        const matchCount = normalizedComponents.filter(comp => 
          normalizedProfileLocation.includes(comp)
        ).length;
        
        // Require at least 3 out of 4 components to match (or all if we have fewer)
        const requiredMatches = Math.min(3, components.length);
        const allMatch = matchCount >= requiredMatches;
        
        console.log("findLocationNameByAddress: component matching", {
          locationName: location.name,
          components,
          normalizedComponents,
          matchCount,
          requiredMatches,
          allMatch
        });
        
        if (allMatch) {
          console.log("findLocationNameByAddress: MATCH FOUND", { locationName: location.name });
          return location.name.trim();
        }
      }
    }
    
    // If we have a fullAddress, try fuzzy match as fallback
    if (location.fullAddress) {
      const normalizedLocationAddress = normalizeAddressComponent(location.fullAddress);
      // Check if key parts match (at least 3 words in common)
      const locationWords = normalizedLocationAddress.split(/\s+/).filter(w => w.length > 2);
      const profileWords = normalizedProfileLocation.split(/\s+/).filter(w => w.length > 2);
      const commonWords = locationWords.filter(w => profileWords.includes(w));
      
      if (commonWords.length >= 3) {
        console.log("findLocationNameByAddress: fuzzy match found", {
          locationName: location.name,
          commonWords
        });
        return location.name.trim();
      }
    }
  }
  
  console.log("findLocationNameByAddress: no match found, using fallback");
  // Fallback: if no match found, use first location's name
  if (catalog.locations.length > 0 && catalog.locations[0].name) {
    return catalog.locations[0].name.trim();
  }
  
  return null;
}

function buildCollectionEvents(catalog, profileLocation, profileGeoHash, businessName, merchantPubkey) {
  // Build map from category ID to full category object
  const catById = new Map((catalog.categories || []).map((c) => [c.id, c]));
  const locationTagValue =
    typeof profileLocation === "string" && profileLocation.trim() ? profileLocation.trim() : null;
  const geohashTagValue =
    typeof profileGeoHash === "string" && profileGeoHash.trim() ? profileGeoHash.trim() : null;

  // Find location name from Square locations
  const locationName = findLocationNameByAddress(catalog, profileLocation);
  // Use location name if available, otherwise fall back to business name
  const displayName = locationName || businessName;

  // Build map of category ID -> list of product d-tags
  // Each product variation gets its own d-tag
  const categoryIdToProductDTags = new Map();
  
  for (const item of catalog.items || []) {
    const variations =
      item.variations && item.variations.length
        ? item.variations
        : [{ id: "default", name: "Default", sku: null }];
    
    for (const variation of variations) {
      // Compute d-tag same way as in buildEvents
      const productDTag = variation.sku && typeof variation.sku === "string" && variation.sku.trim()
        ? variation.sku.trim()
        : slug(item.id, variation.id);
      
      // Add this product d-tag to all categories this item belongs to
      for (const categoryId of item.categoryIds || []) {
        if (!categoryIdToProductDTags.has(categoryId)) {
          categoryIdToProductDTags.set(categoryId, []);
        }
        categoryIdToProductDTags.get(categoryId).push(productDTag);
      }
    }
  }

  // Filter to only MENU_CATEGORY types that have items
  const menuCategoriesWithItems = (catalog.categories || [])
    .filter((cat) => {
      // Only include MENU_CATEGORY types
      if (cat.category_type !== "MENU_CATEGORY") {
        return false;
      }
      // Only include categories that have items
      const hasItems = categoryIdToProductDTags.has(cat.id) && 
                       categoryIdToProductDTags.get(cat.id).length > 0;
      return hasItems;
    });

  // Always log collection building info (not just in debug mode)
  console.log("buildCollectionEvents", JSON.stringify({
    totalCategories: catalog.categories?.length || 0,
    totalItems: catalog.items?.length || 0,
    menuCategoriesWithItems: menuCategoriesWithItems.map(c => ({ id: c.id, name: c.name, category_type: c.category_type })),
    categoryToProductCount: Array.from(categoryIdToProductDTags.entries()).map(([id, dTags]) => {
      const cat = catById.get(id);
      return {
        categoryId: id,
        categoryName: cat?.name || "Unknown",
        categoryType: cat?.category_type || "Unknown",
        productCount: dTags.length
      };
    }),
  }, null, 2));
  
  if (process.env.DEBUG_SQUARE_SYNC === "true") {
    console.debug("buildCollectionEvents (detailed)", {
      totalCategories: catalog.categories?.length || 0,
      totalItems: catalog.items?.length || 0,
      menuCategoriesWithItems: menuCategoriesWithItems.map(c => ({ id: c.id, name: c.name })),
      categoryIdToProductDTags: Object.fromEntries(categoryIdToProductDTags)
    });
  }

  const collectionEvents = [];
  const createdAt = Math.floor(Date.now() / 1000);

  // Create collections for all MENU_CATEGORY types (both top-level and sub-level)
  for (const category of menuCategoriesWithItems) {
    const productDTags = categoryIdToProductDTags.get(category.id) || [];
    
    // Only create collection if it has items
    if (productDTags.length === 0) {
      continue;
    }

    // Use "Menu Section" for sub-menus, "Menu" for top-level menus
    const isSubMenu = category.parent_category_id !== null && category.parent_category_id !== undefined;
    const collectionLabel = isSubMenu ? "Menu Section" : "Menu";

    const tags = [];
    tags.push(["d", category.name]);
    tags.push(["title", `${category.name} ${collectionLabel}`]);
    
    if (displayName && typeof displayName === "string" && displayName.trim()) {
      tags.push(["summary", `${category.name} ${collectionLabel} for ${displayName}`]);
    } else {
      tags.push(["summary", `${category.name} ${collectionLabel}`]);
    }

    if (locationTagValue) {
      tags.push(["location", locationTagValue]);
    }

    if (geohashTagValue) {
      tags.push(["g", geohashTagValue]);
    }

    // Add 'a' tags referencing all products in this collection
    // Format: ["a", "30402:<pubkey>:<d-tag>"] per spec
    if (merchantPubkey && typeof merchantPubkey === "string" && merchantPubkey.trim()) {
      for (const productDTag of productDTags) {
        tags.push(["a", `30402:${merchantPubkey.trim()}:${productDTag}`]);
      }
    }

    collectionEvents.push({
      kind: 30405,
      created_at: createdAt,
      content: "",
      tags
    });
  }

  return collectionEvents;
}

function buildDeletionEvent(eventIds, eventKinds) {
  if (!eventIds || !Array.isArray(eventIds) || eventIds.length === 0) {
    throw new Error("eventIds must be a non-empty array");
  }
  
  const tags = eventIds.map((id) => {
    if (typeof id !== "string" || !id.trim()) {
      throw new Error("All event IDs must be non-empty strings");
    }
    return ["e", id];
  });
  
  if (eventKinds && Array.isArray(eventKinds) && eventKinds.length > 0) {
    for (const kind of eventKinds) {
      if (typeof kind === "number" && kind > 0) {
        tags.push(["k", String(kind)]);
      }
    }
  }
  
  return {
    kind: 5,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content: ""
  };
}

async function fetchSquare(path, { method = "GET", headers = {}, accessToken, body } = {}) {
  const base = resolveSquareBase();
  const url = `${base}${path}`;
  const requestHeaders = {
    "Content-Type": "application/json",
    "Square-Version": squareVersion,
    ...headers
  };
  if (accessToken) {
    requestHeaders.Authorization = `Bearer ${accessToken}`;
  }
  const response = await fetch(url, {
    method,
    headers: requestHeaders,
    body: body ? JSON.stringify(body) : undefined
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(json?.errors?.[0]?.detail || `Square request failed: ${response.status}`);
    error.details = json;
    throw error;
  }
  return json;
}

async function exchangeAuthorizationCode({ code, codeVerifier }) {
  requiredEnv("SQUARE_APPLICATION_ID", squareAppId);
  requiredEnv("SQUARE_REDIRECT_URI", squareRedirectUri);
  const payload = {
    client_id: squareAppId,
    grant_type: "authorization_code",
    code,
    code_verifier: codeVerifier,
    redirect_uri: squareRedirectUri
  };
  if (squareClientSecret) {
    payload.client_secret = squareClientSecret;
  }
  return fetchSquare("/oauth2/token", { method: "POST", body: payload });
}

async function refreshAccessToken(record) {
  if (!record?.refreshToken) {
    return record;
  }
  if (!record.expiresAt) {
    return record;
  }
  const expiresAt = new Date(record.expiresAt).getTime();
  if (Number.isNaN(expiresAt) || expiresAt - Date.now() > 5 * 60 * 1000) {
    return record;
  }
  const payload = {
    client_id: squareAppId,
    grant_type: "refresh_token",
    refresh_token: record.refreshToken
  };
  if (squareClientSecret) {
    payload.client_secret = squareClientSecret;
  }
  const refreshed = await fetchSquare("/oauth2/token", { method: "POST", body: payload });
  await dynamo.send(
    new UpdateCommand({
      TableName: squareConnectionsTable,
      Key: { [squarePrimaryKey]: extractPubkey(record) },
      UpdateExpression:
        "SET accessToken = :at, refreshToken = :rt, expiresAt = :exp, scopes = :sc, updatedAt = :u",
      ExpressionAttributeValues: {
        ":at": refreshed.access_token,
        ":rt": refreshed.refresh_token || record.refreshToken,
        ":exp": refreshed.expires_at || null,
        ":sc":
          refreshed.scope
            ? refreshed.scope.split(" ")
            : Array.isArray(refreshed.scopes)
              ? refreshed.scopes
              : record.scopes || [],
        ":u": new Date().toISOString()
      }
    })
  );
  return {
    ...record,
    accessToken: refreshed.access_token,
    refreshToken: refreshed.refresh_token || record.refreshToken,
    expiresAt: refreshed.expires_at || null,
    scopes: refreshed.scope
      ? refreshed.scope.split(" ")
      : Array.isArray(refreshed.scopes)
        ? refreshed.scopes
        : record.scopes || []
  };
}

async function fetchNormalizedCatalog(record) {
  const { merchantId, accessToken } = record;
  if (!merchantId) {
    throw new Error("Missing merchant ID");
  }
  requiredEnv("SQUARE_APPLICATION_ID", squareAppId);
  if (!accessToken) {
    throw new Error("Missing Square access token");
  }

  const locationsResponse = await fetchSquare("/v2/locations", { accessToken });
  const fetchedLocations =
    locationsResponse.locations?.filter((loc) => typeof loc?.id === "string" && loc.id) || [];
  const normalizedLocations = fetchedLocations.map((loc) => {
    const address = loc.address || {};
    // Build full address string for matching
    const addressParts = [
      address.address_line_1,
      address.locality,
      address.administrative_district_level_1,
      address.postal_code,
      address.country
    ].filter(Boolean);
    const fullAddress = addressParts.join(", ");
    
    return {
      id: loc.id,
      name: loc.name || address.address_line_1 || "Location",
      address: {
        address_line_1: address.address_line_1 || null,
        locality: address.locality || null,
        administrative_district_level_1: address.administrative_district_level_1 || null,
        postal_code: address.postal_code || null,
        country: address.country || null
      },
      fullAddress: fullAddress || null
    };
  });
  const locations =
    normalizedLocations.length > 0
      ? normalizedLocations
      : Array.isArray(record.locations)
        ? record.locations
        : [];

  const objects = [];
  let cursor;
  do {
    const params = new URLSearchParams();
    params.set("types", "ITEM,ITEM_VARIATION,CATEGORY,IMAGE");
    params.set("include_related_objects", "true");
    if (cursor) {
      params.set("cursor", cursor);
    }
    const response = await fetchSquare(`/v2/catalog/list?${params.toString()}`, {
      accessToken
    });
    cursor = response.cursor;
    if (Array.isArray(response.objects)) {
      objects.push(...response.objects);
    }
  } while (cursor);

  const categories = [];
  const images = [];
  const variationsById = new Map();

  const categoryStubByItemId = new Map();
  const reportingCategoryByItemId = new Map();

  for (const object of objects) {
    if (!object || typeof object !== "object") continue;
    switch (object.type) {
      case "CATEGORY": {
        const data = object.category_data;
        if (data && data.name) {
          categories.push({
            id: object.id,
            name: data.name,
            category_type: data.category_type || null,
            parent_category_id: data.parent_category?.id || null
          });
        }
        break;
      }
      case "IMAGE": {
        const data = object.image_data;
        if (data && data.url) {
          images.push({ id: object.id, url: data.url });
        }
        break;
      }
      case "ITEM_VARIATION": {
        const data = object.item_variation_data;
        if (data) {
          variationsById.set(object.id, {
            id: object.id,
            name: data.name || "Default",
            sku: data.sku || null,
            price_money: data.price_money || null
          });
        }
        break;
      }
      case "ITEM": {
        const data = object.item_data;
        if (data) {
          if (Array.isArray(data.categories)) {
            categoryStubByItemId.set(object.id, data.categories);
          }
          if (data.reporting_category?.id) {
            reportingCategoryByItemId.set(object.id, data.reporting_category.id);
          }
        }
        break;
      }
      default:
        break;
    }
  }

  const items = [];
  for (const object of objects) {
    if (object.type !== "ITEM") continue;
    const data = object.item_data;
    if (!data) continue;
    const variations = [];
    if (Array.isArray(data.variations)) {
      for (const variation of data.variations) {
        const ref = variationsById.get(variation.id);
        if (ref) {
          variations.push(ref);
        } else {
          const vData = variation.item_variation_data || {};
          variations.push({
            id: variation.id,
            name: vData.name || "Default",
            sku: vData.sku || null,
            price_money: vData.price_money || null
          });
        }
      }
    }
    const categoryIds = new Set();
    const stubList = categoryStubByItemId.get(object.id);
    if (Array.isArray(stubList)) {
      for (const stub of stubList) {
        const id = stub?.id;
        if (typeof id === "string" && id) {
          categoryIds.add(id);
        }
      }
    }
    const reportingCategory = reportingCategoryByItemId.get(object.id);
    if (reportingCategory) {
      categoryIds.add(reportingCategory);
    }

    const collectedCategoryIds = Array.from(categoryIds);

    // Extract ingredients and dietary_preferences from food_and_beverage_details
    const ingredients = [];
    const dietaryPreferences = [];
    if (data.food_and_beverage_details) {
      const fbDetails = data.food_and_beverage_details;
      if (Array.isArray(fbDetails.ingredients)) {
        for (const ingredient of fbDetails.ingredients) {
          if (ingredient && typeof ingredient.standard_name === "string") {
            ingredients.push(ingredient.standard_name);
          }
        }
      }
      if (Array.isArray(fbDetails.dietary_preferences)) {
        for (const pref of fbDetails.dietary_preferences) {
          if (pref && typeof pref.standard_name === "string") {
            dietaryPreferences.push(pref.standard_name);
          }
        }
      }
    }

    items.push({
      id: object.id,
      name: data.name || "Untitled Item",
      description: data.description || "",
      categoryIds: collectedCategoryIds,
      imageIds: Array.isArray(data.image_ids) ? data.image_ids : [],
      variations,
      ingredients,
      dietaryPreferences
    });

    if (process.env.DEBUG_SQUARE_SYNC === "true") {
      console.debug(
        "Square item categories",
        JSON.stringify({
          id: object.id,
          name: data.name,
          categoryIds: collectedCategoryIds
        })
      );
    }
  }

  return {
    merchant_id: merchantId,
    items,
    categories,
    images,
    locations
  };
}

async function performSync(record, options) {
  console.log("=== performSync START ===");
  const refreshed = await refreshAccessToken(record);
  console.log("Token details", JSON.stringify({
    merchantId: refreshed.merchantId,
    scopes: refreshed.scopes,
    hasAccessToken: !!refreshed.accessToken,
    accessTokenLength: refreshed.accessToken?.length || 0,
    apiBase: resolveSquareBase()
  }, null, 2));
  const catalog = await fetchNormalizedCatalog(refreshed);
  console.log("Catalog fetched", JSON.stringify({ itemsCount: catalog.items?.length || 0, categoriesCount: catalog.categories?.length || 0 }, null, 2));
  const requestedLocationRaw = options?.profileLocation;
  const hasRequestedLocation =
    typeof requestedLocationRaw === "string" && requestedLocationRaw.trim().length > 0;
  const requestedLocation = hasRequestedLocation ? requestedLocationRaw.trim() : null;
  const existingLocation =
    typeof record.profileLocation === "string" && record.profileLocation.trim()
      ? record.profileLocation.trim()
      : null;
  const pubkeyValue = extractPubkey(refreshed);

  let profileLocation = hasRequestedLocation ? requestedLocation : existingLocation;
  let locationSource = hasRequestedLocation ? "request" : existingLocation ? "stored" : null;

  if (!profileLocation) {
    const fromRelays = await fetchProfileLocationFromRelays(pubkeyValue);
    if (fromRelays) {
      profileLocation = fromRelays.trim();
      locationSource = "kind0";
    }
  }

  const locationChanged =
    profileLocation && profileLocation !== existingLocation ? true : hasRequestedLocation && !profileLocation && existingLocation ? true : false;
  const existingGeoHash =
    typeof record.profileGeoHash === "string" && record.profileGeoHash.trim()
      ? record.profileGeoHash.trim()
      : null;

  let profileGeoHash = existingGeoHash;
  const locationHasFullAddress = profileLocation ? isCompleteAddress(profileLocation) : false;
  if (locationHasFullAddress) {
    if (locationChanged || !existingGeoHash) {
      const { geohash } = await geocodeLocation(profileLocation);
      profileGeoHash = geohash || null;
    }
  } else if (locationChanged && existingGeoHash) {
    profileGeoHash = null;
  }

  // Fetch business name from kind:0 profile
  const businessName = await fetchProfileNameFromRelays(pubkeyValue);

  // Build product events and collection events
  const productEvents = buildEvents(catalog, profileLocation, profileGeoHash, businessName, pubkeyValue);
  const collectionEvents = buildCollectionEvents(catalog, profileLocation, profileGeoHash, businessName, pubkeyValue);
  
  // Always log collection events info (not just in debug mode)
  console.log("Collection events created", JSON.stringify({
    productEventsCount: productEvents.length,
    collectionEventsCount: collectionEvents.length,
    collectionDTags: collectionEvents.map((e) => {
      const dTag = e.tags.find((t) => Array.isArray(t) && t[0] === "d")?.[1];
      return dTag;
    }),
    totalItems: catalog.items?.length || 0,
    totalCategories: catalog.categories?.length || 0
  }, null, 2));
  
  if (process.env.DEBUG_SQUARE_SYNC === "true") {
    console.debug("Event building summary (performSync)", {
      productEventsCount: productEvents.length,
      collectionEventsCount: collectionEvents.length,
      collectionDTags: collectionEvents.map((e) => {
        const dTag = e.tags.find((t) => Array.isArray(t) && t[0] === "d")?.[1];
        return dTag;
      })
    });
  }
  
  const events = [...productEvents, ...collectionEvents];

  const previous = record.publishedFingerprints || {};
  const fingerprints = { ...previous };
  const toPublish = [];

  // Build set of current d-tags (for both products and collections)
  const currentDTags = new Set();
  for (const event of events) {
    const dTag = event.tags.find((tag) => Array.isArray(tag) && tag[0] === "d")?.[1];
    if (dTag) {
      currentDTags.add(dTag);
    }
  }

  // Detect removed items/collections: d-tags in previous but not in current
  const removedDTags = [];
  for (const dTag of Object.keys(previous)) {
    if (!currentDTags.has(dTag)) {
      removedDTags.push(dTag);
    }
  }

  // Query relays for event IDs of removed items/collections and create deletion events
  if (removedDTags.length > 0 && nostrPool && profileRelays.length) {
    try {
      // Query for both product events (kind 30402) and collection events (kind 30405)
      const eventIdsByDTag = await queryEventIdsByDTags(pubkeyValue, removedDTags, profileRelays);
      const eventIdsToDelete = [];
      const eventKindsToDelete = new Set(); // Track which kinds actually have events to delete
      
      // Also query for the actual events to determine their kinds
      const eventsByDTag = await queryEventsByDTags(pubkeyValue, removedDTags, profileRelays);
      
      for (const dTag of removedDTags) {
        const eventId = eventIdsByDTag[dTag];
        if (eventId) {
          eventIdsToDelete.push(eventId);
          // Determine the kind from the actual event
          const event = eventsByDTag[dTag];
          if (event && event.kind) {
            eventKindsToDelete.add(event.kind);
          }
        } else {
          console.warn("Could not find event ID for removed item/collection", { dTag, pubkey: pubkeyValue });
        }
      }

      if (eventIdsToDelete.length > 0) {
        // Only include kinds that actually have events to delete
        const kindsArray = Array.from(eventKindsToDelete);
        console.log("Creating deletion event", JSON.stringify({
          eventIdsCount: eventIdsToDelete.length,
          kindsToDelete: kindsArray,
          removedDTags
        }, null, 2));
        
        const deletionEvent = buildDeletionEvent(eventIdsToDelete, kindsArray);
        toPublish.push({
          kind: deletionEvent.kind,
          created_at: deletionEvent.created_at,
          content: deletionEvent.content,
          tags: deletionEvent.tags
        });
        
        // Remove deleted item fingerprints from fingerprints object
        for (const dTag of removedDTags) {
          delete fingerprints[dTag];
        }
      } else {
        // No event IDs found, but still remove fingerprints
        for (const dTag of removedDTags) {
          delete fingerprints[dTag];
        }
      }
    } catch (error) {
      console.warn("Failed to query event IDs for removed items/collections", { 
        removedDTags, 
        pubkey: pubkeyValue, 
        error: error?.message || error 
      });
      // Still remove fingerprints even if query failed
      for (const dTag of removedDTags) {
        delete fingerprints[dTag];
      }
    }
  } else if (removedDTags.length > 0) {
    // No relays available, but still remove fingerprints
    for (const dTag of removedDTags) {
      delete fingerprints[dTag];
    }
  }

  // Process current events (new/updated items and collections)
  // For collections, verify they actually exist on relays before skipping
  let skippedCollections = 0;
  let publishedCollections = 0;
  const collectionDTagsToVerify = [];
  const collectionEventsMap = new Map();
  
  // First pass: identify collections that match fingerprints
  console.log("First pass: checking collections for fingerprint matches", JSON.stringify({
    totalEvents: events.length,
    previousFingerprints: Object.keys(previous).length
  }, null, 2));
  
  for (const event of events) {
    const dTag = event.tags.find((tag) => Array.isArray(tag) && tag[0] === "d")?.[1];
    if (!dTag) continue;
    const fingerprint = computeFingerprint(event);
    const isCollection = event.kind === 30405;
    
    if (isCollection) {
      const hasPreviousFingerprint = previous[dTag] !== undefined;
      const fingerprintMatches = previous[dTag] === fingerprint;
      if (hasPreviousFingerprint && fingerprintMatches) {
        // Collection matches fingerprint - need to verify it exists on relays
        console.log("Collection matches fingerprint, will verify", { dTag, fingerprint: fingerprint.substring(0, 8) + "..." });
        collectionDTagsToVerify.push(dTag);
        collectionEventsMap.set(dTag, event);
      } else if (hasPreviousFingerprint && !fingerprintMatches) {
        console.log("Collection fingerprint changed, will publish", { dTag, oldFp: previous[dTag]?.substring(0, 8) + "...", newFp: fingerprint.substring(0, 8) + "..." });
      } else {
        console.log("Collection has no previous fingerprint, will publish", { dTag });
      }
    }
  }
  
  console.log("First pass complete", JSON.stringify({
    collectionDTagsToVerify: collectionDTagsToVerify.length,
    dTags: collectionDTagsToVerify
  }, null, 2));
  
  // Verify collections exist on relays
  // If verification can't run or fails, existingCollectionDTags stays empty,
  // which means collections will be published (safe default)
  const existingCollectionDTags = new Set();
  if (collectionDTagsToVerify.length > 0) {
    console.log("Verifying collections on relays", JSON.stringify({ 
      collectionDTagsToVerify, 
      hasNostrPool: !!nostrPool, 
      profileRelaysCount: profileRelays?.length || 0 
    }, null, 2));
    
    if (nostrPool && profileRelays && profileRelays.length > 0) {
      try {
        const timeoutMs = Number.parseInt(process.env.EVENT_QUERY_TIMEOUT_MS ?? "5000", 10);
        const timeoutPromise = new Promise((resolve) => setTimeout(() => resolve([]), timeoutMs));
        
        const queryPromise = nostrPool
          .querySync(profileRelays, {
            kinds: [30405],
            authors: [pubkeyValue],
            "#d": collectionDTagsToVerify
          })
          .catch((error) => {
            console.warn("Failed to verify collections on relays - will publish them", { 
              pubkey: pubkeyValue, 
              dTags: collectionDTagsToVerify, 
              error: error?.message || error 
            });
            return []; // Return empty array so collections will be published
          });
        
        const existingEvents = await Promise.race([queryPromise, timeoutPromise]);
        
        console.log("Collection verification results", JSON.stringify({
          collectionDTagsToVerify,
          existingEventsCount: existingEvents?.length || 0,
          foundDTags: []
        }, null, 2));
        
        if (existingEvents && Array.isArray(existingEvents) && existingEvents.length > 0) {
          for (const event of existingEvents) {
            // Skip events with invalid 'a' tag format
            if (!isValidEventFormat(event)) {
              console.warn("Skipping collection event with invalid 'a' tag format during verification", {
                eventId: event.id?.substring(0, 16) + "...",
                kind: event.kind
              });
              continue;
            }
            
            const dTag = event.tags?.find((tag) => Array.isArray(tag) && tag[0] === "d")?.[1];
            if (dTag && collectionDTagsToVerify.includes(dTag)) {
              existingCollectionDTags.add(dTag);
            }
          }
          console.log("Collections found on relays", JSON.stringify({ 
            foundDTags: Array.from(existingCollectionDTags),
            missingDTags: collectionDTagsToVerify.filter(d => !existingCollectionDTags.has(d))
          }, null, 2));
        } else {
          console.log("No collections found on relays (or query returned empty), all will be published", { 
            collectionDTagsToVerify,
            existingEventsWasArray: Array.isArray(existingEvents),
            existingEventsLength: existingEvents?.length || 0
          });
        }
      } catch (error) {
        console.warn("Error verifying collections on relays - will publish them", { 
          error: error?.message || error,
          collectionDTagsToVerify 
        });
        // existingCollectionDTags stays empty, so collections will be published
      }
    } else {
      console.log("Cannot verify collections - no nostrPool or relays, will publish them", { 
        hasNostrPool: !!nostrPool, 
        profileRelaysCount: profileRelays?.length || 0,
        collectionDTagsToVerify
      });
      // existingCollectionDTags stays empty, so collections will be published
    }
  } else {
    console.log("No collections to verify (none had matching fingerprints)", {
      totalCollections: events.filter(e => e.kind === 30405).length
    });
  }
  
  // Second pass: process all events
  for (const event of events) {
    const dTag = event.tags.find((tag) => Array.isArray(tag) && tag[0] === "d")?.[1];
    if (!dTag) {
      console.log("Event has no d-tag, skipping", { kind: event.kind });
      continue;
    }
    const fingerprint = computeFingerprint(event);
    const isCollection = event.kind === 30405;
    
    // For collections: ALWAYS verify they exist on relays before skipping
    // For products: skip if fingerprint matches (they don't need verification)
    if (previous[dTag] && previous[dTag] === fingerprint) {
      if (isCollection) {
        // Collection with matching fingerprint - only skip if we verified it exists on relays
        if (existingCollectionDTags.has(dTag)) {
          console.log("Collection exists on relays, skipping", { dTag });
          skippedCollections++;
          fingerprints[dTag] = fingerprint; // Keep the fingerprint
          continue;
        } else {
          // Collection fingerprint matches but doesn't exist on relays - MUST publish it
          console.log("Collection fingerprint matches but NOT found on relays, MUST publish", { 
            dTag, 
            wasInVerificationList: collectionDTagsToVerify.includes(dTag),
            existingCollectionDTagsSize: existingCollectionDTags.size,
            existingCollectionDTags: Array.from(existingCollectionDTags)
          });
          // Fall through to publish - DO NOT SKIP
        }
      } else {
        // Product with matching fingerprint - skip it (no verification needed)
        continue;
      }
    } else if (isCollection) {
      // Collection without previous fingerprint - always publish
      console.log("Collection has no previous fingerprint, will publish", { dTag, fingerprint: fingerprint.substring(0, 8) + "..." });
    }
    
    // Add to publish list
    console.log("Adding event to publish list", { 
      kind: event.kind, 
      dTag, 
      isCollection,
      hasPreviousFingerprint: !!previous[dTag],
      fingerprintMatches: previous[dTag] === fingerprint
    });
    
    toPublish.push({
      kind: event.kind,
      created_at: event.created_at,
      content: event.content,
      tags: event.tags
    });
    if (isCollection) {
      publishedCollections++;
      console.log("Collection added to publish list", { dTag, publishedCollections });
    }
    fingerprints[dTag] = fingerprint;
  }
  
  // Always log publishing summary (not just in debug mode)
  console.log("Publishing summary", JSON.stringify({
    totalToPublish: toPublish.length,
    publishedCollections,
    skippedCollections,
    collectionEventsInInput: collectionEvents.length,
    collectionKinds: toPublish.filter((e) => e.kind === 30405).length
  }, null, 2));
  
  if (process.env.DEBUG_SQUARE_SYNC === "true") {
    console.debug("Publishing summary (detailed)", {
      totalToPublish: toPublish.length,
      publishedCollections,
      skippedCollections,
      collectionEventsInInput: collectionEvents.length
    });
  }

  const persistFingerprints = options?.persistFingerprints !== false;
  if (persistFingerprints) {
    const expressionValues = {
      ":sync": new Date().toISOString(),
      ":count": toPublish.length,
      ":fp": fingerprints,
      ":u": new Date().toISOString(),
      ":loc": catalog.locations
    };
    const removeExpressions = [];
    let updateExpression =
      "SET lastSyncAt = :sync, lastPublishCount = :count, publishedFingerprints = :fp, updatedAt = :u, locations = :loc";
    if (profileLocation) {
      updateExpression += ", profileLocation = :profileLocation";
      expressionValues[":profileLocation"] = profileLocation;
    } else if (locationChanged && existingLocation) {
      removeExpressions.push("profileLocation");
    }
    if (profileGeoHash) {
      updateExpression += ", profileGeoHash = :profileGeoHash";
      expressionValues[":profileGeoHash"] = profileGeoHash;
    } else if ((locationChanged && existingGeoHash) || (!profileGeoHash && existingGeoHash && !profileLocation)) {
      removeExpressions.push("profileGeoHash");
    }
    const finalExpression =
      removeExpressions.length > 0 ? `${updateExpression} REMOVE ${removeExpressions.join(", ")}` : updateExpression;
    await dynamo.send(
      new UpdateCommand({
        TableName: squareConnectionsTable,
        Key: { [squarePrimaryKey]: extractPubkey(refreshed) },
        UpdateExpression: finalExpression,
        ExpressionAttributeValues: expressionValues
      })
    );
  } else {
    console.log("performSync: persistFingerprints=false, skipping DynamoDB fingerprint update (e.g. post-OAuth)");
  }

  return {
    totalEvents: events.length,
    pendingCount: toPublish.length,
    events: toPublish
  };
}

async function loadConnection(pubkey) {
  if (!pubkey) {
    throw new Error("Missing pubkey");
  }
  const result = await dynamo.send(
    new GetCommand({
      TableName: squareConnectionsTable,
      Key: { [squarePrimaryKey]: pubkey }
    })
  );
  if (!result.Item) {
    return null;
  }
  if (!result.Item.pubkey) {
    result.Item.pubkey = result.Item[squarePrimaryKey];
  }
  return result.Item;
}

async function handleStatus(event, requestOrigin = null) {
  const pubkey = event.queryStringParameters?.pubkey;
  if (!pubkey) {
    return jsonResponse(400, { error: "pubkey query parameter required" }, {}, requestOrigin);
  }
  const record = await loadConnection(pubkey);
  if (!record) {
    return jsonResponse(200, { connected: false }, {}, requestOrigin);
  }
  return jsonResponse(200, {
    connected: true,
    merchantId: record.merchantId,
    merchantName: record.merchantName || null,
    locations: record.locations || [],
    scopes: record.scopes || [],
    connectedAt: record.connectedAt || null,
    lastSyncAt: record.lastSyncAt || null,
    lastPublishCount: record.lastPublishCount || 0,
    profileLocation: record.profileLocation || null,
    profileGeoHash: record.profileGeoHash || null
  }, {}, requestOrigin);
}

async function handleExchange(event, requestOrigin = null) {
  if (event.requestContext.http.method !== "POST") {
    return jsonResponse(405, { error: "Method not allowed" }, {}, requestOrigin);
  }
  const body = parseJson(event.body);
  const { code, codeVerifier, pubkey } = body;
  if (!code || !codeVerifier || !pubkey) {
    return jsonResponse(400, { error: "code, codeVerifier, and pubkey are required" }, {}, requestOrigin);
  }
  const rawProfileLocation =
    typeof body.profileLocation === "string" ? body.profileLocation.trim() : null;
  const profileLocation = rawProfileLocation && rawProfileLocation.length ? rawProfileLocation : null;

  const token = await exchangeAuthorizationCode({ code, codeVerifier });

  const [locationsResp, merchantResp] = await Promise.all([
    fetchSquare("/v2/locations", { accessToken: token.access_token }),
    fetchSquare(`/v2/merchants/${token.merchant_id}`, { accessToken: token.access_token })
  ]);

  const locations =
    locationsResp.locations?.map((loc) => {
      const address = loc.address || {};
      // Build full address string for matching
      const addressParts = [
        address.address_line_1,
        address.locality,
        address.administrative_district_level_1,
        address.postal_code,
        address.country
      ].filter(Boolean);
      const fullAddress = addressParts.join(", ");
      
      return {
        id: loc.id,
        name: loc.name || address.address_line_1 || "Location",
        address: {
          address_line_1: address.address_line_1 || null,
          locality: address.locality || null,
          administrative_district_level_1: address.administrative_district_level_1 || null,
          postal_code: address.postal_code || null,
          country: address.country || null
        },
        fullAddress: fullAddress || null
      };
    }) || [];

  const merchant = merchantResp.merchant || {};
  const merchantName =
    merchant.business_name ||
    merchant.company_name ||
    merchant.id ||
    token.merchant_id;

  const item = {
    [squarePrimaryKey]: pubkey,
    pubkey,
    merchantId: token.merchant_id,
    merchantName,
    accessToken: token.access_token,
    refreshToken: token.refresh_token || null,
    expiresAt: token.expires_at || null,
    scopes: token.scope ? token.scope.split(" ") : Array.isArray(token.scopes) ? token.scopes : [],
    connectedAt: new Date().toISOString(),
    locations,
    lastSyncAt: null,
    lastPublishCount: 0,
    publishedFingerprints: {}
  };
  if (profileLocation) {
    item.profileLocation = profileLocation;
  }

  await dynamo.send(
    new PutCommand({
      TableName: squareConnectionsTable,
      Item: item
    })
  );

  const result = await performSync({ ...item, pubkey }, { profileLocation, persistFingerprints: false });

  return jsonResponse(200, {
    connected: true,
    merchantId: item.merchantId,
    merchantName: item.merchantName,
    locations: item.locations,
    initialSync: result
  }, {}, requestOrigin);
}

async function performPreview(record, options) {
  console.log("=== performPreview START ===");
  const refreshed = await refreshAccessToken(record);
  console.log("Token details", JSON.stringify({
    merchantId: refreshed.merchantId,
    scopes: refreshed.scopes,
    hasAccessToken: !!refreshed.accessToken,
    accessTokenLength: refreshed.accessToken?.length || 0,
    apiBase: resolveSquareBase()
  }, null, 2));
  const catalog = await fetchNormalizedCatalog(refreshed);
  console.log("Catalog fetched (preview)", JSON.stringify({ itemsCount: catalog.items?.length || 0, categoriesCount: catalog.categories?.length || 0 }, null, 2));
  const requestedLocationRaw = options?.profileLocation;
  const hasRequestedLocation =
    typeof requestedLocationRaw === "string" && requestedLocationRaw.trim().length > 0;
  const requestedLocation = hasRequestedLocation ? requestedLocationRaw.trim() : null;
  const existingLocation =
    typeof record.profileLocation === "string" && record.profileLocation.trim()
      ? record.profileLocation.trim()
      : null;
  const pubkeyValue = extractPubkey(refreshed);

  let profileLocation = hasRequestedLocation ? requestedLocation : existingLocation;

  if (!profileLocation) {
    const fromRelays = await fetchProfileLocationFromRelays(pubkeyValue);
    if (fromRelays) {
      profileLocation = fromRelays.trim();
    }
  }

  const existingGeoHash =
    typeof record.profileGeoHash === "string" && record.profileGeoHash.trim()
      ? record.profileGeoHash.trim()
      : null;

  let profileGeoHash = existingGeoHash;
  const locationHasFullAddress = profileLocation ? isCompleteAddress(profileLocation) : false;
  if (locationHasFullAddress) {
    if (!existingGeoHash) {
      const { geohash } = await geocodeLocation(profileLocation);
      profileGeoHash = geohash || null;
    }
  }

  // Fetch business name from kind:0 profile
  const businessName = await fetchProfileNameFromRelays(pubkeyValue);
  console.log("Business name fetched (preview)", JSON.stringify({ businessName }, null, 2));

  // Build product events and collection events
  const productEvents = buildEvents(catalog, profileLocation, profileGeoHash, businessName, pubkeyValue);
  const collectionEvents = buildCollectionEvents(catalog, profileLocation, profileGeoHash, businessName, pubkeyValue);
  
  // Always log collection events info (not just in debug mode)
  console.log("Collection events created (preview)", JSON.stringify({
    productEventsCount: productEvents.length,
    collectionEventsCount: collectionEvents.length,
    collectionDTags: collectionEvents.map((e) => {
      const dTag = e.tags.find((t) => Array.isArray(t) && t[0] === "d")?.[1];
      return dTag;
    }),
    totalItems: catalog.items?.length || 0,
    totalCategories: catalog.categories?.length || 0
  }, null, 2));
  
  const events = [...productEvents, ...collectionEvents];

  const previous = record.publishedFingerprints || {};
  const toPublish = [];
  let deletionCount = 0;

  // Build set of current d-tags (for both products and collections)
  const currentDTags = new Set();
  for (const event of events) {
    const dTag = event.tags.find((tag) => Array.isArray(tag) && tag[0] === "d")?.[1];
    if (dTag) {
      currentDTags.add(dTag);
    }
  }

  // Detect removed items/collections: d-tags in previous but not in current
  const removedDTags = [];
  for (const dTag of Object.keys(previous)) {
    if (!currentDTags.has(dTag)) {
      removedDTags.push(dTag);
    }
  }

  if (process.env.DEBUG_SQUARE_SYNC === "true") {
    console.debug("Preview deletion detection", {
      previousDTags: Object.keys(previous),
      currentDTags: Array.from(currentDTags),
      removedDTags,
      hasRelays: !!(nostrPool && profileRelays.length)
    });
  }

  // Query relays for events being deleted to show in preview
  const deletionEvents = [];
  if (removedDTags.length > 0 && nostrPool && profileRelays.length) {
    try {
      // Query for the full events (not just IDs) so we can display them
      const timeoutMs = Number.parseInt(process.env.EVENT_QUERY_TIMEOUT_MS ?? "5000", 10);
      const timeoutPromise = new Promise((resolve) => setTimeout(() => resolve([]), timeoutMs));
      
      // Query for both product events (30402) and collection events (30405)
      const queryPromise = nostrPool
        .querySync(profileRelays, {
          kinds: [30402, 30405],
          authors: [pubkeyValue],
          "#d": removedDTags
        })
        .catch((error) => {
          console.warn("Failed to query events for deletion preview", { pubkey: pubkeyValue, dTags: removedDTags, error: error?.message || error });
          return [];
        });
      
      const eventsToDelete = await Promise.race([queryPromise, timeoutPromise]);
      
      if (eventsToDelete && Array.isArray(eventsToDelete)) {
        // Build map of d-tag -> most recent event
        // Ignore events with invalid 'a' tag format
        const dTagToEvent = {};
        for (const event of eventsToDelete) {
          if (!event || !event.id) continue;
          
          // Skip events with invalid 'a' tag format
          if (!isValidEventFormat(event)) {
            console.warn("Skipping event with invalid 'a' tag format in preview deletion", {
              eventId: event.id?.substring(0, 16) + "...",
              kind: event.kind
            });
            continue;
          }
          
          const dTag = event.tags?.find((tag) => Array.isArray(tag) && tag[0] === "d")?.[1];
          if (dTag && removedDTags.includes(dTag)) {
            const existing = dTagToEvent[dTag];
            if (!existing || (event.created_at > existing.created_at)) {
              dTagToEvent[dTag] = event;
            }
          }
        }
        
        // Convert to array and mark as deletion events
        for (const [dTag, event] of Object.entries(dTagToEvent)) {
          deletionEvents.push({
            kind: event.kind,
            created_at: event.created_at,
            content: event.content,
            tags: event.tags,
            _isDeletion: true,
            _dTag: dTag
          });
        }
        
        deletionCount = deletionEvents.length;
      } else {
        // Even if we can't find events, count as deletions if we have removed d-tags
        deletionCount = removedDTags.length;
      }
    } catch (error) {
      console.warn("Failed to query events for removed items/collections in preview", { 
        removedDTags, 
        pubkey: pubkeyValue, 
        error: error?.message || error 
      });
      // Still count as deletions even if query failed
      deletionCount = removedDTags.length;
    }
  } else if (removedDTags.length > 0) {
    // No relays available, but still count as deletions
    deletionCount = removedDTags.length;
  }

  // Process current events (new/updated items and collections)
  for (const event of events) {
    const dTag = event.tags.find((tag) => Array.isArray(tag) && tag[0] === "d")?.[1];
    if (!dTag) continue;
    const fingerprint = computeFingerprint(event);
    if (previous[dTag] && previous[dTag] === fingerprint) {
      continue;
    }
    toPublish.push({
      kind: event.kind,
      created_at: event.created_at,
      content: event.content,
      tags: event.tags
    });
  }

  // Combine update events and deletion events for preview
  const allPreviewEvents = [...toPublish, ...deletionEvents];

  return {
    totalEvents: events.length,
    pendingCount: toPublish.length + deletionCount,
    deletionCount,
    events: allPreviewEvents
  };
}

async function handlePreview(event, requestOrigin = null) {
  if (event.requestContext?.http?.method !== "POST") {
    return jsonResponse(405, { error: "Method not allowed" }, {}, requestOrigin);
  }
  const body = parseJson(event.body);
  const { pubkey } = body;
  if (!pubkey) {
    return jsonResponse(400, { error: "pubkey is required" }, {}, requestOrigin);
  }
  const rawProfileLocation =
    typeof body.profileLocation === "string" ? body.profileLocation.trim() : null;
  const profileLocation = rawProfileLocation && rawProfileLocation.length ? rawProfileLocation : null;
  const record = await loadConnection(pubkey);
  if (!record) {
    return jsonResponse(404, { error: "Square connection not found" }, {}, requestOrigin);
  }
  const result = await performPreview({ ...record, pubkey }, { profileLocation });
  return jsonResponse(200, {
    merchantId: record.merchantId,
    pendingCount: result.pendingCount,
    totalEvents: result.totalEvents,
    deletionCount: result.deletionCount,
    events: result.events
  }, {}, requestOrigin);
}

async function handlePublish(event, requestOrigin = null) {
  console.log("=== handlePublish START ===");
  if (event.requestContext.http.method !== "POST") {
    return jsonResponse(405, { error: "Method not allowed" }, {}, requestOrigin);
  }
  const body = parseJson(event.body);
  const { pubkey, clearCache } = body;
  console.log("handlePublish - pubkey:", pubkey, "clearCache:", clearCache);
  if (!pubkey) {
    return jsonResponse(400, { error: "pubkey is required" }, {}, requestOrigin);
  }
  const rawProfileLocation =
    typeof body.profileLocation === "string" ? body.profileLocation.trim() : null;
  const profileLocation = rawProfileLocation && rawProfileLocation.length ? rawProfileLocation : null;
  console.log("handlePublish - profileLocation:", profileLocation);
  const record = await loadConnection(pubkey);
  if (!record) {
    console.log("handlePublish - connection not found for pubkey:", pubkey);
    return jsonResponse(404, { error: "Square connection not found" }, {}, requestOrigin);
  }
  
  // Clear publishedFingerprints cache if requested
  if (clearCache === true) {
    console.log("handlePublish - clearing publishedFingerprints cache");
    await dynamo.send(
      new UpdateCommand({
        TableName: squareConnectionsTable,
        Key: { [squarePrimaryKey]: pubkey },
        UpdateExpression: "SET publishedFingerprints = :empty, updatedAt = :u",
        ExpressionAttributeValues: {
          ":empty": {},
          ":u": new Date().toISOString()
        }
      })
    );
    console.log("Cleared publishedFingerprints for pubkey:", pubkey);
    
    // Return early to prevent repopulating the cache with performSync
    // This allows preview to detect all items as needing to be republished
    return jsonResponse(200, {
      merchantId: record.merchantId,
      pendingCount: 0,
      totalEvents: 0,
      events: []
    }, {}, requestOrigin);
  }
  
  console.log("handlePublish - connection found, calling performSync");
  const result = await performSync({ ...record, pubkey }, { profileLocation });
  return jsonResponse(200, {
    merchantId: record.merchantId,
    pendingCount: result.pendingCount,
    totalEvents: result.totalEvents,
    events: result.events
  }, {}, requestOrigin);
}


export const handler = withErrorHandling(async (event) => {
  console.log("=== Lambda handler called ===", JSON.stringify({
    path: event.requestContext?.http?.path,
    method: event.requestContext?.http?.method,
    timestamp: new Date().toISOString()
  }, null, 2));
  const requestOrigin = event.headers?.["origin"] || event.headers?.["Origin"] || null;
  if (event.requestContext?.http?.method === "OPTIONS") {
    return jsonResponse(200, { ok: true }, {}, requestOrigin);
  }
  const path = event.requestContext?.http?.path || "";
  if (path.endsWith("/square/status")) {
    return handleStatus(event, requestOrigin);
  }
  if (path.endsWith("/square/oauth/exchange")) {
    return handleExchange(event, requestOrigin);
  }
  if (path.endsWith("/square/preview")) {
    console.log("=== Routing to handlePreview ===");
    return handlePreview(event, requestOrigin);
  }
  if (path.endsWith("/square/publish")) {
    console.log("=== Routing to handlePublish ===");
    return handlePublish(event, requestOrigin);
  }
  return jsonResponse(404, { error: "Not found" }, {}, requestOrigin);
});
