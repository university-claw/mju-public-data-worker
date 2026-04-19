import { beforeEach, describe, expect, it, vi } from "vitest";
import { createNoticeNormalizationRunner } from "../../src/notices/normalization-runner.js";
import type {
  NoticeNormalizationContext,
  NoticeNormalizationSourceBundle,
} from "../../src/notices/types.js";
import type { NoticeNormalizationRuntimeResult } from "../../src/notices/normalization-runtime.js";

function createBundle(): NoticeNormalizationSourceBundle {
  return {
    source: {
      id: "scholarship",
      name: "장학공지",
      description: "장학 공지",
      listUrl: "https://example.com/list",
    },
    notice: {
      noticeItemId: 10,
      sourceId: "scholarship",
      externalId: "230100",
      title: "테스트 공지",
      categoryLabel: null,
      detailUrl: "https://example.com/notices/230100",
      listUrl: "https://example.com/list",
      author: null,
      publishedAt: "2026-04-19T10:00:00+09:00",
      publishedAtRaw: "2026.04.19",
      bodyText: "본문 텍스트",
      bodyHtml: "<p>본문 텍스트</p>",
      contentHash: "hash",
      attachmentsCount: 1,
      imagesCount: 0,
      firstSeenAt: "2026-04-19T10:00:00+09:00",
      lastSeenAt: "2026-04-19T10:00:00+09:00",
      lastScrapedAt: "2026-04-19T10:00:00+09:00",
    },
    attachments: [
      {
        attachmentId: 1,
        fileName: "guide.pdf",
        downloadUrl: "https://example.com/guide.pdf",
        sortOrder: 0,
        storageKey: null,
        contentType: "application/pdf",
        downloadStatus: "succeeded",
        extractionStatus: "succeeded",
        extractorType: "pdf",
        extractedText: "첨부 텍스트",
        extractedCharCount: 20,
        extractedAt: "2026-04-19T10:01:00+09:00",
        errorMessage: null,
      },
    ],
    images: [],
  };
}

function createContext(): NoticeNormalizationContext {
  return {
    source: createBundle().source,
    notice: createBundle().notice,
    bodyTextBlock: {
      text: "본문 텍스트",
      originalCharCount: 6,
      includedCharCount: 6,
      truncated: false,
    },
    bodyLinks: [],
    attachments: [
      {
        attachmentId: 1,
        fileName: "guide.pdf",
        downloadUrl: "https://example.com/guide.pdf",
        sortOrder: 0,
        storageKey: null,
        contentType: "application/pdf",
        downloadStatus: "succeeded",
        extractionStatus: "succeeded",
        extractorType: "pdf",
        extractedAt: "2026-04-19T10:01:00+09:00",
        errorMessage: null,
        textBlock: {
          text: "첨부 텍스트",
          originalCharCount: 6,
          includedCharCount: 6,
          truncated: false,
        },
      },
    ],
    images: [],
    stats: {
      attachmentCount: 1,
      attachmentTextAvailableCount: 1,
      attachmentTextMissingCount: 0,
      attachmentOmittedCount: 0,
      imageCount: 0,
      imageTextAvailableCount: 0,
      imageTextMissingCount: 0,
      imageOmittedCount: 0,
    },
    promptInput: "[NOTICE TITLE]\ntitle: 테스트 공지",
  };
}

