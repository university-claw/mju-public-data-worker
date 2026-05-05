import got from "got";
import { HTTPError } from "got";
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
import {
  buildNoticeNormalizationUserPrompt,
  NOTICE_NORMALIZATION_SYSTEM_PROMPT,
} from "./normalization-prompt.js";
import {
  noticeNormalizationStructuredOutputSchema,
  noticeNormalizationStructuredOutputSchemaName,
} from "./normalization-output-schema.js";
import {
  resolveNoticePrimaryActionUrl,
  type NoticePrimaryActionUrlResolution,
} from "./action-url-resolver.js";
import type {
  NoticeDetailsJsonb,
  NoticeNormalizationContext,
  NoticeNormalizationSourceBundle,
  NoticeReadModelActionChannel,
  NoticeReadModelActionKind,
  NoticeReadModelBenefitKind,
  NoticeReadModelIssuerScope,
  NoticeReadModelNoticeKind,
  NoticeReadModelParticipationMode,
  NoticeReadModelPrimaryTimeKind,
} from "./types.js";

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";

export const DEFAULT_NOTICE_NORMALIZATION_MAX_OUTPUT_TOKENS = 4_000;

export const MODEL_PRICING_USD_PER_1M_TOKENS: Record<
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

export interface OpenAIResponsesUsage {
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
}

export interface NoticeNormalizationUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCostUsd: number | null;
}

export interface NoticeNormalizationRawResponse {
  usage?: OpenAIResponsesUsage;
  output?: unknown[];
  output_text?: unknown;
  [key: string]: unknown;
}

export interface NoticeNormalizationRuntimeResult {
  context: NoticeNormalizationContext;
  systemPrompt: string;
  userPrompt: string;
  rawOutputText: string;
  rawResponse: NoticeNormalizationRawResponse;
  parsedOutputBeforePostProcessing: NoticeNormalizationStructuredOutput;
  parsedOutput: NoticeNormalizationStructuredOutput;
  primaryActionUrlResolution: NoticePrimaryActionUrlResolution;
  usage: NoticeNormalizationUsage;
}

export interface RunNoticeNormalizationOptions {
  apiKey: string;
  model: string;
  bundle: NoticeNormalizationSourceBundle;
  maxOutputTokens?: number;
}

export async function runNoticeNormalization(
  options: RunNoticeNormalizationOptions,
): Promise<NoticeNormalizationRuntimeResult> {
  const context = createNoticeNormalizationContext(options.bundle, {
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
    apiKey: options.apiKey,
    model: options.model,
    userPrompt,
    maxOutputTokens:
      options.maxOutputTokens ?? DEFAULT_NOTICE_NORMALIZATION_MAX_OUTPUT_TOKENS,
  });
  const rawOutputText = extractResponseOutputText(response);
  const parsedOutputBeforePostProcessing = JSON.parse(
    rawOutputText,
  ) as NoticeNormalizationStructuredOutput;
  const { output: parsedOutput, resolution: primaryActionUrlResolution } =
    resolveNoticePrimaryActionUrl({
      output: parsedOutputBeforePostProcessing,
      bundle: options.bundle,
    });

  return {
    context,
    systemPrompt: NOTICE_NORMALIZATION_SYSTEM_PROMPT,
    userPrompt,
    rawOutputText,
    rawResponse: response,
    parsedOutputBeforePostProcessing,
    parsedOutput,
    primaryActionUrlResolution,
    usage: buildUsageSummary(options.model, response.usage),
  };
}

export async function callNoticeNormalizationModel(params: {
  apiKey: string;
  model: string;
  userPrompt: string;
  maxOutputTokens: number;
}): Promise<NoticeNormalizationRawResponse> {
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
      .json<NoticeNormalizationRawResponse>();

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

export function extractResponseOutputText(
  response: NoticeNormalizationRawResponse,
): string {
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

export function buildUsageSummary(
  model: string,
  usage: OpenAIResponsesUsage | undefined,
): NoticeNormalizationUsage {
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
