/**
 * Narrative generation for AI Visibility Reports.
 * - Summary: LLM-generated from actual prompt responses (accurate, specific)
 * - Headline & recommendations: template-driven (fast, deterministic)
 */

// --- Summary LLM prompt and schema ---

export const SUMMARY_SYSTEM_PROMPT = `You are writing a brief summary for a business owner about how their business appears to AI assistants like ChatGPT.

You will receive 5 test prompts that were sent to ChatGPT along with ChatGPT's actual responses. Your job is to summarize what ChatGPT knows (and doesn't know) about this business in 2-4 sentences.

Rules:
- Be specific: reference actual details from the responses (e.g., "ChatGPT knows your menu includes biryani and butter chicken" not "ChatGPT knows some of your products")
- Be honest: if ChatGPT got something wrong or didn't mention the business, say so clearly
- Write in second person ("your business") addressing the business owner
- Do not make up information — only summarize what's in the responses
- Keep it concise: 2-4 sentences, no bullet points
- Do not include recommendations or advice — just describe the current state`;

export const SUMMARY_SCHEMA = {
  name: "summary_response",
  strict: true,
  schema: {
    type: "object",
    properties: {
      summary: {
        type: "string",
        description: "A 2-4 sentence summary of how the business appears to AI assistants, based on the test responses.",
      },
    },
    required: ["summary"],
    additionalProperties: false,
  },
};

/**
 * Build the user prompt for summary generation from prompt results.
 */
export function buildSummaryUserPrompt(businessName, city, promptResults) {
  const lines = [`Business: ${businessName} in ${city}\n`];

  for (const result of promptResults) {
    lines.push(`--- Test prompt: "${result.prompt_text}" ---`);
    lines.push(result.raw_response);
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Generate the full narrative object from report data.
 * Accepts an optional LLM-generated summary; falls back to template if not provided.
 */
export function generateNarrative({ businessName, dimensionScores, diagnosisLabel, overallScore, llmSummary }) {
  return {
    headline: generateHeadline(businessName, diagnosisLabel, overallScore),
    summary: llmSummary || generateTemplateSummary(businessName, dimensionScores),
    recommendations: generateRecommendations(dimensionScores),
  };
}

function generateHeadline(businessName, diagnosisLabel, overallScore) {
  if (overallScore >= 8) {
    return `${businessName} has strong AI visibility`;
  }
  if (overallScore >= 5) {
    return `AI assistants partially know ${businessName}`;
  }
  if (overallScore >= 2) {
    return `${businessName} is hard for AI assistants to find`;
  }
  return `AI assistants don't know about ${businessName} yet`;
}

/**
 * Template-based summary — used as fallback if LLM summary fails.
 */
function generateTemplateSummary(businessName, dims) {
  const parts = [];

  if (dims.presence.score >= 2) {
    parts.push(`When someone asks for a recommendation, AI assistants know about ${businessName}.`);
  } else if (dims.presence.score >= 1) {
    parts.push(`AI assistants occasionally mention ${businessName}, but it's not a go-to recommendation.`);
  } else {
    parts.push(`AI assistants don't mention ${businessName} when asked for recommendations.`);
  }

  if (dims.menu_knowledge.score >= 2) {
    parts.push(`They can describe your products in detail.`);
  } else if (dims.menu_knowledge.score >= 1) {
    parts.push(`They know your business exists but can't describe your specific products.`);
  } else {
    parts.push(`They don't know what you sell.`);
  }

  if (dims.accuracy.score <= 0.5) {
    parts.push(`The information they do have may be inaccurate or outdated.`);
  }

  if (dims.actionability.score >= 1.5) {
    parts.push(`They can tell customers how to visit or order from you.`);
  } else if (dims.actionability.score >= 0.5) {
    parts.push(`They have some of your contact details, but not enough for a customer to easily order.`);
  } else {
    parts.push(`They can't tell customers how to reach you, visit, or place an order.`);
  }

  return parts.join(" ");
}

function generateRecommendations(dims) {
  const recs = [];

  if (dims.presence.score < 2) {
    recs.push("Get listed on Google Business Profile, Yelp, and TripAdvisor to increase your digital footprint");
    if (dims.presence.category_avg !== undefined && dims.presence.category_avg < 1) {
      recs.push("Ask satisfied customers to mention your business in online reviews — this helps AI assistants learn about you");
    }
  }

  if (dims.menu_knowledge.score < 2) {
    recs.push("Publish your full menu with descriptions on your website — AI assistants read websites to learn about businesses");
    recs.push("List your specialty items and signature products prominently on your homepage");
  }
  if (dims.menu_knowledge.score < 1) {
    recs.push("Add structured data (schema.org/Menu) to your website so AI can parse your offerings");
  }

  if (dims.accuracy.score < 1.5) {
    recs.push("Verify your business hours, address, and phone number are consistent across all online listings");
    recs.push("Keep your Google Business Profile updated with current information");
  }

  if (dims.actionability.score < 1.5) {
    recs.push("Add clear ordering instructions to your website (phone, online ordering, walk-in)");
    recs.push("Include your full address, phone number, and hours on every page of your website");
  }
  if (dims.actionability.score < 0.5) {
    recs.push("Create a website if you don't have one — even a simple one-page site helps AI assistants direct customers to you");
  }

  if (dims.menu_knowledge.score >= 1 && dims.accuracy.score < 1) {
    recs.push("List dietary options (gluten-free, vegan, etc.) on your menu and website");
  }

  return recs.slice(0, 5);
}
