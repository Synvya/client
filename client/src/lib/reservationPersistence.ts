/**
 * Reservation Persistence Layer
 * 
 * Handles persisting reservation messages to localStorage so that
 * reservation status persists across app sessions.
 * 
 * Note: We serialize messages to plain objects because Nostr events
 * may contain non-serializable data (Uint8Array, etc.)
 */

import type { ReservationMessage } from "@/services/reservationService";

const STORAGE_KEY = "synvya:reservation:messages";
const STORAGE_VERSION = 2; // Bumped version for new serialization format

interface PersistedData {
  version: number;
  messages: SerializedReservationMessage[];
  lastUpdated: number;
}

/**
 * Serialized version of ReservationMessage that's safe for localStorage
 */
interface SerializedReservationMessage {
  rumor: {
    id: string;
    pubkey: string;
    created_at: number;
    kind: number;
    tags: string[][];
    content: string;
  };
  type: "request" | "response" | "modification-request" | "modification-response";
  payload: unknown;
  senderPubkey: string;
  giftWrap: {
    id: string;
    pubkey: string;
    created_at: number;
    kind: number;
    tags: string[][];
    content: string;
    sig: string;
  };
}

/**
 * Converts a ReservationMessage to a serializable format
 */
function serializeMessage(message: ReservationMessage): SerializedReservationMessage {
  return {
    rumor: {
      id: message.rumor.id,
      pubkey: message.rumor.pubkey,
      created_at: message.rumor.created_at,
      kind: message.rumor.kind,
      tags: message.rumor.tags,
      content: message.rumor.content,
    },
    type: message.type,
    payload: message.payload,
    senderPubkey: message.senderPubkey,
    giftWrap: {
      id: message.giftWrap.id,
      pubkey: message.giftWrap.pubkey,
      created_at: message.giftWrap.created_at,
      kind: message.giftWrap.kind,
      tags: message.giftWrap.tags,
      content: message.giftWrap.content,
      sig: message.giftWrap.sig,
    },
  };
}

/**
 * Converts a serialized message back to a ReservationMessage
 */
function deserializeMessage(serialized: SerializedReservationMessage): ReservationMessage {
  return serialized as unknown as ReservationMessage;
}

/**
 * Saves reservation messages to localStorage
 */
export function persistReservationMessages(messages: ReservationMessage[]): void {
  console.log(`[Persistence] persistReservationMessages called with ${messages.length} messages`);
  
  try {
    // Serialize messages to plain objects
    console.log("[Persistence] Serializing messages...");
    const serializedMessages = messages.map((msg, index) => {
      try {
        return serializeMessage(msg);
      } catch (err) {
        console.error(`[Persistence] Failed to serialize message ${index}:`, err, msg);
        throw err;
      }
    });
    
    console.log("[Persistence] Creating data object...");
    const data: PersistedData = {
      version: STORAGE_VERSION,
      messages: serializedMessages,
      lastUpdated: Date.now(),
    };
    
    console.log("[Persistence] Stringifying data...");
    const json = JSON.stringify(data);
    console.log(`[Persistence] JSON string created (${json.length} bytes)`);
    
    console.log("[Persistence] Writing to localStorage...");
    localStorage.setItem(STORAGE_KEY, json);
    console.log(`[Persistence] ✅ SUCCESS! Persisted ${messages.length} messages to localStorage`);
    
    // Verify it was written
    const verify = localStorage.getItem(STORAGE_KEY);
    console.log(`[Persistence] Verification: ${verify ? `${verify.length} bytes written` : "FAILED - null"}`);
  } catch (error) {
    console.error("[Persistence] ❌ FAILED to persist reservation messages:", error);
    // Log the problematic message structure for debugging
    if (messages.length > 0) {
      console.error("[Persistence] Sample message structure:", messages[0]);
    }
    throw error; // Re-throw so caller knows it failed
  }
}

/**
 * Loads reservation messages from localStorage
 */
export function loadPersistedReservationMessages(): ReservationMessage[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) {
      console.debug("[Persistence] No persisted messages found in localStorage");
      return [];
    }

    const data: PersistedData = JSON.parse(stored);
    
    // Check version compatibility
    if (data.version !== STORAGE_VERSION) {
      console.warn(`[Persistence] Storage version mismatch (expected ${STORAGE_VERSION}, got ${data.version}), clearing persisted data`);
      clearPersistedReservationMessages();
      return [];
    }

    // Deserialize messages back to ReservationMessage format
    const messages = (data.messages || []).map(deserializeMessage);
    
    console.debug(`[Persistence] Loaded ${messages.length} persisted messages from localStorage`);
    return messages;
  } catch (error) {
    console.error("[Persistence] Failed to load persisted reservation messages:", error);
    return [];
  }
}

/**
 * Clears persisted reservation messages from localStorage
 */
export function clearPersistedReservationMessages(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (error) {
    console.error("Failed to clear persisted reservation messages:", error);
  }
}

/**
 * Merges new messages with existing messages, deduplicating by rumor ID
 */
export function mergeReservationMessages(
  existing: ReservationMessage[],
  incoming: ReservationMessage[]
): ReservationMessage[] {
  const merged = [...existing];
  const existingIds = new Set(existing.map(m => m.rumor.id));

  for (const message of incoming) {
    if (!existingIds.has(message.rumor.id)) {
      merged.push(message);
      existingIds.add(message.rumor.id);
    }
  }

  // Sort by timestamp (newest first)
  return merged.sort((a, b) => b.rumor.created_at - a.rumor.created_at);
}

