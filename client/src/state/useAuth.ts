import { create } from "zustand";
import type { Event, EventTemplate } from "nostr-tools";
import { generateKeypair, deriveFromNsec, signEventWithNsec } from "@/lib/nostrKeys";
import { loadAndDecryptSecret, saveEncryptedSecret, clearSecret } from "@/lib/secureStore";

export type AuthStatus = "idle" | "loading" | "ready" | "error" | "needs-setup";

interface AuthState {
  status: AuthStatus;
  pubkey: string | null;
  npub: string | null;
  needsBackup: boolean;
  lastGeneratedNsec: string | null;
  error: string | null;
  initialize: () => Promise<void>;
  createNewIdentity: () => Promise<string>;
  importSecret: (nsec: string) => Promise<void>;
  markBackedUp: () => void;
  revealSecret: () => Promise<string | null>;
  regenerate: () => Promise<string>;
  signEvent: (template: EventTemplate) => Promise<Event>;
  reset: () => Promise<void>;
}

export const useAuth = create<AuthState>((set, get) => ({
  status: "idle",
  pubkey: null,
  npub: null,
  needsBackup: false,
  lastGeneratedNsec: null,
  error: null,
  async initialize() {
    const currentStatus = get().status;
    if (currentStatus === "loading") {
      return;
    }

    set({ status: "loading", error: null });

    try {
      const decrypted = await loadAndDecryptSecret();
      if (decrypted) {
        const derived = deriveFromNsec(decrypted);
        set({
          status: "ready",
          pubkey: derived.pk,
          npub: derived.npub,
          needsBackup: false,
          lastGeneratedNsec: null,
          error: null
        });
        return;
      }

      set({
        status: "needs-setup",
        pubkey: null,
        npub: null,
        needsBackup: false,
        lastGeneratedNsec: null,
        error: null
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to initialize auth";
      set({ status: "error", error: message });
    }
  },
  async createNewIdentity() {
    const generated = generateKeypair();
    await saveEncryptedSecret(generated.nsec);
    
    // Register restaurant with backend (fire-and-forget)
    const apiBaseUrl = import.meta.env.VITE_API_BASE_URL;
    if (apiBaseUrl) {
      try {
        const signupTimestamp = Math.floor(Date.now() / 1000);
        await fetch(`${apiBaseUrl}/api/customers/register`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            npub: generated.npub,
            signup_timestamp: signupTimestamp
          })
        });
      } catch (error) {
        // Don't block sign-up if registration fails
        console.error("Failed to register restaurant:", error);
      }
    }
    
    set({
      status: "ready",
      pubkey: generated.pk,
      npub: generated.npub,
      needsBackup: true,
      lastGeneratedNsec: generated.nsec,
      error: null
    });
    return generated.nsec;
  },
  async importSecret(nsec) {
    await saveEncryptedSecret(nsec);
    const derived = deriveFromNsec(nsec);
    set({
      status: "ready",
      pubkey: derived.pk,
      npub: derived.npub,
      needsBackup: false,
      lastGeneratedNsec: null,
      error: null
    });
  },
  markBackedUp() {
    set({ needsBackup: false, lastGeneratedNsec: null });
  },
  async revealSecret() {
    const secret = await loadAndDecryptSecret();
    if (secret) {
      set({ lastGeneratedNsec: secret });
    }
    return secret;
  },
  async regenerate() {
    const generated = generateKeypair();
    await saveEncryptedSecret(generated.nsec);
    set({
      pubkey: generated.pk,
      npub: generated.npub,
      needsBackup: true,
      lastGeneratedNsec: generated.nsec,
      status: "ready",
      error: null
    });
    return generated.nsec;
  },
  async signEvent(template) {
    const secret = await loadAndDecryptSecret();
    if (!secret) {
      throw new Error("Secret key not available");
    }
    return signEventWithNsec(template, secret);
  },
  async reset() {
    await clearSecret();
    set({
      status: "needs-setup",
      pubkey: null,
      npub: null,
      needsBackup: false,
      lastGeneratedNsec: null,
      error: null
    });
  }
}));
