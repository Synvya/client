import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { createHash } from "node:crypto";

const secretsClient = new SecretsManagerClient({});
const s3Client = new S3Client({});

let cachedMenuImportSecret = null;

async function getMenuImportSecret() {
  if (cachedMenuImportSecret) return cachedMenuImportSecret;

  const secretId = process.env.MENU_IMPORT_SECRET_ARN;
  if (!secretId) throw new Error("MENU_IMPORT_SECRET_ARN not set");

  const result = await secretsClient.send(
    new GetSecretValueCommand({ SecretId: secretId })
  );
  const parsed = JSON.parse(result.SecretString);
  cachedMenuImportSecret = parsed;
  return parsed;
}


// Retry helper for transient API errors (502, 503, 429)
async function fetchWithRetry(url, options, maxRetries = 2) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const response = await fetch(url, options);
    if (response.ok || attempt === maxRetries) return response;
    if (![429, 502, 503].includes(response.status)) return response;
    const delay = Math.pow(2, attempt) * 2000; // 2s, 4s
    console.warn(`Retrying after ${response.status} (attempt ${attempt + 1}/${maxRetries}, wait ${delay}ms)`);
    await new Promise((r) => setTimeout(r, delay));
  }
}

// CORS is handled by the Lambda Function URL configuration.
// Do NOT set CORS headers here — duplicates cause browsers to reject the response.

function jsonResponse(statusCode, body) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

function withErrorHandling(handler) {
  return async (event) => {
    try {
      return await handler(event);
    } catch (error) {
      console.error("Menu Import API error:", error);
      return jsonResponse(500, { error: "Internal server error", message: error.message });
    }
  };
}

// ─── /menu-import/extract ───

const EXTRACT_PROMPT = `You are a restaurant menu extraction expert. Extract all menu items from this PDF menu into structured JSON.

Return a JSON object with this exact structure:
{
  "menus": [
    {
      "name": "Menu name",
      "description": "Brief description of this menu",
      "menuType": "food or drink",
      "parentMenu": "parent menu name if this is a section; empty string if this is a top-level menu"
    }
  ],
  "items": [
    {
      "name": "Item name",
      "description": "Item description from the menu",
      "price": "Price as a number string (e.g. '12.99'). Use empty string if no price listed.",
      "currency": "USD",
      "ingredients": ["ingredient1", "ingredient2"],
      "suitableForDiets": ["vegan", "gluten-free"],
      "tags": ["appetizer", "spicy"],
      "partOfMenu": "Which top-level menu this item belongs to",
      "partOfMenuSection": "Which section within the menu (e.g. 'Appetizers', 'Entrees'), or empty string if none",
      "imageDescription": "A vivid 1-2 sentence description of how this dish would look as professional food photography. Focus on plating, colors, textures, and garnishes."
    }
  ]
}

STEP 1 — Identify top-level menus:
Look for explicit high-level separations such as "Lunch Menu", "Dinner Menu", "Brunch", "Drinks Menu", "Wine List", etc. These become top-level entries with parentMenu set to empty string.
If the PDF has NO such top-level distinction (i.e. the restaurant has a single combined food menu and only section/category headers are visible), create exactly ONE top-level entry: { "name": "Menu", "description": "Full menu", "menuType": "food", "parentMenu": "" }. Do NOT promote section headers to be top-level menus in this case.

STEP 2 — Identify sections:
Section headers are bold, uppercase, or visually prominent titles within a menu that group items together (e.g. "STARTERS", "KABOBS", "DESSERTS", "TANDOORI TEMPTATIONS"). Each section becomes a menus entry with parentMenu set to its parent top-level menu name, and menuType "food" or "drink" as appropriate.
Multi-column layouts: many printed menus use two or more columns where the same section header appears at the top of each column. Treat repeated identical headers as ONE section — do not create duplicate menus entries.

STEP 3 — Consistency check (critical):
Before finalising output, scan every item's "partOfMenuSection" value and confirm it exactly matches a "name" in the menus array. If any partOfMenuSection value has no matching menus entry, add the missing section to the menus array (with the appropriate parentMenu). This check is mandatory — every section referenced by items must exist in menus.

STEP 4 — Menu legend and dietary/spice symbols:
Many menus include a legend (e.g. "V = Vegetarian", "GF = Gluten-Free") or use icons (chili pepper icon for spicy, leaf for vegan, etc.). Scan the entire PDF for any such legend or key.
- If an item is marked with a symbol that the legend defines as "Vegetarian", add "vegetarian" to suitableForDiets.
- If an item is marked with a symbol that the legend defines as "Vegan", add "vegan" to suitableForDiets.
- If an item is marked with a symbol that the legend defines as "Gluten-Free", add "gluten-free" to suitableForDiets.
- If an item has a chili pepper icon or any symbol the legend defines as "Spicy" or "Hot", add "spicy" to tags.
- Apply these rules even when the symbol appears inline next to the item name (e.g. "Chicken Tikka V", "Tangra Chilli Chicken 🌶").
- Do not strip the dietary markers from the item name — keep the name clean (without V, GF, etc.).

Additional guidelines:
- Extract ALL items; do not skip any
- Normalize section names: strip leading/trailing asterisks or symbols, normalise whitespace, use consistent Title Case
- If an item has no description on the menu, write a brief one based on the name and ingredients
- For suitableForDiets, only include diets you can confidently identify (vegan, vegetarian, gluten-free, etc.)
- Ingredients: list what you can identify from the description. If none listed, use empty array.
- imageDescription should be vivid enough for an AI image generator to create appetizing food photography
- Return ONLY the JSON, no markdown code fences or explanations`;

