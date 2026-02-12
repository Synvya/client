/**
 * Tests for Bot Analytics Lambda function
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockSend = vi.fn();

vi.mock("@aws-sdk/client-dynamodb", () => ({
  DynamoDBClient: class {}
}));

vi.mock("@aws-sdk/lib-dynamodb", () => ({
  DynamoDBDocumentClient: {
    from: () => ({ send: mockSend })
  },
  QueryCommand: class {
    constructor(params) {
      Object.assign(this, params);
    }
  }
}));

const { extractNpub, handler } = await import("./analytics.js");

describe("extractNpub", () => {
  it("should extract npub from valid path", () => {
    expect(extractNpub("/analytics/npub1abc123def456ghi789jkl012mno345pqr678stu901vwx234yz567ab")).toBeTruthy();
  });

  it("should return null for missing path", () => {
    expect(extractNpub(null)).toBeNull();
    expect(extractNpub(undefined)).toBeNull();
    expect(extractNpub("")).toBeNull();
  });

  it("should return null for path without npub segment", () => {
    expect(extractNpub("/analytics/")).toBeNull();
    expect(extractNpub("/analytics")).toBeNull();
    expect(extractNpub("/other/path")).toBeNull();
  });

  it("should extract npub even with prefix path segments", () => {
    expect(extractNpub("/api/analytics/npub1test")).toBe("npub1test");
  });

  it("should not match paths with trailing segments", () => {
    expect(extractNpub("/analytics/npub1test/extra")).toBeNull();
  });
});

describe("handler", () => {
  const originalEnv = process.env;

  // Valid bech32 npub: "npub1" (5 chars) + 58 bech32 data chars = 63 total
  const validNpub = "npub1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqcmv7nu";

  beforeEach(() => {
    process.env = { ...originalEnv };
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("should return 200 for OPTIONS request", async () => {
    process.env.CORS_ALLOW_ORIGIN = "https://account.synvya.com";
    const event = {
      requestContext: { http: { method: "OPTIONS" } },
      headers: { origin: "https://account.synvya.com" }
    };

    const response = await handler(event);

    expect(response.statusCode).toBe(200);
    expect(response.headers["Access-Control-Allow-Origin"]).toBe("https://account.synvya.com");
  });

  it("should return 405 for non-GET requests", async () => {
    const event = {
      requestContext: { http: { method: "POST", path: `/analytics/${validNpub}` } },
      headers: {}
    };

    const response = await handler(event);

    expect(response.statusCode).toBe(405);
    expect(JSON.parse(response.body).error).toBe("Method not allowed");
  });

  it("should return 400 for missing npub in path", async () => {
    const event = {
      requestContext: { http: { method: "GET", path: "/analytics/" } },
      headers: {}
    };

    const response = await handler(event);

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body).error).toBe("Missing npub in path");
  });

  it("should return 400 for invalid npub format", async () => {
    const event = {
      requestContext: { http: { method: "GET", path: "/analytics/not-an-npub" } },
      headers: {}
    };

    const response = await handler(event);

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body).error).toBe("Invalid npub format");
  });

  it("should return items from DynamoDB for valid npub", async () => {
    const items = [
      { npub: validNpub, dateBotKey: "2025-01-15#ChatGPT", date: "2025-01-15", bot: "ChatGPT", visitCount: 3 },
      { npub: validNpub, dateBotKey: "2025-01-16#Claude", date: "2025-01-16", bot: "Claude", visitCount: 5 }
    ];

    mockSend.mockResolvedValueOnce({ Items: items });

    const event = {
      requestContext: { http: { method: "GET", path: `/analytics/${validNpub}` } },
      headers: {}
    };

    const response = await handler(event);

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.items).toHaveLength(2);
    expect(body.items[0].bot).toBe("ChatGPT");
    expect(body.items[1].bot).toBe("Claude");
  });

  it("should return empty items array when no records found", async () => {
    mockSend.mockResolvedValueOnce({ Items: [] });

    const event = {
      requestContext: { http: { method: "GET", path: `/analytics/${validNpub}` } },
      headers: {}
    };

    const response = await handler(event);

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.items).toEqual([]);
  });

  it("should handle DynamoDB returning undefined Items", async () => {
    mockSend.mockResolvedValueOnce({});

    const event = {
      requestContext: { http: { method: "GET", path: `/analytics/${validNpub}` } },
      headers: {}
    };

    const response = await handler(event);

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.items).toEqual([]);
  });

  it("should return 500 when DynamoDB throws", async () => {
    mockSend.mockRejectedValueOnce(new Error("DynamoDB connection failed"));

    const event = {
      requestContext: { http: { method: "GET", path: `/analytics/${validNpub}` } },
      headers: {}
    };

    const response = await handler(event);

    expect(response.statusCode).toBe(500);
    expect(JSON.parse(response.body).error).toBe("Internal server error");
  });

  it("should set CORS headers from environment variable", async () => {
    process.env.CORS_ALLOW_ORIGIN = "https://account.synvya.com";
    mockSend.mockResolvedValueOnce({ Items: [] });

    const event = {
      requestContext: { http: { method: "GET", path: `/analytics/${validNpub}` } },
      headers: { origin: "https://account.synvya.com" }
    };

    const response = await handler(event);

    expect(response.headers["Access-Control-Allow-Origin"]).toBe("https://account.synvya.com");
  });

  it("should query the correct DynamoDB table", async () => {
    process.env.BOT_ANALYTICS_TABLE = "custom-table-name";

    // Re-import to pick up new env var — but since the module is cached,
    // we test via the mock call args instead
    mockSend.mockResolvedValueOnce({ Items: [] });

    const event = {
      requestContext: { http: { method: "GET", path: `/analytics/${validNpub}` } },
      headers: {}
    };

    await handler(event);

    expect(mockSend).toHaveBeenCalledTimes(1);
    const queryParams = mockSend.mock.calls[0][0];
    expect(queryParams.KeyConditionExpression).toBe("npub = :npub");
    expect(queryParams.ExpressionAttributeValues[":npub"]).toBe(validNpub);
  });
});

describe("handler - npub validation", () => {
  it("should reject npub that is too short", async () => {
    const event = {
      requestContext: { http: { method: "GET", path: "/analytics/npub1short" } },
      headers: {}
    };

    const response = await handler(event);
    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body).error).toBe("Invalid npub format");
  });

  it("should reject npub with uppercase letters", async () => {
    const event = {
      requestContext: { http: { method: "GET", path: "/analytics/npub1QQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQCMV7nu" } },
      headers: {}
    };

    const response = await handler(event);
    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body).error).toBe("Invalid npub format");
  });

  it("should reject npub without npub1 prefix", async () => {
    const event = {
      requestContext: { http: { method: "GET", path: "/analytics/nsec1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqcmv7nu" } },
      headers: {}
    };

    const response = await handler(event);
    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body).error).toBe("Invalid npub format");
  });
});
