import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, QueryCommand } from "@aws-sdk/lib-dynamodb";

const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const analyticsTable = process.env.BOT_ANALYTICS_TABLE || "synvya-bot-analytics";

function getCorsOrigin(requestOrigin) {
  const allowedOrigins = (process.env.CORS_ALLOW_ORIGIN || "*").split(",").map((o) => o.trim());

  if (allowedOrigins.includes("*")) {
    return "*";
  }

  if (!requestOrigin) {
    return allowedOrigins[0] || null;
  }

  if (allowedOrigins.includes(requestOrigin)) {
    return requestOrigin;
  }

  return null;
}

function jsonResponse(statusCode, body, headers = {}, requestOrigin = null) {
  const corsOrigin = getCorsOrigin(requestOrigin);

  const corsHeaders = {
    "Access-Control-Allow-Methods": "OPTIONS,GET",
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
    "Content-Type": "application/json",
    ...headers
  };

  if (corsOrigin !== null) {
    corsHeaders["Access-Control-Allow-Origin"] = corsOrigin;
  }

  return {
    statusCode,
    headers: corsHeaders,
    body: JSON.stringify(body)
  };
}

function withErrorHandling(handler) {
  return async (event) => {
    try {
      return await handler(event);
    } catch (error) {
      console.error("Bot Analytics API error:", error);
      const requestOrigin = event.headers?.["origin"] || event.headers?.["Origin"] || null;
      return jsonResponse(
        500,
        { error: "Internal server error", message: error.message },
        {},
        requestOrigin
      );
    }
  };
}

export function extractNpub(path) {
  if (!path || typeof path !== "string") return null;
  const match = path.match(/\/dashboard\/([^/]+)$/);
  return match ? match[1] : null;
}

function isValidNpub(npub) {
  return typeof npub === "string" && /^npub1[a-z0-9]{58}$/.test(npub);
}

async function handleGetAnalytics(npub, requestOrigin = null) {
  const result = await dynamo.send(
    new QueryCommand({
      TableName: analyticsTable,
      KeyConditionExpression: "npub = :npub",
      ExpressionAttributeValues: {
        ":npub": npub
      }
    })
  );

  return jsonResponse(200, { items: result.Items || [] }, {}, requestOrigin);
}

export const handler = withErrorHandling(async (event) => {
  const requestOrigin = event.headers?.["origin"] || event.headers?.["Origin"] || null;

  if (event.requestContext?.http?.method === "OPTIONS") {
    return jsonResponse(200, { ok: true }, {}, requestOrigin);
  }

  if (event.requestContext?.http?.method !== "GET") {
    return jsonResponse(405, { error: "Method not allowed" }, {}, requestOrigin);
  }

  const path = event.requestContext?.http?.path || "";
  const npub = extractNpub(path);

  if (!npub) {
    return jsonResponse(400, { error: "Missing npub in path" }, {}, requestOrigin);
  }

  if (!isValidNpub(npub)) {
    return jsonResponse(400, { error: "Invalid npub format" }, {}, requestOrigin);
  }

  return handleGetAnalytics(npub, requestOrigin);
});