async function handleExtract(event) {
  if (event.requestContext?.http?.method !== "POST") {
    return jsonResponse(405, { error: "Method not allowed" });
  }

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return jsonResponse(400, { error: "Invalid JSON body" });
  }

  const { pageImages, restaurantName } = body;
  if (!Array.isArray(pageImages) || !pageImages.length) {
    return jsonResponse(400, { error: "pageImages array is required" });
  }

  const secrets = await getMenuImportSecret();
  const anthropicKey = secrets["anthropic-api-key"];
  if (!anthropicKey) {
    throw new Error("Missing anthropic-api-key in secret");
  }

  const systemPrompt = restaurantName
    ? `${EXTRACT_PROMPT}\n\nThe restaurant name is "${restaurantName}". Use this context when generating descriptions and image descriptions.`
    : EXTRACT_PROMPT;

  // Build content blocks: one image per page, then the text prompt
  const contentBlocks = [
    ...pageImages.map((imgBase64) => ({
      type: "image",
      source: {
        type: "base64",
        media_type: "image/jpeg",
        data: imgBase64,
      },
    })),
    {
      type: "text",
      text: systemPrompt,
    },
  ];

  const response = await fetchWithRetry("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": anthropicKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-5-20250929",
      max_tokens: 16384,
      messages: [
        {
          role: "user",
          content: contentBlocks,
        },
      ],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error("Anthropic API error:", response.status, errorText);
    throw new Error(`Claude API error: ${response.status}`);
  }

  const result = await response.json();

  if (result.stop_reason === "max_tokens") {
    console.error("Claude response truncated — output exceeded max_tokens");
    throw new Error("Menu too large: Claude response was cut off. Try uploading fewer pages.");
  }

  const textBlock = result.content?.find((b) => b.type === "text");
  if (!textBlock?.text) {
    throw new Error("No text response from Claude");
  }

  let extracted;
  try {
    const raw = textBlock.text;
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start === -1 || end === -1 || end <= start) {
      throw new Error("No JSON object found in response");
    }
    extracted = JSON.parse(raw.slice(start, end + 1));
  } catch (parseErr) {
    console.error("Failed to parse Claude response:", textBlock.text.slice(0, 500));
    throw new Error("Failed to parse extraction result as JSON");
  }

  // Basic validation
  if (!Array.isArray(extracted.menus) || !Array.isArray(extracted.items)) {
    throw new Error("Invalid extraction structure: missing menus or items array");
  }

  return jsonResponse(200, extracted);
}

// ─── /menu-import/enrich ───

