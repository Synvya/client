/**
 * Service for publishing discovery pages to synvya.com via the discovery Lambda.
 */

export interface DiscoveryPublishRequest {
  typeSlug: string;
  nameSlug: string;
  html: string;
}

export interface DiscoveryPublishResponse {
  published: boolean;
  url: string;
}

function getApiBaseUrl(): string {
  const base = import.meta.env.VITE_API_BASE_URL as string | undefined;
  if (!base) {
    throw new Error("Missing VITE_API_BASE_URL");
  }
  return base.endsWith("/") ? base.slice(0, -1) : base;
}

/**
 * Publishes a discovery page to synvya.com.
 *
 * @param typeSlug - The business type slug (e.g., "restaurant")
 * @param nameSlug - The business name slug (e.g., "chickadee-bakeshop")
 * @param html - The generated HTML content for the discovery page
 * @returns The published URL on success
 * @throws Error if the publish fails
 */
export async function publishDiscoveryPage(
  typeSlug: string,
  nameSlug: string,
  html: string
): Promise<string> {
  const baseUrl = getApiBaseUrl();
  const endpoint = `${baseUrl}/discovery/publish`;

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json"
    },
    body: JSON.stringify({
      typeSlug,
      nameSlug,
      html
    } satisfies DiscoveryPublishRequest)
  });

  if (!response.ok) {
    let errorMessage = `Failed to publish discovery page (${response.status})`;
    try {
      const errorBody = await response.json();
      if (errorBody && typeof errorBody === "object" && "error" in errorBody) {
        errorMessage = `${errorMessage}: ${errorBody.error}`;
      }
    } catch {
      // Ignore JSON parse errors
    }
    throw new Error(errorMessage);
  }

  const result = (await response.json()) as DiscoveryPublishResponse;

  if (!result.published || !result.url) {
    throw new Error("Unexpected response from discovery publish endpoint");
  }

  return result.url;
}
