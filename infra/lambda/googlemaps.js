/**
 * Google Maps Lambda - proxies Google Places API requests
 * @version 1.0.0
 */
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";

const secretsClient = new SecretsManagerClient({});

const DEFAULT_CORS_ORIGIN = "*";
const DEFAULT_SECRET_KEY = "google-maps-api-key";
const GOOGLE_PLACES_SEARCH_URL = "https://places.googleapis.com/v1/places:searchText";
const FIELD_MASK = "places.id,places.displayName,places.formattedAddress,places.googleMapsUri,places.websiteUri,places.nationalPhoneNumber,places.internationalPhoneNumber,places.addressComponents";

let cachedApiKey = null;

/**
 * Retrieves the Google Maps API key from AWS Secrets Manager.
 */
async function getApiKey() {
  if (cachedApiKey) {
    return cachedApiKey;
  }

  const secretArn = process.env.GOOGLE_MAPS_SECRET_ARN;
  const secretKey = process.env.GOOGLE_MAPS_SECRET_KEY || DEFAULT_SECRET_KEY;

  if (!secretArn) {
    throw new Error("GOOGLE_MAPS_SECRET_ARN environment variable is not set");
  }

  const command = new GetSecretValueCommand({ SecretId: secretArn });
  const result = await secretsClient.send(command);

  let secretString = result.SecretString;
  if (!secretString && result.SecretBinary) {
    secretString = Buffer.from(result.SecretBinary, "base64").toString("utf8");
  }

  if (!secretString) {
    throw new Error("Secret manager response did not include a secret value");
  }

  let parsed;
  try {
    parsed = JSON.parse(secretString);
  } catch {
    parsed = secretString;
  }

  const value = typeof parsed === "string" ? parsed : parsed?.[secretKey];
  if (!value || typeof value !== "string") {
    throw new Error(`Secret value missing for key "${secretKey}"`);
  }

  cachedApiKey = value.trim();
  return cachedApiKey;
}

/**
 * Builds CORS headers for the response.
 */
export function buildCorsHeaders(originOverride) {
  const allowOrigin = originOverride || process.env.CORS_ALLOW_ORIGIN || DEFAULT_CORS_ORIGIN;
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "OPTIONS,POST",
    "Access-Control-Allow-Headers": "Content-Type,Authorization"
  };
}

/**
 * Parses address components from Google Places API into structured fields.
 */
function parseAddressComponents(components) {
  if (!components || !Array.isArray(components)) {
    return {};
  }

  let streetNumber = "";
  let route = "";
  let city = "";
  let state = "";
  let zip = "";

  for (const component of components) {
    const types = component.types || [];
    if (types.includes("street_number")) {
      streetNumber = component.longText || component.shortText || "";
    } else if (types.includes("route")) {
      route = component.longText || component.shortText || "";
    } else if (types.includes("locality")) {
      city = component.longText || component.shortText || "";
    } else if (types.includes("administrative_area_level_1")) {
      state = component.shortText || component.longText || "";
    } else if (types.includes("postal_code")) {
      zip = component.longText || component.shortText || "";
    }
  }

  const streetAddress = [streetNumber, route].filter(Boolean).join(" ") || undefined;

  return {
    streetAddress,
    city: city || undefined,
    state: state || undefined,
    zip: zip || undefined
  };
}

/**
 * Maps a Google Places API result to our candidate format.
 */
function mapPlaceToCandidate(place) {
  const addressParts = parseAddressComponents(place.addressComponents);

  return {
    placeId: place.id || "",
    name: place.displayName?.text || "",
    address: place.formattedAddress || "",
    googleMapsUrl: place.googleMapsUri || "",
    websiteUrl: place.websiteUri || "",
    phone: place.internationalPhoneNumber || place.nationalPhoneNumber || "",
    streetAddress: addressParts.streetAddress,
    city: addressParts.city,
    state: addressParts.state,
    zip: addressParts.zip
  };
}

/**
 * Lambda handler for Google Maps search.
 */
export async function handler(event) {
  const origin = event.headers?.origin || event.headers?.Origin;
  const corsHeaders = buildCorsHeaders(origin);

  // Support both API Gateway v1 (httpMethod) and v2 (requestContext.http.method)
  const httpMethod = event.httpMethod || event.requestContext?.http?.method;

  // Handle preflight
  if (httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: corsHeaders, body: "" };
  }

  // Only allow POST
  if (httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Method not allowed" })
    };
  }

  // Parse body
  let body;
  try {
    const rawBody = event.isBase64Encoded
      ? Buffer.from(event.body, "base64").toString("utf-8")
      : event.body;

    if (!rawBody) {
      return {
        statusCode: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Request body is required" })
      };
    }

    body = JSON.parse(rawBody);
  } catch {
    return {
      statusCode: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Invalid JSON body" })
    };
  }

  const { name, address } = body;

  if (!name) {
    return {
      statusCode: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ error: "name is required" })
    };
  }

  if (!address) {
    return {
      statusCode: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ error: "address is required" })
    };
  }

  try {
    const apiKey = await getApiKey();

    const response = await fetch(GOOGLE_PLACES_SEARCH_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": FIELD_MASK
      },
      body: JSON.stringify({
        textQuery: `${name} ${address}`,
        maxResultCount: 5
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Google Places API error:", response.status, errorText);
      return {
        statusCode: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Google Places API request failed" })
      };
    }

    const data = await response.json();
    const places = data.places || [];
    const candidates = places.map(mapPlaceToCandidate);

    return {
      statusCode: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ candidates })
    };
  } catch (err) {
    console.error("Google Maps search error:", err);
    return {
      statusCode: 502,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Failed to search Google Places" })
    };
  }
}
