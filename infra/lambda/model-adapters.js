/**
 * LLM model adapters — abstraction layer so Claude/Gemini can plug in later.
 * Phase 1: OpenAI Responses API with web search.
 */

import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";

const secretsClient = new SecretsManagerClient({});

const DEFAULT_MODEL = process.env.OPENAI_MODEL || "gpt-4o";
const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
let cachedApiKey = null;

async function getOpenAIKey() {
  if (cachedApiKey) return cachedApiKey;

  const secretArn = process.env.OPENAI_SECRET_ARN;
  const secretKey = process.env.OPENAI_SECRET_KEY || "openai-api-key";

  if (!secretArn) {
    throw new Error("OPENAI_SECRET_ARN environment variable is not set");
  }

  const result = await secretsClient.send(
    new GetSecretValueCommand({ SecretId: secretArn })
  );

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

  cachedApiKey = value.trim();
  return cachedApiKey;
}

/**
 * Call OpenAI Responses API with structured output and web search.
 *
 * @param {string} systemPrompt - Instructions (developer role)
 * @param {string} userPrompt - User message (the actual question)
 * @param {object} responseSchema - JSON schema for structured output
 * @param {object} [options] - Optional overrides
 * @returns {{ parsed: object, model: string, latencyMs: number }}
 */
async function callOpenAI(systemPrompt, userPrompt, responseSchema, options = {}) {
  const apiKey = await getOpenAIKey();
  const model = options.model || DEFAULT_MODEL;
  const startTime = Date.now();

  const body = {
    model,
    instructions: systemPrompt,
    input: userPrompt,
    text: {
      format: {
        type: "json_schema",
        ...responseSchema,
      },
    },
  };

  // Enable web search unless explicitly disabled (e.g. for judge calls)
  if (options.webSearch !== false) {
    body.tools = [{ type: "web_search" }];
  }

  const response = await fetchWithRetry(OPENAI_RESPONSES_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  const latencyMs = Date.now() - startTime;

  if (!response.ok) {
    const errorText = await response.text().catch(() => "unknown error");
    throw new Error(`OpenAI API error (${response.status}): ${errorText.slice(0, 500)}`);
  }

  const data = await response.json();

  // Responses API: find the output_text in the output array
  const outputText = data.output_text
    || data.output?.find((o) => o.type === "message")?.content?.find((c) => c.type === "output_text")?.text;

  if (!outputText) {
    throw new Error("OpenAI returned no content in response");
  }

  let parsed;
  try {
    parsed = JSON.parse(outputText);
  } catch {
    throw new Error("OpenAI returned invalid JSON in structured output");
  }

  return { parsed, model, latencyMs };
}

async function fetchWithRetry(url, options, maxRetries = 2) {
  let lastError;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(url, options);
      if (response.ok || attempt === maxRetries) return response;
      if (![429, 502, 503].includes(response.status)) return response;
      const delay = Math.pow(2, attempt) * 2000;
      console.warn(`OpenAI retry after ${response.status} (attempt ${attempt + 1}/${maxRetries})`);
      await new Promise((r) => setTimeout(r, delay));
    } catch (error) {
      lastError = error;
      if (attempt === maxRetries) throw lastError;
      const delay = Math.pow(2, attempt) * 2000;
      console.warn(`OpenAI network error, retrying (attempt ${attempt + 1}/${maxRetries}):`, error.message);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
}

// === Adapter interface ===

/**
 * Model adapter registry. Each adapter implements:
 *   call(systemPrompt, userPrompt, responseSchema, options) → { parsed, model, latencyMs }
 */
const adapters = {
  openai: { call: callOpenAI, defaultModel: DEFAULT_MODEL, provider: "openai" },
  // Future:
  // anthropic: { call: callAnthropic, defaultModel: "claude-sonnet-4-20250514", provider: "anthropic" },
  // google: { call: callGemini, defaultModel: "gemini-2.0-flash", provider: "google" },
};

/**
 * Get a model adapter by provider name.
 */
export function getAdapter(provider = "openai") {
  const adapter = adapters[provider];
  if (!adapter) {
    throw new Error(`Unknown model provider: ${provider}`);
  }
  return adapter;
}

/**
 * Get the default model ID for a provider.
 */
export function getDefaultModel(provider = "openai") {
  return getAdapter(provider).defaultModel;
}
