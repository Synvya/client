/**
 * Reservation Service
 * 
 * Handles relay subscriptions for incoming gift-wrapped reservation messages.
 * Listens for kind 1059 events, unwraps them, and parses reservation messages (kinds 9901/9902/9903/9904).
 */

import type { Event } from "nostr-tools";
import type { SubCloser } from "nostr-tools/abstract-pool";
import { getPool } from "@/lib/relayPool";
import { unwrapEvent, type Rumor } from "@/lib/nip59";
import {
  parseReservationRequest,
  parseReservationResponse,
  parseReservationModificationRequest,
  parseReservationModificationResponse,
} from "@/lib/reservationEvents";
import type { 
  ReservationRequest, 
  ReservationResponse,
  ReservationModificationRequest,
  ReservationModificationResponse
} from "@/types/reservation";
import type { AutoAcceptConfig } from "@/lib/autoAcceptConfig";
import type { BusinessProfile } from "@/types/profile";

/**
 * Parsed reservation message with metadata
 */
export interface ReservationMessage {
  /** The unwrapped rumor event */
  rumor: Rumor;
  /** Message type */
  type: "request" | "response" | "modification-request" | "modification-response";
  /** Parsed payload */
  payload: ReservationRequest | ReservationResponse | ReservationModificationRequest | ReservationModificationResponse;
  /** Sender's public key */
  senderPubkey: string;
  /** Original gift wrap event */
  giftWrap: Event;
}

/**
 * Callback for new reservation messages
 */
export type ReservationMessageCallback = (message: ReservationMessage) => void;

/**
 * Callback for errors during message processing
 */
export type ReservationErrorCallback = (error: Error, event?: Event) => void;

/**
 * Configuration for reservation subscription
 */
export interface ReservationSubscriptionConfig {
  /** Relay URLs to subscribe to */
  relays: string[];
  /** Merchant's private key for decryption */
  privateKey: Uint8Array;
  /** Merchant's public key (for filtering) */
  publicKey: string;
  /** Callback for new messages */
  onMessage: ReservationMessageCallback;
  /** Optional callback for errors */
  onError?: ReservationErrorCallback;
  /** Optional callback when subscription is active */
  onReady?: () => void;
  /** Optional auto-acceptance configuration */
  autoAcceptConfig?: AutoAcceptConfig;
  /** Optional callback when auto-accepting a reservation */
  onAutoAccept?: (message: ReservationMessage) => void;
  /** Optional function to accept reservations (required for auto-acceptance) */
  acceptReservationFn?: (message: ReservationMessage) => Promise<void>;
  /** Optional function to get existing confirmed reservations (required for conflict checking) */
  getExistingReservations?: () => ReservationMessage[];
  /** Optional function to load business profile (required for business hours checking) */
  loadBusinessProfileFn?: (pubkey: string, relays: string[]) => Promise<BusinessProfile | null>;
}

/**
 * Active subscription manager
 */
export class ReservationSubscription {
  private config: ReservationSubscriptionConfig;
  private subscription: SubCloser | null = null;
  private isStarted = false;
  private isReady = false;

  constructor(config: ReservationSubscriptionConfig) {
    this.config = config;
  }

  /**
   * Starts the subscription to relay(s)
   */
  start(): void {
    if (this.isStarted) {
      console.warn("Reservation subscription already active");
      return;
    }

    const pool = getPool();
    const { relays, publicKey, privateKey, onMessage, onError, onReady } = this.config;

    // Subscribe to gift wrap events addressed to this merchant
    // Query events up to 9 days old to capture all rumors from the last 7 days
    // Rationale: Gift wrap events have randomized created_at within last 2 days (NIP-59)
    // To capture all rumors from last 7 days, we query 7 + 2 = 9 days back
    const NINE_DAYS_IN_SECONDS = 9 * 24 * 60 * 60;
    const since = Math.floor(Date.now() / 1000) - NINE_DAYS_IN_SECONDS;

    this.subscription = pool.subscribeMany(
      relays,
      {
        kinds: [1059], // Gift wrap
        "#p": [publicKey], // Addressed to merchant
        since, // Only query events from last 9 days
      },
      {
        onevent: (event: Event) => {
          this.handleEvent(
            event,
            privateKey,
            onMessage,
            onError,
            publicKey,
            relays
          );
        },
        oneose: () => {
          // End of stored events - subscription is now ready
          if (!this.isReady) {
            this.isReady = true;
            onReady?.();
          }
        },
      }
    );

    this.isStarted = true;
  }

  /**
   * Stops the subscription
   */
  stop(): void {
    if (this.subscription) {
      this.subscription.close();
      this.subscription = null;
    }
    this.isStarted = false;
    this.isReady = false;
  }

  /**
   * Whether the subscription has been started
   */
  get active(): boolean {
    return this.isStarted;
  }

  /**
   * Whether the subscription has received initial events and is ready
   */
  get ready(): boolean {
    return this.isReady;
  }

