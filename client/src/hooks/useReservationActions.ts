/**
 * Hook for handling reservation response actions
 * 
 * Provides functions to accept, decline, or respond to modification requests
 * for reservation requests.
 */

import { useState, useCallback } from "react";
import { useAuth } from "@/state/useAuth";
import { useRelays } from "@/state/useRelays";
import { useReservations } from "@/state/useReservations";
import { buildReservationResponse, buildReservationModificationResponse, buildReservationModificationRequest } from "@/lib/reservationEvents";
import { publishToRelays } from "@/lib/relayPool";
import { wrapEvent, createRumor } from "@/lib/nip59";
import { loadAndDecryptSecret } from "@/lib/secureStore";
import { skFromNsec } from "@/lib/nostrKeys";
import { iso8601ToUnixAndTzid, unixAndTzidToIso8601 } from "@/lib/reservationTimeUtils";
import type { 
    ReservationResponse, 
    ReservationModificationResponse,
    ReservationModificationRequest
} from "@/types/reservation";
import type { ReservationMessage } from "@/services/reservationService";

export interface ReservationActionState {
    loading: boolean;
    error: string | null;
    success: boolean;
}

export interface AcceptOptions {
    message?: string;
    time?: number | null; // Optional override for time (Unix timestamp)
    tzid?: string; // Optional timezone identifier
}

export interface DeclineOptions {
    message?: string;
}

export interface SendModificationRequestOptions {
    party_size: number;
    time: number; // Unix timestamp
    tzid: string; // IANA timezone identifier
    message?: string;
    name?: string;
    telephone?: string; // tel: URI format
    email?: string; // mailto: URI format
    duration?: number;
    earliest_time?: number; // Unix timestamp
    latest_time?: number; // Unix timestamp
}

