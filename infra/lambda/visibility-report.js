/**
 * Lambda handler for AI Visibility Report.
 *
 * Routes:
 *   POST /visibility/search           → Search Google Places for candidates
 *   POST /visibility/jobs             → Create report job (with optional place_id from search)
 *   GET  /visibility/jobs/{id}        → Poll job status/progress
 *   GET  /visibility/reports/{id}     → Get completed report
 *
 * Follows existing patterns from customers.js / billing.js.
 */

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, PutCommand, ScanCommand } from "@aws-sdk/lib-dynamodb";
import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";
import { randomUUID } from "node:crypto";
import { buildCacheKey, buildBusinessKey, searchGooglePlaces } from "./business-normalize.js";
import { PROMPT_SET_VERSION } from "./prompt-library.js";
import { getDefaultModel } from "./model-adapters.js";
import { runReportPipeline } from "./report-engine.js";
import { storeLead, markLeadEmailSent, sendReportEmail, markEmailUnsubscribed, markEmailBounced, deleteEmailRecords } from "./email-sender.js";

const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const lambdaClient = new LambdaClient({});

const jobsTable = process.env.JOBS_TABLE || "visibility-report-jobs";
const resultsTable = process.env.RESULTS_TABLE || "visibility-report-results";
const cacheTable = process.env.CACHE_TABLE || "visibility-cache";
const functionName = process.env.AWS_LAMBDA_FUNCTION_NAME; // self-invoke for async

const MAX_NAME_LENGTH = 200;
const MAX_REPORTS_PER_IP_PER_HOUR = 5;

// --- CORS & Response helpers (same pattern as customers.js) ---

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
    "Access-Control-Allow-Methods": "OPTIONS,GET,POST",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
    ...headers,
  };
  if (corsOrigin !== null) {
    corsHeaders["Access-Control-Allow-Origin"] = corsOrigin;
  }
  return { statusCode, headers: corsHeaders, body: JSON.stringify(body) };
}

function withErrorHandling(handler) {
  return async (event) => {
    try {
      return await handler(event);
    } catch (error) {
      console.error("Visibility Report API error:", error);
      const requestOrigin = event.headers?.["origin"] || event.headers?.["Origin"] || null;
      return jsonResponse(500, { error: "Internal server error", message: error.message }, {}, requestOrigin);
    }
  };
}

// --- Input validation ---

function sanitizeString(str, maxLength = MAX_NAME_LENGTH) {
  if (!str || typeof str !== "string") return null;
  return str.replace(/<[^>]*>/g, "").trim().slice(0, maxLength);
}

// --- Rate limiting ---

async function checkIpRateLimit(ip) {
  if (!ip) return true;

  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();

  const result = await dynamo.send(new ScanCommand({
    TableName: jobsTable,
    FilterExpression: "requester_ip = :ip AND created_at > :since",
    ExpressionAttributeValues: {
      ":ip": ip,
      ":since": oneHourAgo,
    },
    Select: "COUNT",
  }));

  return (result.Count || 0) < MAX_REPORTS_PER_IP_PER_HOUR;
}

// --- Route handlers ---

/**
 * POST /visibility/search
 * Search Google Places for business candidates.
 * Returns a list for the user to select from.
 */
async function handleSearch(event, requestOrigin) {
  if (event.requestContext?.http?.method !== "POST") {
    return jsonResponse(405, { error: "Method not allowed" }, {}, requestOrigin);
  }

  let body;
  try {
    const rawBody = event.isBase64Encoded
      ? Buffer.from(event.body, "base64").toString("utf8")
      : event.body;
    body = JSON.parse(rawBody || "{}");
  } catch {
    return jsonResponse(400, { error: "Invalid JSON body" }, {}, requestOrigin);
  }

  const businessName = sanitizeString(body.business_name);
  const city = sanitizeString(body.city);
  if (!businessName) {
    return jsonResponse(400, { error: "business_name is required" }, {}, requestOrigin);
  }
  if (!city) {
    return jsonResponse(400, { error: "city is required" }, {}, requestOrigin);
  }

  const candidates = await searchGooglePlaces(businessName, city);

  return jsonResponse(200, { candidates }, {}, requestOrigin);
}

