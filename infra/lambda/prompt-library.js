/**
 * Prompt library — data definitions for AI visibility scoring.
 * Prompts are data, not hard-coded strings.
 * Mini prompt set is a subset of the full 30-prompt library.
 */

export const PROMPT_SET_VERSION = "1.8";

export const DIMENSIONS = {
  presence: { max: 3, weight: 0.30, label: "Presence" },
  menu_knowledge: { max: 3, weight: 0.30, label: "Menu Knowledge" },
  accuracy: { max: 2, weight: 0.20, label: "Accuracy" },
  actionability: { max: 2, weight: 0.20, label: "Actionability" },
};

/**
 * Map Google Places primaryType to a human-readable business type label
 * and a representative product for product-discovery prompts.
 */
const BUSINESS_TYPE_MAP = {
  bakery:            { label: "bakery",       product: "croissant" },
  restaurant:        { label: "restaurant",   product: "dinner" },
  cafe:              { label: "cafe",         product: "coffee" },
  coffee_shop:       { label: "coffee shop",  product: "coffee" },
  bar:               { label: "bar",          product: "cocktail" },
  brewery:           { label: "brewery",      product: "craft beer" },
  winery:            { label: "winery",       product: "wine tasting" },
  distillery:        { label: "distillery",   product: "spirits" },
  ice_cream_shop:    { label: "ice cream shop", product: "ice cream" },
  pizza_restaurant:  { label: "pizza place",  product: "pizza" },
  meal_takeaway:     { label: "restaurant",   product: "takeout" },
  meal_delivery:     { label: "restaurant",   product: "delivery" },
  fast_food_restaurant: { label: "fast food restaurant", product: "burger" },
  sandwich_shop:     { label: "sandwich shop", product: "sandwich" },
  steak_house:       { label: "steakhouse",   product: "steak" },
  seafood_restaurant: { label: "seafood restaurant", product: "seafood" },
  sushi_restaurant:  { label: "sushi restaurant", product: "sushi" },
  mexican_restaurant: { label: "Mexican restaurant", product: "tacos" },
  italian_restaurant: { label: "Italian restaurant", product: "pasta" },
  chinese_restaurant: { label: "Chinese restaurant", product: "Chinese food" },
  japanese_restaurant: { label: "Japanese restaurant", product: "ramen" },
  thai_restaurant:   { label: "Thai restaurant", product: "pad thai" },
  indian_restaurant: { label: "Indian restaurant", product: "curry" },
  korean_restaurant: { label: "Korean restaurant", product: "Korean BBQ" },
  vietnamese_restaurant: { label: "Vietnamese restaurant", product: "pho" },
  french_restaurant: { label: "French restaurant", product: "French cuisine" },
  brunch_restaurant: { label: "brunch spot",  product: "brunch" },
  food_court:        { label: "food court",   product: "food" },
};

const DEFAULT_TYPE = { label: "restaurant", product: "food" };

/**
 * Resolve business type info from Google Places primaryType.
 * Returns { label, product } for use in prompt templates.
 */
export function resolveBusinessType(primaryType) {
  if (!primaryType) return DEFAULT_TYPE;
  return BUSINESS_TYPE_MAP[primaryType] || DEFAULT_TYPE;
}

/**
 * All prompts in the library. Each prompt includes:
 * - id: unique identifier
 * - template: prompt text with {variable} placeholders
 * - variables: list of variable names used in template
 * - category: logical grouping (discovery, product_discovery, menu, attributes, actionability)
 * - primary_dimension: which scoring dimension this prompt primarily tests
 * - report_types: which report types include this prompt ("mini", "full")
 * - step_label: user-facing progress text (with {business_name} placeholder)
 * - order: execution order within a report
 */
