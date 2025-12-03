import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
import { createHash } from "node:crypto";
import { finalizeEvent, nip19 } from "nostr-tools";

const secretsClient = new SecretsManagerClient({});

const DEFAULT_UPLOAD_URL = "https://nostr.build/api/v2/upload";
const DEFAULT_SECRET_KEY = "synvya-nsec";
const DEFAULT_CORS_ORIGIN = "*";
const WELL_KNOWN_PATH = "/.well-known/nostr/nip96.json";

const REMOTE_ORIGIN = new URL(DEFAULT_UPLOAD_URL).origin;

let cachedSecret = null;
let cachedConfigPromise = null;

async function getUploadSecret() {
  if (cachedSecret) {
    return cachedSecret;
  }

  const secretId = process.env.UPLOAD_SECRET_ARN;
  const secretKey = process.env.UPLOAD_SECRET_KEY || DEFAULT_SECRET_KEY;

  if (!secretId) {
    throw new Error("UPLOAD_SECRET_ARN environment variable is not set");
  }

  const command = new GetSecretValueCommand({ SecretId: secretId });
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

  cachedSecret = value.trim();
  return cachedSecret;
}

function decodeNsec(secret) {
  const decoded = nip19.decode(secret);
  if (decoded.type !== "nsec") {
    throw new Error("Secret from Secrets Manager is not an nsec");
  }
  return decoded.data;
}

function toAbsoluteUrl(path, apiBase) {
  try {
    if (/^https?:/i.test(path)) {
      return path;
    }
    const base = apiBase || DEFAULT_UPLOAD_URL;
    return new URL(path, base).toString();
  } catch (error) {
    console.warn("Failed to resolve upload endpoint", path, error);
    return new URL(path, DEFAULT_UPLOAD_URL).toString();
  }
}

function createTarget(url, methods) {
  return {
    requestUrl: url,
    signingUrl: url,
    methods
  };
}

function buildFallbackTargets() {
  const fallbackMethods = ["POST", "PUT"];
  const urls = [
    DEFAULT_UPLOAD_URL,
    `${DEFAULT_UPLOAD_URL}/`,
    "https://nostr.build/api/v2/upload/files",
    "https://nostr.build/api/v2/media",
    "https://nostr.build/api/v2/media/upload"
  ];

  const targets = [];
  const seen = new Set();
  for (const url of urls) {
    if (!seen.has(url)) {
      seen.add(url);
      targets.push(createTarget(url, fallbackMethods));
    }
  }
  return targets;
}

function normalizeMethods(value) {
  if (Array.isArray(value)) {
    const normalized = value
      .filter((item) => typeof item === "string")
      .map((item) => item.toUpperCase())
      .filter((item) => item === "POST" || item === "PUT");
    return normalized.length ? normalized : undefined;
  }

  if (typeof value === "string") {
    const upper = value.toUpperCase();
    if (upper === "POST" || upper === "PUT") {
      return [upper];
    }
  }

  return undefined;
}

function looksLikeEndpointValue(value) {
  if (!value || typeof value !== "string") return false;
  const lowered = value.toLowerCase();
  if (lowered.includes(".well-known/nostr/nip96")) {
    return false;
  }
  const isUrl = /^https?:/.test(value) || value.startsWith("/");
  if (!isUrl) return false;
  return (
    lowered.includes("/api/") ||
    lowered.includes("nip96") ||
    lowered.includes("/upload") ||
    lowered.endsWith("/upload")
  );
}

function traverseConfig(node, apiBase, inheritedMethods, collector) {
  if (!node) return;

  if (Array.isArray(node)) {
    const methodsFromArray = normalizeMethods(node) || inheritedMethods;
    for (const item of node) {
      if (typeof item === "string") {
        if (looksLikeEndpointValue(item)) {
          const absolute = toAbsoluteUrl(item, apiBase);
          const entry = collector.get(absolute) || new Set();
          const toAdd = methodsFromArray && methodsFromArray.length ? methodsFromArray : ["POST"];
          for (const method of toAdd) entry.add(method);
          collector.set(absolute, entry);
        }
      } else if (item && typeof item === "object") {
        traverseConfig(item, apiBase, methodsFromArray, collector);
      }
    }
    return;
  }
  if (typeof node !== "object") {
    return;
  }

  const obj = node;

  let localApiBase = apiBase;
  for (const [key, value] of Object.entries(obj)) {
    const lower = key.toLowerCase();
    if (/api_url|base_url/.test(lower) && typeof value === "string") {
      localApiBase = value;
    }
  }

  let methodsForThis = inheritedMethods;
  for (const [key, value] of Object.entries(obj)) {
    const lower = key.toLowerCase();
    if (lower.includes("method")) {
      const candidate = normalizeMethods(value);
      if (candidate && candidate.length) {
        methodsForThis = candidate;
        break;
      }
    }
  }

  for (const [key, value] of Object.entries(obj)) {
    const lower = key.toLowerCase();
    if (typeof value === "string") {
      if (looksLikeEndpointValue(value)) {
        const absolute = toAbsoluteUrl(value, localApiBase);
        const entry = collector.get(absolute) || new Set();
        const toAdd = methodsForThis && methodsForThis.length ? methodsForThis : ["POST"];
        for (const method of toAdd) entry.add(method);
        collector.set(absolute, entry);
      }
    } else if (Array.isArray(value)) {
      traverseConfig(value, localApiBase, methodsForThis, collector);
    } else if (value && typeof value === "object") {
      traverseConfig(value, localApiBase, methodsForThis, collector);
    }
  }
}

