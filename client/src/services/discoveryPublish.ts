/**
 * Service for fetching data from Nostr and publishing discovery pages to Synvya.com.
 * This consolidates the logic previously spread across WebsiteData.tsx for reuse
 * by Profile and Menu publish flows.
 */

import { getPool } from "@/lib/relayPool";
import { parseKind0ProfileEvent } from "@/components/BusinessProfileForm";
import { deduplicateEvents } from "@/lib/nostrEventProcessing";
import { mapBusinessTypeToEstablishmentSlug } from "@/lib/siteExport/typeMapping";
import { slugify } from "@/lib/siteExport/slug";
import { buildStaticSiteFiles } from "@/lib/siteExport/buildSite";
import { publishDiscoveryPage } from "@/services/discovery";
import { useWebsiteData } from "@/state/useWebsiteData";
import type { BusinessProfile } from "@/types/profile";
import type { SquareEventTemplate } from "@/services/square";

export interface DiscoveryPublishResult {
  /** The published Synvya.com URL */
  url: string;
  /** The profile data that was used */
  profile: BusinessProfile;
}

export interface FetchedDiscoveryData {
  /** The parsed business profile */
  profile: BusinessProfile;
  /** Menu events (products and collections) */
  menuEvents: SquareEventTemplate[] | null;
  /** Geohash from profile tags */
  geohash: string | null;
  /** All profile event tags */
  profileTags: string[][];
}

/**
 * Fetches the latest profile and menu data from Nostr relays.
 *
 * @param pubkey - The merchant's public key
 * @param relays - List of relay URLs to query
 * @returns The fetched data or null if no profile exists
 * @throws Error if fetch fails
 */
export async function fetchDiscoveryData(
  pubkey: string,
  relays: string[]
): Promise<FetchedDiscoveryData | null> {
  if (!pubkey || !relays.length) {
    throw new Error("Missing pubkey or relays");
  }

  const pool = getPool();

  // Fetch profile (kind 0)
  const profileEvent = await pool.get(relays, {
    kinds: [0],
    authors: [pubkey]
  });

  if (!profileEvent) {
    // No profile published yet
    return null;
  }

  // Parse profile using the same logic as BusinessProfileForm
  const { patch } = parseKind0ProfileEvent(profileEvent);
  const profile: BusinessProfile = {
    name: patch.name || "",
    displayName: patch.displayName || patch.name || "",
    about: patch.about || "",
    website: patch.website || "",
    nip05: patch.nip05 || "",
    picture: patch.picture || "",
    banner: patch.banner || "",
    businessType: patch.businessType || ("restaurant" as const),
    categories: patch.categories || [],
    phone: patch.phone,
    email: patch.email,
    street: patch.street,
    city: patch.city,
    state: patch.state,
    zip: patch.zip,
    country: patch.country,
    cuisine: patch.cuisine,
    openingHours: patch.openingHours,
    acceptsReservations: patch.acceptsReservations
  };

  // Extract geohash from profile event tags
  const geohashTag = profileEvent.tags.find((t: string[]) => t[0] === "g")?.[1];

  // Fetch menu events (kinds 30402 and 30405)
  const allMenuEvents = await pool.querySync(relays, {
    kinds: [30402, 30405],
    authors: [pubkey]
  });

  // Deduplicate events
  const menuEvents = deduplicateEvents(allMenuEvents, pubkey);

  return {
    profile,
    menuEvents: menuEvents.length > 0 ? menuEvents : null,
    geohash: geohashTag || null,
    profileTags: (profileEvent.tags as string[][]) || []
  };
}

/**
 * Generates the discovery page HTML and publishes it to Synvya.com.
 *
 * @param pubkey - The merchant's public key
 * @param data - The fetched discovery data
 * @returns The publish result with URL and schema HTML
 * @throws Error if publish fails
 */
export async function publishDiscoveryToSynvya(
  pubkey: string,
  data: FetchedDiscoveryData
): Promise<DiscoveryPublishResult> {
  const { profile, menuEvents, geohash, profileTags } = data;

  const typeSlug = mapBusinessTypeToEstablishmentSlug(profile.businessType);
  const nameSlug = slugify(profile.name || profile.displayName || "business");

  const { html } = buildStaticSiteFiles({
    profile,
    geohash,
    menuEvents,
    merchantPubkey: pubkey,
    profileTags,
    typeSlug,
    nameSlug
  });

  const url = await publishDiscoveryPage(typeSlug, nameSlug, html);

  return {
    url,
    profile
  };
}

/**
 * Fetches data from Nostr and publishes the discovery page to Synvya.com in one call.
 * This is the main entry point for Profile and Menu publish flows.
 *
 * @param pubkey - The merchant's public key
 * @param relays - List of relay URLs to query
 * @returns The publish result with URL and profile data
 * @throws Error if no profile exists or publish fails
 */
export async function fetchAndPublishDiscovery(
  pubkey: string,
  relays: string[]
): Promise<DiscoveryPublishResult> {
  const data = await fetchDiscoveryData(pubkey, relays);

  if (!data) {
    throw new Error("No profile found. Please publish your profile first.");
  }

  const result = await publishDiscoveryToSynvya(pubkey, data);

  useWebsiteData.getState().updateSchema(
    data.profile,
    data.menuEvents,
    data.geohash,
    pubkey,
    data.profileTags
  );

  return result;
}

/**
 * Builds the Synvya.com URL for a given profile without publishing.
 * Useful for displaying the expected URL before publishing.
 *
 * @param profile - The business profile
 * @returns The expected Synvya.com URL
 */
export function buildDiscoveryUrl(profile: BusinessProfile): string {
  const typeSlug = mapBusinessTypeToEstablishmentSlug(profile.businessType);
  const nameSlug = slugify(profile.name || profile.displayName || "business");
  return `https://synvya.com/${typeSlug}/${nameSlug}/`;
}
