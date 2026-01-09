/**
 * Time Conversion Utilities for NIP-RP Reservation Protocol
 * 
 * Converts between ISO8601 datetime strings and Unix timestamps with IANA timezone identifiers.
 * NIP-RP requires Unix timestamps in tags along with separate IANA timezone identifiers.
 */

/**
 * Result of converting ISO8601 to Unix timestamp and timezone
 */
export interface UnixTimestampAndTzid {
  /** Unix timestamp in seconds */
  unixTimestamp: number;
  /** IANA Time Zone Database identifier (e.g., "America/Los_Angeles") */
  tzid: string;
}

/**
 * Converts an ISO8601 datetime string to a Unix timestamp and IANA timezone identifier.
 * 
 * @param iso8601 - ISO8601 datetime string (e.g., "2025-10-20T19:00:00-07:00")
 * @returns Object with Unix timestamp (seconds) and IANA timezone identifier
 * @throws Error if the ISO8601 string is invalid
 * 
 * @example
 * ```typescript
 * const result = iso8601ToUnixAndTzid("2025-10-20T19:00:00-07:00");
 * // Returns: { unixTimestamp: 1729458000, tzid: "America/Los_Angeles" }
 * ```
 */
export function iso8601ToUnixAndTzid(iso8601: string): UnixTimestampAndTzid {
  if (!iso8601 || typeof iso8601 !== "string") {
    throw new Error("ISO8601 string is required");
  }

  // Parse the ISO8601 string to a Date object
  const date = new Date(iso8601);
  
  if (isNaN(date.getTime())) {
    throw new Error(`Invalid ISO8601 datetime string: ${iso8601}`);
  }

  // Convert to Unix timestamp (seconds)
  const unixTimestamp = Math.floor(date.getTime() / 1000);

  // Extract timezone offset from ISO8601 string
  // Format: YYYY-MM-DDTHH:mm:ss±HH:MM or YYYY-MM-DDTHH:mm:ssZ
  const offsetMatch = iso8601.match(/([+-]\d{2}):(\d{2})|Z$/);
  
  if (!offsetMatch) {
    // If no explicit offset, use the system timezone
    const tzid = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return { unixTimestamp, tzid };
  }

  // Try to infer IANA timezone from offset
  // Note: This is approximate since multiple timezones can have the same offset
  // For better accuracy, the timezone should be provided explicitly
  const tzid = inferTzidFromOffset(iso8601, date);
  
  return { unixTimestamp, tzid };
}

/**
 * Converts a Unix timestamp and IANA timezone identifier to an ISO8601 datetime string.
 * 
 * @param unixTimestamp - Unix timestamp in seconds
 * @param tzid - IANA Time Zone Database identifier (e.g., "America/Los_Angeles")
 * @returns ISO8601 datetime string with timezone offset
 * @throws Error if the timezone identifier is invalid
 * 
 * @example
 * ```typescript
 * const iso8601 = unixAndTzidToIso8601(1729458000, "America/Los_Angeles");
 * // Returns: "2025-10-20T19:00:00-07:00"
 * ```
 */
