/**
 * Tests for Billing Lambda function (Stripe integration)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── DynamoDB mock ──────────────────────────────────────────────────────

const mockSend = vi.fn();

vi.mock("@aws-sdk/client-dynamodb", () => ({
  DynamoDBClient: class {}
}));

vi.mock("@aws-sdk/lib-dynamodb", () => ({
  DynamoDBDocumentClient: {
    from: () => ({ send: mockSend })
  },
  GetCommand: class {
    constructor(params) { Object.assign(this, params); }
  },
  UpdateCommand: class {
    constructor(params) { Object.assign(this, params); }
  },
  QueryCommand: class {
    constructor(params) { Object.assign(this, params); }
  }
}));

// ── Stripe mock ────────────────────────────────────────────────────────

const mockStripeCustomersCreate = vi.fn();
const mockCheckoutSessionsCreate = vi.fn();
const mockPortalSessionsCreate = vi.fn();
const mockWebhooksConstructEvent = vi.fn();

vi.mock("stripe", () => {
  return {
    default: class {
      constructor() {
        this.customers = { create: mockStripeCustomersCreate };
        this.checkout = { sessions: { create: mockCheckoutSessionsCreate } };
        this.billingPortal = { sessions: { create: mockPortalSessionsCreate } };
        this.webhooks = { constructEvent: mockWebhooksConstructEvent };
      }
    }
  };
});

// Set required env vars before importing handler
process.env.STRIPE_SECRET_KEY = "sk_test_fake";
process.env.STRIPE_WEBHOOK_SECRET = "whsec_test_fake";
process.env.STRIPE_PRICE_ID = "price_test_fake";

const { handler } = await import("./billing.js");

function makeEvent(method, path, body = null, headers = {}) {
  return {
    requestContext: { http: { method, path } },
    headers: { origin: "https://account.synvya.com", ...headers },
    body: body && typeof body === "string" ? body : body ? JSON.stringify(body) : null
  };
}

// ── Checkout Session Tests ─────────────────────────────────────────────

describe("POST /billing/create-checkout-session", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should create checkout session for customer with existing Stripe ID", async () => {
    // GetCommand returns customer with stripe_customer_id
    mockSend.mockResolvedValueOnce({
      Item: {
        npub: "npub1test",
        stripe_customer_id: "cus_existing",
        stripe_subscription_id: null,
        trial_end: "2026-01-01T00:00:00Z" // expired trial
      }
    });

    mockCheckoutSessionsCreate.mockResolvedValueOnce({
      url: "https://checkout.stripe.com/session123"
    });

    const event = makeEvent("POST", "/billing/create-checkout-session", { npub: "npub1test" });
    const result = await handler(event);
    const body = JSON.parse(result.body);

    expect(result.statusCode).toBe(200);
    expect(body.checkout_url).toBe("https://checkout.stripe.com/session123");

    // Should NOT create a new Stripe customer
    expect(mockStripeCustomersCreate).not.toHaveBeenCalled();

    // Should create checkout with no trial (expired)
    const checkoutCall = mockCheckoutSessionsCreate.mock.calls[0][0];
    expect(checkoutCall.customer).toBe("cus_existing");
    expect(checkoutCall.subscription_data).toBeUndefined();
  });

  it("should create Stripe customer if none exists", async () => {
    // GetCommand returns customer without stripe_customer_id
    mockSend.mockResolvedValueOnce({
      Item: {
        npub: "npub1new",
        stripe_customer_id: null,
        stripe_subscription_id: null,
        trial_end: "2099-01-01T00:00:00Z" // future trial
      }
    });
    // UpdateCommand to save stripe_customer_id
    mockSend.mockResolvedValueOnce({});

    mockStripeCustomersCreate.mockResolvedValueOnce({ id: "cus_new123" });
    mockCheckoutSessionsCreate.mockResolvedValueOnce({
      url: "https://checkout.stripe.com/new"
    });

    const event = makeEvent("POST", "/billing/create-checkout-session", { npub: "npub1new" });
    const result = await handler(event);
    const body = JSON.parse(result.body);

    expect(result.statusCode).toBe(200);
    expect(mockStripeCustomersCreate).toHaveBeenCalledWith({ metadata: { npub: "npub1new" } });

    // Should pass remaining trial to Stripe
    const checkoutCall = mockCheckoutSessionsCreate.mock.calls[0][0];
    expect(checkoutCall.customer).toBe("cus_new123");
    expect(checkoutCall.subscription_data.trial_end).toBeDefined();
  });

  it("should not give trial to returning subscriber", async () => {
    mockSend.mockResolvedValueOnce({
      Item: {
        npub: "npub1returning",
        stripe_customer_id: "cus_old",
        stripe_subscription_id: "sub_old", // had a subscription before
        trial_end: "2099-01-01T00:00:00Z"
      }
    });

    mockCheckoutSessionsCreate.mockResolvedValueOnce({
      url: "https://checkout.stripe.com/returning"
    });

    const event = makeEvent("POST", "/billing/create-checkout-session", { npub: "npub1returning" });
    const result = await handler(event);

    expect(result.statusCode).toBe(200);
    const checkoutCall = mockCheckoutSessionsCreate.mock.calls[0][0];
    expect(checkoutCall.subscription_data).toBeUndefined();
  });

  it("should honor forever trial (no Stripe trial needed)", async () => {
    mockSend.mockResolvedValueOnce({
      Item: {
        npub: "npub1nonprofit",
        stripe_customer_id: "cus_np",
        stripe_subscription_id: null,
        trial_end: "forever"
      }
    });

    mockCheckoutSessionsCreate.mockResolvedValueOnce({
      url: "https://checkout.stripe.com/np"
    });

    const event = makeEvent("POST", "/billing/create-checkout-session", { npub: "npub1nonprofit" });
    const result = await handler(event);

    expect(result.statusCode).toBe(200);
    const checkoutCall = mockCheckoutSessionsCreate.mock.calls[0][0];
    expect(checkoutCall.subscription_data).toBeUndefined();
  });

  it("should return 404 for unknown customer", async () => {
    mockSend.mockResolvedValueOnce({ Item: null });

    const event = makeEvent("POST", "/billing/create-checkout-session", { npub: "npub1ghost" });
    const result = await handler(event);

    expect(result.statusCode).toBe(404);
  });

  it("should return 400 for missing npub", async () => {
    const event = makeEvent("POST", "/billing/create-checkout-session", {});
    const result = await handler(event);

    expect(result.statusCode).toBe(400);
  });
});

// ── Portal Session Tests ───────────────────────────────────────────────

describe("POST /billing/create-portal-session", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should create portal session for customer with Stripe ID", async () => {
    mockSend.mockResolvedValueOnce({
      Item: { npub: "npub1active", stripe_customer_id: "cus_active" }
    });

    mockPortalSessionsCreate.mockResolvedValueOnce({
      url: "https://billing.stripe.com/portal123"
    });

    const event = makeEvent("POST", "/billing/create-portal-session", { npub: "npub1active" });
    const result = await handler(event);
    const body = JSON.parse(result.body);

    expect(result.statusCode).toBe(200);
    expect(body.portal_url).toBe("https://billing.stripe.com/portal123");
  });

  it("should return 400 if no Stripe customer linked", async () => {
    mockSend.mockResolvedValueOnce({
      Item: { npub: "npub1nostripe", stripe_customer_id: null }
    });

    const event = makeEvent("POST", "/billing/create-portal-session", { npub: "npub1nostripe" });
    const result = await handler(event);

    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).error).toContain("Subscribe first");
  });

  it("should return 404 for unknown customer", async () => {
    mockSend.mockResolvedValueOnce({ Item: null });

    const event = makeEvent("POST", "/billing/create-portal-session", { npub: "npub1ghost" });
    const result = await handler(event);

    expect(result.statusCode).toBe(404);
  });
});

// ── Webhook Tests ──────────────────────────────────────────────────────

describe("POST /webhooks/stripe", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function makeWebhookEvent(type, dataObject) {
    return { type, data: { object: dataObject } };
  }

  it("should return 400 when stripe-signature header is missing", async () => {
    const event = makeEvent("POST", "/webhooks/stripe", "{}");
    const result = await handler(event);

    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).error).toBe("Missing stripe-signature header");
  });

  it("should return 400 on invalid signature", async () => {
    mockWebhooksConstructEvent.mockImplementation(() => {
      throw new Error("Invalid signature");
    });

    const event = makeEvent("POST", "/webhooks/stripe", "{}", { "stripe-signature": "bad_sig" });
    const result = await handler(event);

    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).error).toBe("Invalid signature");
  });

  it("should handle checkout.session.completed", async () => {
    mockWebhooksConstructEvent.mockReturnValueOnce(
      makeWebhookEvent("checkout.session.completed", {
        customer: "cus_123",
        subscription: "sub_456"
      })
    );

    // GSI query returns the customer
    mockSend.mockResolvedValueOnce({
      Items: [{ npub: "npub1buyer" }]
    });
    // UpdateCommand succeeds
    mockSend.mockResolvedValueOnce({});

    const event = makeEvent("POST", "/webhooks/stripe", "{}", { "stripe-signature": "valid_sig" });
    const result = await handler(event);

    expect(result.statusCode).toBe(200);

    // Verify update was called with correct fields
    const updateCall = mockSend.mock.calls[1][0];
    expect(updateCall.Key).toEqual({ npub: "npub1buyer" });
    expect(updateCall.ExpressionAttributeValues[":stripe_subscription_id"]).toBe("sub_456");
    expect(updateCall.ExpressionAttributeValues[":subscription_status"]).toBe("active");
    expect(updateCall.ExpressionAttributeValues[":ai_pages_active"]).toBe(true);
  });

  it("should handle invoice.paid", async () => {
    mockWebhooksConstructEvent.mockReturnValueOnce(
      makeWebhookEvent("invoice.paid", {
        customer: "cus_123",
        lines: { data: [{ period: { end: 1735689600 } }] } // 2025-01-01
      })
    );

    mockSend.mockResolvedValueOnce({ Items: [{ npub: "npub1paid" }] });
    mockSend.mockResolvedValueOnce({});

    const event = makeEvent("POST", "/webhooks/stripe", "{}", { "stripe-signature": "valid_sig" });
    const result = await handler(event);

    expect(result.statusCode).toBe(200);
    const updateCall = mockSend.mock.calls[1][0];
    expect(updateCall.ExpressionAttributeValues[":subscription_status"]).toBe("active");
    expect(updateCall.ExpressionAttributeValues[":ai_pages_active"]).toBe(true);
    expect(updateCall.ExpressionAttributeValues[":current_period_end"]).toBeDefined();
  });

  it("should handle invoice.payment_failed", async () => {
    mockWebhooksConstructEvent.mockReturnValueOnce(
      makeWebhookEvent("invoice.payment_failed", { customer: "cus_123" })
    );

    mockSend.mockResolvedValueOnce({ Items: [{ npub: "npub1failed" }] });
    mockSend.mockResolvedValueOnce({});

    const event = makeEvent("POST", "/webhooks/stripe", "{}", { "stripe-signature": "valid_sig" });
    const result = await handler(event);

    expect(result.statusCode).toBe(200);
    const updateCall = mockSend.mock.calls[1][0];
    expect(updateCall.ExpressionAttributeValues[":subscription_status"]).toBe("past_due");
    expect(updateCall.ExpressionAttributeValues[":ai_pages_active"]).toBe(false);
  });

  it("should handle customer.subscription.deleted", async () => {
    mockWebhooksConstructEvent.mockReturnValueOnce(
      makeWebhookEvent("customer.subscription.deleted", { customer: "cus_123" })
    );

    mockSend.mockResolvedValueOnce({ Items: [{ npub: "npub1canceled" }] });
    mockSend.mockResolvedValueOnce({});

    const event = makeEvent("POST", "/webhooks/stripe", "{}", { "stripe-signature": "valid_sig" });
    const result = await handler(event);

    expect(result.statusCode).toBe(200);
    const updateCall = mockSend.mock.calls[1][0];
    expect(updateCall.ExpressionAttributeValues[":subscription_status"]).toBe("canceled");
    expect(updateCall.ExpressionAttributeValues[":ai_pages_active"]).toBe(false);
  });

  it("should handle customer.subscription.updated", async () => {
    mockWebhooksConstructEvent.mockReturnValueOnce(
      makeWebhookEvent("customer.subscription.updated", {
        customer: "cus_123",
        status: "active",
        current_period_end: 1735689600
      })
    );

    mockSend.mockResolvedValueOnce({ Items: [{ npub: "npub1updated" }] });
    mockSend.mockResolvedValueOnce({});

    const event = makeEvent("POST", "/webhooks/stripe", "{}", { "stripe-signature": "valid_sig" });
    const result = await handler(event);

    expect(result.statusCode).toBe(200);
    const updateCall = mockSend.mock.calls[1][0];
    expect(updateCall.ExpressionAttributeValues[":subscription_status"]).toBe("active");
    expect(updateCall.ExpressionAttributeValues[":ai_pages_active"]).toBe(true);
  });

  it("should return 200 for unknown event types", async () => {
    mockWebhooksConstructEvent.mockReturnValueOnce(
      makeWebhookEvent("some.unknown.event", {})
    );

    const event = makeEvent("POST", "/webhooks/stripe", "{}", { "stripe-signature": "valid_sig" });
    const result = await handler(event);

    expect(result.statusCode).toBe(200);
    // No DynamoDB calls for unknown events
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("should return 200 even when customer not found in DynamoDB", async () => {
    mockWebhooksConstructEvent.mockReturnValueOnce(
      makeWebhookEvent("invoice.paid", { customer: "cus_unknown", lines: { data: [] } })
    );

    // GSI query returns no items
    mockSend.mockResolvedValueOnce({ Items: [] });

    const event = makeEvent("POST", "/webhooks/stripe", "{}", { "stripe-signature": "valid_sig" });
    const result = await handler(event);

    // Should still return 200 so Stripe doesn't retry
    expect(result.statusCode).toBe(200);
  });
});

// ── Routing Tests ──────────────────────────────────────────────────────

describe("routing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return 200 for OPTIONS preflight", async () => {
    const event = makeEvent("OPTIONS", "/billing/create-checkout-session");
    const result = await handler(event);

    expect(result.statusCode).toBe(200);
  });

  it("should return 404 for unknown path", async () => {
    const event = makeEvent("POST", "/billing/unknown");
    const result = await handler(event);

    expect(result.statusCode).toBe(404);
  });
});
