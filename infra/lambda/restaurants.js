import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";

const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const restaurantsTable = process.env.RESTAURANTS_TABLE || "synvya-restaurants";

function jsonResponse(statusCode, body, headers = {}, requestOrigin = null) {
  const corsHeaders = {
    "Access-Control-Allow-Origin": requestOrigin || process.env.CORS_ALLOW_ORIGIN || "*",
    "Access-Control-Allow-Methods": "OPTIONS,GET,POST,PUT,DELETE",
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
    "Content-Type": "application/json",
    ...headers
  };

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
      console.error("Restaurant API error:", error);
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

async function handleRegister(event, requestOrigin = null) {
  if (event.requestContext?.http?.method !== "POST") {
    return jsonResponse(405, { error: "Method not allowed" }, {}, requestOrigin);
  }

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch (error) {
    return jsonResponse(400, { error: "Invalid JSON body" }, {}, requestOrigin);
  }

  const { npub, signup_timestamp } = body;

  if (!npub || typeof npub !== "string") {
    return jsonResponse(400, { error: "npub is required and must be a string" }, {}, requestOrigin);
  }

  if (!signup_timestamp || typeof signup_timestamp !== "number") {
    return jsonResponse(400, { error: "signup_timestamp is required and must be a number" }, {}, requestOrigin);
  }

  // Calculate signup_date as ISO date string (YYYY-MM-DD)
  const signupDate = new Date(signup_timestamp * 1000).toISOString().split("T")[0];
  const lastUpdated = new Date().toISOString();

  // Check if restaurant already exists
  try {
    const existing = await dynamo.send(
      new GetCommand({
        TableName: restaurantsTable,
        Key: { npub }
      })
    );

    if (existing.Item) {
      // Restaurant already registered, return success
      return jsonResponse(200, { 
        message: "Restaurant already registered",
        npub,
        signup_date: existing.Item.signup_date
      }, {}, requestOrigin);
    }
  } catch (error) {
    console.error("Error checking existing restaurant:", error);
    // Continue to create new record
  }

  // Create new restaurant record
  const item = {
    npub,
    signup_date: signupDate,
    signup_timestamp,
    reservations_by_month: {},
    last_updated: lastUpdated
  };

  try {
    await dynamo.send(
      new PutCommand({
        TableName: restaurantsTable,
        Item: item
      })
    );

    return jsonResponse(200, {
      message: "Restaurant registered successfully",
      npub,
      signup_date: signupDate
    }, {}, requestOrigin);
  } catch (error) {
    console.error("Error creating restaurant record:", error);
    throw error;
  }
}

async function handleReservation(event, requestOrigin = null) {
  if (event.requestContext?.http?.method !== "POST") {
    return jsonResponse(405, { error: "Method not allowed" }, {}, requestOrigin);
  }

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch (error) {
    return jsonResponse(400, { error: "Invalid JSON body" }, {}, requestOrigin);
  }

  const { npub, root_rumor_id, reservation_timestamp, month } = body;

  if (!npub || typeof npub !== "string") {
    return jsonResponse(400, { error: "npub is required and must be a string" }, {}, requestOrigin);
  }

  if (!month || typeof month !== "string" || !/^\d{4}-\d{2}$/.test(month)) {
    return jsonResponse(400, { error: "month is required and must be in YYYY-MM format" }, {}, requestOrigin);
  }

  // Validate month format
  const monthKey = month;

  // Use atomic increment to update the count
  const updateExpression = "SET reservations_by_month.#month.confirmed = if_not_exists(reservations_by_month.#month.confirmed, :zero) + :one, last_updated = :now";
  const expressionAttributeNames = {
    "#month": monthKey
  };
  const expressionAttributeValues = {
    ":zero": 0,
    ":one": 1,
    ":now": new Date().toISOString()
  };

  try {
    // First, ensure the restaurant record exists (create if it doesn't)
    const existing = await dynamo.send(
      new GetCommand({
        TableName: restaurantsTable,
        Key: { npub }
      })
    );

    if (!existing.Item) {
      // Restaurant doesn't exist, create it with current timestamp as signup
      const now = Math.floor(Date.now() / 1000);
      const signupDate = new Date().toISOString().split("T")[0];
      await dynamo.send(
        new PutCommand({
          TableName: restaurantsTable,
          Item: {
            npub,
            signup_date: signupDate,
            signup_timestamp: now,
            reservations_by_month: {
              [monthKey]: { confirmed: 1 }
            },
            last_updated: new Date().toISOString()
          }
        })
      );
    } else {
      // Update existing record with atomic increment
      await dynamo.send(
        new UpdateCommand({
          TableName: restaurantsTable,
          Key: { npub },
          UpdateExpression: updateExpression,
          ExpressionAttributeNames: expressionAttributeNames,
          ExpressionAttributeValues: expressionAttributeValues
        })
      );
    }

    return jsonResponse(200, {
      message: "Reservation tracked successfully",
      npub,
      month: monthKey
    }, {}, requestOrigin);
  } catch (error) {
    console.error("Error tracking reservation:", error);
    throw error;
  }
}

export const handler = withErrorHandling(async (event) => {
  console.log("=== Restaurant API handler called ===", JSON.stringify({
    path: event.requestContext?.http?.path,
    method: event.requestContext?.http?.method,
    timestamp: new Date().toISOString()
  }, null, 2));

  const requestOrigin = event.headers?.["origin"] || event.headers?.["Origin"] || null;

  if (event.requestContext?.http?.method === "OPTIONS") {
    return jsonResponse(200, { ok: true }, {}, requestOrigin);
  }

  const path = event.requestContext?.http?.path || "";

  if (path.endsWith("/api/restaurants/register")) {
    return handleRegister(event, requestOrigin);
  }

  if (path.endsWith("/api/restaurants/reservations")) {
    return handleReservation(event, requestOrigin);
  }

  return jsonResponse(404, { error: "Not found" }, {}, requestOrigin);
});