function createRuntimeResult(): NoticeNormalizationRuntimeResult {
  return {
    context: createContext(),
    systemPrompt: "system",
    userPrompt: "user",
    rawOutputText: "{}",
    rawResponse: {},
    parsedOutputBeforePostProcessing: {
      notice_kind: "scholarship",
      issuer_name: "테스트 장학재단",
      issuer_scope: "external",
      target_campuses: ["humanities"],
      target_audiences: ["student"],
      target_program_levels: ["undergraduate"],
      target_departments: [],
      target_grade_years: [3],
      primary_time_kind: "application_period",
      primary_start_at: "2026-04-19",
      primary_end_at: "2026-04-30",
      primary_deadline_at: "2026-04-30",
      has_deadline: true,
      action_required: true,
      action_kind: "apply",
      primary_action_channel: "web_form",
      primary_action_url: "https://example.com/apply",
      primary_location: null,
      participation_mode: "online",
      has_benefit: true,
      benefit_kind: "scholarship",
      benefit_amount_krw: 2000000,
      selection_count: 10,
      summary: "요약",
      details_jsonb: {
        eligibility: null,
        required_documents: [{ title: "필수", content: "신청서" }],
        application_process: null,
        schedule_details: null,
        benefit_details: null,
        selection_details: null,
        content_details: null,
        resource_links: null,
        contact: null,
        important_notes: null,
        extra: null,
      },
    },
    parsedOutput: {
      notice_kind: "scholarship",
      issuer_name: "테스트 장학재단",
      issuer_scope: "external",
      target_campuses: ["humanities"],
      target_audiences: ["student"],
      target_program_levels: ["undergraduate"],
      target_departments: [],
      target_grade_years: [3],
      primary_time_kind: "application_period",
      primary_start_at: "2026-04-19",
      primary_end_at: "2026-04-30",
      primary_deadline_at: "2026-04-30",
      has_deadline: true,
      action_required: true,
      action_kind: "apply",
      primary_action_channel: "web_form",
      primary_action_url: "https://example.com/apply",
      primary_location: null,
      participation_mode: "online",
      has_benefit: true,
      benefit_kind: "scholarship",
      benefit_amount_krw: 2000000,
      selection_count: 10,
      summary: "요약",
      details_jsonb: {
        eligibility: null,
        required_documents: [{ title: "필수", content: "신청서" }],
        application_process: null,
        schedule_details: null,
        benefit_details: null,
        selection_details: null,
        content_details: null,
        resource_links: null,
        contact: null,
        important_notes: null,
        extra: null,
      },
    },
    primaryActionUrlResolution: {
      initialUrl: "https://example.com/apply",
      finalUrl: "https://example.com/apply",
      decision: "unchanged",
      reason: "direct link",
      directCandidateCount: 1,
      genericRootCandidateCount: 0,
    },
    usage: {
      inputTokens: 100,
      outputTokens: 40,
      totalTokens: 140,
      estimatedCostUsd: 0.001,
    },
  };
}

