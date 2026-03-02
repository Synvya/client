/**
 * Tests for Customer Registry Lambda function
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockSend = vi.fn();

vi.mock("@aws-sdk/client-dynamodb", () => ({
  DynamoDBClient: class {}
}));

vi.mock("@aws-sdk/lib-dynamodb", () => ({
  DynamoDBDocumentClient: {
    from: () => ({ send: mockSend })
  },
  GetCommand: class {
    constructor(params) {
      Object.assign(this, params);
    }
  },
  PutCommand: class {
    constructor(params) {
      Object.assign(this, params);
    }
  },
  UpdateCommand: class {
    constructor(params) {
      Object.assign(this, params);
    }
  }
}));

const { handler } = await import("./customers.js");

function makeEvent(method, path, body = null) {
  return {
    requestContext: {
      http: { method, path }
    },
    headers: { origin: "https://account.synvya.com" },
    body: body ? JSON.stringify(body) : null
  };
}

describe("POST /api/customers/register", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should register a new customer with trial fields", async () => {
    // First call: GetCommand returns no existing item
    mockSend.mockResolvedValueOnce({ Item: null });
    // Second call: PutCommand succeeds
    mockSend.mockResolvedValueOnce({});

    const signupTimestamp = Math.floor(new Date("2026-03-02T12:00:00Z").getTime() / 1000);
    const event = makeEvent("POST", "/api/customers/register", {
      npub: "npub1test123",
      signup_timestamp: signupTimestamp
    });

    const result = await handler(event);
    const body = JSON.parse(result.body);

    expect(result.statusCode).toBe(200);
    expect(body.message).toBe("Customer registered successfully");

    // Verify the PutCommand was called with trial fields
    const putCall = mockSend.mock.calls[1][0];
    const item = putCall.Item;
    expect(item.subscription_status).toBe("trialing");
    expect(item.trial_start).toBeDefined();
    expect(item.trial_end).toBeDefined();
    expect(item.ai_pages_active).toBe(true);
    expect(item.stripe_customer_id).toBeNull();
    expect(item.stripe_subscription_id).toBeNull();
    expect(item.current_period_end).toBeNull();

    // Verify trial_end is 14 days after trial_start
    const trialStart = new Date(item.trial_start);
    const trialEnd = new Date(item.trial_end);
    const diffDays = (trialEnd - trialStart) / (1000 * 60 * 60 * 24);
    expect(diffDays).toBeCloseTo(14, 0);
  });

  it("should not overwrite existing customer on re-registration", async () => {
    mockSend.mockResolvedValueOnce({
      Item: {
        npub: "npub1existing",
        signup_date: "2026-01-01",
        subscription_status: "active",
        trial_end: "forever"
      }
    });

    const event = makeEvent("POST", "/api/customers/register", {
      npub: "npub1existing",
      signup_timestamp: Math.floor(Date.now() / 1000)
    });

    const result = await handler(event);
    const body = JSON.parse(result.body);

    expect(result.statusCode).toBe(200);
    expect(body.message).toBe("Customer already registered");
    // Should only have called GetCommand, no PutCommand
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it("should reject missing npub", async () => {
    const event = makeEvent("POST", "/api/customers/register", {
      signup_timestamp: 1234567890
    });

    const result = await handler(event);
    expect(result.statusCode).toBe(400);
  });

  it("should reject missing signup_timestamp", async () => {
    const event = makeEvent("POST", "/api/customers/register", {
      npub: "npub1test"
    });

    const result = await handler(event);
    expect(result.statusCode).toBe(400);
  });
});

describe("GET /api/customers/status/{npub}", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return subscription status for existing customer", async () => {
    mockSend.mockResolvedValueOnce({
      Item: {
        npub: "npub1test",
        subscription_status: "active",
        trial_start: "2026-01-01T00:00:00Z",
        trial_end: "2026-01-15T00:00:00Z",
        ai_pages_active: true,
        stripe_customer_id: "cus_123",
        stripe_subscription_id: "sub_456",
        current_period_end: "2026-04-01T00:00:00Z"
      }
    });

    const event = makeEvent("GET", "/api/customers/status/npub1test");
    const result = await handler(event);
    const body = JSON.parse(result.body);

    expect(result.statusCode).toBe(200);
    expect(body.subscription_status).toBe("active");
    expect(body.ai_pages_active).toBe(true);
    expect(body.stripe_customer_id).toBe("cus_123");
  });

  it("should return trial_expired when trial has passed and no subscription", async () => {
    const pastDate = new Date();
    pastDate.setDate(pastDate.getDate() - 1);

    mockSend.mockResolvedValueOnce({
      Item: {
        npub: "npub1expired",
        subscription_status: "trialing",
        trial_start: "2026-01-01T00:00:00Z",
        trial_end: pastDate.toISOString(),
        ai_pages_active: true,
        stripe_customer_id: null,
        stripe_subscription_id: null,
        current_period_end: null
      }
    });

    const event = makeEvent("GET", "/api/customers/status/npub1expired");
    const result = await handler(event);
    const body = JSON.parse(result.body);

    expect(result.statusCode).toBe(200);
    expect(body.subscription_status).toBe("trial_expired");
    expect(body.ai_pages_active).toBe(false);
  });

  it("should keep forever trial as active", async () => {
    mockSend.mockResolvedValueOnce({
      Item: {
        npub: "npub1nonprofit",
        subscription_status: "trialing",
        trial_start: "2026-01-01T00:00:00Z",
        trial_end: "forever",
        ai_pages_active: true,
        stripe_customer_id: null,
        stripe_subscription_id: null,
        current_period_end: null
      }
    });

    const event = makeEvent("GET", "/api/customers/status/npub1nonprofit");
    const result = await handler(event);
    const body = JSON.parse(result.body);

    expect(result.statusCode).toBe(200);
    expect(body.subscription_status).toBe("trialing");
    expect(body.ai_pages_active).toBe(true);
    expect(body.trial_end).toBe("forever");
  });

  it("should return 404 for unknown customer", async () => {
    mockSend.mockResolvedValueOnce({ Item: null });

    const event = makeEvent("GET", "/api/customers/status/npub1unknown");
    const result = await handler(event);

    expect(result.statusCode).toBe(404);
  });

  it("should reject invalid npub in path", async () => {
    const event = makeEvent("GET", "/api/customers/status/invalid");
    const result = await handler(event);

    expect(result.statusCode).toBe(400);
  });
});

describe("POST /api/customers/reservations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should create customer with trial fields when auto-creating via reservation", async () => {
    // GetCommand returns no existing item
    mockSend.mockResolvedValueOnce({ Item: null });
    // PutCommand succeeds
    mockSend.mockResolvedValueOnce({});

    const event = makeEvent("POST", "/api/customers/reservations", {
      npub: "npub1new",
      root_rumor_id: "event123",
      reservation_timestamp: Math.floor(Date.now() / 1000),
      month: "2026-03"
    });

    const result = await handler(event);
    const body = JSON.parse(result.body);

    expect(result.statusCode).toBe(200);
    expect(body.message).toBe("Reservation tracked successfully");

    // Verify PutCommand includes trial fields
    const putCall = mockSend.mock.calls[1][0];
    const item = putCall.Item;
    expect(item.subscription_status).toBe("trialing");
    expect(item.trial_start).toBeDefined();
    expect(item.trial_end).toBeDefined();
    expect(item.ai_pages_active).toBe(true);
  });
});
