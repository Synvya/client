import type { Event } from "nostr-tools";
import type { SquareEventTemplate } from "@/services/square";

/**
 * Validates that an event's 'a' tags use the correct format.
 * Correct format: ["a", "30405:<pubkey>:<d-tag>"] or ["a", "30402:<pubkey>:<d-tag>"]
 * Wrong format: ["a", "30402", "<pubkey>", "<d-tag>"]
 */
export function isValidEventFormat(event: Event | SquareEventTemplate): boolean {
  if (!event?.tags || !Array.isArray(event.tags)) {
    return false;
  }

  const aTags = event.tags.filter((tag) => Array.isArray(tag) && tag[0] === "a");

  // Check each 'a' tag
  for (const aTag of aTags) {
    // Correct format: ["a", "30405:<pubkey>:<d-tag>"] - second element is a single string
    // Wrong format: ["a", "30402", "<pubkey>", "<d-tag>"] - multiple elements
    if (aTag.length !== 2 || typeof aTag[1] !== "string") {
      return false;
    }

    // Validate the format of the address string: "kind:pubkey:d-tag"
    const address = aTag[1];
    const parts = address.split(":");
    if (parts.length !== 3) {
      return false;
    }

    // Validate kind matches expected format
    const [kindStr] = parts;
    if (kindStr !== "30402" && kindStr !== "30405") {
      return false;
    }
  }

  return true;
}

/**
 * Extracts collection references from product 'a' tags
 * Handles both correct and legacy formats for backward compatibility
 * Returns array of collection d-tags
 */
export function extractCollectionRefs(
  productEvent: Event | SquareEventTemplate,
  expectedPubkey: string
): string[] {
  const refs = new Set<string>();

  if (!productEvent.tags || !Array.isArray(productEvent.tags)) {
    return [];
  }

  for (const tag of productEvent.tags) {
    if (!Array.isArray(tag) || tag[0] !== "a") continue;

    let dTag: string | undefined;

    // Correct format: ["a", "30405:<pubkey>:<d-tag>"]
    if (tag.length === 2 && typeof tag[1] === "string") {
      const parts = tag[1].split(":");
      if (parts.length === 3 && parts[0] === "30405" && parts[1] === expectedPubkey) {
        dTag = parts[2];
      }
    }
    // Legacy format: ["a", "30405", "<pubkey>", "<d-tag>"] - skip these as they're invalid
    // We only process correct format now

    if (dTag) {
      refs.add(dTag);
    }
  }

  return Array.from(refs);
}

/**
 * Extracts product references from collection 'a' tags
 * Returns array of product d-tags
 */
export function extractProductRefs(
  collectionEvent: Event | SquareEventTemplate,
  expectedPubkey: string
): string[] {
  const refs = new Set<string>();

  if (!collectionEvent.tags || !Array.isArray(collectionEvent.tags)) {
    return [];
  }

  for (const tag of collectionEvent.tags) {
    if (!Array.isArray(tag) || tag[0] !== "a") continue;

    let dTag: string | undefined;

    // Correct format: ["a", "30402:<pubkey>:<d-tag>"]
    if (tag.length === 2 && typeof tag[1] === "string") {
      const parts = tag[1].split(":");
      if (parts.length === 3 && parts[0] === "30402" && parts[1] === expectedPubkey) {
        dTag = parts[2];
      }
    }

    if (dTag) {
      refs.add(dTag);
    }
  }

  return Array.from(refs);
}

/**
 * First pass: Deduplicates events by d-tag
 * For events with same (kind, pubkey, d-tag), keeps the one with latest created_at
 * Events without d-tag are passed through unchanged
 */
function deduplicateByDTag<T extends { kind: number; created_at: number; tags: string[][] }>(
  events: T[],
  pubkey: string
): T[] {
  const byDTag = new Map<string, T>();
  const withoutDTag: T[] = [];

  for (const event of events) {
    const dTag = event.tags.find((t) => Array.isArray(t) && t[0] === "d")?.[1];
    if (!dTag) {
      // Keep events without d-tag for second pass
      withoutDTag.push(event);
      continue;
    }

    const key = `${event.kind}:${pubkey}:${dTag}`;
    const existing = byDTag.get(key);

    if (!existing || event.created_at > existing.created_at) {
      byDTag.set(key, event);
    }
  }

  return [...Array.from(byDTag.values()), ...withoutDTag];
}

/**
 * Second pass: Deduplicates events by name/title
 * For events with same (kind, pubkey, title) but different d-tags, keeps the one with latest created_at
 * Events without title are passed through unchanged (they were already deduplicated by d-tag)
 */
function deduplicateByName<T extends { kind: number; created_at: number; tags: string[][] }>(
  events: T[],
  pubkey: string
): T[] {
  const byName = new Map<string, T>();
  const withoutTitle: T[] = [];

  for (const event of events) {
    const title = event.tags.find((t) => Array.isArray(t) && t[0] === "title")?.[1];
    if (!title) {
      // Keep events without title (they were already deduplicated by d-tag in first pass)
      withoutTitle.push(event);
      continue;
    }

    const key = `${event.kind}:${pubkey}:${title}`;
    const existing = byName.get(key);

    if (!existing || event.created_at > existing.created_at) {
      byName.set(key, event);
    }
  }

  return [...Array.from(byName.values()), ...withoutTitle];
}

/**
 * Complete deduplication pipeline:
 * 1. Filter invalid events (wrong 'a' tag format)
 * 2. First pass: Deduplicate by d-tag
 * 3. Second pass: Deduplicate by name
 */
export function deduplicateEvents(
  events: Event[],
  pubkey: string
): SquareEventTemplate[] {
  // Step 1: Filter invalid events
  const validEvents = events.filter(isValidEventFormat);

  // Step 2: First pass - deduplicate by d-tag
  const afterFirstPass = deduplicateByDTag(validEvents, pubkey);

  // Step 3: Second pass - deduplicate by name
  const afterSecondPass = deduplicateByName(afterFirstPass, pubkey);

  // Convert to SquareEventTemplate format
  return afterSecondPass.map((event) => ({
    kind: event.kind,
    created_at: event.created_at,
    content: event.content,
    tags: event.tags
  }));
}

