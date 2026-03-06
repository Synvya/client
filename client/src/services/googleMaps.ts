/**
 * Service for searching Google Places via the Google Maps Lambda.
 */

export interface GooglePlaceCandidate {
  placeId: string;
  name: string;
  address: string;             // formatted full address
  googleMapsUrl: string;
  websiteUrl: string;
  phone: string;               // international format
  streetAddress?: string;      // parsed from addressComponents
  city?: string;
  state?: string;
  zip?: string;
}

export interface GooglePlacesSearchResponse {
  candidates: GooglePlaceCandidate[];
}

function getApiBaseUrl(): string {
  const base = import.meta.env.VITE_API_BASE_URL as string | undefined;
  if (!base) {
    throw new Error("Missing VITE_API_BASE_URL");
  }
  return base.endsWith("/") ? base.slice(0, -1) : base;
}

/**
 * Searches Google Places API for a business by name and address.
 *
 * @param name - The business name to search for
 * @param address - The business address (street, city, state, etc.)
 * @returns Array of matching place candidates
 * @throws Error if the search fails
 */
export async function searchGooglePlaces(
  name: string,
  address: string
): Promise<GooglePlaceCandidate[]> {
  const baseUrl = getApiBaseUrl();
  const endpoint = `${baseUrl}/google-maps/search`;

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json"
    },
    body: JSON.stringify({ name, address })
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "Unknown error");
    throw new Error(`Google Places search failed (${response.status}): ${errorText}`);
  }

  const data: GooglePlacesSearchResponse = await response.json();
  return data.candidates || [];
}
