/**
 * Tests for Menu Import Lambda function
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock Secrets Manager
vi.mock("@aws-sdk/client-secrets-manager", () => {
  const send = vi.fn().mockResolvedValue({
    SecretString: JSON.stringify({
      "anthropic-api-key": "test-anthropic-key",
      "openai-api-key": "test-openai-key",
    }),
  });
  return {
    SecretsManagerClient: vi.fn(function () { this.send = send; }),
    GetSecretValueCommand: vi.fn(),
  };
});

// Mock S3
vi.mock("@aws-sdk/client-s3", () => {
  const send = vi.fn().mockResolvedValue({});
  return {
    S3Client: vi.fn(function () { this.send = send; }),
    PutObjectCommand: vi.fn(),
  };
});

const mockFetch = vi.fn();
global.fetch = mockFetch;

// Set env vars before importing handler
process.env.MENU_IMPORT_SECRET_ARN = "arn:aws:secretsmanager:us-east-1:123:secret:test";
process.env.IMAGE_BUCKET = "client2-synvya-com";
process.env.IMAGE_CDN_BASE = "https://account.synvya.com";

import { handler } from "./menuimport.js";

beforeEach(() => {
  mockFetch.mockReset();
});

function makeEvent(path, method, body) {
  return {
    rawPath: path,
    requestContext: { http: { method, path } },
    headers: { origin: "https://account.synvya.com" },
    body: body != null ? (typeof body === "string" ? body : JSON.stringify(body)) : undefined,
  };
}

describe("menuimport handler", () => {
  it("should return 404 for unknown paths", async () => {
    const event = makeEvent("/menu-import/unknown", "POST", {});
    const result = await handler(event);
    expect(result.statusCode).toBe(404);
  });

  it("should handle OPTIONS for CORS preflight", async () => {
    const event = makeEvent("/menu-import/extract", "OPTIONS", null);
    const result = await handler(event);
    expect(result.statusCode).toBe(204);
  });

  it("should reject non-POST to extract", async () => {
    const event = makeEvent("/menu-import/extract", "GET", null);
    const result = await handler(event);
    expect(result.statusCode).toBe(405);
  });

  it("should require pageImages for extract", async () => {
    const event = makeEvent("/menu-import/extract", "POST", { restaurantName: "Test" });
    const result = await handler(event);
    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body);
    expect(body.error).toContain("pageImages");
  });

  it("should call Claude API for extract and return parsed result", async () => {
    const extractionResult = {
      menus: [{ name: "Dinner", description: "Evening menu", menuType: "food", parentMenu: "" }],
      items: [
        {
          name: "Steak",
          description: "Grilled ribeye",
          price: "32.00",
          currency: "USD",
          ingredients: ["beef", "salt"],
          suitableForDiets: [],
          tags: ["entree"],
          partOfMenu: "Dinner",
          partOfMenuSection: "Mains",
          imageDescription: "A perfectly grilled steak",
        },
      ],
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          content: [{ type: "text", text: JSON.stringify(extractionResult) }],
        }),
    });

    const event = makeEvent("/menu-import/extract", "POST", {
      pageImages: ["dGVzdA=="],
      restaurantName: "Test Restaurant",
    });
    const result = await handler(event);
    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.menus).toHaveLength(1);
    expect(body.items).toHaveLength(1);
    expect(body.items[0].name).toBe("Steak");
  });

  it("should require items array for enrich", async () => {
    const event = makeEvent("/menu-import/enrich", "POST", { items: [] });
    const result = await handler(event);
    expect(result.statusCode).toBe(400);
  });

  it("should call Claude API for enrich and return enriched descriptions", async () => {
    const enrichResult = {
      items: [{ name: "Steak", enrichedDescription: "A juicy, perfectly seared ribeye steak." }],
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          content: [{ type: "text", text: JSON.stringify(enrichResult) }],
        }),
    });

    const event = makeEvent("/menu-import/enrich", "POST", {
      items: [{ name: "Steak", description: "Grilled ribeye", ingredients: ["beef"] }],
      restaurantContext: { name: "Test", cuisine: "American", about: "Steakhouse" },
    });
    const result = await handler(event);
    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.items[0].enrichedDescription).toContain("ribeye");
  });

  it("should require itemName and imageDescription for generate-image", async () => {
    const event = makeEvent("/menu-import/generate-image", "POST", { itemName: "Steak" });
    const result = await handler(event);
    expect(result.statusCode).toBe(400);
  });

  it("should set Content-Type header on responses", async () => {
    const event = makeEvent("/menu-import/extract", "POST", { restaurantName: "Test" });
    const result = await handler(event);
    expect(result.headers["Content-Type"]).toBe("application/json");
  });

  it("should handle Claude API errors gracefully", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 429,
      text: () => Promise.resolve("Rate limited"),
    });

    const event = makeEvent("/menu-import/extract", "POST", {
      pageImages: ["dGVzdA=="],
      restaurantName: "Test",
    });
    const result = await handler(event);
    expect(result.statusCode).toBe(500);
    const body = JSON.parse(result.body);
    expect(body.error).toBe("Internal server error");
  });

  it("should handle malformed Claude JSON response", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          content: [{ type: "text", text: "This is not JSON" }],
        }),
    });

    const event = makeEvent("/menu-import/extract", "POST", {
      pageImages: ["dGVzdA=="],
      restaurantName: "Test",
    });
    const result = await handler(event);
    expect(result.statusCode).toBe(500);
  });
});
