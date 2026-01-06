/**
 * Auto-Acceptance Configuration
 * 
 * Configuration interface and default settings for automatic reservation acceptance.
 */

/**
 * Configuration for auto-acceptance rules
 */
export interface AutoAcceptConfig {
  /** Whether auto-acceptance is enabled */
  enabled: boolean;
  /** Whether to check if reservation time is within business hours */
  checkBusinessHours: boolean;
  /** Whether to check for conflicting reservations */
  checkConflicts: boolean;
  /** Minimum party size allowed (default: 1) */
  minPartySize: number;
  /** Maximum party size allowed (default: 8) */
  maxPartySize: number;
  /** Default reservation duration in minutes when not specified (default: 90) */
  defaultDurationMinutes: number;
  /** Maximum number of simultaneous reservations allowed (default: 2) */
  maxSimultaneousReservations: number;
  /** Buffer time between reservations in minutes (default: 15) */
  conflictBufferMinutes: number;
}

/**
 * Default auto-acceptance configuration matching business rules:
 * - Reservation duration: 90 minutes
 * - Maximum party size: 8 people
 * - Maximum simultaneous reservations: 2
 */
export const DEFAULT_AUTO_ACCEPT_CONFIG: AutoAcceptConfig = {
  enabled: true,
  checkBusinessHours: true,
  checkConflicts: true,
  minPartySize: 1,
  maxPartySize: 8,
  defaultDurationMinutes: 90,
  maxSimultaneousReservations: 2,
  conflictBufferMinutes: 15,
};

