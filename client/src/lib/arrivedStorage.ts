/**
 * Local storage for "arrived" reservation status
 * 
 * Stores arrived status in IndexedDB. This is private restaurant-side tracking
 * and does not publish any Nostr events.
 */

import { openDB } from "idb";

const DB_NAME = "synvya-arrived-reservations";
const DB_VERSION = 1;
const ARRIVED_STORE = "arrived";

interface ArrivedRecord {
  arrived: boolean;
  arrivedAt: number; // Unix timestamp in seconds
}

const dbPromise = openDB(DB_NAME, DB_VERSION, {
  upgrade(db) {
    if (!db.objectStoreNames.contains(ARRIVED_STORE)) {
      db.createObjectStore(ARRIVED_STORE);
    }
  }
});

/**
 * Marks a reservation as arrived
 * 
 * @param rootRumorId - The root event ID of the reservation thread
 */
export async function markReservationArrived(rootRumorId: string): Promise<void> {
  const db = await dbPromise;
  const record: ArrivedRecord = {
    arrived: true,
    arrivedAt: Math.floor(Date.now() / 1000), // Unix timestamp in seconds
  };
  await db.put(ARRIVED_STORE, record, rootRumorId);
}

/**
 * Checks if a reservation has been marked as arrived
 * 
 * @param rootRumorId - The root event ID of the reservation thread
 * @returns true if the reservation has been marked as arrived, false otherwise
 */
export async function isReservationArrived(rootRumorId: string): Promise<boolean> {
  const db = await dbPromise;
  const record = (await db.get(ARRIVED_STORE, rootRumorId)) as ArrivedRecord | undefined;
  return record?.arrived === true;
}

/**
 * Gets the timestamp when a reservation was marked as arrived
 * 
 * @param rootRumorId - The root event ID of the reservation thread
 * @returns Unix timestamp in seconds, or null if not arrived
 */
export async function getArrivedTimestamp(rootRumorId: string): Promise<number | null> {
  const db = await dbPromise;
  const record = (await db.get(ARRIVED_STORE, rootRumorId)) as ArrivedRecord | undefined;
  return record?.arrivedAt ?? null;
}

/**
 * Removes the arrived status for a reservation
 * 
 * @param rootRumorId - The root event ID of the reservation thread
 */
export async function clearArrivedStatus(rootRumorId: string): Promise<void> {
  const db = await dbPromise;
  await db.delete(ARRIVED_STORE, rootRumorId);
}

