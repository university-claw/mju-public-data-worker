import fs from "node:fs/promises";
import path from "node:path";
import got from "got";
import { HTTPError } from "got";
import { loadConfig } from "../config/env.js";
import { createPool } from "../db/client.js";
import { NoticeRepository } from "../db/notice-repository.js";
import {
  createNoticeNormalizationContext,
  DEFAULT_NOTICE_NORMALIZATION_MAX_ATTACHMENT_CHARS,
  DEFAULT_NOTICE_NORMALIZATION_MAX_ATTACHMENT_COUNT,
  DEFAULT_NOTICE_NORMALIZATION_MAX_BODY_CHARS,
  DEFAULT_NOTICE_NORMALIZATION_MAX_BODY_LINK_COUNT,
  DEFAULT_NOTICE_NORMALIZATION_MAX_IMAGE_CHARS,
  DEFAULT_NOTICE_NORMALIZATION_MAX_IMAGE_COUNT,
  DEFAULT_NOTICE_NORMALIZATION_MAX_TOTAL_CHARS,
} from "./normalization-context.js";
import type {
  NoticeDetailsJsonb,
  NoticeReadModelActionChannel,
  NoticeReadModelActionKind,
  NoticeReadModelBenefitKind,
  NoticeReadModelIssuerScope,
  NoticeReadModelNoticeKind,
  NoticeReadModelParticipationMode,
  NoticeReadModelPrimaryTimeKind,
} from "./types.js";
import {
  getNoticeNormalizationEvalDataset,
  type NoticeNormalizationEvalDatasetName,
  type NoticeNormalizationEvalSample,
} from "./normalization-eval-datasets.js";
import { NOTICE_SOURCES } from "./sources.js";
import {
  buildNoticeNormalizationUserPrompt,
  NOTICE_NORMALIZATION_PROMPT_VERSION,
  NOTICE_NORMALIZATION_SYSTEM_PROMPT,
} from "./normalization-prompt.js";
import {
  noticeNormalizationStructuredOutputSchema,
  noticeNormalizationStructuredOutputSchemaName,
} from "./normalization-output-schema.js";

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const DEFAULT_NOTICE_NORMALIZATION_MAX_OUTPUT_TOKENS = 4_000;

const MODEL_PRICING_USD_PER_1M_TOKENS: Record<
  string,
  { input: number; output: number }
> = {
  "gpt-5.4-mini": { input: 0.75, output: 4.5 },
  "gpt-5.4-nano": { input: 0.2, output: 1.25 },
};

export interface NoticeNormalizationStructuredOutput {
  notice_kind: NoticeReadModelNoticeKind | null;
  issuer_name: string | null;
  issuer_scope: NoticeReadModelIssuerScope | null;
  target_campuses: string[];
  target_audiences: string[];
  target_program_levels: string[];
  target_departments: string[];
  target_grade_years: number[];
  primary_time_kind: NoticeReadModelPrimaryTimeKind | null;
  primary_start_at: string | null;
  primary_end_at: string | null;
  primary_deadline_at: string | null;
  has_deadline: boolean;
  action_required: boolean;
  action_kind: NoticeReadModelActionKind | null;
  primary_action_channel: NoticeReadModelActionChannel | null;
  primary_action_url: string | null;
  primary_location: string | null;
  participation_mode: NoticeReadModelParticipationMode | null;
  has_benefit: boolean;
  benefit_kind: NoticeReadModelBenefitKind | null;
  benefit_amount_krw: number | null;
  selection_count: number | null;
  summary: string | null;
  details_jsonb: NoticeDetailsJsonb | null;
}

export interface NoticeNormalizationEvalUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCostUsd: number | null;
}

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
  parsedOutput: NoticeNormalizationStructuredOutput;
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

interface OpenAIResponsesUsage {
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
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
        const context = createNoticeNormalizationContext(bundle, {
          maxBodyChars: DEFAULT_NOTICE_NORMALIZATION_MAX_BODY_CHARS,
          maxAttachmentChars: DEFAULT_NOTICE_NORMALIZATION_MAX_ATTACHMENT_CHARS,
          maxImageChars: DEFAULT_NOTICE_NORMALIZATION_MAX_IMAGE_CHARS,
          maxAttachmentCount: DEFAULT_NOTICE_NORMALIZATION_MAX_ATTACHMENT_COUNT,
          maxImageCount: DEFAULT_NOTICE_NORMALIZATION_MAX_IMAGE_COUNT,
          maxBodyLinkCount: DEFAULT_NOTICE_NORMALIZATION_MAX_BODY_LINK_COUNT,
          maxTotalChars: DEFAULT_NOTICE_NORMALIZATION_MAX_TOTAL_CHARS,
        });
        const userPrompt = buildNoticeNormalizationUserPrompt(context.promptInput);