async function fetchUploadConfig() {
  const baseUrl = process.env.UPLOAD_TARGET_URL || DEFAULT_UPLOAD_URL;
  const origin = new URL(baseUrl).origin;
  const wellKnownUrl = `${origin}${WELL_KNOWN_PATH}`;

  const response = await fetch(wellKnownUrl, {
    headers: {
      Accept: "application/json"
    }
  });

  if (!response.ok) {
    throw new Error(`Failed to load NIP-96 config (${response.status})`);
  }

  const raw = await response.json();
  const collector = new Map();
  traverseConfig(raw, null, undefined, collector);

  const targets = [];
  for (const [url, methodsSet] of collector.entries()) {
    const methods = Array.from(methodsSet.values());
    targets.push(createTarget(url, methods.length ? methods : ["POST"]));
  }

  if (!targets.length) {
    return buildFallbackTargets();
  }

  return targets;
}

async function getUploadTargets() {
  if (!cachedConfigPromise) {
    cachedConfigPromise = (async () => {
      try {
        return await fetchUploadConfig();
      } catch (error) {
        console.warn("Falling back to static nostr.build upload targets", error);
        return buildFallbackTargets();
      }
    })();
  }
  return cachedConfigPromise;
}

function buildAuthorization(url, method, payloadHash, secretBytes, contentType) {
  const tags = [
    ["u", url],
    ["method", method.toUpperCase()]
  ];

  if (payloadHash) {
    tags.push(["payload", payloadHash]);
  }

  if (contentType) {
    tags.push(["content-type", contentType]);
  }

  const event = finalizeEvent(
    {
      kind: 27235,
      created_at: Math.floor(Date.now() / 1000),
      tags,
      content: ""
    },
    secretBytes
  );

  return `Nostr ${Buffer.from(JSON.stringify(event)).toString("base64")}`;
}

function extractUrl(data) {
  if (!data || typeof data !== "object") {
    throw new Error("Upload failed: invalid response");
  }

  const obj = data;
  if (typeof obj.url === "string") return obj.url;
  if (typeof obj.location === "string") return obj.location;
  if (typeof obj.download_url === "string") return obj.download_url;

  if (obj.data && typeof obj.data === "object") {
    const nested = obj.data;
    if (typeof nested.url === "string") return nested.url;
    if (Array.isArray(nested.files) && nested.files.length) {
      const first = nested.files[0];
      if (first && typeof first === "object" && typeof first.url === "string") {
        return first.url;
      }
    }
  }

  if (obj.nip94_event && typeof obj.nip94_event === "object") {
    const tags = obj.nip94_event.tags;
    if (Array.isArray(tags)) {
      for (const tag of tags) {
        if (Array.isArray(tag) && tag[0] === "url" && typeof tag[1] === "string") {
          return tag[1];
        }
      }
    }
  }

  throw new Error("Upload response missing URL");
}

function buildCorsHeaders(originOverride) {
  const allowOrigin = originOverride || process.env.CORS_ALLOW_ORIGIN || DEFAULT_CORS_ORIGIN;
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "OPTIONS,POST,PUT",
    "Access-Control-Allow-Headers": "Content-Type,Authorization"
  };
}

export const handler = async (event) => {
  const corsHeaders = buildCorsHeaders(event?.headers?.origin || event?.headers?.Origin);

  if (event?.requestContext?.http?.method === "OPTIONS") {
    return {
      statusCode: 204,
      headers: corsHeaders
    };
  }

  if (!event?.body) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ error: "Missing request body" })
    };
  }

  const contentType = event.headers?.["content-type"] || event.headers?.["Content-Type"];
  if (!contentType) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ error: "Content-Type header is required" })
    };
  }

  try {
    const bodyBuffer = event.isBase64Encoded ? Buffer.from(event.body, "base64") : Buffer.from(event.body);
    const payloadHash = createHash("sha256").update(bodyBuffer).digest("hex");

    const targets = await getUploadTargets();
    const nsec = await getUploadSecret();
    const secretBytes = decodeNsec(nsec);

    let lastError = null;

    for (const target of targets) {
      for (const method of target.methods) {
        try {
          const authorization = buildAuthorization(target.signingUrl, method, payloadHash, secretBytes, contentType);
          const response = await fetch(target.requestUrl, {
            method,
            headers: {
              Authorization: authorization,
              "Content-Type": contentType,
              Accept: "application/json"
            },
            body: bodyBuffer
          });

          const responseText = await response.text();

          if (!response.ok) {
            if (response.status === 404 || response.status === 405) {
              lastError = new Error(`Upload failed (${response.status}) ${response.statusText}`);
              continue;
            }
            return {
              statusCode: response.status,
              headers: corsHeaders,
              body: JSON.stringify({ error: "Upload failed", details: responseText.slice(0, 500) })
            };
          }

          let parsed;
          try {
            parsed = JSON.parse(responseText);
          } catch {
            return {
              statusCode: 502,
              headers: corsHeaders,
              body: JSON.stringify({ error: "Unexpected response from upstream", details: responseText.slice(0, 200) })
            };
          }

          const url = extractUrl(parsed);

          return {
            statusCode: 200,
            headers: {
              ...corsHeaders,
              "Content-Type": "application/json"
            },
            body: JSON.stringify({ url })
          };
        } catch (error) {
          lastError = error instanceof Error ? error : new Error(String(error));
        }
      }
    }

    throw lastError || new Error("Upload failed");
  } catch (error) {
    console.error("Upload proxy error", error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: "Internal server error" })
    };
  }
};
