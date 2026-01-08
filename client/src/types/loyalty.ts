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
 * Offer type - categorizes offers for AI agent searchability
 */
export type OfferType = "coupon" | "discount" | "bogo" | "free-item" | "happy-hour";

/**
 * Loyalty offer interface matching kind:31556 event structure
 */
export interface Offer {
  /** 8-letter auto-generated code (d tag value) - e.g., "XKCD1234" */
  code: string;
  
  /** Offer type for categorization and AI searchability (will be required in next PR) */
  type?: OfferType;
  
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