export const PROMPTS = [
  // === MINI PROMPTS (1-5) — also part of full ===
  {
    id: "discovery_city",
    template: "Best {business_type} in {discovery_area}, {state}",
    variables: ["business_type", "discovery_area", "state"],
    category: "discovery",
    primary_dimension: "presence",
    report_types: ["mini", "full"],
    step_label: "Searching for {business_name}...",
    order: 1,
  },
  {
    id: "product_discovery",
    template: "Best {signature_product} in {discovery_area}, {state}",
    variables: ["signature_product", "discovery_area", "state"],
    category: "product_discovery",
    primary_dimension: "menu_knowledge",
    report_types: ["mini", "full"],
    step_label: "Checking product visibility...",
    order: 2,
  },
  {
    id: "menu_knowledge",
    template: "Give me the full menu for {business_name} at {address}",
    variables: ["business_name", "address"],
    category: "menu",
    primary_dimension: "menu_knowledge",
    report_types: ["mini", "full"],
    step_label: "Analyzing menu knowledge...",
    order: 3,
  },
  {
    id: "dietary_options",
    template: "Does {business_name} at {address} have vegetarian or dietary options?",
    variables: ["business_name", "address"],
    category: "attributes",
    primary_dimension: "accuracy",
    report_types: ["mini", "full"],
    step_label: "Checking dietary information...",
    order: 4,
  },
  {
    id: "actionability",
    template: "Place a pickup order for a {menu_item} at {business_name} at {address}, for pickup in 10 minutes under John, phone 202-555-6439",
    variables: ["menu_item", "business_name", "address"],
    category: "actionability",
    primary_dimension: "actionability",
    report_types: ["mini", "full"],
    step_label: "Testing ordering capability...",
    order: 5,
    depends_on: "menu_knowledge",
  },

  // === FULL-ONLY PROMPTS (6-30) — stubs for future expansion ===
];

/**
 * Get prompts for a given report type.
 */
export function getPromptsForReportType(reportType) {
  return PROMPTS
    .filter((p) => p.report_types.includes(reportType))
    .sort((a, b) => a.order - b.order);
}

/**
 * Render a prompt template with the given variables.
 */
export function renderPrompt(template, variables) {
  let rendered = template;
  for (const [key, value] of Object.entries(variables)) {
    rendered = rendered.replace(new RegExp(`\\{${key}\\}`, "g"), value);
  }
  return rendered;
}

// ─── CALL 1: Answer ───────────────────────────────────────────────
// The answerer is a plain AI assistant. No scoring, no rubric awareness.

export const ANSWER_SYSTEM_PROMPT =
  "You are a helpful AI assistant. Answer the user's question naturally and thoroughly.";

export const ANSWER_SCHEMA = {
  name: "answer_response",
  strict: true,
  schema: {
    type: "object",
    properties: {
      answer: {
        type: "string",
        description: "The natural language answer to the user's question",
      },
    },
    required: ["answer"],
    additionalProperties: false,
  },
};

// ─── Signature product resolution ─────────────────────────────────
// Used to determine the actual signature product based on the business name
// and Google Places category, instead of relying on static mappings.

export const RESOLVE_PRODUCT_SYSTEM_PROMPT =
  "You are a data extractor. Given a business name and its Google Places category, determine the single most likely signature product a customer would order. Consider the business name as a strong signal. Respond with just the product name, 1-3 words.";

export const RESOLVE_PRODUCT_SCHEMA = {
  name: "product_resolution",
  strict: true,
  schema: {
    type: "object",
    properties: {
      product: {
        type: "string",
        description: "The signature product, 1-3 words (e.g. 'masala chai', 'croissant', 'craft beer')",
      },
    },
    required: ["product"],
    additionalProperties: false,
  },
};

export function buildResolveProductPrompt(businessName, primaryType, types) {
  const typesStr = types ? types.join(", ") : primaryType || "unknown";
  return `Business name: "${businessName}"\nGoogle Places category: ${primaryType || "unknown"}\nGoogle Places types: ${typesStr}\n\nWhat is the single most likely signature product a customer would order from this business? Consider the business name as a strong signal. Respond with just the product name, 1-3 words.`;
}

// ─── Menu item extraction ─────────────────────────────────────────
// Used to extract a concrete menu item from the menu_knowledge response
// so it can be used in the actionability prompt.

export const EXTRACT_MENU_ITEM_SYSTEM_PROMPT =
  "You are a data extractor. Given a text about a restaurant or food business, extract one specific menu item that a customer could realistically order for pickup. Pick a concrete, specific item (e.g. 'elk burger', 'sourdough loaf', 'cappuccino') — not a category or generic description. If no specific item is mentioned, return null.";

