import Stripe from "stripe";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, UpdateCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";

const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const secretsClient = new SecretsManagerClient({});
const customersTable = process.env.CUSTOMERS_TABLE || "synvya-customers";
const stripeCustomerIdIndex = "stripe-customer-id-index";

// Cache resolved secrets in memory across invocations
let cachedStripeKey = null;
let cachedWebhookSecret = null;

async function getSecret(arnEnvVar, fallbackEnvVar) {
  // In local dev, use the env var directly
  const arn = process.env[arnEnvVar];
  if (!arn) {
    const direct = process.env[fallbackEnvVar];
    if (!direct) throw new Error(`${arnEnvVar} or ${fallbackEnvVar} environment variable is not set`);
    return direct;
  }

  const result = await secretsClient.send(
    new GetSecretValueCommand({ SecretId: arn })
  );
  const parsed = JSON.parse(result.SecretString);
  return parsed[fallbackEnvVar] || result.SecretString;
}

async function getStripe() {
  if (!cachedStripeKey) {
    cachedStripeKey = await getSecret("STRIPE_SECRET_ARN", "STRIPE_SECRET_KEY");
  }
  return new Stripe(cachedStripeKey);
}

async function getWebhookSecret() {
  if (!cachedWebhookSecret) {
    cachedWebhookSecret = await getSecret("STRIPE_WEBHOOK_SECRET_ARN", "STRIPE_WEBHOOK_SECRET");
  }
  return cachedWebhookSecret;
}

function getCorsOrigin(requestOrigin) {
  const allowedOrigins = (process.env.CORS_ALLOW_ORIGIN || "*").split(",").map((o) => o.trim());
  if (allowedOrigins.includes("*")) return "*";
  if (!requestOrigin) return allowedOrigins[0] || null;
  if (allowedOrigins.includes(requestOrigin)) return requestOrigin;
  return null;
}

function jsonResponse(statusCode, body, headers = {}, requestOrigin = null) {
  const corsOrigin = getCorsOrigin(requestOrigin);
  const corsHeaders = {
    "Access-Control-Allow-Methods": "OPTIONS,GET,POST,PUT,DELETE",
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
    "Content-Type": "application/json",
    ...headers
  };
  if (corsOrigin !== null) {
    corsHeaders["Access-Control-Allow-Origin"] = corsOrigin;
  }
  return { statusCode, headers: corsHeaders, body: JSON.stringify(body) };
}

// Look up a customer record by stripe_customer_id using the GSI
async function getCustomerByStripeId(stripeCustomerId) {
  const result = await dynamo.send(
    new QueryCommand({
      TableName: customersTable,
      IndexName: stripeCustomerIdIndex,
      KeyConditionExpression: "stripe_customer_id = :sid",
      ExpressionAttributeValues: { ":sid": stripeCustomerId }
    })
  );
  return result.Items?.[0] || null;
}

// Update subscription fields on a customer record
async function updateSubscriptionFields(npub, fields) {
  const expressions = [];
  const names = {};
  const values = {};

  for (const [key, val] of Object.entries(fields)) {
    const attrName = `#${key}`;
    const attrVal = `:${key}`;
    expressions.push(`${attrName} = ${attrVal}`);
    names[attrName] = key;
    values[attrVal] = val;
  }

  expressions.push("#last_updated = :last_updated");
  names["#last_updated"] = "last_updated";
  values[":last_updated"] = new Date().toISOString();

  await dynamo.send(
    new UpdateCommand({
      TableName: customersTable,
      Key: { npub },
      UpdateExpression: `SET ${expressions.join(", ")}`,
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values
    })
  );
}

// ── POST /billing/create-checkout-session ──────────────────────────────

