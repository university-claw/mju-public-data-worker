import fs from "node:fs/promises";
import path from "node:path";
import { loadConfig } from "../config/env.js";
import { createPool } from "../db/client.js";
import { NoticeRepository } from "../db/notice-repository.js";
import {
  getNoticeNormalizationEvalDataset,
  type NoticeNormalizationEvalDatasetName,
  type NoticeNormalizationEvalSample,
} from "./normalization-eval-datasets.js";
import { NOTICE_SOURCES } from "./sources.js";
import { NOTICE_NORMALIZATION_PROMPT_VERSION } from "./normalization-prompt.js";
import type { NoticePrimaryActionUrlResolution } from "./action-url-resolver.js";
import {
  DEFAULT_NOTICE_NORMALIZATION_MAX_OUTPUT_TOKENS,
  runNoticeNormalization,
  type NoticeNormalizationStructuredOutput,
  type NoticeNormalizationUsage as NoticeNormalizationEvalUsage,
} from "./normalization-runtime.js";

export interface NoticeNormalizationEvalValidation {
  schemaValid: boolean;
  missingFields: string[];
  unknownDetailsTopLevelKeys: string[];
  populatedScalarFacts: string[];
  populatedArrayFacts: string[];
  detailsTopLevelKeys: string[];
  consistencyWarnings: string[];
}

export interface NoticeNormalizationEvalResult {
  dataset: NoticeNormalizationEvalDatasetName;
  model: string;
  promptVersion: string;
  sample: NoticeNormalizationEvalSample;
  noticeItemId: number;
  promptInputChars: number;
  promptInput: string;
  promptInputPreview: string;
  systemPrompt: string;
  userPrompt: string;
  usage: NoticeNormalizationEvalUsage;
  validation: NoticeNormalizationEvalValidation;
  primaryActionUrlResolution: NoticePrimaryActionUrlResolution;
  parsedOutput: NoticeNormalizationStructuredOutput;
  parsedOutputBeforePostProcessing: NoticeNormalizationStructuredOutput;
  rawOutputText: string;
  rawResponse: unknown;
}

export interface NoticeNormalizationEvalSummary {
  dataset: NoticeNormalizationEvalDatasetName;
  models: string[];
  promptVersion: string;
  runId: string;
  generatedAt: string;
  sampleCount: number;
  coveredSourceIds: string[];
  missingSourceIds: string[];
  manualReviewRequired: true;
  summaryLimitations: string[];
  modelSummaries: Array<{
    model: string;
    sampleCount: number;
    schemaValidCount: number;
    consistencyWarningCount: number;
    primaryActionUrlChangedCount: number;
    genericRootClearedCount: number;
    directCandidateReplacementCount: number;
    averageInputTokens: number;
    averageOutputTokens: number;
    averageEstimatedCostUsd: number | null;
    averagePopulatedScalarFacts: number;
    averageDetailsTopLevelKeys: number;
  }>;
}

export interface RunNoticeNormalizationEvalOptions {
  dataset: NoticeNormalizationEvalDatasetName;
  models: readonly string[];
  sampleLimit?: number;
  outputRoot?: string;
  maxOutputTokens?: number;
}

