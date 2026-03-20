/**
 * Report engine — config-driven orchestration pipeline.
 * One engine for both mini and full reports, differentiated by config.
 */

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { getPromptsForReportType, renderPrompt, resolveBusinessType, ANSWER_SYSTEM_PROMPT, ANSWER_SCHEMA, EXTRACT_MENU_ITEM_SYSTEM_PROMPT, EXTRACT_MENU_ITEM_SCHEMA, RESOLVE_PRODUCT_SYSTEM_PROMPT, RESOLVE_PRODUCT_SCHEMA, buildResolveProductPrompt, buildJudgeSystemPrompt, buildJudgeUserPrompt, JUDGE_SCHEMA, PROMPT_SET_VERSION } from "./prompt-library.js";
import { getAdapter, getDefaultModel } from "./model-adapters.js";
import { applyDeterministicOverrides, computeDimensionScores, computeOverallScore, determineDiagnosis } from "./scoring-engine.js";
import { buildCacheKey } from "./business-normalize.js";
import { generateNarrative, SUMMARY_SYSTEM_PROMPT, SUMMARY_SCHEMA, buildSummaryUserPrompt } from "./narrative.js";
import { storeLead, markLeadEmailSent, sendReportEmail } from "./email-sender.js";
import { randomUUID } from "node:crypto";

const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const jobsTable = process.env.JOBS_TABLE || "visibility-report-jobs";
const resultsTable = process.env.RESULTS_TABLE || "visibility-report-results";
const cacheTable = process.env.CACHE_TABLE || "visibility-cache";

/**
 * Run the report pipeline for a given job.
 * Updates job status/step as it progresses.
 */