async function handleCreateCheckoutSession(event, requestOrigin) {
  if (event.requestContext?.http?.method !== "POST") {
    return jsonResponse(405, { error: "Method not allowed" }, {}, requestOrigin);
  }

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return jsonResponse(400, { error: "Invalid JSON body" }, {}, requestOrigin);
  }

  const { npub } = body;
  if (!npub || typeof npub !== "string") {
    return jsonResponse(400, { error: "npub is required" }, {}, requestOrigin);
  }

  // Look up customer in DynamoDB
  const result = await dynamo.send(
    new GetCommand({ TableName: customersTable, Key: { npub } })
  );

  if (!result.Item) {
    return jsonResponse(404, { error: "Customer not found" }, {}, requestOrigin);
  }

  const customer = result.Item;
  const stripe = await getStripe();

  // Create Stripe customer if one doesn't exist
  let stripeCustomerId = customer.stripe_customer_id;
  if (!stripeCustomerId) {
    const stripeCustomer = await stripe.customers.create({
      metadata: { npub }
    });
    stripeCustomerId = stripeCustomer.id;

    await updateSubscriptionFields(npub, {
      stripe_customer_id: stripeCustomerId
    });
  }

  // Determine trial: only if they haven't had one via Stripe before
  // and their trial_end is still in the future
  const subscriptionData = {};
  const hadStripeSub = !!customer.stripe_subscription_id;
  if (!hadStripeSub && customer.trial_end && customer.trial_end !== "forever") {
    const trialEnd = new Date(customer.trial_end);
    const now = new Date();
    if (trialEnd > now) {
      // Honor remaining trial days in Stripe
      subscriptionData.trial_end = Math.floor(trialEnd.getTime() / 1000);
    }
  }

  const priceId = process.env.STRIPE_PRICE_ID;
  if (!priceId) {
    throw new Error("STRIPE_PRICE_ID environment variable is not set");
  }

  const baseUrl = process.env.APP_BASE_URL || "https://account.synvya.com";

  const session = await stripe.checkout.sessions.create({
    customer: stripeCustomerId,
    mode: "subscription",
    line_items: [{ price: priceId, quantity: 1 }],
    ...(Object.keys(subscriptionData).length > 0 && { subscription_data: subscriptionData }),
    success_url: `${baseUrl}/app/settings?success=true`,
    cancel_url: `${baseUrl}/app/settings?canceled=true`
  });

  return jsonResponse(200, { checkout_url: session.url }, {}, requestOrigin);
}

// ── POST /billing/create-portal-session ────────────────────────────────

async function handleCreatePortalSession(event, requestOrigin) {
  if (event.requestContext?.http?.method !== "POST") {
    return jsonResponse(405, { error: "Method not allowed" }, {}, requestOrigin);
  }

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return jsonResponse(400, { error: "Invalid JSON body" }, {}, requestOrigin);
  }

  const { npub } = body;
  if (!npub || typeof npub !== "string") {
    return jsonResponse(400, { error: "npub is required" }, {}, requestOrigin);
  }

  const result = await dynamo.send(
    new GetCommand({ TableName: customersTable, Key: { npub } })
  );

  if (!result.Item) {
    return jsonResponse(404, { error: "Customer not found" }, {}, requestOrigin);
  }

  const stripeCustomerId = result.Item.stripe_customer_id;
  if (!stripeCustomerId) {
    return jsonResponse(400, { error: "No Stripe customer linked. Subscribe first." }, {}, requestOrigin);
  }

  const stripe = await getStripe();
  const baseUrl = process.env.APP_BASE_URL || "https://account.synvya.com";
  const session = await stripe.billingPortal.sessions.create({
    customer: stripeCustomerId,
    return_url: `${baseUrl}/app/settings`
  });

  return jsonResponse(200, { portal_url: session.url }, {}, requestOrigin);
}

// ── POST /webhooks/stripe ──────────────────────────────────────────────

