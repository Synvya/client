/**
 * Scoring engine — aggregates per-prompt scores, applies deterministic overrides,
 * computes dimension averages, and determines diagnosis labels.
 */

import { DIMENSIONS } from "./prompt-library.js";

/**
 * Apply deterministic overrides to a single prompt's scores.
 * Catches obvious cases the LLM might miss in self-scoring.
 * When ground truth from Google Places is available, uses it
 * to verify accuracy and actionability deterministically.
 *
 * @param {string} rawAnswer - The LLM's raw text answer
 * @param {object} scores - Mutable scores object (modified in place)
 * @param {string} businessName - The business name
 * @param {object|null} groundTruth - Google Places data, if available
 */
export function applyDeterministicOverrides(rawAnswer, scores, businessName, groundTruth = null) {
  const overrides = {};
  const answerLower = rawAnswer.toLowerCase();
  const nameLower = businessName.toLowerCase();

  // --- Name-based presence overrides ---

  // If business name literally appears in the answer → presence >= 1
  if (answerLower.includes(nameLower) && scores.presence < 1) {
    overrides.presence = 1;
    scores.presence = 1;
  }

  // If business name appears AND words like "recommend", "best", "top" → presence >= 2
  if (answerLower.includes(nameLower)) {
    const recommendPatterns = /\b(recommend|best|top|favorite|favourite|popular|renowned|well-known|famous|must-visit)\b/i;
    if (recommendPatterns.test(answerLower) && scores.presence < 2) {
      overrides.presence = 2;
      scores.presence = 2;
    }
  }

  // If answer expresses uncertainty about the business → accuracy = 0
  const uncertaintyPatterns = /\b(i don'?t have (specific |current )?information|i'?m not (sure|certain|aware)|i cannot (confirm|verify)|no (specific |reliable )?data)\b/i;
  if (uncertaintyPatterns.test(answerLower) && scores.accuracy > 0) {
    if (answerLower.includes(nameLower)) {
      overrides.accuracy = 0;
      scores.accuracy = 0;
    }
  }

  // --- Ground truth overrides (from Google Places) ---

  if (groundTruth) {
    // Accuracy: check if LLM's address matches ground truth
    if (groundTruth.formatted_address) {
      const gtAddressLower = groundTruth.formatted_address.toLowerCase();
      // Extract key parts of the address for fuzzy matching
      const gtParts = gtAddressLower.split(",").map((p) => p.trim());
      const streetPart = groundTruth.street_address?.toLowerCase();

      if (streetPart && answerLower.includes(streetPart)) {
        // LLM got the street address right → accuracy >= 1
        if (scores.accuracy < 1) {
          overrides.accuracy = 1;
          scores.accuracy = 1;
        }
      }

      // Check if LLM mentions a WRONG address (contains a street number but not the right one)
      if (streetPart) {
        const streetNumberMatch = streetPart.match(/^(\d+)\s/);
        if (streetNumberMatch) {
          const correctNumber = streetNumberMatch[1];
          // Look for any street number near the business name in the response
          const addressPattern = new RegExp(`\\b\\d+\\s+\\w+\\s+(st|street|ave|avenue|rd|road|blvd|dr|drive|way|ln|lane|ct|pl)\\b`, "i");
          const foundAddress = answerLower.match(addressPattern);
          if (foundAddress && !foundAddress[0].startsWith(correctNumber)) {
            // LLM gave a different address → accuracy = 0
            overrides.accuracy = 0;
            scores.accuracy = 0;
          }
        }
      }
    }

    // Accuracy: check phone number
    if (groundTruth.phone) {
      // Normalize phone for comparison (strip non-digits)
      const gtPhone = groundTruth.phone.replace(/\D/g, "");
      const answerDigits = rawAnswer.replace(/\D/g, "");
      if (gtPhone.length >= 7 && answerDigits.includes(gtPhone.slice(-7))) {
        // LLM got the phone right → accuracy >= 1
        if (scores.accuracy < 1) {
          overrides.accuracy = 1;
          scores.accuracy = 1;
        }
      }
    }

    // Actionability: no deterministic overrides — this dimension measures
    // whether the AI can actually place an order, which can only be assessed
    // by the judge rubric. Contact info (phone, address, website) is at most
    // a score of 1 (customer still has to act), and a score of 2 requires
    // the AI to complete the transaction via an API/integration.
  }

  return overrides;
}

/**
 * Compute dimension scores using only each prompt's primary dimension.
 * Each prompt contributes only to the dimension it's designed to test,
 * preventing cross-dimension score pollution (e.g., the actionability
 * prompt dragging down the presence score).
 *
 * Prompt → Dimension mapping is defined by primary_dimension in the prompt library.
 * When multiple prompts share a primary dimension, their scores are averaged.
 */