export function unixAndTzidToIso8601(
  unixTimestamp: number,
  tzid: string
): string {
  // Handle null/undefined explicitly (declined/cancelled reservations may have null time)
  if (unixTimestamp === null || unixTimestamp === undefined) {
    throw new Error("Unix timestamp cannot be null or undefined");
  }
  if (typeof unixTimestamp !== "number" || isNaN(unixTimestamp)) {
    throw new Error("Unix timestamp must be a valid number");
  }

  if (!tzid || typeof tzid !== "string") {
    throw new Error("IANA timezone identifier (tzid) is required");
  }

  // Validate timezone before using it (defensive check)
  const validatedTzid = validateTimezone(tzid);

  // Create a Date object from the Unix timestamp
  const date = new Date(unixTimestamp * 1000);

  // Format the date in the specified timezone
  // Use Intl.DateTimeFormat to format with the timezone
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: validatedTzid,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  // Format date components in the target timezone
  const parts = formatter.formatToParts(date);
  const year = parts.find(p => p.type === "year")?.value;
  const month = parts.find(p => p.type === "month")?.value;
  const day = parts.find(p => p.type === "day")?.value;
  const hour = parts.find(p => p.type === "hour")?.value;
  const minute = parts.find(p => p.type === "minute")?.value;
  const second = parts.find(p => p.type === "second")?.value;

  if (!year || !month || !day || !hour || !minute || !second) {
    throw new Error(`Failed to format date in timezone: ${validatedTzid}`);
  }

  // Get the timezone offset directly using Intl.DateTimeFormat with timeZoneName
  // This is much simpler and more reliable than calculating it manually
  const offsetFormatter = new Intl.DateTimeFormat("en", {
    timeZone: validatedTzid,
    timeZoneName: "longOffset",
  });

  const offsetParts = offsetFormatter.formatToParts(date);
  const offsetPart = offsetParts.find(p => p.type === "timeZoneName");
  
  if (!offsetPart) {
    throw new Error(`Failed to get timezone offset for: ${validatedTzid}`);
  }

  // Parse the offset string (e.g., "GMT-07:00" or "GMT+09:00")
  // Extract the offset part after "GMT"
  const offsetMatch = offsetPart.value.match(/GMT([+-])(\d{2}):(\d{2})/);
  
  if (!offsetMatch) {
    // If no offset (UTC), return with Z
    // Check for various UTC representations: "GMT", "UTC", "GMT+00:00", "GMT-00:00"
    if (
      offsetPart.value === "GMT" ||
      offsetPart.value === "UTC" ||
      offsetPart.value.includes("UTC") ||
      offsetPart.value === "GMT+00:00" ||
      offsetPart.value === "GMT-00:00" ||
      validatedTzid === "UTC"
    ) {
      return `${year}-${month}-${day}T${hour}:${minute}:${second}Z`;
    }
    throw new Error(`Unexpected timezone offset format: ${offsetPart.value} (timezone: ${validatedTzid})`);
  }
  
  // Check if offset is actually zero (GMT+00:00 or GMT-00:00)
  const offsetHoursNum = parseInt(offsetMatch[2], 10);
  const offsetMinutesNum = parseInt(offsetMatch[3], 10);
  if (offsetHoursNum === 0 && offsetMinutesNum === 0) {
    return `${year}-${month}-${day}T${hour}:${minute}:${second}Z`;
  }

  const offsetSign = offsetMatch[1];
  const offsetHours = offsetMatch[2];
  const offsetMinutes = offsetMatch[3];
  const offsetString = `${offsetSign}${offsetHours}:${offsetMinutes}`;

  // Construct and validate the resulting ISO8601 string
  const result = `${year}-${month}-${day}T${hour}:${minute}:${second}${offsetString}`;
  const testParse = new Date(result);
  if (isNaN(testParse.getTime())) {
    throw new Error(`Generated invalid ISO8601 string: ${result} (timezone: ${validatedTzid}, timestamp: ${unixTimestamp})`);
  }
  
  // Verify the parsed result matches the original timestamp (within 1 minute for rounding)
  const timeDiff = Math.abs(testParse.getTime() - date.getTime());
  if (timeDiff > 60 * 1000) {
    // For debugging: log what went wrong
    const expectedIso = date.toISOString();
    throw new Error(
      `Generated ISO8601 string does not match original timestamp: ${result} (diff: ${timeDiff}ms, expected: ${expectedIso}, got: ${testParse.toISOString()}, timezone: ${validatedTzid}, timestamp: ${unixTimestamp})`
    );
  }

  return result;
}

/**
 * Infers IANA timezone identifier from an ISO8601 string's offset.
 * 
 * This is an approximation since multiple timezones can have the same offset.
 * For better accuracy, the timezone should be provided explicitly.
 * 
 * @param iso8601 - ISO8601 datetime string
 * @param date - Parsed Date object
 * @returns IANA timezone identifier
 */
