/**
 * Tests for Discovery Lambda function
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { isValidSlug, buildCorsHeaders, handler } from "./discovery.js";

// Mock S3 client
vi.mock("@aws-sdk/client-s3", () => {
  const mockSend = vi.fn().mockResolvedValue({});
  return {
    S3Client: vi.fn(() => ({ send: mockSend })),
    PutObjectCommand: vi.fn((params) => ({ ...params, _type: "PutObjectCommand" })),
    __mockSend: mockSend
  };
});

// Mock Secrets Manager
vi.mock("@aws-sdk/client-secrets-manager", () => {
  const mockSend = vi.fn().mockResolvedValue({
    SecretString: JSON.stringify({ "github-token": "test-github-token" })
  });
  return {
    SecretsManagerClient: vi.fn(() => ({ send: mockSend })),
    GetSecretValueCommand: vi.fn(),
    __mockSend: mockSend
  };
});

// Mock global fetch for GitHub API calls
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe("isValidSlug", () => {
  it("should accept valid slugs", () => {
    expect(isValidSlug("restaurant")).toBe(true);
    expect(isValidSlug("cafe")).toBe(true);
    expect(isValidSlug("el-candado")).toBe(true);
    expect(isValidSlug("india_belly")).toBe(true);
    expect(isValidSlug("Restaurant123")).toBe(true);
    expect(isValidSlug("a")).toBe(true);
  });

  it("should reject empty or null slugs", () => {
    expect(isValidSlug("")).toBe(false);
    expect(isValidSlug(null)).toBe(false);
    expect(isValidSlug(undefined)).toBe(false);
  });

  it("should reject path traversal attempts", () => {
    expect(isValidSlug("..")).toBe(false);
    expect(isValidSlug("../etc")).toBe(false);
    expect(isValidSlug("foo/bar")).toBe(false);
    expect(isValidSlug("foo\\bar")).toBe(false);
    expect(isValidSlug("..%2F")).toBe(false);
  });

  it("should reject slugs with special characters", () => {
    expect(isValidSlug("hello world")).toBe(false);
    expect(isValidSlug("hello!")).toBe(false);
    expect(isValidSlug("hello@world")).toBe(false);
    expect(isValidSlug("<script>")).toBe(false);
  });

  it("should reject slugs starting with special characters", () => {
    expect(isValidSlug("-restaurant")).toBe(false);
    expect(isValidSlug("_cafe")).toBe(false);
  });

  it("should reject non-string inputs", () => {
    expect(isValidSlug(123)).toBe(false);
    expect(isValidSlug({})).toBe(false);
    expect(isValidSlug([])).toBe(false);
  });
});

describe("buildCorsHeaders", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("should use origin override when provided", () => {
    const headers = buildCorsHeaders("https://example.com");
    expect(headers["Access-Control-Allow-Origin"]).toBe("https://example.com");
    expect(headers["Access-Control-Allow-Methods"]).toBe("OPTIONS,POST");
    expect(headers["Access-Control-Allow-Headers"]).toBe("Content-Type,Authorization");
  });

  it("should use environment variable when no override", () => {
    process.env.CORS_ALLOW_ORIGIN = "https://synvya.com";
    const headers = buildCorsHeaders(undefined);
    expect(headers["Access-Control-Allow-Origin"]).toBe("https://synvya.com");
  });

  it("should default to * when no override or env var", () => {
    delete process.env.CORS_ALLOW_ORIGIN;
    const headers = buildCorsHeaders(undefined);
    expect(headers["Access-Control-Allow-Origin"]).toBe("*");
  });
});

describe("handler", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    vi.resetAllMocks();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("should return 204 for OPTIONS request", async () => {
    const event = {
      requestContext: { http: { method: "OPTIONS" } },
      headers: { origin: "https://example.com" }
    };

    const response = await handler(event);

    expect(response.statusCode).toBe(204);
    expect(response.headers["Access-Control-Allow-Origin"]).toBe("https://example.com");
  });

  it("should return 405 for non-POST requests", async () => {
    const event = {
      requestContext: { http: { method: "GET" } },
      headers: {}
    };

    const response = await handler(event);

    expect(response.statusCode).toBe(405);
    expect(JSON.parse(response.body).error).toBe("Method not allowed");
  });

  it("should return 400 for missing body", async () => {
    const event = {
      requestContext: { http: { method: "POST" } },
      headers: {},
      body: null
    };

    const response = await handler(event);

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body).error).toBe("Missing request body");
  });

  it("should return 400 for invalid JSON", async () => {
    const event = {
      requestContext: { http: { method: "POST" } },
      headers: {},
      body: "not valid json"
    };

    const response = await handler(event);

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body).error).toBe("Invalid JSON in request body");
  });

  it("should return 400 for missing required fields", async () => {
    const event = {
      requestContext: { http: { method: "POST" } },
      headers: {},
      body: JSON.stringify({ typeSlug: "restaurant" })
    };

    const response = await handler(event);

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body).error).toBe("Missing required fields: typeSlug, nameSlug, html");
  });

  it("should return 400 for invalid typeSlug", async () => {
    const event = {
      requestContext: { http: { method: "POST" } },
      headers: {},
      body: JSON.stringify({
        typeSlug: "../etc",
        nameSlug: "test",
        html: "<html></html>"
      })
    };

    const response = await handler(event);

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body).error).toBe("Invalid typeSlug format");
  });

  it("should return 400 for invalid nameSlug", async () => {
    const event = {
      requestContext: { http: { method: "POST" } },
      headers: {},
      body: JSON.stringify({
        typeSlug: "restaurant",
        nameSlug: "foo/bar",
        html: "<html></html>"
      })
    };

    const response = await handler(event);

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body).error).toBe("Invalid nameSlug format");
  });

  it("should return 400 for empty html", async () => {
    const event = {
      requestContext: { http: { method: "POST" } },
      headers: {},
      body: JSON.stringify({
        typeSlug: "restaurant",
        nameSlug: "test",
        html: ""
      })
    };

    const response = await handler(event);

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body).error).toBe("html must be a non-empty string");
  });

  it("should return 400 for whitespace-only html", async () => {
    const event = {
      requestContext: { http: { method: "POST" } },
      headers: {},
      body: JSON.stringify({
        typeSlug: "restaurant",
        nameSlug: "test",
        html: "   "
      })
    };

    const response = await handler(event);

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body).error).toBe("html must be a non-empty string");
  });

  it("should handle base64-encoded body", async () => {
    const bodyContent = JSON.stringify({
      typeSlug: "restaurant",
      nameSlug: "test-restaurant"
    });
    const base64Body = Buffer.from(bodyContent).toString("base64");

    const event = {
      requestContext: { http: { method: "POST" } },
      headers: {},
      body: base64Body,
      isBase64Encoded: true
    };

    const response = await handler(event);

    // Should fail with missing html field, not with JSON parse error
    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body).error).toBe("Missing required fields: typeSlug, nameSlug, html");
  });

  it("should return 500 when WEBSITE_S3_BUCKET is not set", async () => {
    delete process.env.WEBSITE_S3_BUCKET;

    const event = {
      requestContext: { http: { method: "POST" } },
      headers: {},
      body: JSON.stringify({
        typeSlug: "restaurant",
        nameSlug: "test",
        html: "<html><body>Test</body></html>"
      })
    };

    const response = await handler(event);

    expect(response.statusCode).toBe(500);
    expect(JSON.parse(response.body).error).toBe("Failed to publish discovery page");
  });

  it("should upload HTML to S3 and trigger workflow on success", async () => {
    process.env.WEBSITE_S3_BUCKET = "test-website-bucket";
    process.env.GITHUB_TOKEN_SECRET_ARN = "arn:aws:secretsmanager:us-east-1:123:secret:test";

    const { __mockSend: mockS3Send } = await import("@aws-sdk/client-s3");
    const { __mockSend: mockSecretsSend } = await import("@aws-sdk/client-secrets-manager");
    mockS3Send.mockResolvedValue({});
    mockSecretsSend.mockResolvedValue({
      SecretString: JSON.stringify({ "github-token": "test-github-token" })
    });
    mockFetch.mockResolvedValue({ ok: true, status: 204 });

    const event = {
      requestContext: { http: { method: "POST" } },
      headers: {},
      body: JSON.stringify({
        typeSlug: "restaurant",
        nameSlug: "test-restaurant",
        html: "<html><body>Test</body></html>"
      })
    };

    const response = await handler(event);

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.published).toBe(true);
    expect(body.url).toBe("https://synvya.com/restaurant/test-restaurant/");

    // Verify S3 upload was called
    expect(mockS3Send).toHaveBeenCalled();

    // Verify workflow was triggered without html_content
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const fetchCall = mockFetch.mock.calls[0];
    const fetchBody = JSON.parse(fetchCall[1].body);
    expect(fetchBody.inputs).toEqual({
      type_slug: "restaurant",
      name_slug: "test-restaurant"
    });
    expect(fetchBody.inputs.html_content).toBeUndefined();
  });

  it("should return 500 when S3 upload fails", async () => {
    process.env.WEBSITE_S3_BUCKET = "test-website-bucket";
    process.env.GITHUB_TOKEN_SECRET_ARN = "arn:aws:secretsmanager:us-east-1:123:secret:test";

    const { __mockSend: mockS3Send } = await import("@aws-sdk/client-s3");
    mockS3Send.mockRejectedValue(new Error("S3 access denied"));

    const event = {
      requestContext: { http: { method: "POST" } },
      headers: {},
      body: JSON.stringify({
        typeSlug: "restaurant",
        nameSlug: "test",
        html: "<html><body>Test</body></html>"
      })
    };

    const response = await handler(event);

    expect(response.statusCode).toBe(500);
    expect(JSON.parse(response.body).error).toBe("Failed to publish discovery page");
    // Workflow should not have been triggered
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe("handler - input validation edge cases", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    // Don't set WEBSITE_S3_BUCKET so these fail at S3 check, not validation
    delete process.env.WEBSITE_S3_BUCKET;
    vi.resetAllMocks();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("should accept slug with numbers", async () => {
    const event = {
      requestContext: { http: { method: "POST" } },
      headers: {},
      body: JSON.stringify({
        typeSlug: "restaurant123",
        nameSlug: "cafe456",
        html: "<html></html>"
      })
    };

    // Will fail at S3 bucket check, but should pass validation
    const response = await handler(event);
    expect(response.statusCode).toBe(500); // Fails at S3 bucket, not validation
  });

  it("should accept slug with hyphens", async () => {
    const event = {
      requestContext: { http: { method: "POST" } },
      headers: {},
      body: JSON.stringify({
        typeSlug: "fast-food",
        nameSlug: "el-candado",
        html: "<html></html>"
      })
    };

    const response = await handler(event);
    expect(response.statusCode).toBe(500); // Fails at S3 bucket, not validation
  });

  it("should accept slug with underscores", async () => {
    const event = {
      requestContext: { http: { method: "POST" } },
      headers: {},
      body: JSON.stringify({
        typeSlug: "fast_food",
        nameSlug: "india_belly",
        html: "<html></html>"
      })
    };

    const response = await handler(event);
    expect(response.statusCode).toBe(500); // Fails at S3 bucket, not validation
  });
});

describe("uploadHtmlToS3", () => {
  it("should upload HTML with correct key and content type", async () => {
    const { uploadHtmlToS3 } = await import("./discovery.js");
    const { PutObjectCommand, __mockSend: mockS3Send } = await import("@aws-sdk/client-s3");

    mockS3Send.mockResolvedValue({});

    await uploadHtmlToS3("my-bucket", "restaurant", "el-candado", "<html>hello</html>");

    expect(PutObjectCommand).toHaveBeenCalledWith({
      Bucket: "my-bucket",
      Key: "restaurant/el-candado/index.html",
      Body: "<html>hello</html>",
      ContentType: "text/html"
    });
    expect(mockS3Send).toHaveBeenCalled();
  });
});
