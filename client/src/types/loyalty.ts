/**
 * Loyalty Program Types
 * 
 * Defines types for loyalty offers published as kind:31556 Nostr events.
 */

/**
 * Offer status - active offers are currently valid, inactive offers are deactivated
 */
export type OfferStatus = "active" | "inactive";

/**
 * Loyalty offer interface matching kind:31556 event structure
 */
export interface Offer {
  /** Short promotional code (d tag value) - e.g., "SAVE20", "FREEFRIES" */
  code: string;
  
  /** Merchant's description of the offer (event content) */
  description: string;
  
  /** Start date/time for offer validity (parsed from valid_from tag) */
  validFrom: Date;
  
  /** End date/time for offer validity (parsed from valid_until tag) */
  validUntil: Date;
  
  /** Offer status */
  status: OfferStatus;
  
  /** Nostr event ID */
  eventId: string;
  
  /** Event creation timestamp (Unix seconds) */
  createdAt: number;
}
