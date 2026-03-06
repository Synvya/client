export type BusinessType =
  | "bakery"
  | "barOrPub"
  | "brewery"
  | "cafeOrCoffeeShop"
  | "distillery"
  | "fastFoodRestaurant"
  | "iceCreamShop"
  | "restaurant"
  | "winery";

export interface OpeningHoursSpec {
  days: string[]; // ["Mo", "Tu", "We", "Th", "Fr"] or ["Sa", "Su"]
  startTime: string; // "11:00"
  endTime: string; // "21:00"
}

export interface BusinessProfile {
  name: string;
  displayName: string;
  about: string;
  website: string;
  nip05: string;
  picture: string;
  banner: string;
  businessType: BusinessType;
  categories: string[];
  cuisine?: string;
  phone?: string;
  email?: string;
  street?: string;
  city?: string;
  state?: string;
  zip?: string;
  country?: string; // ISO 3166-1 alpha-2 country code (e.g., "US")
  location?: string;
  memberOf?: string;
  acceptsReservations?: boolean;
  openingHours?: OpeningHoursSpec[];
  facebook?: string;       // Facebook page URL or ID
  instagram?: string;      // Instagram handle or URL
  twitter?: string;        // X/Twitter handle or URL
  googleMapsUrl?: string;  // Google Maps share URL
  googlePlaceId?: string;  // Google Place ID for future API use
}

export interface PublishResult {
  ok: boolean;
  message: string;
  eventId?: string;
}