function inferTzidFromOffset(iso8601: string, date: Date): string {
  // Extract offset from ISO8601 string
  const offsetMatch = iso8601.match(/([+-]\d{2}):(\d{2})|Z$/);
  
  if (!offsetMatch) {
    // Fallback to system timezone
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  }

  if (offsetMatch[0] === "Z") {
    return "UTC";
  }

  // Calculate offset in minutes
  const offsetSign = offsetMatch[1][0] === "+" ? 1 : -1;
  const offsetHours = parseInt(offsetMatch[1].slice(1), 10);
  const offsetMinutes = parseInt(offsetMatch[2], 10);
  const totalOffsetMinutes = offsetSign * (offsetHours * 60 + offsetMinutes);

  // Try to use the system timezone if the offset matches
  const systemTzid = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const systemOffset = -date.getTimezoneOffset(); // getTimezoneOffset returns opposite sign
  
  // If the offset matches the system timezone, use it
  if (Math.abs(systemOffset - totalOffsetMinutes) < 60) {
    return systemTzid;
  }

  // Common US timezone mappings (approximate, doesn't account for DST changes)
  // This is a fallback - for production, consider using a timezone library
  const commonTimezones: Record<number, string[]> = {
    [-480]: ["America/Los_Angeles", "America/Vancouver", "America/Tijuana"], // PST/PDT
    [-420]: ["America/Denver", "America/Phoenix", "America/Edmonton"], // MST/MDT
    [-360]: ["America/Chicago", "America/Mexico_City", "America/Winnipeg"], // CST/CDT
    [-300]: ["America/New_York", "America/Toronto", "America/Montreal"], // EST/EDT
    [-240]: ["America/Halifax", "America/Santiago"], // AST
    [0]: ["UTC", "Europe/London", "Africa/Casablanca"], // UTC/GMT
    [60]: ["Europe/Paris", "Europe/Berlin", "Europe/Rome"], // CET
    [120]: ["Europe/Athens", "Africa/Cairo", "Europe/Helsinki"], // EET
    [330]: ["Asia/Kolkata"], // IST
    [480]: ["Asia/Shanghai", "Asia/Hong_Kong", "Asia/Singapore"], // CST
    [540]: ["Asia/Tokyo", "Asia/Seoul"], // JST/KST
  };

  // Find matching timezone(s) for this offset
  const matchingTimezones = commonTimezones[totalOffsetMinutes];
  if (matchingTimezones && matchingTimezones.length > 0) {
    // Return the first match (prefer US timezones for US offsets)
    return matchingTimezones[0];
  }

  // Fallback: construct a timezone name from offset
  // This is not ideal but provides a reasonable default
  const offsetHoursRounded = Math.round(totalOffsetMinutes / 60);
  if (offsetHoursRounded === 0) {
    return "UTC";
  }
  
  // For unknown offsets, try to use a generic timezone
  // In practice, the timezone should be provided explicitly
  return `Etc/GMT${offsetHoursRounded >= 0 ? "-" : "+"}${Math.abs(offsetHoursRounded)}`;
}

/**
 * Validates an IANA timezone identifier.
 * 
 * @param tzid - IANA timezone identifier to validate
 * @returns true if the timezone is valid, false otherwise
 * 
 * @example
 * ```typescript
 * isValidTzid("America/Los_Angeles"); // true
 * isValidTzid("Invalid/Timezone"); // false
 * ```
 */
export function isValidTzid(tzid: string): boolean {
  if (!tzid || typeof tzid !== "string") {
    return false;
  }

  try {
    // Try to format a date with this timezone
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: tzid,
    });
    formatter.format(new Date());
    return true;
  } catch {
    return false;
  }
}

/**
 * Validates and sanitizes IANA timezone identifier.
 * Returns a valid timezone identifier or 'UTC' as fallback.
 * 
 * @param tzid - Timezone identifier from NIP-RP event (may be undefined or invalid)
 * @returns Valid timezone identifier or 'UTC' as fallback
 * 
 * @example
 * ```typescript
 * validateTimezone("America/Los_Angeles"); // "America/Los_Angeles"
 * validateTimezone("Etc/GMT-0800"); // "UTC" (with warning)
 * validateTimezone(undefined); // "UTC" (with warning)
 * ```
 */
export function validateTimezone(tzid: string | undefined): string {
  if (!tzid) {
    console.warn('Missing tzid in reservation request, using UTC');
    return 'UTC';
  }
  
  try {
    // Test if timezone is valid by attempting to use it
    new Intl.DateTimeFormat('en-US', { timeZone: tzid });
    return tzid; // Valid timezone
  } catch (error) {
    console.warn(`Invalid timezone "${tzid}", falling back to UTC. Error: ${error}`);
    return 'UTC'; // Fallback to UTC
  }
}

