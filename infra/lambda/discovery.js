/**
 * Discovery page publish Lambda - triggers GitHub workflow to publish pages to synvya.com
 * @version 1.0.0
 */
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";

const secretsClient = new SecretsManagerClient({});

const GITHUB_REPO_OWNER = "Synvya";
const GITHUB_REPO_NAME = "website";
const GITHUB_WORKFLOW_FILE = "publish-discovery.yml";
const DEFAULT_CORS_ORIGIN = "*";
const DEFAULT_SECRET_KEY = "github-token";

let cachedToken = null;

/**
 * Retrieves the GitHub token from AWS Secrets Manager.
 */
async function getGitHubToken() {
  if (cachedToken) {
    return cachedToken;
  }

  const secretArn = process.env.GITHUB_TOKEN_SECRET_ARN;
  const secretKey = process.env.GITHUB_TOKEN_SECRET_KEY || DEFAULT_SECRET_KEY;

  if (!secretArn) {
    throw new Error("GITHUB_TOKEN_SECRET_ARN environment variable is not set");
  }

  const command = new GetSecretValueCommand({ SecretId: secretArn });
  const result = await secretsClient.send(command);

  let secretString = result.SecretString;
  if (!secretString && result.SecretBinary) {
    secretString = Buffer.from(result.SecretBinary, "base64").toString("utf8");
  }

  if (!secretString) {
    throw new Error("Secret manager response did not include a secret value");
  }

  let parsed;
  try {
    parsed = JSON.parse(secretString);
  } catch {
    parsed = secretString;
  }

  const value = typeof parsed === "string" ? parsed : parsed?.[secretKey];
  if (!value || typeof value !== "string") {
    throw new Error(`Secret value missing for key "${secretKey}"`);
  }

  cachedToken = value.trim();
  return cachedToken;
}

/**
 * Validates a slug to prevent path traversal attacks.
 * Returns true if valid, false otherwise.
 */
function isValidSlug(slug) {
  if (!slug || typeof slug !== "string") {
    return false;
  }
  // Slug must be non-empty, contain only safe characters, and not contain path traversal
  const safePattern = /^[a-z0-9][a-z0-9_-]*$/i;
  if (!safePattern.test(slug)) {
    return false;
  }
  // Explicitly check for path traversal patterns
  if (slug.includes("..") || slug.includes("/") || slug.includes("\\")) {
    return false;
  }
  return true;
}

/**
 * Builds CORS headers for the response.
 */
function buildCorsHeaders(originOverride) {
  const allowOrigin = originOverride || process.env.CORS_ALLOW_ORIGIN || DEFAULT_CORS_ORIGIN;
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "OPTIONS,POST",
    "Access-Control-Allow-Headers": "Content-Type,Authorization"
  };
}

/**
 * Triggers the publish-discovery workflow in the website repo.
 */
async function triggerWorkflow(token, typeSlug, nameSlug, htmlBase64) {
  const url = `https://api.github.com/repos/${GITHUB_REPO_OWNER}/${GITHUB_REPO_NAME}/actions/workflows/${GITHUB_WORKFLOW_FILE}/dispatches`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github.v3+json",
      "Content-Type": "application/json",
      "User-Agent": "Synvya-Discovery-Lambda"
    },
    body: JSON.stringify({
      ref: "main",
      inputs: {
        type_slug: typeSlug,
        name_slug: nameSlug,
        html_content: htmlBase64
      }
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`GitHub API error (${response.status}): ${errorText}`);
  }

  // GitHub returns 204 No Content on success
  return true;
}

/**
 * Lambda handler for publishing discovery pages.
 */
export const handler = async (event) => {
  const corsHeaders = buildCorsHeaders(event?.headers?.origin || event?.headers?.Origin);

  // Handle preflight OPTIONS request
  if (event?.requestContext?.http?.method === "OPTIONS") {
    return {
      statusCode: 204,
      headers: corsHeaders
    };
  }

  // Validate request method
  if (event?.requestContext?.http?.method !== "POST") {
    return {
      statusCode: 405,
      headers: corsHeaders,
      body: JSON.stringify({ error: "Method not allowed" })
    };
  }

  // Parse request body
  if (!event?.body) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ error: "Missing request body" })
    };
  }

  let body;
  try {
    const rawBody = event.isBase64Encoded
      ? Buffer.from(event.body, "base64").toString("utf8")
      : event.body;
    body = JSON.parse(rawBody);
  } catch {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ error: "Invalid JSON in request body" })
    };
  }

  const { typeSlug, nameSlug, html } = body;

  // Validate required fields (check for undefined/null, not falsy - empty string checked separately)
  if (typeSlug === undefined || typeSlug === null || 
      nameSlug === undefined || nameSlug === null || 
      html === undefined || html === null) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ error: "Missing required fields: typeSlug, nameSlug, html" })
    };
  }

  // Validate slugs to prevent path traversal
  if (!isValidSlug(typeSlug)) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ error: "Invalid typeSlug format" })
    };
  }

  if (!isValidSlug(nameSlug)) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ error: "Invalid nameSlug format" })
    };
  }

  // Validate HTML is a non-empty string
  if (typeof html !== "string" || html.trim().length === 0) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ error: "html must be a non-empty string" })
    };
  }

  try {
    // Get GitHub token from Secrets Manager
    const token = await getGitHubToken();

    // Base64 encode the HTML for workflow dispatch input
    const htmlBase64 = Buffer.from(html).toString("base64");

    // Trigger the workflow
    await triggerWorkflow(token, typeSlug, nameSlug, htmlBase64);

    // Return success response with the published URL
    const publishedUrl = `https://synvya.com/${typeSlug}/${nameSlug}/`;

    return {
      statusCode: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        published: true,
        url: publishedUrl
      })
    };
  } catch (error) {
    console.error("Discovery publish error:", error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: "Failed to publish discovery page" })
    };
  }
};

// Export for testing
export { isValidSlug, buildCorsHeaders, getGitHubToken, triggerWorkflow };