async function handleEnrich(event) {
  if (event.requestContext?.http?.method !== "POST") {
    return jsonResponse(405, { error: "Method not allowed" });
  }

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return jsonResponse(400, { error: "Invalid JSON body" });
  }

  const { items, restaurantContext } = body;
  if (!Array.isArray(items) || !items.length) {
    return jsonResponse(400, { error: "items array is required" });
  }

  const secrets = await getMenuImportSecret();
  const anthropicKey = secrets["anthropic-api-key"];
  if (!anthropicKey) {
    throw new Error("Missing anthropic-api-key in secret");
  }

  const ctx = restaurantContext || {};
  const contextLine = [
    ctx.name && `Restaurant: ${ctx.name}`,
    ctx.cuisine && `Cuisine: ${ctx.cuisine}`,
    ctx.about && `About: ${ctx.about}`,
  ]
    .filter(Boolean)
    .join(". ");

  const itemList = items
    .map(
      (item, i) =>
        `${i + 1}. "${item.name}" — Current description: "${item.description || "none"}"${
          item.ingredients?.length ? ` — Ingredients: ${item.ingredients.join(", ")}` : ""
        }`
    )
    .join("\n");

  const prompt = `You are a restaurant menu copywriter. Expand each item's description to 2-3 engaging sentences that would make a customer want to order it. Reference specific ingredients and flavors when known. Keep the restaurant's voice and style.

${contextLine ? `Context: ${contextLine}\n` : ""}
Items to enrich:
${itemList}

Return a JSON object:
{
  "items": [
    { "name": "Item name", "enrichedDescription": "The expanded description" }
  ]
}

Return ONLY the JSON, no markdown code fences or explanations.`;

  const response = await fetchWithRetry("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": anthropicKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 4096,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error("Anthropic API error:", response.status, errorText);
    throw new Error(`Claude API error: ${response.status}`);
  }

  const result = await response.json();
  const textBlock = result.content?.find((b) => b.type === "text");
  if (!textBlock?.text) {
    throw new Error("No text response from Claude");
  }

  let parsed;
  try {
    const raw = textBlock.text;
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start === -1 || end === -1 || end <= start) {
      throw new Error("No JSON object found in response");
    }
    parsed = JSON.parse(raw.slice(start, end + 1));
  } catch {
    console.error("Failed to parse enrich response:", textBlock.text.slice(0, 500));
    throw new Error("Failed to parse enrichment result as JSON");
  }

  return jsonResponse(200, parsed);
}

// ─── /menu-import/generate-image ───

async function handleGenerateImage(event) {
  if (event.requestContext?.http?.method !== "POST") {
    return jsonResponse(405, { error: "Method not allowed" });
  }

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return jsonResponse(400, { error: "Invalid JSON body" });
  }

  const { itemName, imageDescription, cuisineContext } = body;
  if (!itemName || !imageDescription) {
    return jsonResponse(400, { error: "itemName and imageDescription are required" });
  }

  const secrets = await getMenuImportSecret();
  const openaiKey = secrets["openai-api-key"];
  if (!openaiKey) {
    throw new Error("Missing openai-api-key in secret");
  }

  // Generate image with DALL-E 3
  const dallePrompt = `Professional food photography of ${itemName}. ${imageDescription}${
    cuisineContext ? `. ${cuisineContext} cuisine style.` : ""
  } Shot from above at a 45-degree angle on an elegant plate, soft natural lighting, shallow depth of field, no text or watermarks.`;

  const dalleResponse = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${openaiKey}`,
    },
    body: JSON.stringify({
      model: "dall-e-3",
      prompt: dallePrompt,
      n: 1,
      size: "1024x1024",
      quality: "standard",
      response_format: "url",
    }),
  });

  if (!dalleResponse.ok) {
    const errorText = await dalleResponse.text();
    console.error("DALL-E API error:", dalleResponse.status, errorText);
    throw new Error(`DALL-E API error: ${dalleResponse.status}`);
  }

  const dalleResult = await dalleResponse.json();
  const tempUrl = dalleResult.data?.[0]?.url;
  if (!tempUrl) {
    throw new Error("No image URL in DALL-E response");
  }

  // Download the image
  const imageResponse = await fetch(tempUrl);
  if (!imageResponse.ok) {
    throw new Error(`Failed to download generated image: ${imageResponse.status}`);
  }
  const imageBuffer = Buffer.from(await imageResponse.arrayBuffer());

  // Upload to S3
  const bucket = process.env.IMAGE_BUCKET;
  const cdnBase = process.env.IMAGE_CDN_BASE; // e.g. https://account.synvya.com
  if (!bucket) throw new Error("IMAGE_BUCKET not set");
  if (!cdnBase) throw new Error("IMAGE_CDN_BASE not set");

  const hash = createHash("sha256").update(imageBuffer).digest("hex").slice(0, 12);
  const safeName = itemName.replace(/[^a-zA-Z0-9]/g, "_").toLowerCase();
  const key = `menu-images/${safeName}_${hash}.png`;

  await s3Client.send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: imageBuffer,
    ContentType: "image/png",
    CacheControl: "public, max-age=31536000, immutable",
  }));

  const permanentUrl = `${cdnBase.replace(/\/+$/, "")}/${key}`;
  return jsonResponse(200, { url: permanentUrl });
}

// ─── Router ───

export const handler = withErrorHandling(async (event) => {
  const path = event.rawPath || event.requestContext?.http?.path || "";

  if (event.requestContext?.http?.method === "OPTIONS") {
    return jsonResponse(204, "");
  }

  if (path.endsWith("/menu-import/extract")) {
    return handleExtract(event);
  }
  if (path.endsWith("/menu-import/enrich")) {
    return handleEnrich(event);
  }
  if (path.endsWith("/menu-import/generate-image")) {
    return handleGenerateImage(event);
  }

  return jsonResponse(404, { error: "Not found" });
});
