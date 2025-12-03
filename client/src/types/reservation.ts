/**
 * Types for Synvya Reservation Messages (NIP-9901/9902/9903/9904)
 * 
 * These types match the tag-based structure defined in NIP-RP schemas.
 * Data is stored in event tags, not JSON content.
 * Content field contains plain text message.
 */

/**
 * Reservation request payload (kind 9901)
 * 
 * All data is stored in event tags. The content field contains plain text message.
 */
export interface ReservationRequest {
  /** Number of guests (1-20) */
  party_size: number;
  /** Requested time as Unix timestamp in seconds */
  time: number;
  /** IANA timezone identifier (e.g., "America/Los_Angeles") */
  tzid: string;
  /** Optional reservation holder name (max 200 chars) */
  name?: string;
  /** Optional phone number as tel: URI (e.g., "tel:+1234567890") */
  telephone?: string;
  /** Optional email as mailto: URI (e.g., "mailto:guest@example.com") */
  email?: string;
  /** Optional duration in seconds */
  duration?: number;
  /** Optional earliest acceptable time as Unix timestamp in seconds */
  earliest_time?: number;
  /** Optional latest acceptable time as Unix timestamp in seconds */
  latest_time?: number;
  /** Plain text message/notes (stored in content field) */
  message?: string;
}

/**
 * Status of a reservation response
 */
export type ReservationStatus = 
  | "confirmed"
  | "declined" 
  | "cancelled"
  | "arrived";

/**
 * Reservation response payload (kind 9902)
 * 
 * All data is stored in event tags. The content field contains plain text message.
 */
export interface ReservationResponse {
  /** Status of the reservation */
  status: ReservationStatus;
  /** Proposed or confirmed time as Unix timestamp in seconds (null for declined/cancelled) */
  time: number | null;
  /** IANA timezone identifier (required when time is present) */
  tzid?: string;
  /** Optional duration in seconds */
  duration?: number;
  /** Plain text message (stored in content field) */
  message?: string;
}

/**
 * Reservation modification request payload (kind 9903)
 * 
 * Sent by user/agent in response to a restaurant's "suggested" response (9902).
 * Allows user to accept or counter-propose the suggested time.
 * 
 * All data is stored in event tags. The content field contains plain text message.
 * Contact fields (name, telephone, email) must be included if present in original 9901.
 */
export interface ReservationModificationRequest {
  /** Number of guests (1-20) */
  party_size: number;
  /** Requested time as Unix timestamp in seconds */
  time: number;
  /** IANA timezone identifier (e.g., "America/Los_Angeles") */
  tzid: string;
  /** Optional reservation holder name (max 200 chars, must be included if present in original 9901) */
  name?: string;
  /** Optional phone number as tel: URI (must be included if present in original 9901) */
  telephone?: string;
  /** Optional email as mailto: URI (must be included if present in original 9901) */
  email?: string;
  /** Optional duration in seconds */
  duration?: number;
  /** Optional earliest acceptable time as Unix timestamp in seconds */
  earliest_time?: number;
  /** Optional latest acceptable time as Unix timestamp in seconds */
  latest_time?: number;
  /** Plain text message/notes (stored in content field) */
  message?: string;
}

/**
 * Status of a reservation modification response
 */
export type ReservationModificationStatus = 
  | "confirmed"
  | "declined";

/**
 * Reservation modification response payload (kind 9904)
 * 
 * Sent by restaurant in response to a user's modification request (9903).
 * 
 * All data is stored in event tags. The content field contains plain text message.
 */
export interface ReservationModificationResponse {
  /** Status of the modification */
  status: ReservationModificationStatus;
  /** Proposed or confirmed time as Unix timestamp in seconds (null for declined) */
  time: number | null;
  /** IANA timezone identifier (required when time is present) */
  tzid?: string;
  /** Optional duration in seconds */
  duration?: number;
  /** Plain text message (stored in content field) */
  message?: string;
}

/**
 * Validation error details
 */
export interface ValidationError {
  field?: string;
  message: string;
  value?: unknown;
}

/**
 * Result of validation
 */
export interface ValidationResult {
  valid: boolean;
  errors?: ValidationError[];
}

