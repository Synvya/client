import ngeohash from "ngeohash";

const GEOHASH_PRECISION = 9;
const GEOCODE_ENDPOINT = "https://nominatim.openstreetmap.org/search";
const FALLBACK_GEOCODE_ENDPOINT = "https://geocode.maps.co/search";
const GEOCODE_USER_AGENT = "SynvyaClient/1.0 (contact@synvya.com)";
const GEOCODE_CONTACT_EMAIL = "contact@synvya.com";

// Simple in-memory cache for geocoding results
const geocodeCache = new Map<string, { geohash: string | null; latitude: number | null; longitude: number | null }>();

function precisionWithinBounds(value: number): number {
  if (!Number.isInteger(value)) return 9;
  return Math.min(Math.max(value, 1), 12);
}

function buildAddressVariants(location: string): string[] {
  const base = location.trim();
  const variants = new Set<string>();
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

async function queryGeocoder(endpoint: string, address: string): Promise<{ latitude: number; longitude: number } | null> {
  if (!endpoint) return null;
  try {
    const url = new URL(endpoint);
    url.searchParams.set("q", address);
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("limit", "1");
    url.searchParams.set("addressdetails", "0");
    if (GEOCODE_CONTACT_EMAIL) {
      url.searchParams.set("email", GEOCODE_CONTACT_EMAIL);
    }

    const response = await fetch(url.toString(), {
      headers: {
        "User-Agent": GEOCODE_USER_AGENT,
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

export interface GeocodeResult {
  geohash: string | null;
  latitude: number | null;
  longitude: number | null;
}

/**
 * Geocode a location string and return the geohash, latitude, and longitude.
 * Reuses the same logic as the Square integration for consistency.
 * 
 * @param location - The location string to geocode (e.g., "123 Main St, Seattle, WA, 98101, USA")
 * @returns An object with geohash, latitude, and longitude, or null values if geocoding fails
 */
export async function geocodeLocation(location: string | null | undefined): Promise<GeocodeResult> {
  if (!location) return { geohash: null, latitude: null, longitude: null };
  const trimmed = location.trim();
  if (!trimmed) {
    return { geohash: null, latitude: null, longitude: null };
  }
  const cacheKey = trimmed.toLowerCase();
  if (geocodeCache.has(cacheKey)) {
    return geocodeCache.get(cacheKey)!;
  }

  const variants = buildAddressVariants(trimmed);
  try {
    for (const variant of variants) {
      const primary = await queryGeocoder(GEOCODE_ENDPOINT, variant);
      if (primary) {
        const safePrecision = precisionWithinBounds(GEOHASH_PRECISION);
        const geohash = ngeohash.encode(primary.latitude, primary.longitude, safePrecision);
        const result = { geohash, latitude: primary.latitude, longitude: primary.longitude };
        geocodeCache.set(cacheKey, result);
        return result;
      }
    }

    if (FALLBACK_GEOCODE_ENDPOINT) {
      for (const variant of variants) {
        const fallback = await queryGeocoder(FALLBACK_GEOCODE_ENDPOINT, variant);
        if (fallback) {
          const safePrecision = precisionWithinBounds(GEOHASH_PRECISION);
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