export async function runReportPipeline(jobId) {
  // 1. Load the job
  const jobResult = await dynamo.send(new GetCommand({
    TableName: jobsTable,
    Key: { job_id: jobId },
  }));
  const job = jobResult.Item;
  if (!job) throw new Error(`Job not found: ${jobId}`);

  const { business_name, city, neighborhood, website, report_type, place_id, ground_truth, email } = job;
  const provider = "openai";
  const adapter = getAdapter(provider);
  const modelVersion = getDefaultModel(provider);

  try {
    // 2. Update status to processing
    await updateJobStatus(jobId, "processing", "Initializing...", 0);

    // 3. Get prompts for this report type
    const prompts = getPromptsForReportType(report_type);
    const totalSteps = prompts.length;

    // 4. Resolve business type, state, and location details from Google Places data
    const primaryType = ground_truth?.primary_type || null;
    const placesTypes = ground_truth?.types || null;
    const state = ground_truth?.state || "";
    const address = ground_truth?.formatted_address || "";
    const placesNeighborhood = ground_truth?.neighborhood || "";
    const { label: businessTypeLabel, product: fallbackProduct } = resolveBusinessType(primaryType);

    // 4b. Resolve signature product via LLM (uses business name as strong signal)
    let signatureProduct = fallbackProduct;
    try {
      const productPrompt = buildResolveProductPrompt(business_name, primaryType, placesTypes);
      const productResult = await adapter.call(
        RESOLVE_PRODUCT_SYSTEM_PROMPT,
        productPrompt,
        RESOLVE_PRODUCT_SCHEMA,
        { webSearch: false }
      );
      if (productResult.parsed.product) {
        signatureProduct = productResult.parsed.product;
      }
    } catch (err) {
      console.warn("LLM product resolution failed, using fallback:", err.message);
    }

    // 5. Build template variables
    // For discovery prompts (1-2): use neighborhood if available, otherwise city
    // For business-specific prompts (3-5): use full address
    const discoveryArea = placesNeighborhood
      ? `${placesNeighborhood}, ${city}`
      : city;

    const variables = {
      business_name,
      city,
      state,
      address,
      discovery_area: discoveryArea,
      business_type: businessTypeLabel,
      signature_product: signatureProduct,
    };
    if (neighborhood) variables.neighborhood = neighborhood;

    // 6. Execute prompts — parallel where possible
    // Prompts without dependencies run concurrently.
    // Prompts with depends_on wait for their dependency to complete.
    const judgeSystemPrompt = buildJudgeSystemPrompt(business_name, city, businessTypeLabel);

    /**
     * Execute a single prompt: answer call + judge call.
     * Returns a prompt result object.
     */
    async function executePrompt(prompt, promptVariables) {
      const userPrompt = renderPrompt(prompt.template, promptVariables);

      // Call 1: Get natural answer (with web search)
      const answerResult = await adapter.call(
        ANSWER_SYSTEM_PROMPT,
        userPrompt,
        ANSWER_SCHEMA
      );

      const rawAnswer = answerResult.parsed.answer;

      // Call 2: Judge scores the answer (no web search needed)
      const judgeUserPrompt = buildJudgeUserPrompt(userPrompt, rawAnswer);
      const judgeResult = await adapter.call(
        judgeSystemPrompt,
        judgeUserPrompt,
        JUDGE_SCHEMA,
        { webSearch: false }
      );

      const scores = clampScores(judgeResult.parsed.scores);
      const overrides = applyDeterministicOverrides(rawAnswer, scores, business_name, ground_truth);

      return {
        prompt_id: prompt.id,
        prompt_text: userPrompt,
        raw_response: rawAnswer,
        scores,
        scoring_rationale: judgeResult.parsed.rationale,
        deterministic_overrides: Object.keys(overrides).length > 0 ? overrides : null,
        variables_used: prompt.variables,
        category: prompt.category,
        model_id: answerResult.model,
        latency_ms: answerResult.latencyMs + judgeResult.latencyMs,
      };
    }

    // Split prompts into independent (no depends_on) and dependent
    const independentPrompts = prompts.filter((p) => !p.depends_on);
    const dependentPrompts = prompts.filter((p) => p.depends_on);

    // Update status: running parallel prompts
    await updateJobStatus(jobId, "processing", "Analyzing AI visibility...", 0, totalSteps);

    // Run independent prompts in parallel
    const independentResults = await Promise.all(
      independentPrompts.map((prompt) => executePrompt(prompt, variables))
    );

    // Build response map from independent results (needed for dependent prompts)
    const promptResponseMap = {};
    for (const result of independentResults) {
      promptResponseMap[result.prompt_id] = result.raw_response;
    }

    // Update status: running dependent prompts
    await updateJobStatus(jobId, "processing", "Testing ordering capability...", independentPrompts.length, totalSteps);

    // Run dependent prompts sequentially
    const dependentResults = [];
    for (const prompt of dependentPrompts) {
      if (prompt.id === "actionability" && prompt.depends_on === "menu_knowledge") {
        const depResponse = promptResponseMap[prompt.depends_on];

        // Extract a menu item from the menu_knowledge response
        let menuItem = null;
        if (depResponse) {
          const extractResult = await adapter.call(
            EXTRACT_MENU_ITEM_SYSTEM_PROMPT,
            depResponse,
            EXTRACT_MENU_ITEM_SCHEMA,
            { webSearch: false }
          );
          menuItem = extractResult.parsed.menu_item;
        }

        if (!menuItem) {
          // No menu item found — skip this prompt, score 0
          dependentResults.push({
            prompt_id: prompt.id,
            prompt_text: renderPrompt(prompt.template, { ...variables, menu_item: signatureProduct }),
            raw_response: "Skipped — no specific menu item was identified from the menu knowledge prompt.",
            scores: { presence: 0, menu_knowledge: 0, accuracy: 0, actionability: 0 },
            scoring_rationale: {
              presence: "Skipped",
              menu_knowledge: "Skipped",
              accuracy: "Skipped",
              actionability: "No specific menu item could be identified, so ordering capability could not be tested.",
            },
            deterministic_overrides: null,
            variables_used: prompt.variables,
            category: prompt.category,
            model_id: "skipped",
            latency_ms: 0,
          });
          continue;
        }

        const depVariables = { ...variables, menu_item: menuItem };
        const result = await executePrompt(prompt, depVariables);
        dependentResults.push(result);
      }
    }

    // Combine results in original prompt order
    const resultMap = {};
    for (const r of [...independentResults, ...dependentResults]) {
      resultMap[r.prompt_id] = r;
    }
    const promptResults = prompts.map((p) => resultMap[p.id]);

    // 6. Aggregate scores
    const dimensionScores = computeDimensionScores(promptResults);
    const overallScore = computeOverallScore(dimensionScores);
    const diagnosisLabel = determineDiagnosis(dimensionScores);

    // 7. Generate LLM summary from actual prompt responses
    let llmSummary = null;
    try {
      const summaryUserPrompt = buildSummaryUserPrompt(business_name, city, promptResults);
      const summaryResult = await adapter.call(
        SUMMARY_SYSTEM_PROMPT,
        summaryUserPrompt,
        SUMMARY_SCHEMA,
        { webSearch: false }
      );
      llmSummary = summaryResult.parsed.summary;
    } catch (err) {
      console.warn("LLM summary generation failed, falling back to template:", err.message);
    }

    // 8. Generate narrative (uses LLM summary if available, template fallback otherwise)
    const narrative = generateNarrative({
      businessName: business_name,
      dimensionScores,
      diagnosisLabel,
      overallScore,
      llmSummary,
    });

    // 9. Build cache key (uses place_id for stability when available)
    const cacheKey = buildCacheKey({
      placeId: place_id,
      businessName: business_name,
      city,
      reportType: report_type,
      promptSetVersion: PROMPT_SET_VERSION,
      modelVersion,
    });

    // 10. Persist result
    const resultId = randomUUID();
    const now = new Date().toISOString();
    const isMini = report_type === "mini";
    const ttl30Days = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60;

    const resultItem = {
      result_id: resultId,
      job_id: jobId,
      business_name,
      city,
      neighborhood: neighborhood || null,
      report_type,
      place_id: place_id || null,
      ground_truth: ground_truth || null,
      cache_key: cacheKey,
      overall_score: overallScore,
      dimension_scores: dimensionScores,
      diagnosis_label: diagnosisLabel,
      prompt_results: promptResults,
      prompt_set_version: PROMPT_SET_VERSION,
      model_id: modelVersion,
      model_provider: provider,
      narrative,
      created_at: now,
      // Mini reports never expire (one free report per business); full reports expire after 30 days
      ...(isMini ? {} : { expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(), ttl: ttl30Days }),
    };

    await dynamo.send(new PutCommand({
      TableName: resultsTable,
      Item: resultItem,
    }));

    // 11. Write cache entry — mini reports never expire, full reports have 30-day TTL
    const cacheItem = {
      cache_key: cacheKey,
      result_id: resultId,
      created_at: now,
    };
    if (!isMini) {
      cacheItem.ttl = ttl30Days;
    }
    await dynamo.send(new PutCommand({
      TableName: cacheTable,
      Item: cacheItem,
    }));

    // 12. Update job as completed
    await updateJobStatus(jobId, "completed", "Report ready!", prompts.length, prompts.length, resultId);

    // 13. Send email with report link and store lead
    if (email) {
      try {
        const leadCreatedAt = await storeLead({
          email,
          businessName: business_name,
          city,
          neighborhood,
          website,
          placeId: place_id,
          jobId,
          resultId,
        });
        await sendReportEmail({
          email,
          businessName: business_name,
          city,
          resultId,
          overallScore,
        });
        await markLeadEmailSent(email, leadCreatedAt, resultId);
      } catch (emailErr) {
        // Log but don't fail the pipeline — the report is already saved
        console.error("Failed to send report email:", emailErr);
      }
    }

    return resultId;
  } catch (error) {
    console.error("Report pipeline error:", error);
    await updateJobStatus(jobId, "failed", error.message);
    throw error;
  }
}

