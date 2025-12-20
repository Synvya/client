import type { Event } from "nostr-tools";
import { getPool } from "@/lib/relayPool";

function extractLocationFromEvent(event: Event | null | undefined): string | null {
  if (!event) return null;
  if (Array.isArray(event.tags)) {
    for (const tag of event.tags) {
      if (Array.isArray(tag) && tag.length >= 2) {
        // New format: ["location", "7970 Railroad Ave, Snoqualmie, WA, 98065, USA"]
        if (tag[0] === "location" && typeof tag[1] === "string") {
          const value = tag[1].trim();
          if (value) {
            return value;
          }
        }
        // Old format: ["i", "location:..."]
        else if (tag[0] === "i" && typeof tag[1] === "string" && tag[1].startsWith("location:")) {
          const value = tag[1].slice("location:".length).trim();
          if (value) {
            return value;
          }
        }
      }
    }
  }

  if (typeof event.content === "string" && event.content.trim()) {
    try {
      const parsed = JSON.parse(event.content) as Record<string, unknown>;
      const value = parsed.location;
      if (typeof value === "string" && value.trim()) {
        return value.trim();
      }
    } catch (error) {
      console.warn("Failed to parse profile content for location", error);
    }
  }

  return null;
}

export async function resolveProfileLocation(
  pubkey: string | null | undefined,
  relays: string[] | null | undefined,
  fallback?: string | null
): Promise<string | null> {
  if (!pubkey) return fallback ?? null;
  const targets = Array.from(new Set((relays ?? []).map((relay) => relay.trim()).filter(Boolean)));
  if (!targets.length) return fallback ?? null;

  const pool = getPool();
  try {
    const event = await pool.get(targets, {
      kinds: [0],
      authors: [pubkey]
    });
    const resolved = extractLocationFromEvent(event);
    return resolved ?? (fallback ?? null);
  } catch (error) {
    console.warn("Unable to load profile location", error);
    return fallback ?? null;
  }
}
