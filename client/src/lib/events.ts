import type { Event, EventTemplate } from "nostr-tools";
import { finalizeEvent } from "nostr-tools";
import type { BusinessProfile, BusinessType, OpeningHoursSpec } from "@/types/profile";
import { skFromNsec } from "@/lib/nostrKeys";

interface BuildOptions {
  createdAt?: number;
  nsec?: string;
  geohash?: string | null;
  latitude?: number | null;
  longitude?: number | null;
}

/**
 * Converts organization domain to full URL
 * e.g., "snovalley.org" → "https://snovalley.org"
 * If already a full URL, returns as-is
 */
function getChamberUrl(domain: string): string {
  // If already a full URL, return as-is
  if (domain.startsWith("http://") || domain.startsWith("https://")) {
    return domain;
  }
  
  // Add https:// prefix if not present
  return `https://${domain}`;
}

/**
 * Maps ISO 3166-1 alpha-2 country code to telephone country code
 * e.g., "US" → "+1"
 */
function getCountryCode(country: string | undefined): string {
  if (!country) {
    // Default to US if no country specified
    return "+1";
  }
  
  const countryCodeMap: Record<string, string> = {
    "US": "+1",
    "CA": "+1", // Canada shares +1 with US
    "MX": "+52",
    "GB": "+44",
    "FR": "+33",
    "DE": "+49",
    "IT": "+39",
    "ES": "+34",
    "AU": "+61",
    "JP": "+81",
    "CN": "+86",
    "IN": "+91",
    "BR": "+55",
    // Add more as needed
  };
  
  return countryCodeMap[country.toUpperCase()] || "+1";
}

/**
 * Formats phone number with country code prefix
 * If phone already starts with +, assume it's already formatted
 * Strips all non-digit characters (except leading +) before adding country code
 */
function formatPhoneWithCountryCode(phone: string, country: string | undefined): string {
  const trimmed = phone.trim();
  if (trimmed.startsWith("+")) {
    // Already has country code
    return trimmed;
  }
  
  // Strip all non-digit characters
  const digitsOnly = trimmed.replace(/\D/g, "");
  
  const countryCode = getCountryCode(country);
  // Remove any leading 1 if it's a US number and country code is +1
  if (countryCode === "+1" && digitsOnly.startsWith("1") && digitsOnly.length > 10) {
    return `${countryCode}${digitsOnly.slice(1)}`;
  }
  
  return `${countryCode}${digitsOnly}`;
}

/**
 * Maps category to diet tag format if it's a diet category
 * Returns the mapped diet tag or null if not a diet category
 */
function mapDietCategory(category: string): string | null {
  const trimmed = category.trim();
  if (!trimmed) return null;
  
  // Normalize the category to check for diet patterns
  const lower = trimmed.toLowerCase();
  
  // Map common diet terms to proper diet tag format
  const dietMap: Record<string, string> = {
    "vegetarian": "VegetarianDiet",
    "vegan": "VeganDiet",
    "gluten-free": "GlutenFreeDiet",
    "glutenfree": "GlutenFreeDiet",
    "dairy-free": "DairyFreeDiet",
    "dairyfree": "DairyFreeDiet",
    "nut-free": "NutFreeDiet",
    "nutfree": "NutFreeDiet",
    "halal": "HalalDiet",
    "kosher": "KosherDiet",
    "paleo": "PaleoDiet",
    "keto": "KetoDiet",
    "low-carb": "LowCarbDiet",
    "lowcarb": "LowCarbDiet",
  };
  
  // Check exact match first
  if (dietMap[lower]) {
    return dietMap[lower];
  }
  
  // Check if it already ends with "Diet" (case-insensitive)
  if (/diet$/i.test(trimmed)) {
    // Capitalize properly: "vegetarianDiet" -> "VegetarianDiet"
    return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
  }
  
  // Check for patterns like "vegetarian diet", "gluten free diet", etc.
  const normalized = lower.replace(/\s+/g, "");
  if (dietMap[normalized]) {
    return dietMap[normalized];
  }
  
  return null;
}

/**
 * Converts camelCase to PascalCase
 * e.g., "iceCreamShop" -> "IceCreamShop", "barOrPub" -> "BarOrPub"
 */
function camelCaseToPascalCase(str: string): string {
  if (!str) return str;
  return str.charAt(0).toUpperCase() + str.slice(1);
}

/**
 * Formats address components into a single location string
 */
