/**
 * Code Generation Utilities
 * 
 * Generates unique 8-character alphanumeric offer codes.
 */

/**
 * Generate a random 8-character alphanumeric offer code
 * 
 * Format: 8 uppercase alphanumeric characters (A-Z, 0-9)
 * Example: "XKCD1234", "ABCD5678", "H7K2M9P1"
 * 
 * Collision risk is negligible with 36^8 = 2.8 trillion possible combinations.
 * 
 * @returns 8-letter uppercase alphanumeric code
 */
export function generateOfferCode(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  for (let i = 0; i < 8; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}