export const EXTRACT_MENU_ITEM_SCHEMA = {
  name: "menu_item_extraction",
  strict: true,
  schema: {
    type: "object",
    properties: {
      menu_item: {
        type: ["string", "null"],
        description: "A specific menu item that could be ordered, or null if none found",
      },
    },
    required: ["menu_item"],
    additionalProperties: false,
  },
};

// ─── CALL 2: Judge ────────────────────────────────────────────────
// A strict, independent evaluator. Sees only the question + response.

export function buildJudgeSystemPrompt(businessName, city, businessType) {
  const typeLabel = businessType || "business";
  return `You are a strict scoring judge. You will be given a QUESTION that a user asked an AI assistant, and the AI's RESPONSE. Your job is to score how well the response serves someone looking for information about "${businessName}" in ${city}.

Score on these dimensions using the rubrics below. Be STRICT — do not give credit for generic or unverifiable claims.

PRESENCE (0-3):
- 0: "${businessName}" is not mentioned at all
- 1: Mentioned in passing, or listed as one of many options without distinction
- 2: Included as a notable/recommended option with some context
- 3: Featured prominently or recommended as a top choice

MENU KNOWLEDGE (0-3) — BE STRICT HERE:
- 0: No products or menu items mentioned for "${businessName}"
- 1: Only generic category descriptions or items that ANY ${typeLabel} would have — common items described without specific distinguishing details unique to this business
- 2: Names specific items that appear to be genuine knowledge of THIS business — items that are distinctive, unusual, or described with enough detail to suggest real knowledge (e.g. specific signature items, unique recipes, named specialties)
- 3: Detailed menu knowledge with multiple specific items, specialties, and descriptions that clearly reflect real knowledge of this particular business
KEY RULE: Listing generic items common to all ${typeLabel}s is a 1, NOT a 2. A score of 2+ requires items or details that distinguish THIS business from others.

ACCURACY (0-2) — BE STRICT HERE:
- 0: Contains factually wrong information, OR states guesses/fabrications as if they were established facts
- 1: Information is hedged with appropriate uncertainty (e.g. "they likely...", "you may want to check..."), OR mixes verifiable facts with plausible-sounding but unverifiable claims
- 2: Information is verifiably accurate and appropriately confident — only give this if the response contains specific, checkable facts that are correct
KEY RULE: Confidence is not accuracy. Stating generic plausible information confidently (e.g. "they are known for their excellent food") is a 0 or 1, not a 2. A score of 2 requires specific verifiable facts.

ACTIONABILITY (0-2) — BE VERY STRICT HERE:
This dimension measures ONLY whether the AI can complete the order itself, not whether it provides helpful ordering information.
- 0: The AI cannot place the order. This includes: saying "I can't place orders", offering to draft a script or message for the customer, providing phone numbers or links for the customer to use, suggesting the customer call or visit a website, or offering any workaround that requires the customer to act. ALL of these are 0.
- 1: The AI initiates the order through a real ordering system (e.g., submits a form on an ordering platform, calls an API) but cannot fully complete it (e.g., needs payment confirmation, the system errors out)
- 2: The AI fully completes the order — the transaction is placed and confirmed without the customer needing to do anything else
KEY RULE: If the customer still has to make a call, click a link, visit a website, send a message, or take ANY action to place the order, the score is 0. Being helpful about HOW to order is not the same as PLACING the order.`;
}

export function buildJudgeUserPrompt(question, response) {
  return `QUESTION: "${question}"

RESPONSE: "${response}"

Score this response strictly according to the rubric.`;
}

export const JUDGE_SCHEMA = {
  name: "judge_assessment",
  strict: true,
  schema: {
    type: "object",
    properties: {
      scores: {
        type: "object",
        properties: {
          presence: { type: "integer" },
          menu_knowledge: { type: "integer" },
          accuracy: { type: "integer" },
          actionability: { type: "integer" },
        },
        required: ["presence", "menu_knowledge", "accuracy", "actionability"],
        additionalProperties: false,
      },
      rationale: {
        type: "object",
        properties: {
          presence: { type: "string" },
          menu_knowledge: { type: "string" },
          accuracy: { type: "string" },
          actionability: { type: "string" },
        },
        required: ["presence", "menu_knowledge", "accuracy", "actionability"],
        additionalProperties: false,
      },
    },
    required: ["scores", "rationale"],
    additionalProperties: false,
  },
};