function formatLocation(street?: string, city?: string, state?: string, zip?: string, country?: string): string | null {
  const parts: string[] = [];
  
  if (street) parts.push(street);
  if (city) parts.push(city);
  if (state) parts.push(state);
  if (zip) parts.push(zip);
  
  // Add country, defaulting to "US" if not specified but we have other address parts
  const countryCode = country || (parts.length > 0 ? "US" : undefined);
  if (countryCode) {
    // Convert ISO country code to full country name for common ones
    const countryNames: Record<string, string> = {
      "US": "USA",
      "CA": "Canada",
      "MX": "Mexico",
      "GB": "United Kingdom",
      "FR": "France",
      "DE": "Germany",
      "IT": "Italy",
      "ES": "Spain",
      "AU": "Australia",
      "JP": "Japan",
      "CN": "China",
      "IN": "India",
      "BR": "Brazil",
    };
    parts.push(countryNames[countryCode.toUpperCase()] || countryCode);
  }
  
  return parts.length > 0 ? parts.join(", ") : null;
}

export function buildProfileEvent(profile: BusinessProfile, options: BuildOptions = {}): EventTemplate {
  const content: Record<string, string> = {};

  if (profile.name) content.name = profile.name;
  if (profile.displayName) content.display_name = profile.displayName;
  if (profile.about) content.about = profile.about;
  if (profile.website) content.website = profile.website;
  if (profile.picture) content.picture = profile.picture;
  if (profile.banner) content.banner = profile.banner;
  if (profile.nip05) content.nip05 = profile.nip05;

  const tags: string[][] = [];
  
  // Add business type tag - convert camelCase to PascalCase
  const businessTypePascalCase = camelCaseToPascalCase(profile.businessType);
  tags.push(["t", `foodEstablishment:${businessTypePascalCase}`]);

  // Process categories - map diet categories to proper format, others as-is
  for (const category of profile.categories) {
    const trimmed = category.trim();
    if (trimmed) {
      const dietTag = mapDietCategory(trimmed);
      if (dietTag) {
        tags.push(["t", dietTag]);
      } else {
        tags.push(["t", trimmed]);
      }
    }
  }

  // Add cuisine tag
  if (profile.cuisine) {
    tags.push(["t", `servesCuisine:${profile.cuisine}`]);
  }

  // Add telephone tag
  if (profile.phone) {
    const formattedPhone = formatPhoneWithCountryCode(profile.phone, profile.country);
    tags.push(["telephone", `tel:${formattedPhone}`]);
  }

  // Add email tag
  if (profile.email) {
    tags.push(["email", `mailto:${profile.email}`]);
  }

  // Add location tag (combined address)
  const location = formatLocation(profile.street, profile.city, profile.state, profile.zip, profile.country);
  if (location) {
    tags.push(["location", location]);
  }

  // Add geo coordinates tag (lat, lon format)
  if (options.latitude != null && options.longitude != null) {
    tags.push(["geoCoordinates", `${options.latitude}, ${options.longitude}`]);
  }

  // Add geohash tag
  if (options.geohash) {
    const trimmedGeohash = options.geohash.trim();
    if (trimmedGeohash) {
      tags.push(["g", trimmedGeohash]);
    }
  }

  // Add acceptsReservations tags
  if (profile.acceptsReservations === false) {
    tags.push(["acceptsReservations", "False"]);
  } else if (profile.acceptsReservations === true) {
    tags.push(["acceptsReservations", "https://synvya.com"]);
    tags.push(["i", "rp", "https://github.com/Synvya/reservation-protocol/blob/main/nostr-protocols/nips/rp.md"]);
    tags.push(["k", "nip"]);
  }

  // Add opening hours tag
  if (profile.openingHours && profile.openingHours.length > 0) {
    const hoursParts: string[] = [];
    for (const spec of profile.openingHours) {
      if (spec.days.length > 0 && spec.startTime && spec.endTime) {
        // Format day range: "Tu-Th" or "Mo" for single day
        const dayRange =
          spec.days.length === 1
            ? spec.days[0]
            : `${spec.days[0]}-${spec.days[spec.days.length - 1]}`;
        // Format time range: "11:00-21:00"
        const timeRange = `${spec.startTime}-${spec.endTime}`;
        hoursParts.push(`${dayRange} ${timeRange}`);
      }
    }
    if (hoursParts.length > 0) {
      tags.push(["openingHours", hoursParts.join(", ")]);
    }
  }

  // Add memberOf organization tag if memberOf is specified
  // Use organization URL (e.g., "https://snovalley.org") instead of identifier
  if (profile.memberOf) {
    const memberOfUrl = getChamberUrl(profile.memberOf);
    tags.push(["schema.org:FoodEstablishment:memberOf", memberOfUrl, "https://schema.org/memberOf"]);
  }

  const event: EventTemplate = {
    kind: 0,
    created_at: options.createdAt ?? Math.floor(Date.now() / 1000),
    tags,
    content: JSON.stringify(content)
  };

  return event;
}

export function finalizeProfileEvent(profile: BusinessProfile, nsec: string, options: BuildOptions = {}): Event {
  const template = buildProfileEvent(profile, options);
  const sk = skFromNsec(nsec);
  return finalizeEvent(template, sk);
}