async function updateJobStatus(jobId, status, step, stepIndex, totalSteps, resultId) {
  const updateExpr = ["SET #status = :status", "step = :step", "updated_at = :now"];
  const exprValues = {
    ":status": status,
    ":step": step,
    ":now": new Date().toISOString(),
  };
  const exprNames = { "#status": "status" };

  if (stepIndex !== undefined) {
    updateExpr.push("step_index = :stepIndex");
    exprValues[":stepIndex"] = stepIndex;
  }
  if (totalSteps !== undefined) {
    updateExpr.push("total_steps = :totalSteps");
    exprValues[":totalSteps"] = totalSteps;
  }
  if (resultId) {
    updateExpr.push("result_id = :resultId");
    exprValues[":resultId"] = resultId;
  }
  if (status === "failed") {
    updateExpr.push("error_message = :errorMsg");
    exprValues[":errorMsg"] = step; // step contains error message when failed
  }

  await dynamo.send(new UpdateCommand({
    TableName: jobsTable,
    Key: { job_id: jobId },
    UpdateExpression: updateExpr.join(", "),
    ExpressionAttributeValues: exprValues,
    ExpressionAttributeNames: exprNames,
  }));
}

function clampScores(scores) {
  return {
    presence: Math.max(0, Math.min(3, Math.round(scores.presence || 0))),
    menu_knowledge: Math.max(0, Math.min(3, Math.round(scores.menu_knowledge || 0))),
    accuracy: Math.max(0, Math.min(2, Math.round(scores.accuracy || 0))),
    actionability: Math.max(0, Math.min(2, Math.round(scores.actionability || 0))),
  };
}
