/**
 * Direct Reservation Actions
 * 
 * Standalone functions for reservation actions that don't require React hooks.
 * Used by auto-acceptance system and other non-React contexts.
 */

import type { ReservationMessage } from "@/services/reservationService";
import type { ReservationRequest, ReservationResponse } from "@/types/reservation";
import { buildReservationResponse } from "./reservationEvents";
import { createRumor, wrapEvent } from "./nip59";
import { publishToRelays } from "./relayPool";
import { npubFromPk } from "./nostrKeys";
import { iso8601ToUnixAndTzid } from "./reservationTimeUtils";

/**
 * Options for accepting a reservation
 */
export interface AcceptOptions {
  /** Optional time override (Unix timestamp in seconds) */
  time?: number;
  /** Optional timezone override (IANA timezone identifier) */
  tzid?: string;
  /** Optional message to include in response */
  message?: string;
}

/**
 * Directly accepts a reservation request without React hooks.
 * 
 * Builds and publishes a confirmed reservation response (kind 9902) to both
 * the recipient and self (Self CC pattern per NIP-17). Also tracks the
 * reservation in the API for billing purposes.
 * 
 * @param request - The reservation request message
 * @param privateKey - Merchant's private key (Uint8Array)
 * @param relays - Array of relay URLs to publish to
 * @param pubkey - Merchant's public key (hex format)
 * @param options - Optional overrides for time, tzid, and message
 * @returns Promise that resolves when publishing is complete
 * @throws Error if publishing fails or required data is missing
 * 
 * @example
 * ```typescript
 * await acceptReservationDirect(
 *   reservationMessage,
 *   privateKey,
 *   ["wss://relay.example.com"],
 *   "abc123...",
 *   { message: "Looking forward to your visit!" }
 * );
 * ```
 */