export async function runNoticeNormalizationEvaluation(
  options: RunNoticeNormalizationEvalOptions,
): Promise<{
  summaryPath: string;
  resultPaths: string[];
  summary: NoticeNormalizationEvalSummary;
}> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is required for notice normalization eval");
  }

  const config = loadConfig();
  const pool = createPool(config);
  const repository = new NoticeRepository(pool, config.pgSchema);
  const dataset = getNoticeNormalizationEvalDataset(options.dataset);
  const limitedDataset = dataset.slice(
    0,
    options.sampleLimit ? Math.max(1, options.sampleLimit) : dataset.length,
  );
  const outputRoot =
    options.outputRoot ??
    path.join(process.cwd(), "tmp", "notice-normalization-evals");
  const runId = `${new Date().toISOString().replace(/[:.]/g, "-")}-${
    options.dataset
  }`;
  const runDir = path.join(outputRoot, runId);

  await fs.mkdir(runDir, { recursive: true });

  try {
    const results: NoticeNormalizationEvalResult[] = [];

    for (const model of options.models) {
      const modelDir = path.join(runDir, model);
      await fs.mkdir(modelDir, { recursive: true });

      for (const sample of limitedDataset) {
        const noticeItemId = await repository.findNoticeItemIdBySourceExternalId(
          sample.sourceId,
          sample.externalId,
        );
        if (noticeItemId === null) {
          throw new Error(
            `notice sample ${sample.label} was not found in notice_items`,
          );
        }

        const bundle = await repository.getNormalizationSourceBundle(noticeItemId);
        const runtimeResult = await runNoticeNormalization({
          apiKey,
          model,
          bundle,
          maxOutputTokens:
            options.maxOutputTokens ??
            DEFAULT_NOTICE_NORMALIZATION_MAX_OUTPUT_TOKENS,
        });
        const validation = validateStructuredOutput(runtimeResult.parsedOutput);

        const result: NoticeNormalizationEvalResult = {
          dataset: options.dataset,
          model,
          promptVersion: NOTICE_NORMALIZATION_PROMPT_VERSION,
          sample,
          noticeItemId,
          promptInputChars: runtimeResult.context.promptInput.length,
          promptInput: runtimeResult.context.promptInput,
          promptInputPreview: runtimeResult.context.promptInput.slice(0, 4_000),
          systemPrompt: runtimeResult.systemPrompt,
          userPrompt: runtimeResult.userPrompt,
          usage: runtimeResult.usage,
          validation,
          primaryActionUrlResolution: runtimeResult.primaryActionUrlResolution,
          parsedOutput: runtimeResult.parsedOutput,
          parsedOutputBeforePostProcessing:
            runtimeResult.parsedOutputBeforePostProcessing,
          rawOutputText: runtimeResult.rawOutputText,
          rawResponse: runtimeResult.rawResponse,
        };

        const resultPath = path.join(
          modelDir,
          `${sample.sourceId}-${sample.externalId}.json`,
        );
        await fs.writeFile(resultPath, JSON.stringify(result, null, 2), "utf8");
        results.push(result);
      }
    }

    const summary = buildNoticeNormalizationEvalSummary({
      dataset: options.dataset,
      models: [...options.models],
      results,
      runId,
    });
    const summaryPath = path.join(runDir, "summary.json");
    await fs.writeFile(summaryPath, JSON.stringify(summary, null, 2), "utf8");

    return {
      summaryPath,
      resultPaths: results.map((result) =>
        path.join(
          runDir,
          result.model,
          `${result.sample.sourceId}-${result.sample.externalId}.json`,
        )
      ),
      summary,
    };
  } finally {
    await pool.end();
  }
}

function validateStructuredOutput(
  output: NoticeNormalizationStructuredOutput,
): NoticeNormalizationEvalValidation {
  const expectedFactKeys = [
    "notice_kind",
    "issuer_name",
    "issuer_scope",
    "target_campuses",
    "target_audiences",
    "target_program_levels",
    "target_departments",
    "target_grade_years",
    "primary_time_kind",
    "primary_start_at",
    "primary_end_at",
    "primary_deadline_at",
    "has_deadline",
    "action_required",
    "action_kind",
    "primary_action_channel",
    "primary_action_url",
    "primary_location",
    "participation_mode",
    "has_benefit",
    "benefit_kind",
    "benefit_amount_krw",
    "selection_count",
    "summary",
    "details_jsonb",
  ] as const;

  const missingFields = expectedFactKeys.filter((key) => !(key in output));
  const detailsKeys = output.details_jsonb
    ? Object.entries(output.details_jsonb)
        .filter(([, value]) => value !== null)
        .map(([key]) => key)
    : [];
  const unknownDetailsTopLevelKeys = detailsKeys.filter(
    (key) => !keyAllowedInDetailsJsonb(key),
  );
  const consistencyWarnings: string[] = [];

  if (output.has_deadline && !output.primary_deadline_at) {
    consistencyWarnings.push("has_deadline=true but primary_deadline_at is null");
  }
  if (!output.has_deadline && output.primary_deadline_at) {
    consistencyWarnings.push("primary_deadline_at is set while has_deadline=false");
  }

  const populatedScalarFacts = expectedFactKeys.filter((key) => {
    if (key === "details_jsonb") {
      return false;
    }

    const value = output[key];
    if (Array.isArray(value)) {
      return false;
    }
    if (typeof value === "boolean") {
      return value;
    }
    return value !== null && value !== undefined && value !== "";
  });

  const populatedArrayFacts = expectedFactKeys.filter((key) => {
    const value = output[key];
    return Array.isArray(value) && value.length > 0;
  });

  return {
    schemaValid:
      missingFields.length === 0 && unknownDetailsTopLevelKeys.length === 0,
    missingFields,
    unknownDetailsTopLevelKeys,
    populatedScalarFacts: [...populatedScalarFacts],
    populatedArrayFacts: [...populatedArrayFacts],
    detailsTopLevelKeys: detailsKeys,
    consistencyWarnings,
  };
}

