/**
 * Nostr Event Builders for Loyalty Offers (kind:31556)
 * 
 * Kind 31556 is a parameterized replaceable event where the 'd' tag acts as the unique identifier.
 * Publishing a new event with the same 'd' tag replaces the previous version.
 */

import type { EventTemplate, NostrEvent } from "nostr-tools";
import type { Offer, OfferType } from "@/types/loyalty";

/**
 * Build an active offer event (kind:31556)
 * 
 * @param offer - Offer data (without eventId, createdAt, status which are generated)
 * @param pubkey - Merchant's public key
 * @param timezone - IANA timezone for the offer validity period
 * @returns Unsigned event template ready for signing
 * 
 * @example
 * const event = buildOfferEvent(
 *   { code: "SAVE20", description: "Get 20% off!", validFrom: new Date(...), validUntil: new Date(...) },
 *   merchantPubkey,
 *   "America/Los_Angeles"
 * );
 */
export function buildOfferEvent(
  offer: Omit<Offer, "eventId" | "createdAt" | "status">,
  pubkey: string,
  timezone: string
): EventTemplate {
  // Convert Date objects to Unix timestamps (seconds)
  const validFromTimestamp = Math.floor(offer.validFrom.getTime() / 1000);
  const validUntilTimestamp = Math.floor(offer.validUntil.getTime() / 1000);

  const tags: string[][] = [
    ["d", offer.code],
    ["type", offer.type || "coupon"], // Add type tag for AI searchability
    ["status", "active"],
    ["valid_from", validFromTimestamp.toString()],
    ["valid_until", validUntilTimestamp.toString()],
    ["tzid", timezone],
  ];

  const event: EventTemplate = {
    kind: 31556,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content: offer.description,
  };

  return event;
}

/**
 * Build a deactivate offer event (kind:31556)
 * 
 * Publishing this event with the same 'd' tag replaces the active offer,
 * effectively deactivating it while preserving the event history.
 * 
 * @param code - Offer code (d tag) to deactivate
 * @param pubkey - Merchant's public key
 * @returns Unsigned event template ready for signing
 * 
 * @example
 * const event = buildDeactivateEvent("SAVE20", merchantPubkey);
 */
export function buildDeactivateEvent(
  code: string,
  pubkey: string
): EventTemplate {
  const tags: string[][] = [
    ["d", code],
    ["status", "inactive"],
  ];

  const event: EventTemplate = {
    kind: 31556,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content: "",
  };

  return event;
}

/**
 * Parse a kind:31556 Nostr event into an Offer object
 * 
 * @param event - Nostr event to parse
 * @returns Offer object or null if the event is malformed
 * 
 * @example
 * const offer = parseOfferEvent(nostrEvent);
 * if (offer) {
 *   console.log(`Offer ${offer.code}: ${offer.description}`);
 * }
 */
export function parseOfferEvent(event: NostrEvent): Offer | null {
  try {
    // Validate event kind
    if (event.kind !== 31556) {
      return null;
    }

    // Extract required tags
    const dTag = event.tags.find((tag) => tag[0] === "d");
    const typeTag = event.tags.find((tag) => tag[0] === "type");
    const statusTag = event.tags.find((tag) => tag[0] === "status");

    if (!dTag || !dTag[1] || !typeTag || !typeTag[1] || !statusTag || !statusTag[1]) {
      // Missing required tags - ignore old format events without type
      return null;
    }

    const code = dTag[1];
    const type = typeTag[1] as OfferType;
    const status = statusTag[1] as "active" | "inactive";

    // Validate status
    if (status !== "active" && status !== "inactive") {
      return null;
    }

    // Validate type
    const validTypes: OfferType[] = ["coupon", "discount", "bogo", "free-item", "happy-hour"];
    if (!validTypes.includes(type)) {
      return null;
    }

    // For inactive offers, valid_from and valid_until tags are optional
    let validFrom: Date;
    let validUntil: Date;

    if (status === "active") {
      // Active offers must have validity dates
      const validFromTag = event.tags.find((tag) => tag[0] === "valid_from");
      const validUntilTag = event.tags.find((tag) => tag[0] === "valid_until");

      if (!validFromTag || !validFromTag[1] || !validUntilTag || !validUntilTag[1]) {
        // Missing required date tags for active offer
        return null;
      }

      const validFromTimestamp = parseInt(validFromTag[1], 10);
      const validUntilTimestamp = parseInt(validUntilTag[1], 10);

      if (isNaN(validFromTimestamp) || isNaN(validUntilTimestamp)) {
        // Invalid timestamp
        return null;
      }

      validFrom = new Date(validFromTimestamp * 1000);
      validUntil = new Date(validUntilTimestamp * 1000);
    } else {
      // Inactive offers: use epoch time as placeholder dates
      validFrom = new Date(0);
      validUntil = new Date(0);
    }

    const offer: Offer = {
      code,
      type,
      description: event.content,
      validFrom,
      validUntil,
      status,
      eventId: event.id,
      createdAt: event.created_at,
    };

    return offer;
  } catch (error) {
    // Return null for any parsing errors
    console.error("Error parsing offer event:", error);
    return null;
  }
}
