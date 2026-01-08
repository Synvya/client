/**
 * Timezone Utility
 * 
 * Extracts IANA timezone from business profile location strings.
 * Location format: "City, State, ZIP, Country"
 * Example: "Snoqualmie, WA, 98065, US" -> "America/Los_Angeles"
 */

/**
 * US State code to IANA timezone mapping
 */
const US_STATE_TO_TIMEZONE: Record<string, string> = {
  // Pacific Time Zone
  WA: "America/Los_Angeles",
  OR: "America/Los_Angeles",
  CA: "America/Los_Angeles",
  NV: "America/Los_Angeles",
  
  // Mountain Time Zone
  MT: "America/Denver",
  ID: "America/Boise",
  WY: "America/Denver",
  UT: "America/Denver",
  CO: "America/Denver",
  AZ: "America/Phoenix", // Arizona doesn't observe DST
  NM: "America/Denver",
  
  // Central Time Zone
  ND: "America/Chicago",
  SD: "America/Chicago",
  NE: "America/Chicago",
  KS: "America/Chicago",
  OK: "America/Chicago",
  TX: "America/Chicago",
  MN: "America/Chicago",
  IA: "America/Chicago",
  MO: "America/Chicago",
  AR: "America/Chicago",
  LA: "America/Chicago",
  WI: "America/Chicago",
  IL: "America/Chicago",
  MS: "America/Chicago",
  TN: "America/Chicago",
  AL: "America/Chicago",
  
  // Eastern Time Zone
  MI: "America/New_York",
  IN: "America/Indiana/Indianapolis",
  OH: "America/New_York",
  KY: "America/New_York",
  WV: "America/New_York",
  VA: "America/New_York",
  NC: "America/New_York",
  SC: "America/New_York",
  GA: "America/New_York",
  FL: "America/New_York",
  PA: "America/New_York",
  NY: "America/New_York",
  VT: "America/New_York",
  NH: "America/New_York",
  ME: "America/New_York",
  MA: "America/New_York",
  RI: "America/New_York",
  CT: "America/New_York",
  NJ: "America/New_York",
  DE: "America/New_York",
  MD: "America/New_York",
  DC: "America/New_York",
  
  // Alaska Time Zone
  AK: "America/Anchorage",
  
  // Hawaii-Aleutian Time Zone
  HI: "Pacific/Honolulu",
};

/**
 * Default timezone to use when parsing fails
 */
const DEFAULT_TIMEZONE = "America/New_York";

/**
 * Mapping of IANA timezones to user-friendly names
 */
const TIMEZONE_DISPLAY_NAMES: Record<string, string> = {
  "America/Los_Angeles": "Pacific Time",
  "America/Denver": "Mountain Time",
  "America/Boise": "Mountain Time",
  "America/Phoenix": "Mountain Time (no DST)",
  "America/Chicago": "Central Time",
  "America/New_York": "Eastern Time",
  "America/Indiana/Indianapolis": "Eastern Time",
  "America/Anchorage": "Alaska Time",
  "Pacific/Honolulu": "Hawaii Time",
};

/**
 * Extract IANA timezone from business profile location string
 * 
 * @param location - Location string in various formats
 * @returns IANA timezone string (e.g., "America/Los_Angeles")
 * 
 * @example
 * getTimezoneFromLocation("7970 Railroad Ave, Snoqualmie, WA, 98065, USA") // "America/Los_Angeles"
 * getTimezoneFromLocation("Snoqualmie, WA, 98065, US") // "America/Los_Angeles"
 * getTimezoneFromLocation("New York, NY, 10001, US") // "America/New_York"
 * getTimezoneFromLocation("") // "America/New_York" (default)
 */
export function getTimezoneFromLocation(location: string): string {
  if (!location || typeof location !== "string") {
    return DEFAULT_TIMEZONE;
  }

  // Split by comma and trim whitespace
  // Formats can be:
  // - "Street, City, State, ZIP, Country" (5 parts)
  // - "City, State, ZIP, Country" (4 parts)
  const parts = location.split(",").map((part) => part.trim());
  
  if (parts.length < 2) {
    // Not enough parts to parse
    return DEFAULT_TIMEZONE;
  }

  // Search through parts to find a 2-letter uppercase state code
  // State codes are always exactly 2 uppercase letters
  for (const part of parts) {
    const upperPart = part.toUpperCase();
    // Check if this part is a 2-letter state code
    if (upperPart.length === 2 && /^[A-Z]{2}$/.test(upperPart)) {
      const timezone = US_STATE_TO_TIMEZONE[upperPart];
      if (timezone) {
        return timezone;
      }
    }
  }

  // If no match found, return default
  return DEFAULT_TIMEZONE;
}

/**
 * Format IANA timezone string to user-friendly display name
 * 
 * @param timezone - IANA timezone string (e.g., "America/Los_Angeles")
 * @returns User-friendly timezone name (e.g., "Pacific Time")
 * 
 * @example
 * formatTimezoneDisplay("America/Los_Angeles") // "Pacific Time"
 * formatTimezoneDisplay("America/New_York") // "Eastern Time"
 * formatTimezoneDisplay("Unknown/Timezone") // "Unknown Timezone"
 */
export function formatTimezoneDisplay(timezone: string): string {
  // Check if we have a friendly name for this timezone
  if (TIMEZONE_DISPLAY_NAMES[timezone]) {
    return TIMEZONE_DISPLAY_NAMES[timezone];
  }

  // Fallback: Format the IANA string to be more readable
  // "America/Los_Angeles" -> "America/Los Angeles"
  // "Pacific/Honolulu" -> "Pacific/Honolulu"
  return timezone.replace(/_/g, " ");
}