/**
 * POST /visibility/jobs
 * Create a report job. Accepts either:
 *   - place_id + ground_truth (from search selection)
 *   - business_name + city only (skip without Google match)
 */
async function handleCreateJob(event, requestOrigin) {
  if (event.requestContext?.http?.method !== "POST") {
    return jsonResponse(405, { error: "Method not allowed" }, {}, requestOrigin);
  }

  let body;
  try {
    const rawBody = event.isBase64Encoded
      ? Buffer.from(event.body, "base64").toString("utf8")
      : event.body;
    body = JSON.parse(rawBody || "{}");
  } catch {
    return jsonResponse(400, { error: "Invalid JSON body" }, {}, requestOrigin);
  }

  // Validate required fields
  const businessName = sanitizeString(body.business_name);
  const city = sanitizeString(body.city);
  if (!businessName) {
    return jsonResponse(400, { error: "business_name is required" }, {}, requestOrigin);
  }
  if (!city) {
    return jsonResponse(400, { error: "city is required" }, {}, requestOrigin);
  }

  const email = sanitizeString(body.email, 254) || null;
  const neighborhood = sanitizeString(body.neighborhood) || null;
  const website = sanitizeString(body.website) || null;
  const reportType = body.report_type === "full" ? "full" : "mini";

  // Google Places resolved data (optional — from search step)
  const placeId = sanitizeString(body.place_id) || null;
  const groundTruth = body.ground_truth || null;

  // Check cache — one report per bakery per 30 days
  const modelVersion = getDefaultModel("openai");
  const cacheKey = buildCacheKey({
    placeId,
    businessName,
    city,
    reportType,
    promptSetVersion: PROMPT_SET_VERSION,
    modelVersion,
  });

  const cacheResult = await dynamo.send(new GetCommand({
    TableName: cacheTable,
    Key: { cache_key: cacheKey },
  }));

  if (cacheResult.Item) {
    const cachedResultId = cacheResult.Item.result_id;

    // Fetch the cached report for score and created_at
    let reportCreatedAt = null;
    let overallScore = null;
    try {
      const cachedReport = await dynamo.send(new GetCommand({
        TableName: resultsTable,
        Key: { result_id: cachedResultId },
      }));
      overallScore = cachedReport.Item?.overall_score ?? null;
      reportCreatedAt = cachedReport.Item?.created_at ?? null;
    } catch { /* non-critical */ }

    // Send email and store lead for cache-hit path
    if (email) {
      try {
        const leadCreatedAt = await storeLead({
          email, businessName, city, neighborhood, website,
          placeId, jobId: null, resultId: cachedResultId,
        });
        await sendReportEmail({ email, businessName, city, resultId: cachedResultId, overallScore });
        await markLeadEmailSent(email, leadCreatedAt, cachedResultId);
      } catch (emailErr) {
        console.error("Failed to send email for cached report:", emailErr);
        // Don't fail the request — the report still exists
      }
    }

    return jsonResponse(200, {
      job_id: null,
      status: "completed",
      result_id: cachedResultId,
      cached: true,
      report_created_at: reportCreatedAt,
    }, {}, requestOrigin);
  }

  // Check IP rate limit
  const requesterIp = event.requestContext?.http?.sourceIp || event.headers?.["x-forwarded-for"]?.split(",")[0]?.trim() || null;
  const withinLimit = await checkIpRateLimit(requesterIp);
  if (!withinLimit) {
    return jsonResponse(429, { error: "Rate limit exceeded. Please try again later." }, {}, requestOrigin);
  }

  // Create job
  const jobId = randomUUID();
  const now = new Date().toISOString();
  const ttl90Days = Math.floor(Date.now() / 1000) + 90 * 24 * 60 * 60;

  const jobItem = {
    job_id: jobId,
    status: "pending",
    step: "Initializing...",
    step_index: 0,
    total_steps: 5,
    business_name: businessName,
    city,
    neighborhood,
    website: website || groundTruth?.website || null,
    email: email || null,
    place_id: placeId,
    ground_truth: groundTruth || null,
    normalized_key: buildBusinessKey(placeId, businessName, city),
    report_type: reportType,
    result_id: null,
    error_message: null,
    requester_ip: requesterIp,
    created_at: now,
    updated_at: now,
    ttl: ttl90Days,
  };

  await dynamo.send(new PutCommand({
    TableName: jobsTable,
    Item: jobItem,
  }));

  // Invoke self asynchronously to run the pipeline
  if (functionName) {
    await lambdaClient.send(new InvokeCommand({
      FunctionName: functionName,
      InvocationType: "Event",
      Payload: JSON.stringify({ _pipeline: true, job_id: jobId }),
    }));
  }

  return jsonResponse(202, {
    job_id: jobId,
    status: "pending",
    step: "Initializing...",
  }, {}, requestOrigin);
}