describe("notice normalization runner", () => {
  const repository = {
    getNormalizationSourceBundle: vi.fn(async () => createBundle()),
    getReadModelByNoticeItemId: vi.fn(async () => null),
    upsertReadModel: vi.fn(async () => undefined),
    updateNoticeNormalizationState: vi.fn(async () => undefined),
  };
  const runNormalization = vi.fn(async () => createRuntimeResult());

  beforeEach(() => {
    vi.clearAllMocks();
    repository.getNormalizationSourceBundle.mockResolvedValue(createBundle());
    repository.getReadModelByNoticeItemId.mockResolvedValue(null);
    repository.upsertReadModel.mockResolvedValue(undefined);
    repository.updateNoticeNormalizationState.mockResolvedValue(undefined);
    runNormalization.mockResolvedValue(createRuntimeResult());
  });

  it("writes a succeeded notice read model from structured output", async () => {
    const runner = createNoticeNormalizationRunner({
      repository,
      apiKey: "test-key",
      enabled: true,
      model: "gpt-5.4-mini",
      runNormalization,
      now: () => new Date("2026-04-19T02:00:00.000Z"),
    });

    const result = await runner.normalizeNotice(10);

    expect(result).toMatchObject({
      noticeItemId: 10,
      status: "succeeded",
      normalizedAt: "2026-04-19T02:00:00.000Z",
    });
    expect(result.normalizedConfidence).toBeGreaterThan(0.5);
    expect(repository.upsertReadModel).toHaveBeenCalledWith(
      expect.objectContaining({
        noticeItemId: 10,
        noticeKind: "scholarship",
        primaryActionUrl: "https://example.com/apply",
        normalizationStatus: "succeeded",
        normalizationErrorMessage: null,
      }),
    );
    expect(repository.updateNoticeNormalizationState).toHaveBeenCalledWith({
      noticeItemId: 10,
      status: "succeeded",
      normalizedAt: "2026-04-19T02:00:00.000Z",
      errorMessage: null,
    });
  });

  it("does not create a new read model row when the first normalization attempt fails", async () => {
    runNormalization.mockRejectedValueOnce(new Error("OpenAI timeout"));
    const runner = createNoticeNormalizationRunner({
      repository,
      apiKey: "test-key",
      enabled: true,
      model: "gpt-5.4-mini",
      runNormalization,
      now: () => new Date("2026-04-19T02:00:00.000Z"),
    });

    const result = await runner.normalizeNotice(10);

    expect(result).toEqual({
      noticeItemId: 10,
      status: "failed",
      normalizedAt: "2026-04-19T02:00:00.000Z",
      normalizedConfidence: null,
      errorMessage: "OpenAI timeout",
      persistedFailureState: false,
    });
    expect(repository.updateNoticeNormalizationState).toHaveBeenCalledWith({
      noticeItemId: 10,
      status: "failed",
      normalizedAt: "2026-04-19T02:00:00.000Z",
      errorMessage: "OpenAI timeout",
    });
    expect(repository.upsertReadModel).not.toHaveBeenCalled();
  });

  it("preserves the existing read model payload when a re-normalization attempt fails", async () => {
    runNormalization.mockRejectedValueOnce(new Error("schema parse failed"));
    repository.getReadModelByNoticeItemId.mockResolvedValueOnce({
      id: 77,
      noticeItemId: 10,
      sourceId: "scholarship",
      externalId: "230100",
      noticeKind: "scholarship",
      issuerName: "기존 재단",
      issuerScope: "external",
      targetCampuses: ["humanities"],
      targetAudiences: ["student"],
      targetProgramLevels: ["undergraduate"],
      targetDepartments: [],
      targetGradeYears: [2],
      primaryTimeKind: "application_period",
      primaryStartAt: "2026-04-10",
      primaryEndAt: "2026-04-20",
      primaryDeadlineAt: "2026-04-20",
      hasDeadline: true,
      actionRequired: true,
      actionKind: "apply",
      primaryActionChannel: "web_form",
      primaryActionUrl: "https://example.com/apply",
      primaryLocation: null,
      participationMode: "online",
      hasBenefit: true,
      benefitKind: "scholarship",
      benefitAmountKrw: 1000000,
      selectionCount: 5,
      summary: "기존 요약",
      detailsJsonb: {
        eligibility: null,
        required_documents: [{ title: "기존", content: "신청서" }],
        application_process: null,
        schedule_details: null,
        benefit_details: null,
        selection_details: null,
        content_details: null,
        resource_links: null,
        contact: null,
        important_notes: null,
        extra: null,
      },
      normalizedConfidence: 0.88,
      normalizedAt: "2026-04-18T00:00:00.000Z",
      normalizationStatus: "succeeded",
      normalizationErrorMessage: null,
      createdAt: "2026-04-18T00:00:00.000Z",
      updatedAt: "2026-04-18T00:00:00.000Z",
    });

    const runner = createNoticeNormalizationRunner({
      repository,
      apiKey: "test-key",
      enabled: true,
      model: "gpt-5.4-mini",
      runNormalization,
      now: () => new Date("2026-04-19T02:00:00.000Z"),
    });

    await runner.normalizeNotice(10);

    expect(repository.updateNoticeNormalizationState).toHaveBeenCalledWith({
      noticeItemId: 10,
      status: "failed",
      normalizedAt: "2026-04-19T02:00:00.000Z",
      errorMessage: "schema parse failed",
    });
    expect(repository.upsertReadModel).toHaveBeenCalledWith(
      expect.objectContaining({
        noticeItemId: 10,
        issuerName: "기존 재단",
        summary: "기존 요약",
        normalizedConfidence: 0.88,
        normalizationStatus: "failed",
        normalizationErrorMessage: "schema parse failed",
      }),
    );
  });

  it("skips normalization cleanly when disabled", async () => {
    const runner = createNoticeNormalizationRunner({
      repository,
      enabled: false,
      model: "gpt-5.4-mini",
      runNormalization,
    });

    const result = await runner.normalizeNotice(10);

    expect(result).toEqual({
      noticeItemId: 10,
      status: "skipped",
      normalizedAt: null,
      normalizedConfidence: null,
    });
    expect(repository.getNormalizationSourceBundle).not.toHaveBeenCalled();
    expect(runNormalization).not.toHaveBeenCalled();
    expect(repository.upsertReadModel).not.toHaveBeenCalled();
    expect(repository.updateNoticeNormalizationState).not.toHaveBeenCalled();
  });
});
