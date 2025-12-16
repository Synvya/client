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
  
  // Add business type tag
  const businessTypePascalCase = profile.businessType.charAt(0).toUpperCase() + profile.businessType.slice(1);
  tags.push(["schema.org:FoodEstablishment", businessTypePascalCase, "https://schema.org/FoodEstablishment"]);

  for (const category of profile.categories) {
    const trimmed = category.trim();
    if (trimmed) {
      tags.push(["t", trimmed]);
    }
  }

  if (profile.cuisine) {
    tags.push(["schema.org:FoodEstablishment:servesCuisine", profile.cuisine, "https://schema.org/servesCuisine"]);
  }

  if (profile.phone) {
    const formattedPhone = formatPhoneWithCountryCode(profile.phone, profile.country);
    tags.push(["schema.org:FoodEstablishment:telephone", `tel:${formattedPhone}`, "https://datatracker.ietf.org/doc/html/rfc3966"]);
  }

  if (profile.email) {
    tags.push(["schema.org:FoodEstablishment:email", `mailto:${profile.email}`, "https://schema.org/email"]);
  }

  // Add postal address component tags
  if (profile.street) {
    tags.push(["schema.org:PostalAddress:streetAddress", profile.street, "https://schema.org/streetAddress"]);
  }
  if (profile.city) {
    tags.push(["schema.org:PostalAddress:addressLocality", profile.city, "https://schema.org/addressLocality"]);
  }
  if (profile.state) {
    tags.push(["schema.org:PostalAddress:addressRegion", profile.state, "https://schema.org/addressRegion"]);
  }
  if (profile.zip) {
    tags.push(["schema.org:PostalAddress:postalCode", profile.zip, "https://schema.org/postalCode"]);
  }
  // Always add country if we have any address components
  if (profile.street || profile.city || profile.state || profile.zip) {
    const country = profile.country || "US"; // Default to US if not specified
    tags.push(["schema.org:PostalAddress:addressCountry", country, "https://schema.org/addressCountry"]);
  }

  // Add geo tags if geocoding succeeded
  let hasGeoTag = false;
  if (options.latitude != null && options.longitude != null) {
    // Add longitude first, then latitude (as specified)
    tags.push(["schema.org:GeoCoordinates:longitude", options.longitude.toString(), "https://schema.org/longitude"]);
    tags.push(["schema.org:GeoCoordinates:latitude", options.latitude.toString(), "https://schema.org/latitude"]);
    hasGeoTag = true;
  }
  if (options.geohash) {
    const trimmedGeohash = options.geohash.trim();
    if (trimmedGeohash) {
      tags.push(["i", `geo:${trimmedGeohash}`, "https://geohash.org"]);
      hasGeoTag = true;
    }
  }
  if (hasGeoTag) {
    tags.push(["k", "geo"]);
  }

  // Add acceptsReservations tags
  if (profile.acceptsReservations === false) {
    tags.push(["schema.org:FoodEstablishment:acceptsReservations", "False", "https://schema.org/acceptsReservations"]);
  } else if (profile.acceptsReservations === true) {
    tags.push(["schema.org:FoodEstablishment:acceptsReservations", "https://synvya.com", "https://schema.org/acceptsReservations"]);
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
      tags.push(["schema.org:FoodEstablishment:openingHours", hoursParts.join(", "), "https://schema.org/openingHours"]);
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