export function useReservationActions() {
    const { signEvent, pubkey } = useAuth();
    const relays = useRelays((state) => state.relays);
    const addMessage = useReservations((state) => state.addMessage);
    const [state, setState] = useState<ReservationActionState>({
        loading: false,
        error: null,
        success: false,
    });

    const resetState = useCallback(() => {
        setState({ loading: false, error: null, success: false });
    }, []);

    const sendResponse = useCallback(
        async (
            request: ReservationMessage,
            response: ReservationResponse
        ): Promise<void> => {
            setState({ loading: true, error: null, success: false });

            try {
                // Load private key
                const nsec = await loadAndDecryptSecret();
                if (!nsec) {
                    throw new Error("Unable to load private key");
                }
                const privateKey = skFromNsec(nsec);

                // Find the original request's rumor ID for threading
                // Per NIP-17, all messages in a thread must reference the unsigned 9901 rumor ID
                // CRITICAL: Must use the rumor.id from the ORIGINAL 9901 request rumor, NOT gift wrap or seal IDs
                let rootRumorId: string;
                if (request.type === "request") {
                    // For requests, use the rumor ID directly (it's the thread root)
                    // This is the unsigned 9901 rumor ID that all subsequent messages must reference
                    if (request.rumor.kind !== 9901) {
                        throw new Error(`Expected request rumor to be kind 9901, got ${request.rumor.kind}`);
                    }
                    rootRumorId = request.rumor.id;
                } else {
                    // Extract root rumor ID from e tags (per NIP-17)
                    // The root e tag should point to the unsigned 9901 rumor ID
                    const rootTag = request.rumor.tags.find(tag => tag[0] === "e" && tag[3] === "root");
                    if (!rootTag) {
                        throw new Error("Cannot find root rumor ID in message tags");
                    }
                    rootRumorId = rootTag[1];
                }

                // Extract relay URL from incoming message's p tag if available
                // This helps the recipient know which relay to use for responses
                const pTag = request.rumor.tags.find(tag => tag[0] === "p" && tag[1] === request.senderPubkey);
                const relayUrl = pTag && pTag.length > 2 ? pTag[2] : (relays.length > 0 ? relays[0] : undefined);

                // IMPORTANT: Implement "Self CC" per NIP-17 pattern
                // Create ONE rumor template (same content, same tags, same p tag)
                // The p tag points to the original recipient (agent), not ourselves
                // Encryption happens at the seal/gift wrap layer, not the rumor layer
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
                    pubkey!  // Addressed to self (merchant)
                );

                // Publish BOTH gift wraps to relays
                // This ensures merchant can retrieve their own messages across devices
                await Promise.all([
                    publishToRelays(giftWrapToRecipient, relays),
                    publishToRelays(giftWrapToSelf, relays),
                ]);

        // DON'T add message immediately - let it come back from relay subscription
        // This prevents duplicates from Self CC pattern
        // The relay subscription will receive the Self CC message and add it via addMessage

                setState({ loading: false, error: null, success: true });
            } catch (error) {
                const message =
                    error instanceof Error ? error.message : "Failed to send response";
                setState({ loading: false, error: message, success: false });
                throw error;
            }
        },
        [relays, pubkey]
    );

    const acceptReservation = useCallback(
        async (
            request: ReservationMessage,
            options: AcceptOptions = {}
        ): Promise<void> => {
            // Get time from options or from request payload
            let time: number | null = null;
            let tzid: string | undefined = undefined;
            
            if (options.time !== undefined) {
                time = options.time;
                tzid = options.tzid;
            } else {
                // Extract from request payload (temporary - will be fixed in later PRs)
                const payload = request.payload as any;
                if (payload.time !== undefined) {
                    time = payload.time;
                    tzid = payload.tzid;
                } else if (payload.iso_time) {
                    // Legacy support - convert ISO8601 to Unix timestamp
                    const converted = iso8601ToUnixAndTzid(payload.iso_time);
                    time = converted.unixTimestamp;
                    tzid = converted.tzid;
                }
            }
            
            const response: ReservationResponse = {
                status: "confirmed",
                time,
                tzid,
                message: options.message,
            };

            await sendResponse(request, response);

            // Track confirmed reservation for billing (fire-and-forget)
            if (response.status === "confirmed" && time !== null && tzid) {
                const apiBaseUrl = import.meta.env.VITE_API_BASE_URL;
                if (apiBaseUrl) {
                    try {
                        // Calculate month in YYYY-MM format
                        const reservationDate = new Date(time * 1000);
                        const month = `${reservationDate.getFullYear()}-${String(reservationDate.getMonth() + 1).padStart(2, '0')}`;
                        
                        // Get restaurant's npub from auth state
                        const { npub: restaurantNpub } = useAuth.getState();
                        if (restaurantNpub) {
                            // Get root rumor ID from the request
                            let rootRumorId: string;
                            if (request.type === "request") {
                                rootRumorId = request.rumor.id;
                            } else {
                                const rootTag = request.rumor.tags.find(tag => tag[0] === "e" && tag[3] === "root");
                                rootRumorId = rootTag?.[1] || request.rumor.id;
                            }

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
                        }
                    } catch (error) {
                        // Don't block reservation confirmation if tracking fails
                        console.error("Failed to track reservation:", error);
                    }
                }
            }
        },
        [sendResponse]
    );

    const declineReservation = useCallback(
        async (
            request: ReservationMessage,
            options: DeclineOptions = {}
        ): Promise<void> => {
            const response: ReservationResponse = {
                status: "declined",
                time: null,
                message: options.message,
            };

            await sendResponse(request, response);
        },
        [sendResponse]
    );


    const sendModificationRequest = useCallback(
        async (
            response: ReservationMessage,
            options: SendModificationRequestOptions
        ): Promise<void> => {
            setState({ loading: true, error: null, success: false });

            try {
                // Load private key
                const nsec = await loadAndDecryptSecret();
                if (!nsec) {
                    throw new Error("Unable to load private key");
                }
                const privateKey = skFromNsec(nsec);

                // Find the original request's rumor ID for threading
                // CRITICAL: Always use the unsigned 9901 rumor ID as the root
                // - If this is a request message (kind 9901), use its own rumor ID
                // - If this is a response/modification message, extract root from e tags
                let rootRumorId: string;
                if (response.type === "request") {
                    // This is the original 9901 request - use its rumor ID directly
                    if (response.rumor.kind !== 9901) {
                        throw new Error(`Expected request rumor to be kind 9901, got ${response.rumor.kind}`);
                    }
                    rootRumorId = response.rumor.id;
                } else {
                    // Extract root rumor ID from e tags (per NIP-17)
                    // The root e tag should point to the unsigned 9901 rumor ID
                    const rootTag = response.rumor.tags.find(tag => tag[0] === "e" && tag[3] === "root");
                    if (!rootTag) {
                        throw new Error("Cannot find root rumor ID in message tags");
                    }
                    rootRumorId = rootTag[1];
                }

                // Build modification request payload
                const modificationRequest: ReservationModificationRequest = {
                    party_size: options.party_size,
                    time: options.time,
                    tzid: options.tzid,
                    message: options.message,
                    name: options.name,
                    telephone: options.telephone,
                    email: options.email,
                    duration: options.duration,
                    earliest_time: options.earliest_time,
                    latest_time: options.latest_time,
                };

                // Extract relay URL from incoming message's p tag if available
                const pTag = response.rumor.tags.find(tag => tag[0] === "p" && tag[1] === response.senderPubkey);
                const relayUrl = pTag && pTag.length > 2 ? pTag[2] : (relays.length > 0 ? relays[0] : undefined);

                // IMPORTANT: Implement "Self CC" per NIP-17 pattern
                // Root rumor ID is required for threading (references unsigned 9901 rumor ID)
                const requestToAgent = buildReservationModificationRequest(
                    modificationRequest,
                    privateKey,
                    response.senderPubkey,
                    rootRumorId,  // Required root rumor ID for threading
                    relayUrl,  // Relay URL from incoming message or first configured relay
                    []  // Additional tags (none needed, e tag is added automatically)
                );
                
                const requestToSelf = buildReservationModificationRequest(
                    modificationRequest,
                    privateKey,
                    pubkey!,
                    rootRumorId,  // Required root rumor ID for threading
                    relayUrl,  // Relay URL from incoming message or first configured relay
                    []  // Additional tags (none needed, e tag is added automatically)
                );

                // Create rumor from the Self CC template (for local storage)
                const rumor = createRumor(requestToSelf, privateKey);

                // Wrap both requests in gift wraps
                const giftWrapToRecipient = wrapEvent(
                    requestToAgent,
                    privateKey,
                    response.senderPubkey
                );
                
                const giftWrapToSelf = wrapEvent(
                    requestToSelf,
                    privateKey,
                    pubkey!
                );

                // Publish BOTH gift wraps to relays
                await Promise.all([
                    publishToRelays(giftWrapToRecipient, relays),
                    publishToRelays(giftWrapToSelf, relays),
                ]);

                // DON'T add message immediately - let it come back from relay subscription
                // This prevents duplicates from Self CC pattern
                // The relay subscription will receive the Self CC message and add it via addMessage

                setState({ loading: false, error: null, success: true });
            } catch (error) {
                const message =
                    error instanceof Error ? error.message : "Failed to send modification request";
                setState({ loading: false, error: message, success: false });
                throw error;
            }
        },
        [relays, pubkey]
    );

    const sendModificationResponse = useCallback(
        async (
            modificationRequest: ReservationMessage,
            response: ReservationModificationResponse
        ): Promise<void> => {
            setState({ loading: true, error: null, success: false });

            try {
                // Load private key
                const nsec = await loadAndDecryptSecret();
                if (!nsec) {
                    throw new Error("Unable to load private key");
                }
                const privateKey = skFromNsec(nsec);

                // Extract root rumor ID from modification request tags
                // Root: unsigned 9901 rumor ID (the original request)
                const rootTag = modificationRequest.rumor.tags.find(
                    tag => tag[0] === "e" && tag[3] === "root"
                );
                
                if (!rootTag || !rootTag[1]) {
                    throw new Error("Cannot find root rumor ID in modification request tags");
                }
                
                const rootRumorId = rootTag[1];

                // Extract relay URL from incoming message's p tag if available
                const pTag = modificationRequest.rumor.tags.find(tag => tag[0] === "p" && tag[1] === modificationRequest.senderPubkey);
                const relayUrl = pTag && pTag.length > 2 ? pTag[2] : (relays.length > 0 ? relays[0] : undefined);

                // IMPORTANT: Implement "Self CC" per NIP-17 pattern
                // Root rumor ID is required for threading (references unsigned 9901 rumor ID)
                const responseToAgent = buildReservationModificationResponse(
                    response,
                    privateKey,
                    modificationRequest.senderPubkey,
                    rootRumorId,  // Required root rumor ID for threading
                    relayUrl,  // Relay URL from incoming message or first configured relay
                    []  // Additional tags (none needed, e tag is added automatically)
                );
                
                const responseToSelf = buildReservationModificationResponse(
                    response,
                    privateKey,
                    pubkey!,
                    rootRumorId,  // Required root rumor ID for threading
                    relayUrl,  // Relay URL from incoming message or first configured relay
                    []  // Additional tags (none needed, e tag is added automatically)
                );

                // Create rumor from the Self CC template (for local storage)
                const rumor = createRumor(responseToSelf, privateKey);

                // Wrap both responses in gift wraps
                const giftWrapToRecipient = wrapEvent(
                    responseToAgent,
                    privateKey,
                    modificationRequest.senderPubkey
                );
                
                const giftWrapToSelf = wrapEvent(
                    responseToSelf,
                    privateKey,
                    pubkey!
                );

                // Publish BOTH gift wraps to relays
                await Promise.all([
                    publishToRelays(giftWrapToRecipient, relays),
                    publishToRelays(giftWrapToSelf, relays),
                ]);

                // DON'T add message immediately - let it come back from relay subscription
                // This prevents duplicates from Self CC pattern
                // The relay subscription will receive the Self CC message and add it via addMessage

                setState({ loading: false, error: null, success: true });
            } catch (error) {
                const message =
                    error instanceof Error ? error.message : "Failed to send modification response";
                setState({ loading: false, error: message, success: false });
                throw error;
            }
        },
        [relays, pubkey]
    );

    const acceptModification = useCallback(
        async (
            modificationRequest: ReservationMessage,
            options: AcceptOptions = {}
        ): Promise<void> => {
            const modificationPayload = modificationRequest.payload as ReservationModificationRequest;
            const response: ReservationModificationResponse = {
                status: "confirmed",
                time: options.time !== undefined ? options.time : modificationPayload.time,
                tzid: options.tzid !== undefined ? options.tzid : modificationPayload.tzid,
                message: options.message,
            };

            await sendModificationResponse(modificationRequest, response);
        },
        [sendModificationResponse]
    );

    const declineModification = useCallback(
        async (
            modificationRequest: ReservationMessage,
            options: DeclineOptions = {}
        ): Promise<void> => {
            const response: ReservationModificationResponse = {
                status: "declined",
                time: null,
                message: options.message,
            };

            await sendModificationResponse(modificationRequest, response);
        },
        [sendModificationResponse]
    );

    return {
        state,
        resetState,
        acceptReservation,
        declineReservation,
        sendModificationRequest,
        acceptModification,
        declineModification,
    };
}

