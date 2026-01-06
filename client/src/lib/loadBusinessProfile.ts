/**
 * Business Profile Loading Utilities
 * 
 * Fetches and parses the merchant's own kind:0 profile event from Nostr.
 * Used by auto-acceptance system to get business hours and other profile data.
 */

import { getPool } from "./relayPool";
import type { Event } from "nostr-tools";
import type { BusinessProfile, OpeningHoursSpec } from "@/types/profile";

// In-memory cache to avoid repeated queries during the same session
const profileCache = new Map<string, { profile: BusinessProfile; timestamp: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Parses opening hours from the openingHours tag format.
 * Format: "Tu-Th 11:00-21:00, Fr-Sa 11:00-00:00, Su 12:00-21:00"
 * 
 * @param hoursStr - Opening hours string from tag
 * @returns Array of opening hours specifications
 */
function parseOpeningHours(hoursStr: string): OpeningHoursSpec[] {
  const hoursParts = hoursStr.split(",").map((p) => p.trim()).filter(Boolean);
  const result: OpeningHoursSpec[] = [];
  
  for (const part of hoursParts) {
    const spaceIndex = part.indexOf(" ");
    if (spaceIndex === -1) continue;
    
    const dayRange = part.slice(0, spaceIndex).trim();
    const timeRange = part.slice(spaceIndex + 1).trim();
    const [startTime, endTime] = timeRange.split("-");
    
    if (startTime && endTime) {
      const days: string[] = [];
      if (dayRange.includes("-")) {
        // Parse day range: "Tu-Th"
        const [startDay, endDay] = dayRange.split("-");
        const dayOrder = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
        const startIndex = dayOrder.indexOf(startDay);
        const endIndex = dayOrder.indexOf(endDay);
        if (startIndex >= 0 && endIndex >= 0 && startIndex <= endIndex) {
          for (let i = startIndex; i <= endIndex; i++) {
            days.push(dayOrder[i]);
          }
        }
      } else {
        // Single day: "Mo"
        days.push(dayRange);
      }
      
      if (days.length > 0) {
        result.push({ days, startTime, endTime });
      }
    }
  }
  
  return result;
}

/**
 * Parses a kind:0 profile event into a BusinessProfile object.
 * Extracts data from both content (JSON) and tags.
 * 
 * @param event - The kind:0 event
 * @returns Parsed BusinessProfile or null if parsing fails
 */
function parseProfileEvent(event: Event): BusinessProfile | null {
  try {
    const content = JSON.parse(event.content || "{}") as Record<string, unknown>;
    const profile: Partial<BusinessProfile> = {};
    
    // Extract from content
    if (typeof content.name === "string") profile.name = content.name;
    if (typeof content.display_name === "string") profile.displayName = content.display_name;
    if (typeof content.about === "string") profile.about = content.about;
    if (typeof content.website === "string") profile.website = content.website;
    if (typeof content.nip05 === "string") profile.nip05 = content.nip05;
    if (typeof content.picture === "string") profile.picture = content.picture;
    if (typeof content.banner === "string") profile.banner = content.banner;
    
    // Extract from tags
    const categories: string[] = [];
    const openingHours: OpeningHoursSpec[] = [];
    
    for (const tag of event.tags) {
      if (!Array.isArray(tag) || !tag.length) continue;
      
      // Opening hours - new format: ["openingHours", "Tu-Th 11:00-21:00, ..."]
      if (tag[0] === "openingHours" && typeof tag[1] === "string") {
        const parsed = parseOpeningHours(tag[1]);
        openingHours.push(...parsed);
      }
      // Opening hours - old format for backward compatibility
      else if ((tag[0] === "schema.org:FoodEstablishment:openingHours" || tag[0] === "schema.org:openingHours") && typeof tag[1] === "string") {
        const parsed = parseOpeningHours(tag[1]);
        openingHours.push(...parsed);
      }
      // Categories - skip production, diet categories, foodEstablishment, and servesCuisine tags
      else if (tag[0] === "t" && typeof tag[1] === "string") {
        const tagValue = tag[1];
        if (tagValue === "production") continue;
        if (/Diet$/i.test(tagValue)) continue;
        if (tagValue.startsWith("foodEstablishment:")) continue;
        if (tagValue.startsWith("servesCuisine:")) continue;
        categories.push(tagValue);
      }
    }
    
    // Build complete profile
    const businessProfile: BusinessProfile = {
      name: profile.name || "",
      displayName: profile.displayName || "",
      about: profile.about || "",
      website: profile.website || "",
      nip05: profile.nip05 || "",
      picture: profile.picture || "",
      banner: profile.banner || "",
      businessType: "restaurant", // Default, can be overridden if needed
      categories: categories.length > 0 ? categories : [],
      ...(openingHours.length > 0 && { openingHours }),
    };
    
    return businessProfile;
  } catch (error) {
    console.error("Failed to parse profile event:", error);
    return null;
  }
}

/**
 * Loads the merchant's business profile from Nostr.
 * 
 * Fetches the most recent kind:0 event authored by the merchant's pubkey,
 * parses it, and returns the BusinessProfile. Results are cached for 5 minutes
 * to avoid repeated queries.
 * 
 * @param pubkey - Merchant's public key (hex format)
 * @param relays - Array of relay URLs to query
 * @returns BusinessProfile if found and parsed successfully, null otherwise
 * 
 * @example
 * ```typescript
 * const profile = await loadBusinessProfile(
 *   "abc123...",
 *   ["wss://relay.example.com"]
 * );
 * if (profile?.openingHours) {
 *   console.log("Business hours:", profile.openingHours);
 * }
 * ```
 */
export async function loadBusinessProfile(
  pubkey: string,
  relays: string[]
): Promise<BusinessProfile | null> {
  if (!pubkey || !relays.length) {
    return null;
  }
  
  // Check cache first
  const cached = profileCache.get(pubkey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.profile;
  }
  
  try {
    const pool = getPool();
    
    // Query for the most recent kind:0 event from this pubkey
    const event = await pool.get(relays, {
      kinds: [0],
      authors: [pubkey],
    });
    
    if (!event) {
      return null;
    }
    
    // Parse the event
    const profile = parseProfileEvent(event);
    
    // Cache the result
    if (profile) {
      profileCache.set(pubkey, {
        profile,
        timestamp: Date.now(),
      });
    }
    
    return profile;
  } catch (error) {
    console.error("Failed to load business profile:", error);
    return null;
  }
}

/**
 * Clears the profile cache for a specific pubkey or all pubkeys.
 * 
 * @param pubkey - Optional pubkey to clear cache for. If not provided, clears all.
 */
export function clearProfileCache(pubkey?: string): void {
  if (pubkey) {
    profileCache.delete(pubkey);
  } else {
    profileCache.clear();
  }
}