  /**
   * Handles an incoming gift wrap event
   */
  private handleEvent(
    event: Event,
    privateKey: Uint8Array,
    onMessage: ReservationMessageCallback,
    onError?: ReservationErrorCallback,
    publicKey?: string,
    relays?: string[]
  ): void {
    try {
      // Unwrap the gift wrap
      const rumor = unwrapEvent(event, privateKey);

      // Determine type and parse
      if (rumor.kind === 9901) {
        // Reservation request
        const payload = parseReservationRequest(rumor, privateKey);
        const message: ReservationMessage = {
          rumor,
          type: "request",
          payload,
          senderPubkey: rumor.pubkey,
          giftWrap: event,
        };

        // Always add message to state first (so it appears in UI immediately)
        onMessage(message);

        // Check for auto-acceptance (fire-and-forget, don't block)
        const {
          autoAcceptConfig,
          acceptReservationFn,
          onAutoAccept,
          getExistingReservations,
          loadBusinessProfileFn,
        } = this.config;

        if (
          autoAcceptConfig?.enabled &&
          acceptReservationFn &&
          publicKey &&
          relays
        ) {
          // Run auto-acceptance check asynchronously (fire-and-forget)
          // This ensures message is added to state immediately
          (async () => {
            try {
              // Load business profile if function is provided
              let businessProfile: BusinessProfile | null = null;
              if (loadBusinessProfileFn) {
                try {
                  businessProfile = await loadBusinessProfileFn(publicKey, relays);
                } catch (error) {
                  console.warn(
                    "[Auto-Accept] Failed to load business profile:",
                    error
                  );
                  // Continue without profile - will skip business hours check
                }
              }

              // Get existing reservations if function is provided
              const existingReservations =
                getExistingReservations?.() || [];

              // Evaluate auto-acceptance
              const { shouldAutoAcceptReservation } = await import(
                "@/lib/autoAcceptReservation"
              );
              const decision = await shouldAutoAcceptReservation(
                message,
                autoAcceptConfig,
                existingReservations,
                businessProfile
              );

              if (decision.shouldAutoAccept) {
                console.log(
                  "[Auto-Accept] Automatically accepting reservation:",
                  message.rumor.id
                );
                try {
                  await acceptReservationFn(message);
                  onAutoAccept?.(message);
                  console.log(
                    "[Auto-Accept] Successfully auto-accepted reservation:",
                    message.rumor.id
                  );
                } catch (error) {
                  console.error(
                    "[Auto-Accept] Failed to auto-accept reservation:",
                    error
                  );
                  // Don't block message from being added to state
                }
              } else {
                console.log(
                  "[Auto-Accept] Not auto-accepting reservation:",
                  message.rumor.id,
                  "Reason:",
                  decision.reason
                );
              }
            } catch (error) {
              console.error(
                "[Auto-Accept] Error during auto-acceptance evaluation:",
                error
              );
              // Don't block message from being added to state
            }
          })();
        }
      } else if (rumor.kind === 9902) {
        // Reservation response
        const payload = parseReservationResponse(rumor, privateKey);
        onMessage({
          rumor,
          type: "response",
          payload,
          senderPubkey: rumor.pubkey,
          giftWrap: event,
        });
      } else if (rumor.kind === 9903) {
        // Reservation modification request
        const payload = parseReservationModificationRequest(rumor, privateKey);
        onMessage({
          rumor,
          type: "modification-request",
          payload,
          senderPubkey: rumor.pubkey,
          giftWrap: event,
        });
      } else if (rumor.kind === 9904) {
        // Reservation modification response
        const payload = parseReservationModificationResponse(rumor, privateKey);
        onMessage({
          rumor,
          type: "modification-response",
          payload,
          senderPubkey: rumor.pubkey,
          giftWrap: event,
        });
      } else {
        // Unknown kind - ignore or log
        console.debug(`Received gift wrap with unexpected kind: ${rumor.kind}`);
      }
    } catch (error) {
      // "invalid MAC" errors are expected when we receive gift wraps encrypted for others
      // (e.g., the copy sent to the agent when we implement Self CC)
      if (error instanceof Error && error.message.includes('invalid MAC')) {
        console.debug('Skipping gift wrap not encrypted for us (expected with Self CC)');
        return; // Silently ignore - this is normal
      }
      
      // Handle other decryption or parsing errors
      const errorMessage = error instanceof Error ? error : new Error(String(error));
      onError?.(errorMessage, event);
    }
  }
}

/**
 * Creates and starts a reservation subscription
 * 
 * @param config - Subscription configuration
 * @returns Active subscription instance
 * 
 * @example
 * ```typescript
 * const subscription = startReservationSubscription({
 *   relays: ["wss://relay.damus.io", "wss://nos.lol"],
 *   privateKey: merchantPrivateKey,
 *   publicKey: merchantPublicKey,
 *   onMessage: (message) => {
 *     if (message.type === 'request') {
 *       console.log('New reservation request:', message.payload);
 *     }
 *   },
 *   onError: (error) => {
 *     console.error('Subscription error:', error);
 *   }
 * });
 * 
 * // Later, to stop
 * subscription.stop();
 * ```
 */
export function startReservationSubscription(
  config: ReservationSubscriptionConfig
): ReservationSubscription {
  const subscription = new ReservationSubscription(config);
  subscription.start();
  return subscription;
}

/**
 * Creates a subscription but doesn't start it immediately
 * 
 * @param config - Subscription configuration
 * @returns Subscription instance (not yet started)
 * 
 * @example
 * ```typescript
 * const subscription = createReservationSubscription({
 *   relays: relayList,
 *   privateKey: key,
 *   publicKey: pubkey,
 *   onMessage: handleMessage
 * });
 * 
 * // Start when ready
 * subscription.start();
 * ```
 */
export function createReservationSubscription(
  config: ReservationSubscriptionConfig
): ReservationSubscription {
  return new ReservationSubscription(config);
}