async function handleWebhook(event) {
  const stripe = await getStripe();
  const sig = event.headers?.["stripe-signature"];

  if (!sig) {
    return { statusCode: 400, body: JSON.stringify({ error: "Missing stripe-signature header" }) };
  }

  const webhookSecret = await getWebhookSecret();

  // Use raw body for signature verification — API Gateway v2 provides it as event.body
  let stripeEvent;
  try {
    stripeEvent = stripe.webhooks.constructEvent(event.body, sig, webhookSecret);
  } catch (err) {
    console.error("Webhook signature verification failed:", err.message);
    return { statusCode: 400, body: JSON.stringify({ error: "Invalid signature" }) };
  }

  console.log(`Processing Stripe webhook: ${stripeEvent.type}`);

  switch (stripeEvent.type) {
    case "checkout.session.completed": {
      const session = stripeEvent.data.object;
      const stripeCustomerId = session.customer;
      const stripeSubscriptionId = session.subscription;

      const customer = await getCustomerByStripeId(stripeCustomerId);
      if (!customer) {
        console.warn(`No customer found for stripe_customer_id: ${stripeCustomerId}`);
        break;
      }

      await updateSubscriptionFields(customer.npub, {
        stripe_subscription_id: stripeSubscriptionId,
        subscription_status: "active",
        ai_pages_active: true
      });
      break;
    }

    case "invoice.paid": {
      const invoice = stripeEvent.data.object;
      const stripeCustomerId = invoice.customer;
      const periodEnd = invoice.lines?.data?.[0]?.period?.end;

      const customer = await getCustomerByStripeId(stripeCustomerId);
      if (!customer) {
        console.warn(`No customer found for stripe_customer_id: ${stripeCustomerId}`);
        break;
      }

      const fields = {
        subscription_status: "active",
        ai_pages_active: true
      };
      if (periodEnd) {
        fields.current_period_end = new Date(periodEnd * 1000).toISOString();
      }

      await updateSubscriptionFields(customer.npub, fields);
      break;
    }

    case "invoice.payment_failed": {
      const invoice = stripeEvent.data.object;
      const stripeCustomerId = invoice.customer;

      const customer = await getCustomerByStripeId(stripeCustomerId);
      if (!customer) {
        console.warn(`No customer found for stripe_customer_id: ${stripeCustomerId}`);
        break;
      }

      await updateSubscriptionFields(customer.npub, {
        subscription_status: "past_due",
        ai_pages_active: false
      });
      break;
    }

    case "customer.subscription.deleted": {
      const subscription = stripeEvent.data.object;
      const stripeCustomerId = subscription.customer;

      const customer = await getCustomerByStripeId(stripeCustomerId);
      if (!customer) {
        console.warn(`No customer found for stripe_customer_id: ${stripeCustomerId}`);
        break;
      }

      await updateSubscriptionFields(customer.npub, {
        subscription_status: "canceled",
        ai_pages_active: false
      });
      break;
    }

    case "customer.subscription.updated": {
      const subscription = stripeEvent.data.object;
      const stripeCustomerId = subscription.customer;
      const status = subscription.status; // trialing, active, past_due, canceled, etc.

      const customer = await getCustomerByStripeId(stripeCustomerId);
      if (!customer) {
        console.warn(`No customer found for stripe_customer_id: ${stripeCustomerId}`);
        break;
      }

      const aiPagesActive = status === "trialing" || status === "active";
      const fields = {
        subscription_status: status,
        ai_pages_active: aiPagesActive
      };
      if (subscription.current_period_end) {
        fields.current_period_end = new Date(subscription.current_period_end * 1000).toISOString();
      }

      await updateSubscriptionFields(customer.npub, fields);
      break;
    }

    default:
      console.log(`Unhandled event type: ${stripeEvent.type}`);
  }

  // Always return 200 quickly — Stripe retries on non-2xx
  return { statusCode: 200, body: JSON.stringify({ received: true }) };
}

// ── Router ─────────────────────────────────────────────────────────────

export const handler = async (event) => {
  console.log("=== Billing API handler called ===", JSON.stringify({
    path: event.requestContext?.http?.path,
    method: event.requestContext?.http?.method,
    timestamp: new Date().toISOString()
  }, null, 2));

  const requestOrigin = event.headers?.["origin"] || event.headers?.["Origin"] || null;

  try {
    if (event.requestContext?.http?.method === "OPTIONS") {
      return jsonResponse(200, { ok: true }, {}, requestOrigin);
    }

    const path = event.requestContext?.http?.path || "";

    if (path.endsWith("/billing/create-checkout-session")) {
      return await handleCreateCheckoutSession(event, requestOrigin);
    }

    if (path.endsWith("/billing/create-portal-session")) {
      return await handleCreatePortalSession(event, requestOrigin);
    }

    if (path.endsWith("/webhooks/stripe")) {
      return await handleWebhook(event);
    }

    return jsonResponse(404, { error: "Not found" }, {}, requestOrigin);
  } catch (error) {
    console.error("Billing API error:", error);
    return jsonResponse(
      500,
      { error: "Internal server error", message: error.message },
      {},
      requestOrigin
    );
  }
};