async function handleGetJob(event, requestOrigin) {
  if (event.requestContext?.http?.method !== "GET") {
    return jsonResponse(405, { error: "Method not allowed" }, {}, requestOrigin);
  }

  const path = event.requestContext?.http?.path || "";
  const jobId = path.split("/").pop();

  if (!jobId || jobId.length < 10) {
    return jsonResponse(400, { error: "Invalid job ID" }, {}, requestOrigin);
  }

  const result = await dynamo.send(new GetCommand({
    TableName: jobsTable,
    Key: { job_id: jobId },
  }));

  if (!result.Item) {
    return jsonResponse(404, { error: "Job not found" }, {}, requestOrigin);
  }

  const job = result.Item;
  const response = {
    job_id: job.job_id,
    status: job.status,
    step: job.step,
    step_index: job.step_index,
    total_steps: job.total_steps,
  };

  if (job.status === "completed") {
    response.result_id = job.result_id;
  }
  if (job.status === "failed") {
    response.error_message = "Unable to complete report. Please try again later.";
  }

  return jsonResponse(200, response, {}, requestOrigin);
}

async function handleGetReport(event, requestOrigin) {
  if (event.requestContext?.http?.method !== "GET") {
    return jsonResponse(405, { error: "Method not allowed" }, {}, requestOrigin);
  }

  const path = event.requestContext?.http?.path || "";
  const resultId = path.split("/").pop();

  if (!resultId || resultId.length < 10) {
    return jsonResponse(400, { error: "Invalid result ID" }, {}, requestOrigin);
  }

  const result = await dynamo.send(new GetCommand({
    TableName: resultsTable,
    Key: { result_id: resultId },
  }));

  if (!result.Item) {
    return jsonResponse(404, { error: "Report not found" }, {}, requestOrigin);
  }

  const report = result.Item;
  const { ttl, cache_key, job_id, ...publicReport } = report;

  return jsonResponse(200, publicReport, {}, requestOrigin);
}

/**
 * GET /visibility/unsubscribe?email=...
 * Marks the email as unsubscribed (30-day TTL for deletion).
 * Returns a simple HTML confirmation page.
 */
async function handleUnsubscribe(event, requestOrigin) {
  const email = event.queryStringParameters?.email;
  if (!email) {
    return jsonResponse(400, { error: "email parameter is required" }, {}, requestOrigin);
  }

  try {
    await markEmailUnsubscribed(email);
  } catch (err) {
    console.error("Unsubscribe error:", err);
  }

  // Return a simple HTML page regardless (don't leak whether the email existed)
  return {
    statusCode: 200,
    headers: { "Content-Type": "text/html" },
    body: `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Unsubscribed - Synvya</title></head>
<body style="margin:0;padding:48px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;text-align:center;background:#f8fafc;">
<div style="max-width:400px;margin:0 auto;background:#fff;padding:32px;border-radius:8px;border:1px solid #e2e8f0;">
<h1 style="font-size:20px;color:#0f172a;margin:0 0 12px;">You've been unsubscribed</h1>
<p style="font-size:14px;color:#64748b;line-height:1.5;">You will no longer receive emails from Synvya. If this was a mistake, contact us at <a href="mailto:synvya@synvya.com" style="color:#2d8659;">synvya@synvya.com</a>.</p>
</div>
</body></html>`,
  };
}

