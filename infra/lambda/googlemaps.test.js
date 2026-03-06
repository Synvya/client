/**
 * Tests for Google Maps Lambda function
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock Secrets Manager
vi.mock("@aws-sdk/client-secrets-manager", () => {
  const mockSend = vi.fn().mockResolvedValue({
    SecretString: JSON.stringify({ "google-maps-api-key": "test-api-key-12345" })
  });
  return {
    SecretsManagerClient: vi.fn(function () { this.send = mockSend; }),
    GetSecretValueCommand: vi.fn(function (params) { Object.assign(this, params); }),
    __mockSend: mockSend
  };
});

// Mock global fetch for Google Places API calls
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Import after mocks
import { handler, buildCorsHeaders } from "./googlemaps.js";
import { __mockSend as mockSecretsSend } from "@aws-sdk/client-secrets-manager";

const originalEnv = { ...process.env };

beforeEach(() => {
  process.env.CORS_ALLOW_ORIGIN = "https://account.synvya.com";
  process.env.GOOGLE_MAPS_SECRET_ARN = "arn:aws:secretsmanager:us-east-1:123456789:secret:test";
  process.env.GOOGLE_MAPS_SECRET_KEY = "google-maps-api-key";

  mockFetch.mockReset();
});

afterEach(() => {
  process.env = { ...originalEnv };
});

describe("buildCorsHeaders", () => {
  it("should use origin override when provided", () => {
    const headers = buildCorsHeaders("https://example.com");
    expect(headers["Access-Control-Allow-Origin"]).toBe("https://example.com");
    expect(headers["Access-Control-Allow-Methods"]).toBe("OPTIONS,POST");
    expect(headers["Access-Control-Allow-Headers"]).toBe("Content-Type,Authorization");
  });

  it("should use environment variable when no override", () => {
    const headers = buildCorsHeaders(undefined);
    expect(headers["Access-Control-Allow-Origin"]).toBe("https://account.synvya.com");
  });
});

describe("handler", () => {
  it("should return 204 for OPTIONS requests", async () => {
    const event = {
      httpMethod: "OPTIONS",
      headers: { origin: "https://account.synvya.com" }
    };

    const result = await handler(event);

    expect(result.statusCode).toBe(204);
    expect(result.headers["Access-Control-Allow-Origin"]).toBe("https://account.synvya.com");
  });

  it("should return 405 for non-POST methods", async () => {
    const event = {
      httpMethod: "GET",
      headers: { origin: "https://account.synvya.com" }
    };

    const result = await handler(event);

    expect(result.statusCode).toBe(405);
  });

  it("should return 400 for missing body", async () => {
    const event = {
      httpMethod: "POST",
      headers: { origin: "https://account.synvya.com" },
      body: null
    };

    const result = await handler(event);

    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body);
    expect(body.error).toBeDefined();
  });

  it("should return 400 for missing name in body", async () => {
    const event = {
      httpMethod: "POST",
      headers: { origin: "https://account.synvya.com" },
      body: JSON.stringify({ address: "123 Main St, Seattle, WA" })
    };

    const result = await handler(event);

    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body);
    expect(body.error).toBeDefined();
  });

  it("should return 400 for missing address in body", async () => {
    const event = {
      httpMethod: "POST",
      headers: { origin: "https://account.synvya.com" },
      body: JSON.stringify({ name: "South Fork" })
    };

    const result = await handler(event);

    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body);
    expect(body.error).toBeDefined();
  });

  it("should return candidates on successful Google Places search", async () => {
    const googleResponse = {
      places: [
        {
          id: "ChIJ1234567890",
          displayName: { text: "South Fork", languageCode: "en" },
          formattedAddress: "101 W North Bend Way, North Bend, WA 98045, USA",
          googleMapsUri: "https://maps.google.com/?cid=12345",
          websiteUri: "https://southforknorthbend.com",
          nationalPhoneNumber: "(425) 555-1234",
          internationalPhoneNumber: "+1 425-555-1234",
          addressComponents: [
            { types: ["street_number"], longText: "101", shortText: "101" },
            { types: ["route"], longText: "West North Bend Way", shortText: "W North Bend Way" },
            { types: ["locality"], longText: "North Bend", shortText: "North Bend" },
            { types: ["administrative_area_level_1"], longText: "Washington", shortText: "WA" },
            { types: ["postal_code"], longText: "98045", shortText: "98045" }
          ]
        }
      ]
    };

    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(googleResponse)
    });

    const event = {
      httpMethod: "POST",
      headers: { origin: "https://account.synvya.com" },
      body: JSON.stringify({ name: "South Fork", address: "101 W North Bend Way, North Bend, WA" })
    };

    const result = await handler(event);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.candidates).toBeDefined();
    expect(body.candidates).toHaveLength(1);
    expect(body.candidates[0].placeId).toBe("ChIJ1234567890");
    expect(body.candidates[0].name).toBe("South Fork");
    expect(body.candidates[0].googleMapsUrl).toBe("https://maps.google.com/?cid=12345");
    expect(body.candidates[0].address).toBe("101 W North Bend Way, North Bend, WA 98045, USA");
    expect(body.candidates[0].websiteUrl).toBe("https://southforknorthbend.com");
    expect(body.candidates[0].phone).toBe("+1 425-555-1234");
    expect(body.candidates[0].streetAddress).toBe("101 West North Bend Way");
    expect(body.candidates[0].city).toBe("North Bend");
    expect(body.candidates[0].state).toBe("WA");
    expect(body.candidates[0].zip).toBe("98045");
  });

  it("should return empty candidates when Google returns no results", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ places: [] })
    });

    const event = {
      httpMethod: "POST",
      headers: { origin: "https://account.synvya.com" },
      body: JSON.stringify({ name: "NonExistent Place", address: "Nowhere" })
    };

    const result = await handler(event);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.candidates).toBeDefined();
    expect(body.candidates).toHaveLength(0);
  });

  it("should return 502 when Google Places API returns an error", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      text: () => Promise.resolve("Google API Error")
    });

    const event = {
      httpMethod: "POST",
      headers: { origin: "https://account.synvya.com" },
      body: JSON.stringify({ name: "South Fork", address: "North Bend, WA" })
    };

    const result = await handler(event);

    expect(result.statusCode).toBe(502);
    const body = JSON.parse(result.body);
    expect(body.error).toBeDefined();
  });

  it("should return 502 when fetch throws a network error", async () => {
    mockFetch.mockRejectedValue(new Error("Network error"));

    const event = {
      httpMethod: "POST",
      headers: { origin: "https://account.synvya.com" },
      body: JSON.stringify({ name: "South Fork", address: "North Bend, WA" })
    };

    const result = await handler(event);

    expect(result.statusCode).toBe(502);
    const body = JSON.parse(result.body);
    expect(body.error).toBeDefined();
  });

  it("should handle base64 encoded body", async () => {
    const googleResponse = {
      places: [
        {
          id: "ChIJ9999",
          displayName: { text: "Test Place" },
          formattedAddress: "123 Test St",
          googleMapsUri: "https://maps.google.com/?cid=999",
          addressComponents: []
        }
      ]
    };

    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(googleResponse)
    });

    const event = {
      httpMethod: "POST",
      headers: { origin: "https://account.synvya.com" },
      body: Buffer.from(JSON.stringify({ name: "Test Place", address: "123 Test St" })).toString("base64"),
      isBase64Encoded: true
    };

    const result = await handler(event);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.candidates).toBeDefined();
    expect(body.candidates).toHaveLength(1);
  });

  it("should call Google Places API with correct parameters", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ places: [] })
    });

    const event = {
      httpMethod: "POST",
      headers: { origin: "https://account.synvya.com" },
      body: JSON.stringify({ name: "South Fork", address: "North Bend, WA" })
    };

    await handler(event);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toBe("https://places.googleapis.com/v1/places:searchText");
    expect(options.method).toBe("POST");
    expect(options.headers["X-Goog-Api-Key"]).toBe("test-api-key-12345");
    expect(options.headers["X-Goog-FieldMask"]).toContain("places.id");
    expect(options.headers["X-Goog-FieldMask"]).toContain("places.displayName");
    expect(options.headers["X-Goog-FieldMask"]).toContain("places.googleMapsUri");

    const requestBody = JSON.parse(options.body);
    expect(requestBody.textQuery).toBe("South Fork North Bend, WA");
    expect(requestBody.maxResultCount).toBe(5);
  });
});
