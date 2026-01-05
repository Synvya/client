import { SimplePool } from "nostr-tools";
import type { Event } from "nostr-tools";

const pool = new SimplePool();

export function getPool(): SimplePool {
  return pool;
}

export interface RelayPublishResult {
  relay: string;
  success: boolean;
  error?: string;
}

export interface PublishResult {
  eventId: string;
  results: RelayPublishResult[];
  allFailed: boolean;
  someSucceeded: boolean;
}

export async function publishToRelays(event: Event, relays: string[]): Promise<PublishResult> {
  const targets = Array.from(new Set(relays.map((relay) => relay.trim()).filter(Boolean)));

  if (!targets.length) {
    throw new Error("No relays configured");
  }

  const publishPromises = pool.publish(targets, event);
  const results = await Promise.allSettled(publishPromises);

  const relayResults: RelayPublishResult[] = results.map((result, index) => ({
    relay: targets[index],
    success: result.status === "fulfilled",
    error: result.status === "rejected" 
      ? (result.reason instanceof Error ? result.reason.message : String(result.reason))
      : undefined,
  }));

  const failures = results.filter(
    (result): result is PromiseRejectedResult => result.status === "rejected"
  );

  const allFailed = failures.length === results.length;
  const someSucceeded = failures.length < results.length;

  if (allFailed) {
    const reasons = failures.map((failure) =>
      failure.reason instanceof Error ? failure.reason.message : String(failure.reason)
    );
    throw new Error(reasons[0] ?? "Relay rejected event");
  }

  return {
    eventId: event.id,
    results: relayResults,
    allFailed,
    someSucceeded,
  };
}
