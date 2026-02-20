import type { Event } from "nostr-tools";
import { getPool } from "@/lib/relayPool";

export interface LiveMenuItem {
  event: Event;
  dTag: string;
  title: string;
  price: string;
  currency: string;
  imageUrl: string;
  description: string;
  tTags: string[];
  collectionDTags: string[];
}

export interface LiveCollection {
  event: Event;
  dTag: string;
  title: string;
  summary: string;
  itemDTags: string[];
}

export interface LiveMenuData {
  items: LiveMenuItem[];
  collections: LiveCollection[];
}

function getTagValue(tags: string[][], key: string): string {
  const tag = tags.find((t) => t[0] === key);
  return tag?.[1] ?? "";
}

function getAllTagValues(tags: string[][], key: string): string[] {
  return tags.filter((t) => t[0] === key).map((t) => t[1] ?? "");
}

/**
 * Extracts valid `a` tag values in the colon-delimited format "kind:pubkey:dTag".
 * Ignores legacy multi-element `a` tags like ["a", "30402", "pubkey", "dTag"].
 */
function getValidATags(tags: string[][]): string[] {
  return tags
    .filter((t) => t[0] === "a" && typeof t[1] === "string" && t[1].includes(":"))
    .map((t) => t[1]);
}

function parseContent(content: string): { title: string; description: string } {
  // Content format: **Title**\n\nDescription
  const match = content.match(/^\*\*(.+?)\*\*\s*\n?\n?([\s\S]*)$/);
  if (match) {
    return { title: match[1].trim(), description: match[2].trim() };
  }
  return { title: "", description: content.trim() };
}

function deduplicateAddressable(events: Event[]): Event[] {
  const best = new Map<string, Event>();
  for (const event of events) {
    const dTag = getTagValue(event.tags, "d");
    const key = `${event.kind}:${dTag}`;
    const existing = best.get(key);
    if (!existing || event.created_at > existing.created_at) {
      best.set(key, event);
    }
  }
  return Array.from(best.values());
}

function parseItem(event: Event): LiveMenuItem {
  const dTag = getTagValue(event.tags, "d");
  const titleTag = getTagValue(event.tags, "title");
  const parsed = parseContent(event.content);
  const priceTag = event.tags.find((t) => t[0] === "price");
  const tTags = getAllTagValues(event.tags, "t");
  const aTags = getValidATags(event.tags);

  // Extract collection dTags from a tags like "30405:pubkey:collectionDTag"
  const collectionDTags = aTags
    .filter((a) => a.startsWith("30405:"))
    .map((a) => {
      const parts = a.split(":");
      return parts.slice(2).join(":");
    });

  return {
    event,
    dTag,
    title: titleTag || parsed.title,
    price: priceTag?.[1] ?? "",
    currency: priceTag?.[2] ?? "USD",
    imageUrl: getTagValue(event.tags, "image"),
    description: parsed.description,
    tTags,
    collectionDTags,
  };
}

function parseCollection(event: Event): LiveCollection {
  const dTag = getTagValue(event.tags, "d");
  const title = getTagValue(event.tags, "title");
  const summary = getTagValue(event.tags, "summary");
  const aTags = getValidATags(event.tags);

  const itemDTags = aTags
    .filter((a) => a.startsWith("30402:"))
    .map((a) => {
      const parts = a.split(":");
      return parts.slice(2).join(":");
    });

  return {
    event,
    dTag,
    title,
    summary,
    itemDTags,
  };
}

export async function fetchLiveMenuData(
  pubkey: string,
  relays: string[]
): Promise<LiveMenuData> {
  const pool = getPool();
  const events = await pool.querySync(relays, {
    kinds: [30402, 30405],
    authors: [pubkey],
  });

  const deduped = deduplicateAddressable(events);

  const items = deduped
    .filter((e) => e.kind === 30402)
    .filter((e) => !e.tags.some((t) => t[0] === "visibility" && (t[1] === "hidden" || t[1] === "<hidden")))
    .map(parseItem);

  const collections = deduped
    .filter((e) => e.kind === 30405)
    .map(parseCollection);

  return { items, collections };
}
