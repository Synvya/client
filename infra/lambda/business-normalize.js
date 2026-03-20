/**
 * Business name and geography normalization for cache key generation.
 * Includes Google Places integration for canonical business resolution.
 */

import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";

const secretsClient = new SecretsManagerClient({});

const GOOGLE_PLACES_SEARCH_URL = "https://places.googleapis.com/v1/places:searchText";
const FIELD_MASK = "places.id,places.displayName,places.formattedAddress,places.googleMapsUri,places.websiteUri,places.nationalPhoneNumber,places.internationalPhoneNumber,places.addressComponents,places.regularOpeningHours,places.location,places.primaryType,places.types";

let cachedGoogleKey = null;

async function getGoogleApiKey() {
  if (cachedGoogleKey) return cachedGoogleKey;

  const secretArn = process.env.GOOGLE_MAPS_SECRET_ARN;
  const secretKey = process.env.GOOGLE_MAPS_SECRET_KEY || "google-maps-api-key";

  if (!secretArn) {
    console.warn("GOOGLE_MAPS_SECRET_ARN not set — Google Places resolution disabled");
    return null;
  }

  const result = await secretsClient.send(
    new GetSecretValueCommand({ SecretId: secretArn })
  );

  let secretString = result.SecretString;
  if (!secretString && result.SecretBinary) {
    secretString = Buffer.from(result.SecretBinary, "base64").toString("utf8");
  }
  if (!secretString) throw new Error("Google Maps secret missing");

  let parsed;
  try {
    parsed = JSON.parse(secretString);
  } catch {
    parsed = secretString;
  }

  const value = typeof parsed === "string" ? parsed : parsed?.[secretKey];
  if (!value || typeof value !== "string") {
    throw new Error(`Google Maps secret value missing for key "${secretKey}"`);
  }

  cachedGoogleKey = value.trim();
  return cachedGoogleKey;
}

/**
 * Normalize a string for use in cache keys.
 * Strips accents, lowercases, replaces non-alphanum with dashes.
 */
export function normalizeForCache(str) {
  if (!str || typeof str !== "string") return "";
  return str
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // strip accents
    .replace(/[^a-z0-9]+/g, "-") // non-alphanum → dash
    .replace(/^-+|-+$/g, ""); // trim leading/trailing dashes
}

/**
 * Build a cache key from business info + report config.
 * Uses place_id when available for stable identity, falls back to normalized name.
 */
export function buildCacheKey({ placeId, businessName, city, reportType, promptSetVersion, modelVersion }) {
  const identity = placeId || `${normalizeForCache(businessName)}|${normalizeForCache(city)}`;
  return `${identity}|${reportType}|${promptSetVersion}|${modelVersion}`;
}

/**
 * Build a normalized key for the business identity portion only
 * (used for the 30-day one-report-per-bakery check).
 */
export function buildBusinessKey(placeId, businessName, city) {
  return placeId || `${normalizeForCache(businessName)}|${normalizeForCache(city)}`;
}

// --- Google Places resolution ---

/**
 * Parse address components from Google Places API.
 */
function parseAddressComponents(components) {
  if (!components || !Array.isArray(components)) return {};

  let streetNumber = "";
  let route = "";
  let neighborhood = "";
  let city = "";
  let state = "";
  let zip = "";
  let country = "";

  for (const component of components) {
    const types = component.types || [];
    if (types.includes("street_number")) {
      streetNumber = component.longText || component.shortText || "";
    } else if (types.includes("route")) {
      route = component.longText || component.shortText || "";
    } else if (types.includes("neighborhood")) {
      neighborhood = component.longText || component.shortText || "";
    } else if (types.includes("locality")) {
      city = component.longText || component.shortText || "";
    } else if (types.includes("administrative_area_level_1")) {
      state = component.shortText || component.longText || "";
    } else if (types.includes("postal_code")) {
      zip = component.longText || component.shortText || "";
    } else if (types.includes("country")) {
      country = component.shortText || component.longText || "";
    }
  }

  return {
    street_address: [streetNumber, route].filter(Boolean).join(" ") || undefined,
    neighborhood: neighborhood || undefined,
    city: city || undefined,
    state: state || undefined,
    zip: zip || undefined,
    country: country || undefined,
  };
}

/**
 * Parse opening hours from Google Places API.
 */
function parseOpeningHours(regularOpeningHours) {
  if (!regularOpeningHours?.weekdayDescriptions) return null;
  return regularOpeningHours.weekdayDescriptions;
}

/**
 * Map a Google Places result to our candidate format.
 */
function mapPlaceToCandidate(place) {
  const addressParts = parseAddressComponents(place.addressComponents);

  return {
    place_id: place.id || "",
    name: place.displayName?.text || "",
    formatted_address: place.formattedAddress || "",
    google_maps_url: place.googleMapsUri || "",
    website: place.websiteUri || "",
    phone: place.internationalPhoneNumber || place.nationalPhoneNumber || "",
    street_address: addressParts.street_address,
    neighborhood: addressParts.neighborhood,
    city: addressParts.city,
    state: addressParts.state,
    zip: addressParts.zip,
    country: addressParts.country,
    hours: parseOpeningHours(place.regularOpeningHours),
    lat: place.location?.latitude || null,
    lng: place.location?.longitude || null,
    primary_type: place.primaryType || null,
    types: place.types || [],
  };
}

/**
 * Search Google Places for a business.
 * Returns an array of candidates for the user to choose from.
 *
 * @param {string} name - Business name
 * @param {string} city - City/location
 * @returns {Promise<Array>} Array of candidate objects, or empty array if unavailable
 */
export async function searchGooglePlaces(name, city) {
  const apiKey = await getGoogleApiKey();
  if (!apiKey) return [];

  try {
    const response = await fetch(GOOGLE_PLACES_SEARCH_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": FIELD_MASK,
      },
      body: JSON.stringify({
        textQuery: `${name} ${city}`,
        maxResultCount: 5,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Google Places API error:", response.status, errorText);
      return [];
    }

    const data = await response.json();
    const places = data.places || [];
    return places.map(mapPlaceToCandidate);
  } catch (error) {
    console.error("Google Places search failed:", error);
    return [];
  }
}