        const response = await callNoticeNormalizationModel({
          apiKey,
          model,
          userPrompt,
          maxOutputTokens:
            options.maxOutputTokens ??
            DEFAULT_NOTICE_NORMALIZATION_MAX_OUTPUT_TOKENS,
        });

        const rawOutputText = extractResponseOutputText(response);
        const parsedOutput = JSON.parse(
          rawOutputText,
        ) as NoticeNormalizationStructuredOutput;
        const validation = validateStructuredOutput(parsedOutput);
        const usage = buildUsageSummary(model, response.usage);

        const result: NoticeNormalizationEvalResult = {
          dataset: options.dataset,
          model,
          promptVersion: NOTICE_NORMALIZATION_PROMPT_VERSION,
          sample,
          noticeItemId,
          promptInputChars: context.promptInput.length,
          promptInput: context.promptInput,
          promptInputPreview: context.promptInput.slice(0, 4_000),
          systemPrompt: NOTICE_NORMALIZATION_SYSTEM_PROMPT,
          userPrompt,
          usage,
          validation,
          parsedOutput,
          rawOutputText,
          rawResponse: response,
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

async function callNoticeNormalizationModel(params: {
  apiKey: string;
  model: string;
  userPrompt: string;
  maxOutputTokens: number;
}): Promise<{
  usage?: OpenAIResponsesUsage;
  output?: unknown[];
  [key: string]: unknown;
}> {
  try {
    const response = await got
      .post(OPENAI_RESPONSES_URL, {
        headers: {
          authorization: `Bearer ${params.apiKey}`,
          "content-type": "application/json",
        },
        json: {
          model: params.model,
          input: [
            {
              role: "system",
              content: [
                {
                  type: "input_text",
                  text: NOTICE_NORMALIZATION_SYSTEM_PROMPT,
                },
              ],
            },
            {
              role: "user",
              content: [
                {
                  type: "input_text",
                  text: params.userPrompt,
                },
              ],
            },
          ],
          max_output_tokens: params.maxOutputTokens,
          temperature: 0,
          text: {
            format: {
              type: "json_schema",
              strict: true,
              name: noticeNormalizationStructuredOutputSchemaName,
              schema: noticeNormalizationStructuredOutputSchema,
            },
          },
        },
        responseType: "json",
      })
      .json<{
        usage?: OpenAIResponsesUsage;
        output?: unknown[];
        [key: string]: unknown;
      }>();

    return response;
  } catch (error) {
    if (error instanceof HTTPError) {
      const statusCode = error.response.statusCode;
      const responseBody =
        typeof error.response.body === "string"
          ? error.response.body
          : JSON.stringify(error.response.body);
      throw new Error(
        `OpenAI Responses API request failed with status ${statusCode}: ${responseBody}`,
      );
    }

    throw error;
  }
}

function extractResponseOutputText(response: {
  output?: unknown[];
  output_text?: unknown;
}): string {
  if (typeof response.output_text === "string" && response.output_text.trim()) {
    return response.output_text;
  }

  const texts: string[] = [];
  for (const item of response.output ?? []) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const content = (item as { content?: unknown[] }).content ?? [];
    for (const entry of content) {
      if (
        entry &&
        typeof entry === "object" &&
        (entry as { type?: string }).type === "output_text" &&
        typeof (entry as { text?: unknown }).text === "string"
      ) {
        texts.push((entry as { text: string }).text);
      }
    }
  }

  const combined = texts.join("\n").trim();
  if (!combined) {
    throw new Error("OpenAI Responses API returned no output_text content");
  }

  return combined;
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

function buildUsageSummary(
  model: string,
  usage: OpenAIResponsesUsage | undefined,
): NoticeNormalizationEvalUsage {
  const inputTokens = usage?.input_tokens ?? 0;
  const outputTokens = usage?.output_tokens ?? 0;
  const totalTokens = usage?.total_tokens ?? inputTokens + outputTokens;
  const pricing = MODEL_PRICING_USD_PER_1M_TOKENS[model];
  const estimatedCostUsd = pricing
    ? (inputTokens / 1_000_000) * pricing.input +
      (outputTokens / 1_000_000) * pricing.output
    : null;

  return {
    inputTokens,
    outputTokens,
    totalTokens,
    estimatedCostUsd,
  };
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

    return {
      model,
      sampleCount: results.length,
      schemaValidCount,
      consistencyWarningCount,
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