export function computeDimensionScores(promptResults) {
  const dims = {};

  for (const [dimKey, dimConfig] of Object.entries(DIMENSIONS)) {
    // Only include scores from prompts whose primary_dimension matches this dimension
    const relevantResults = promptResults.filter((r) => r.category === dimKey ||
      // Map category names to dimension keys
      (dimKey === "presence" && r.category === "discovery") ||
      (dimKey === "menu_knowledge" && (r.category === "product_discovery" || r.category === "menu")) ||
      (dimKey === "accuracy" && r.category === "attributes") ||
      (dimKey === "actionability" && r.category === "actionability")
    );

    const allScores = relevantResults.map((r) => r.scores[dimKey]);
    const sum = allScores.reduce((a, b) => a + b, 0);
    const avg = allScores.length > 0 ? sum / allScores.length : 0;

    dims[dimKey] = {
      score: Math.round(avg * 100) / 100,
      max: dimConfig.max,
      weight: dimConfig.weight,
      label: dimConfig.label,
    };
  }

  // Also compute category-specific averages for diagnosis
  // "named" = prompts that use business_name, "category" = discovery/product prompts
  const namedResults = promptResults.filter((r) => r.variables_used?.includes("business_name"));
  const categoryResults = promptResults.filter((r) => !r.variables_used?.includes("business_name"));

  if (namedResults.length > 0) {
    dims.presence.named_avg = namedResults.reduce((s, r) => s + r.scores.presence, 0) / namedResults.length;
  }
  if (categoryResults.length > 0) {
    dims.presence.category_avg = categoryResults.reduce((s, r) => s + r.scores.presence, 0) / categoryResults.length;
  }

  return dims;
}

/**
 * Compute the overall weighted score (0-10 scale).
 */
export function computeOverallScore(dimensionScores) {
  let weightedSum = 0;
  let totalWeight = 0;

  for (const [dimKey, dimConfig] of Object.entries(DIMENSIONS)) {
    const dim = dimensionScores[dimKey];
    // Normalize to 0-1 range, then apply weight
    const normalized = dim.score / dim.max;
    weightedSum += normalized * dimConfig.weight;
    totalWeight += dimConfig.weight;
  }

  // Scale to 0-10
  const score = (weightedSum / totalWeight) * 10;
  return Math.round(score * 10) / 10;
}

/**
 * Diagnosis rules — deterministic mapping from dimension scores to labels.
 * Rules are evaluated in order; first match wins.
 */
const DIAGNOSIS_RULES = [
  {
    test: (d) => d.presence.score <= 0.5 && d.menu_knowledge.score <= 0.5,
    label: "Not on AI's radar yet",
  },
  {
    test: (d) =>
      d.presence.named_avg !== undefined &&
      d.presence.category_avg !== undefined &&
      d.presence.named_avg >= 2 &&
      d.presence.category_avg <= 1,
    label: "Easy to find if known, hard to discover if not known",
  },
  {
    test: (d) => d.presence.score >= 2 && d.menu_knowledge.score <= 1,
    label: "Visible by name, invisible by product",
  },
  {
    test: (d) => d.presence.score <= 1 && d.menu_knowledge.score >= 2,
    label: "Strong local brand, weak AI discovery",
  },
  {
    test: (d) => d.presence.score >= 2 && d.menu_knowledge.score >= 2 && d.accuracy.score <= 0.5,
    label: "Known but described inaccurately",
  },
  {
    test: (d) => d.presence.score >= 2 && d.menu_knowledge.score >= 2 && d.actionability.score <= 0.5,
    label: "Shows up, but with incomplete details",
  },
  {
    test: (d) =>
      d.presence.score >= 2 &&
      d.menu_knowledge.score >= 1.5 &&
      d.menu_knowledge.score < 2.5,
    label: "Recommended by category, not for signature products",
  },
  {
    test: (d) =>
      d.presence.score >= 2 &&
      d.menu_knowledge.score >= 2 &&
      d.accuracy.score >= 1.5 &&
      d.actionability.score >= 1.5,
    label: "Strong AI visibility across the board",
  },
  // Fallback
  {
    test: () => true,
    label: "Partially visible to AI assistants",
  },
];

/**
 * Determine the diagnosis label from dimension scores.
 */
export function determineDiagnosis(dimensionScores) {
  for (const rule of DIAGNOSIS_RULES) {
    if (rule.test(dimensionScores)) {
      return rule.label;
    }
  }
  return "Partially visible to AI assistants";
}
