/**
 * Business Hours Validation Utilities
 * 
 * Validates reservation times against business opening hours.
 */

import type { OpeningHoursSpec } from "@/types/profile";

/**
 * Day of week abbreviations mapping
 */
const DAY_ABBREVIATIONS: Record<string, number> = {
  "Mo": 1, // Monday
  "Tu": 2, // Tuesday
  "We": 3, // Wednesday
  "Th": 4, // Thursday
  "Fr": 5, // Friday
  "Sa": 6, // Saturday
  "Su": 0, // Sunday
};

/**
 * Checks if a given datetime falls within business hours.
 * 
 * @param unixTimestamp - Unix timestamp in seconds
 * @param tzid - IANA timezone identifier (e.g., "America/Los_Angeles")
 * @param openingHours - Array of opening hours specifications
 * @returns true if the time falls within business hours, false otherwise
 * 
 * @example
 * ```typescript
 * const openingHours: OpeningHoursSpec[] = [
 *   { days: ["Mo", "Tu", "We", "Th", "Fr"], startTime: "11:00", endTime: "21:00" },
 *   { days: ["Sa", "Su"], startTime: "10:00", endTime: "20:00" }
 * ];
 * 
 * const isOpen = isWithinBusinessHours(1729458000, "America/Los_Angeles", openingHours);
 * ```
 */
export function isWithinBusinessHours(
  unixTimestamp: number,
  tzid: string,
  openingHours: OpeningHoursSpec[]
): boolean {
  if (!openingHours || openingHours.length === 0) {
    // No opening hours specified - assume always open
    return true;
  }

  // Create a Date object from the Unix timestamp
  const date = new Date(unixTimestamp * 1000);

  // Get the day of week in the specified timezone (0 = Sunday, 1 = Monday, ..., 6 = Saturday)
  // Use formatToParts to get the weekday part directly
  const dayFormatter = new Intl.DateTimeFormat("en-US", {
    timeZone: tzid,
    weekday: "long",
  });
  const dayParts = dayFormatter.formatToParts(date);
  const weekdayPart = dayParts.find(p => p.type === "weekday");
  const dayName = weekdayPart?.value || "";
  
  // Map full day names to numbers (Sunday=0, Monday=1, ..., Saturday=6)
  const dayNameToNum: Record<string, number> = {
    "Sunday": 0, "Monday": 1, "Tuesday": 2, "Wednesday": 3, "Thursday": 4, "Friday": 5, "Saturday": 6,
  };
  const dayOfWeek = dayNameToNum[dayName] ?? date.getDay(); // Fallback to UTC if mapping fails

  // Format the time in the specified timezone
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: tzid,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  const timeParts = formatter.formatToParts(date);
  const hour = parseInt(timeParts.find(p => p.type === "hour")?.value || "0", 10);
  const minute = parseInt(timeParts.find(p => p.type === "minute")?.value || "0", 10);
  const currentTimeMinutes = hour * 60 + minute;

  // Check each opening hours specification
  for (const spec of openingHours) {
    if (!spec.days || spec.days.length === 0 || !spec.startTime || !spec.endTime) {
      continue;
    }

    // Check if the day of week matches
    const dayMatches = spec.days.some(dayAbbr => {
      const dayNum = DAY_ABBREVIATIONS[dayAbbr];
      return dayNum !== undefined && dayNum === dayOfWeek;
    });

    if (!dayMatches) {
      continue;
    }

    // Parse start and end times
    const startTimeMinutes = parseTimeToMinutes(spec.startTime);
    const endTimeMinutes = parseTimeToMinutes(spec.endTime);

    if (startTimeMinutes === null || endTimeMinutes === null) {
      continue;
    }

    // Check if time falls within the range
    if (startTimeMinutes <= endTimeMinutes) {
      // Normal case: start time is before end time (e.g., 11:00-21:00)
      if (currentTimeMinutes >= startTimeMinutes && currentTimeMinutes < endTimeMinutes) {
        return true;
      }
    } else {
      // Time range spans midnight (e.g., 22:00-02:00)
      // Check if current time is after start OR before end
      if (currentTimeMinutes >= startTimeMinutes || currentTimeMinutes < endTimeMinutes) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Parses a time string (HH:MM format) to minutes since midnight.
 * 
 * @param timeStr - Time string in HH:MM format (e.g., "11:00", "21:30")
 * @returns Minutes since midnight, or null if invalid
 */
function parseTimeToMinutes(timeStr: string): number | null {
  const match = timeStr.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) {
    return null;
  }

  const hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);

  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    return null;
  }

  return hours * 60 + minutes;
}

