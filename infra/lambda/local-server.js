/**
 * Local test server that wraps Lambda handlers for local development.
 * Usage: node local-server.js
 *
 * Starts an HTTP server on port 3001 that routes requests to Lambda handlers.
 * NOT for production use — development and testing only.
 */

import http from "node:http";

// Import Lambda handlers
import { handler as customersHandler } from "./customers.js";
import { handler as billingHandler } from "./billing.js";

const PORT = 3001;

function lambdaEventFromRequest(req, body) {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  return {
    requestContext: {
      http: {
        method: req.method,
        path: url.pathname
      }
    },
    headers: {
      ...req.headers,
      origin: req.headers.origin || "http://localhost:5173"
    },
    body: body || null,
    isBase64Encoded: false
  };
}

function routeToHandler(path) {
  if (path.startsWith("/api/customers")) return customersHandler;
  if (path.startsWith("/billing") || path.startsWith("/webhooks/stripe")) return billingHandler;
  return null;
}

const server = http.createServer(async (req, res) => {
  // Collect body
  let body = "";
  for await (const chunk of req) {
    body += chunk;
  }

  const url = new URL(req.url, `http://localhost:${PORT}`);
  console.log(`${req.method} ${url.pathname}`);

  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    res.writeHead(200, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "OPTIONS,GET,POST,PUT,DELETE",
      "Access-Control-Allow-Headers": "Content-Type,Authorization,stripe-signature"
    });
    res.end();
    return;
  }

  const handler = routeToHandler(url.pathname);
  if (!handler) {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
    return;
  }

  try {
    const event = lambdaEventFromRequest(req, body || null);
    const result = await handler(event);

    const headers = result.headers || {};
    // Override CORS for local dev
    headers["Access-Control-Allow-Origin"] = "*";

    res.writeHead(result.statusCode, headers);
    res.end(result.body);
  } catch (err) {
    console.error("Handler error:", err);
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: err.message }));
  }
});

server.listen(PORT, () => {
  console.log(`\nLocal Lambda server running at http://localhost:${PORT}`);
  console.log("Routes:");
  console.log("  GET  /api/customers/status/{npub}");
  console.log("  POST /api/customers/register");
  console.log("  POST /api/customers/reservations");
  console.log("  POST /billing/create-checkout-session");
  console.log("  POST /billing/create-portal-session");
  console.log("  POST /webhooks/stripe");
  console.log("");
});