function keyAllowedInDetailsJsonb(key: string): boolean {
  return [
    "eligibility",
    "required_documents",
    "application_process",
    "schedule_details",
    "benefit_details",
    "selection_details",
    "content_details",
    "resource_links",
    "contact",
    "important_notes",
    "extra",
  ].includes(key);
}

export function buildNoticeNormalizationEvalSummary(params: {
  dataset: NoticeNormalizationEvalDatasetName;
  models: string[];
  results: NoticeNormalizationEvalResult[];
  runId: string;
}): NoticeNormalizationEvalSummary {
  const modelSummaries = params.models.map((model) => {
    const results = params.results.filter((result) => result.model === model);
    const schemaValidCount = results.filter((result) =>
      result.validation.schemaValid
    ).length;
    const consistencyWarningCount = results.reduce(
      (sum, result) => sum + result.validation.consistencyWarnings.length,
      0,
    );
    const primaryActionUrlChangedCount = results.filter(
      (result) =>
        result.primaryActionUrlResolution.initialUrl !==
        result.primaryActionUrlResolution.finalUrl,
    ).length;
    const genericRootClearedCount = results.filter(
      (result) =>
        result.primaryActionUrlResolution.decision === "cleared_generic_root",
    ).length;
    const directCandidateReplacementCount = results.filter(
      (result) =>
        result.primaryActionUrlResolution.decision ===
        "replaced_with_direct_candidate",
    ).length;

    return {
      model,
      sampleCount: results.length,
      schemaValidCount,
      consistencyWarningCount,
      primaryActionUrlChangedCount,
      genericRootClearedCount,
      directCandidateReplacementCount,
      averageInputTokens: average(results.map((result) => result.usage.inputTokens)),
      averageOutputTokens: average(
        results.map((result) => result.usage.outputTokens),
      ),
      averageEstimatedCostUsd: averageNullable(
        results.map((result) => result.usage.estimatedCostUsd),
      ),
      averagePopulatedScalarFacts: average(
        results.map((result) => result.validation.populatedScalarFacts.length),
      ),
      averageDetailsTopLevelKeys: average(
        results.map((result) => result.validation.detailsTopLevelKeys.length),
      ),
    };
  });
  const distinctSampleCount = new Set(
    params.results.map((result) => `${result.sample.sourceId}:${result.sample.externalId}`),
  ).size;
  const coveredSourceIds = [
    ...new Set(params.results.map((result) => result.sample.sourceId)),
  ].sort();
  const missingSourceIds = NOTICE_SOURCES.map((source) => source.id).filter(
    (sourceId) => !coveredSourceIds.includes(sourceId),
  ).sort();
  const summaryLimitations = [
    "Aggregate metrics measure schema adherence, output density, token usage, and consistency warnings only.",
    "Semantic correctness and model choice still require manual review of saved per-notice artifacts.",
  ];
  if (missingSourceIds.length > 0) {
    summaryLimitations.push(
      `This dataset does not cover every notice source. Missing source_ids: ${missingSourceIds.join(
        ", ",
      )}.`,
    );
  }

  return {
    dataset: params.dataset,
    models: params.models,
    promptVersion: NOTICE_NORMALIZATION_PROMPT_VERSION,
    runId: params.runId,
    generatedAt: new Date().toISOString(),
    sampleCount: distinctSampleCount,
    coveredSourceIds,
    missingSourceIds,
    manualReviewRequired: true,
    summaryLimitations,
    modelSummaries,
  };
}

function average(values: readonly number[]): number {
  if (values.length === 0) {
    return 0;
  }

  return Number(
    (values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2),
  );
}

function averageNullable(values: readonly (number | null)[]): number | null {
  const numericValues = values.filter((value): value is number => value !== null);
  if (numericValues.length === 0) {
    return null;
  }

  return average(numericValues);
}