/**
 * Handle SES bounce/complaint notifications via SNS.
 * Expected to be invoked directly by SNS (not via API Gateway).
 *
 * Bounces → mark as "bounced" (30-day TTL)
 * Complaints → delete immediately (human follow-up via CloudWatch logs)
 */
async function handleSnsNotification(event) {
  for (const record of event.Records || []) {
    let message;
    try {
      message = JSON.parse(record.Sns?.Message || "{}");
    } catch {
      console.error("Failed to parse SNS message:", record.Sns?.Message);
      continue;
    }

    const notificationType = message.notificationType;

    if (notificationType === "Bounce") {
      const bounce = message.bounce;
      const recipients = bounce?.bouncedRecipients || [];
      for (const recipient of recipients) {
        const email = recipient.emailAddress;
        if (email) {
          console.log(`Processing bounce for: ${email}, type: ${bounce.bounceType}`);
          await markEmailBounced(email);
        }
      }
    } else if (notificationType === "Complaint") {
      const complaint = message.complaint;
      const recipients = complaint?.complainedRecipients || [];
      for (const recipient of recipients) {
        const email = recipient.emailAddress;
        if (email) {
          console.log(`Processing complaint for: ${email} — deleting immediately, requires human follow-up`);
          await deleteEmailRecords(email);
        }
      }
    } else {
      console.log(`Ignoring SNS notification type: ${notificationType}`);
    }
  }
}

// --- Main handler ---

export const handler = withErrorHandling(async (event) => {
  // Handle SNS notifications (bounces/complaints from SES)
  if (event.Records && event.Records[0]?.EventSource === "aws:sns") {
    await handleSnsNotification(event);
    return;
  }

  // Handle async pipeline invocation (self-invoked)
  if (event._pipeline && event.job_id) {
    console.log("Running report pipeline for job:", event.job_id);
    await runReportPipeline(event.job_id);
    return;
  }

  console.log("Visibility Report handler called", {
    path: event.requestContext?.http?.path,
    method: event.requestContext?.http?.method,
    timestamp: new Date().toISOString(),
  });

  const requestOrigin = event.headers?.["origin"] || event.headers?.["Origin"] || null;

  // Handle preflight
  if (event.requestContext?.http?.method === "OPTIONS") {
    return jsonResponse(204, null, {}, requestOrigin);
  }

  const path = event.requestContext?.http?.path || "";

  // Route: POST /visibility/search
  if (path.endsWith("/visibility/search") || path.endsWith("/visibility/search/")) {
    return handleSearch(event, requestOrigin);
  }

  // Route: POST /visibility/jobs
  if (path.endsWith("/visibility/jobs") || path.endsWith("/visibility/jobs/")) {
    return handleCreateJob(event, requestOrigin);
  }

  // Route: GET /visibility/jobs/{id}
  if (path.includes("/visibility/jobs/")) {
    return handleGetJob(event, requestOrigin);
  }

  // Route: GET /visibility/reports/{id}
  if (path.includes("/visibility/reports/")) {
    return handleGetReport(event, requestOrigin);
  }

  // Route: GET /visibility/unsubscribe?email=...
  if (path.includes("/visibility/unsubscribe")) {
    return handleUnsubscribe(event, requestOrigin);
  }

  return jsonResponse(404, { error: "Not found" }, {}, requestOrigin);
});
