import { describe, expect, it } from "vitest";
import {
  buildNoticeNormalizationEvalSummary,
  type NoticeNormalizationEvalResult,
} from "../../src/notices/normalization-evaluator.js";

function createEvalResult(params: {
  model: string;
  sourceId: string;
  externalId: string;
  consistencyWarnings?: string[];
}): NoticeNormalizationEvalResult {
  return {
    dataset: "holdout",
    model: params.model,
    promptVersion: "v2",
    sample: {
      sourceId: params.sourceId,
      externalId: params.externalId,
      label: `${params.sourceId}:${params.externalId}`,
      shape: "mixed",
      reason: "test",
    },
    noticeItemId: 1,
    promptInputChars: 100,
    promptInput: "[NOTICE TITLE]\ntitle: 테스트",
    promptInputPreview: "[NOTICE TITLE]\ntitle: 테스트",
    systemPrompt: "system",
    userPrompt: "user",
    usage: {
      inputTokens: 10,
      outputTokens: 20,
      totalTokens: 30,
      estimatedCostUsd: 0.001,
    },
    validation: {
      schemaValid: true,
      missingFields: [],
      unknownDetailsTopLevelKeys: [],
      populatedScalarFacts: ["notice_kind", "summary"],
      populatedArrayFacts: ["target_audiences"],
      detailsTopLevelKeys: ["eligibility", "contact"],
      consistencyWarnings: params.consistencyWarnings ?? [],
    },
    parsedOutput: {
      notice_kind: "announcement",
      issuer_name: "테스트",
      issuer_scope: "internal",
      target_campuses: [],
      target_audiences: ["학생"],
      target_program_levels: [],
      target_departments: [],
      target_grade_years: [],
      primary_time_kind: null,
      primary_start_at: null,
      primary_end_at: null,
      primary_deadline_at: null,
      has_deadline: false,
      action_required: false,
      action_kind: null,
      primary_action_channel: null,
      primary_action_url: null,
      primary_location: null,
      participation_mode: null,
      has_benefit: false,
      benefit_kind: null,
      benefit_amount_krw: null,
      selection_count: null,
      summary: "요약",
      details_jsonb: {
        eligibility: [],
        required_documents: null,
        application_process: null,
        schedule_details: null,
        benefit_details: null,
        selection_details: null,
        content_details: null,
        resource_links: null,
        contact: [],
        important_notes: null,
        extra: null,
      },
    },
    rawOutputText: "{}",
    rawResponse: {},
  };
}

describe("buildNoticeNormalizationEvalSummary", () => {
  it("counts distinct notice samples instead of model runs", () => {
    const results = [
      createEvalResult({
        model: "gpt-5.4-mini",
        sourceId: "career",
        externalId: "230907",
      }),
      createEvalResult({
        model: "gpt-5.4-nano",
        sourceId: "career",
        externalId: "230907",
      }),
      createEvalResult({
        model: "gpt-5.4-mini",
        sourceId: "general",
        externalId: "230921",
      }),
      createEvalResult({
        model: "gpt-5.4-nano",
        sourceId: "general",
        externalId: "230921",
      }),
    ];

    const summary = buildNoticeNormalizationEvalSummary({
      dataset: "holdout",
      models: ["gpt-5.4-mini", "gpt-5.4-nano"],
      results,
      runId: "test-run",
    });

    expect(summary.sampleCount).toBe(2);
    expect(summary.coveredSourceIds).toEqual(["career", "general"]);
    expect(summary.missingSourceIds).toEqual(["event", "scholarship"]);
    expect(summary.manualReviewRequired).toBe(true);
  });

  it("aggregates consistency warning counts per model", () => {
    const results = [
      createEvalResult({
        model: "gpt-5.4-mini",
        sourceId: "career",
        externalId: "230907",
      }),
      createEvalResult({
        model: "gpt-5.4-mini",
        sourceId: "general",
        externalId: "230921",
      }),
      createEvalResult({
        model: "gpt-5.4-nano",
        sourceId: "career",
        externalId: "230907",
        consistencyWarnings: ["warning-a", "warning-b"],
      }),
    ];

    const summary = buildNoticeNormalizationEvalSummary({
      dataset: "tuning",
      models: ["gpt-5.4-mini", "gpt-5.4-nano"],
      results,
      runId: "test-run",
    });

    expect(summary.modelSummaries).toEqual([
      expect.objectContaining({
        model: "gpt-5.4-mini",
        sampleCount: 2,
        consistencyWarningCount: 0,
      }),
      expect.objectContaining({
        model: "gpt-5.4-nano",
        sampleCount: 1,
        consistencyWarningCount: 2,
      }),
    ]);
    expect(summary.summaryLimitations).toContain(
      "Aggregate metrics measure schema adherence, output density, token usage, and consistency warnings only.",
    );
  });
});