export async function acceptReservationDirect(
  request: ReservationMessage,
  privateKey: Uint8Array,
  relays: string[],
  pubkey: string,
  options: AcceptOptions = {}
): Promise<void> {
  // Extract time and tzid from options or request payload
  let time: number | null = null;
  let tzid: string | undefined = undefined;
  
  if (options.time !== undefined) {
    time = options.time;
    tzid = options.tzid;
  } else {
    // Extract from request payload
    const payload = request.payload as ReservationRequest;
    if (payload.time !== undefined) {
      time = payload.time;
      tzid = payload.tzid;
    } else if ((payload as any).iso_time) {
      // Legacy support - convert ISO8601 to Unix timestamp
      const converted = iso8601ToUnixAndTzid((payload as any).iso_time);
      time = converted.unixTimestamp;
      tzid = converted.tzid;
    }
  }

  if (time === null || !tzid) {
    throw new Error("Missing required time and tzid in reservation request");
  }

  // Build response payload
  const response: ReservationResponse = {
    status: "confirmed",
    time,
    tzid,
    message: options.message,
  };

  // Find the original request's rumor ID for threading
  // Per NIP-17, all messages in a thread must reference the unsigned 9901 rumor ID
  let rootRumorId: string;
  if (request.type === "request") {
    // For requests, use the rumor ID directly (it's the thread root)
    if (request.rumor.kind !== 9901) {
      throw new Error(`Expected request rumor to be kind 9901, got ${request.rumor.kind}`);
    }
    rootRumorId = request.rumor.id;
  } else {
    // Extract root rumor ID from e tags (per NIP-17)
    const rootTag = request.rumor.tags.find(tag => tag[0] === "e" && tag[3] === "root");
    if (!rootTag) {
      throw new Error("Cannot find root rumor ID in message tags");
    }
    rootRumorId = rootTag[1];
  }

  // Extract relay URL from incoming message's p tag if available
  const pTag = request.rumor.tags.find(tag => tag[0] === "p" && tag[1] === request.senderPubkey);
  const relayUrl = pTag && pTag.length > 2 ? pTag[2] : (relays.length > 0 ? relays[0] : undefined);

  // Build response event template
  const responseTemplate = buildReservationResponse(
    response,
    privateKey,
    request.senderPubkey,  // p tag points to original recipient (agent)
    rootRumorId,  // Required root rumor ID for threading
    relayUrl,  // Relay URL from incoming message or first configured relay
    []  // Additional tags (none needed, e tag is added automatically)
  );

  // Create the rumor from the template (for local storage)
  const rumor = createRumor(responseTemplate, privateKey);

  // Wrap the SAME rumor in TWO gift wraps with DIFFERENT encryption:
  // 1. Gift wrap TO agent (encrypted for agent to read)
  // 2. Gift wrap TO self (encrypted for merchant to read - Self CC)
  const giftWrapToRecipient = wrapEvent(
    responseTemplate,
    privateKey,
    request.senderPubkey  // Addressed to agent
  );
  
  const giftWrapToSelf = wrapEvent(
    responseTemplate,
    privateKey,
    pubkey  // Addressed to self (merchant)
  );

  // Log gift wrap details before publishing
  console.log('[Reservation Response] Publishing gift wraps:', {
    toAgent: {
      eventId: giftWrapToRecipient.id,
      recipientPubkey: request.senderPubkey,
      pTag: giftWrapToRecipient.tags.find(t => t[0] === 'p')?.[1],
      relays: relays,
      kind: giftWrapToRecipient.kind,
    },
    toSelf: {
      eventId: giftWrapToSelf.id,
      recipientPubkey: pubkey,
      pTag: giftWrapToSelf.tags.find(t => t[0] === 'p')?.[1],
      relays: relays,
      kind: giftWrapToSelf.kind,
    }
  });

  // Publish BOTH gift wraps to relays
  // Use allSettled to ensure both are attempted even if one fails
  const results = await Promise.allSettled([
    publishToRelays(giftWrapToRecipient, relays),
    publishToRelays(giftWrapToSelf, relays),
  ]);

  // Log detailed results for each gift wrap
  results.forEach((result, index) => {
    const which = index === 0 ? 'agent' : 'self';
    if (result.status === 'fulfilled') {
      const publishResult = result.value;
      console.log(`[Reservation Response] Successfully published gift wrap to ${which}:`, {
        eventId: publishResult.eventId,
        relayResults: publishResult.results.map(r => ({
          relay: r.relay,
          success: r.success,
          error: r.error
        })),
        allFailed: publishResult.allFailed,
        someSucceeded: publishResult.someSucceeded,
      });
    } else {
      console.error(`[Reservation Response] Failed to publish gift wrap to ${which}:`, {
        error: result.reason instanceof Error ? result.reason.message : String(result.reason),
        stack: result.reason instanceof Error ? result.reason.stack : undefined,
      });
    }
  });

  // Only throw if BOTH failed
  const allFailed = results.every(r => r.status === 'rejected');
  if (allFailed) {
    const errors = results
      .map(r => r.status === 'rejected' ? r.reason : null)
      .filter(Boolean)
      .map(e => e instanceof Error ? e.message : String(e));
    throw new Error(`Failed to publish gift wraps: ${errors.join(', ')}`);
  }

  // Track confirmed reservation for billing (fire-and-forget)
  if (response.status === "confirmed" && time !== null && tzid) {
    const apiBaseUrl = import.meta.env.VITE_API_BASE_URL;
    if (apiBaseUrl) {
      try {
        // Calculate month in YYYY-MM format
        const reservationDate = new Date(time * 1000);
        const month = `${reservationDate.getFullYear()}-${String(reservationDate.getMonth() + 1).padStart(2, '0')}`;
        
        // Convert pubkey to npub
        const restaurantNpub = npubFromPk(pubkey);

        await fetch(`${apiBaseUrl}/api/customers/reservations`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            npub: restaurantNpub,
            root_rumor_id: rootRumorId,
            reservation_timestamp: time,
            month
          })
        });
      } catch (error) {
        // Don't block reservation confirmation if tracking fails
        console.error("Failed to track reservation:", error);
      }
    }
  }
}

