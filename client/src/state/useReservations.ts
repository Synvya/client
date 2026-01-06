/**
 * Zustand store for managing reservation messages
 */

import { create } from "zustand";
import type { ReservationMessage } from "@/services/reservationService";
import {
  createReservationSubscription,
  type ReservationSubscription,
} from "@/services/reservationService";
import { getThreadContext } from "@/lib/nip10";
import type { ReservationRequest } from "@/types/reservation";
import {
  loadPersistedReservationMessages,
  persistReservationMessages,
  mergeReservationMessages,
} from "@/lib/reservationPersistence";
import { DEFAULT_AUTO_ACCEPT_CONFIG } from "@/lib/autoAcceptConfig";
import { acceptReservationDirect } from "@/lib/reservationActions";
import { loadBusinessProfile } from "@/lib/loadBusinessProfile";

/**
 * A conversation thread containing related messages
 */
export interface ConversationThread {
  /** Root event ID of the thread */
  rootEventId: string;
  /** All messages in this thread, sorted chronologically */
  messages: ReservationMessage[];
  /** The initial reservation request */
  initialRequest: ReservationMessage;
  /** Latest message in the thread */
  latestMessage: ReservationMessage;
  /** Timestamp of the latest message */
  latestTimestamp: number;
  /** Conversation partner's public key */
  partnerPubkey: string;
  /** Number of messages in thread */
  messageCount: number;
}

export interface ReservationState {
  messages: ReservationMessage[];
  subscription: ReservationSubscription | null;
  isConnected: boolean;
  error: string | null;
  isInitialized: boolean;
  merchantPubkey: string | null;
  
  // Actions
  addMessage: (message: ReservationMessage) => void;
  startListening: (privateKey: Uint8Array, publicKey: string, relays: string[]) => void;
  stopListening: () => void;
  setError: (error: string | null) => void;
  clearMessages: () => void;
  markAsRead: (messageId: string) => void;
  loadPersistedMessages: () => void;
  
  // Computed/derived
  getThreads: () => ConversationThread[];
}

export const useReservations = create<ReservationState>((set, get) => ({
  messages: [],
  subscription: null,
  isConnected: false,
  error: null,
  isInitialized: false,
  merchantPubkey: null,

  loadPersistedMessages: () => {
    const persisted = loadPersistedReservationMessages();
    console.log(`[useReservations] Loading ${persisted.length} persisted messages`);
    set({ messages: persisted, isInitialized: true });
  },

  addMessage: (message) => {
    console.log("[useReservations] addMessage called with:", message.type, message.rumor.id);
    set((state) => {
      // Deduplicate: check if message with same rumor ID already exists
      const exists = state.messages.some(m => m.rumor.id === message.rumor.id);
      if (exists) {
        console.log("[useReservations] Message already exists, skipping");
        return state; // Don't add duplicate
      }
      const newMessages = [message, ...state.messages]; // Newest first
      
      console.log(`[useReservations] Adding message, total count: ${newMessages.length}`);
      console.log("[useReservations] About to persist messages...");
      
      // Persist to localStorage
      try {
        persistReservationMessages(newMessages);
        console.log("[useReservations] Persistence completed successfully");
      } catch (error) {
        console.error("[useReservations] Persistence failed:", error);
      }
      
      return {
        messages: newMessages,
      };
    });
  },

  startListening: (privateKey, publicKey, relays) => {
    // Load persisted messages if not already loaded
    if (!get().isInitialized) {
      get().loadPersistedMessages();
    }

    // Stop existing subscription if any
    const existing = get().subscription;
    if (existing) {
      existing.stop();
    }

    // Create auto-acceptance function
    const acceptReservationFn = async (message: ReservationMessage) => {
      await acceptReservationDirect(message, privateKey, relays, publicKey);
    };

    // Create function to get existing confirmed reservations
    const getExistingReservations = (): ReservationMessage[] => {
      const messages = get().messages;
      // Filter for confirmed reservations (responses with status "confirmed")
      return messages.filter((msg) => {
        if (msg.type !== "response") return false;
        const response = msg.payload as any;
        return response.status === "confirmed" && response.time !== null;
      });
    };

    // Create and start new subscription
    const subscription = createReservationSubscription({
      relays,
      privateKey,
      publicKey,
      onMessage: (message) => {
        get().addMessage(message);
      },
      onError: (error) => {
        // Log errors silently without showing to user
        // Common errors: JSON parsing failures, invalid payloads, decryption issues
        console.debug("Reservation subscription error (silently handled):", error.message);
      },
      onReady: () => {
        set({ isConnected: true, error: null });
      },
      autoAcceptConfig: DEFAULT_AUTO_ACCEPT_CONFIG,
      acceptReservationFn,
      getExistingReservations,
      loadBusinessProfileFn: loadBusinessProfile,
      onAutoAccept: (message) => {
        console.log("[Auto-Accept] Automatically accepted reservation:", message.rumor.id);
      },
    });

    subscription.start();

    set({
      subscription,
      isConnected: subscription.active,
      error: null,
      merchantPubkey: publicKey,
    });
  },

  stopListening: () => {
    const subscription = get().subscription;
    if (subscription) {
      subscription.stop();
    }
    set({
      subscription: null,
      isConnected: false,
    });
  },

  setError: (error) => {
    set({ error });
  },

  clearMessages: () => {
    set({ messages: [] });
    // Clear from localStorage as well
    persistReservationMessages([]);
  },

  markAsRead: (messageId) => {
    // TODO: Implement read tracking
    // For now, this is a placeholder for future functionality
    console.debug("Mark as read:", messageId);
  },

  getThreads: () => {
    const messages = get().messages;
    if (!messages.length) return [];

    // Group messages by thread
    const threadMap = new Map<string, ReservationMessage[]>();

    for (const message of messages) {
      // Extract thread context from rumor tags
      const context = getThreadContext(message.rumor as any); // Rumor has tags, which is all getThreadContext needs
      
      // Per NIP-17, all messages in a thread reference the unsigned 9901 rumor ID via root e tag
      // - If this message has a root e tag, use that (it references the original 9901 rumor ID)
      // - Otherwise, this is a request message (thread root), so use its own rumor ID
      const threadId = context.rootId || message.rumor.id;
      
      if (!threadMap.has(threadId)) {
        threadMap.set(threadId, []);
      }
      threadMap.get(threadId)!.push(message);
    }

    // Convert to ConversationThread objects
    const threads: ConversationThread[] = [];
    
    for (const [rootEventId, threadMessages] of threadMap.entries()) {
      // Deduplicate by rumor ID (Self CC messages will have same rumor ID)
      const seenRumorIds = new Set<string>();
      const uniqueMessages = threadMessages.filter(msg => {
        if (seenRumorIds.has(msg.rumor.id)) {
          return false; // Skip duplicate
        }
        seenRumorIds.add(msg.rumor.id);
        return true;
      });

      // Sort messages chronologically, with secondary sort by message type for protocol flow
      // When timestamps are equal, ensure correct order:
      // 1. request (9901)
      // 2. modification-request (9903)
      // 3. modification-response (9904) - customer responds to modification request
      // 4. response (9902) - restaurant auto-replies after modification response
      const getMessageTypeOrder = (type: ReservationMessage["type"]): number => {
        switch (type) {
          case "request":
            return 1;
          case "modification-request":
            return 2;
          case "modification-response":
            return 3;
          case "response":
            return 4;
          default:
            return 99;
        }
      };

      const sortedMessages = [...uniqueMessages].sort((a, b) => {
        // Primary sort: timestamp
        if (a.rumor.created_at !== b.rumor.created_at) {
          return a.rumor.created_at - b.rumor.created_at;
        }
        // Secondary sort: message type order for protocol flow
        return getMessageTypeOrder(a.type) - getMessageTypeOrder(b.type);
      });

      // Find the initial request (first message with type "request" or "modification-request")
      // Prioritize "request" over "modification-request" as initial request
      const initialRequest = sortedMessages.find(m => m.type === "request") 
        || sortedMessages.find(m => m.type === "modification-request")
        || sortedMessages[0];
      const latestMessage = sortedMessages[sortedMessages.length - 1];

      // Determine conversation partner (the other party's pubkey)
      // The partner is the person who is NOT the merchant
      const merchantPubkey = get().merchantPubkey;
      const partnerPubkey = sortedMessages.find(
        m => m.senderPubkey !== merchantPubkey
      )?.senderPubkey || latestMessage.senderPubkey;

      threads.push({
        rootEventId,
        messages: sortedMessages,
        initialRequest,
        latestMessage,
        latestTimestamp: latestMessage.rumor.created_at,
        partnerPubkey,
        messageCount: sortedMessages.length,
      });
    }

    // Sort threads by latest message timestamp (newest first)
    return threads.sort((a, b) => b.latestTimestamp - a.latestTimestamp);
  },
}));

