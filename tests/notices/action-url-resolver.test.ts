import { describe, expect, it } from "vitest";
import { resolveNoticePrimaryActionUrl } from "../../src/notices/action-url-resolver.js";
import type {
  NoticeDetailsJsonb,
  NoticeNormalizationSourceBundle,
} from "../../src/notices/types.js";
import type { NoticeNormalizationStructuredOutput } from "../../src/notices/normalization-evaluator.js";

function createBundle(params: {
  bodyText?: string | null;
  bodyHtml?: string | null;
  attachmentTexts?: string[];
  imageTexts?: string[];
}): NoticeNormalizationSourceBundle {
  return {
    source: {
      id: "scholarship",
      name: "장학공지",
      description: "장학 공지",
      listUrl: "https://example.com/list",
    },
    notice: {
      noticeItemId: 1,
      sourceId: "scholarship",
      externalId: "230000",
      title: "테스트 공지",
      categoryLabel: null,
      detailUrl: "https://example.com/notices/230000",
      listUrl: "https://example.com/list",
      author: null,
      publishedAt: "2026-04-19T10:00:00+09:00",
      publishedAtRaw: "2026.04.19",
      bodyText: params.bodyText ?? null,
      bodyHtml: params.bodyHtml ?? null,
      contentHash: null,
      attachmentsCount: params.attachmentTexts?.length ?? 0,
      imagesCount: params.imageTexts?.length ?? 0,
      firstSeenAt: "2026-04-19T10:00:00+09:00",
      lastSeenAt: "2026-04-19T10:00:00+09:00",
      lastScrapedAt: "2026-04-19T10:00:00+09:00",
    },
    attachments: (params.attachmentTexts ?? []).map((text, index) => ({
      attachmentId: index + 1,
      fileName: `${index + 1}.pdf`,
      downloadUrl: `https://example.com/${index + 1}.pdf`,
      sortOrder: index,
      storageKey: null,
      contentType: "application/pdf",
      downloadStatus: "succeeded" as const,
      extractionStatus: "succeeded" as const,
      extractorType: "pdf" as const,
      extractedText: text,
      extractedCharCount: text.length,
      extractedAt: null,
      errorMessage: null,
    })),
    images: (params.imageTexts ?? []).map((text, index) => ({
      imageId: index + 1,
      imageUrl: `https://example.com/${index + 1}.png`,
      altText: null,
      sortOrder: index,
      storageKey: null,
      contentType: "image/png",
      downloadStatus: "succeeded" as const,
      ocrStatus: "succeeded" as const,
      ocrText: text,
      ocrConfidence: null,
      ocrLanguage: null,
      ocrExtractedAt: null,
      errorMessage: null,
    })),
  };
}

function createOutput(
  overrides: Partial<NoticeNormalizationStructuredOutput> = {},
): NoticeNormalizationStructuredOutput {
  return {
    notice_kind: "scholarship",
    issuer_name: "테스트",
    issuer_scope: "external",
    target_campuses: [],
    target_audiences: [],
    target_program_levels: [],
    target_departments: [],
    target_grade_years: [],
    primary_time_kind: "application_period",
    primary_start_at: "2026-03-25T09:00:00+09:00",
    primary_end_at: "2026-04-07T18:00:00+09:00",
    primary_deadline_at: "2026-04-07T18:00:00+09:00",
    has_deadline: true,
    action_required: true,
    action_kind: "apply",
    primary_action_channel: "web_form",
    primary_action_url: null,
    primary_location: null,
    participation_mode: "online",
    has_benefit: true,
    benefit_kind: "scholarship",
    benefit_amount_krw: 3000000,
    selection_count: 200,
    summary: "요약",
    details_jsonb: {
      eligibility: null,
      required_documents: null,
      application_process: null,
      schedule_details: null,
      benefit_details: null,
      selection_details: null,
      content_details: null,
      resource_links: null,
      contact: null,
      important_notes: null,
      extra: null,
    } satisfies NoticeDetailsJsonb,
    ...overrides,
  };
}

describe("resolveNoticePrimaryActionUrl", () => {
  it("clears a generic root URL when only homepage navigation guidance is available", () => {
    const bundle = createBundle({
      attachmentTexts: [
        "푸른등대 삼성기부장학금 신청하기: 한국장학재단 누리집 접속(www.kosaf.go.kr) 후 [장학금>기부장학금>푸른등대 삼성기부장학금] 클릭",
      ],
    });
    const output = createOutput({
      primary_action_url: "https://www.kosaf.go.kr",
      details_jsonb: {
        eligibility: null,
        required_documents: null,
        application_process: null,
        schedule_details: null,
        benefit_details: null,
        selection_details: null,
        content_details: null,
        resource_links: [
          {
            label: "한국장학재단 홈페이지",
            url: "https://www.kosaf.go.kr",
            purpose: "신청 및 안내",
          },
        ],
        contact: null,
        important_notes: null,
        extra: null,
      },
    });

    const result = resolveNoticePrimaryActionUrl({ output, bundle });

    expect(result.output.primary_action_url).toBeNull();
    expect(result.output.details_jsonb?.resource_links).toHaveLength(1);
    expect(result.resolution.decision).toBe("cleared_generic_root");
  });

  it("keeps a short direct form link chosen by the model", () => {
    const bundle = createBundle({
      bodyText:
        "지원양식을 작성한 뒤 아래 네이버 폼으로 제출 바랍니다. 접수방법: https://naver.me/xVRKtWNy",
      bodyHtml:
        "<p><a href=\"https://naver.me/xVRKtWNy\">신청 링크</a></p>",
    });
    const output = createOutput({
      primary_action_url: "https://naver.me/xVRKtWNy",
      details_jsonb: {
        eligibility: null,
        required_documents: null,
        application_process: null,
        schedule_details: null,
        benefit_details: null,
        selection_details: null,
        content_details: null,
        resource_links: [
          {
            label: "신청 링크",
            url: "https://naver.me/xVRKtWNy",
            purpose: "신청",
          },
        ],
        contact: null,
        important_notes: null,
        extra: null,
      },
    });

    const result = resolveNoticePrimaryActionUrl({ output, bundle });

    expect(result.output.primary_action_url).toBe("https://naver.me/xVRKtWNy");
    expect(result.output.details_jsonb?.resource_links).toBeNull();
    expect(result.resolution.decision).toBe("unchanged");
  });

  it("replaces a generic root URL with a stronger direct candidate when one exists", () => {
    const bundle = createBundle({
      bodyText:
        "안내 페이지: https://example.com/ 접수 링크: https://example.com/apply/form?id=77",
    });
    const output = createOutput({
      primary_action_url: "https://example.com/",
      details_jsonb: {
        eligibility: null,
        required_documents: null,
        application_process: null,
        schedule_details: null,
        benefit_details: null,
        selection_details: null,
        content_details: null,
        resource_links: [
          {
            label: "홈페이지",
            url: "https://example.com/",
            purpose: "안내",
          },
          {
            label: "접수 링크",
            url: "https://example.com/apply/form?id=77",
            purpose: "신청",
          },
        ],
        contact: null,
        important_notes: null,
        extra: null,
      },
    });

    const result = resolveNoticePrimaryActionUrl({ output, bundle });

    expect(result.output.primary_action_url).toBe(
      "https://example.com/apply/form?id=77",
    );
    expect(result.output.primary_action_channel).toBe("web_form");
    expect(result.output.details_jsonb?.resource_links).toEqual([
      {
        label: "홈페이지",
        url: "https://example.com/",
        purpose: "안내",
      },
    ]);
    expect(result.resolution.decision).toBe("replaced_with_direct_candidate");
  });

  it("does not replace a generic root URL when multiple direct candidates are present", () => {
    const bundle = createBundle({
      bodyText:
        "안내 페이지: https://example.com/ 신청 링크: https://example.com/apply/form?id=77 접수 링크: https://example.com/register/form?id=88",
    });
    const output = createOutput({
      primary_action_url: "https://example.com/",
      details_jsonb: {
        eligibility: null,
        required_documents: null,
        application_process: null,
        schedule_details: null,
        benefit_details: null,
        selection_details: null,
        content_details: null,
        resource_links: [
          {
            label: "홈페이지",
            url: "https://example.com/",
            purpose: "안내",
          },
          {
            label: "신청 링크",
            url: "https://example.com/apply/form?id=77",
            purpose: "신청",
          },
          {
            label: "접수 링크",
            url: "https://example.com/register/form?id=88",
            purpose: "접수",
          },
        ],
        contact: null,
        important_notes: null,
        extra: null,
      },
    });

    const result = resolveNoticePrimaryActionUrl({ output, bundle });

    expect(result.output.primary_action_url).toBeNull();
    expect(result.resolution.decision).toBe("cleared_generic_root");
  });

  it("does not replace a generic root URL with an inquiry-only email candidate", () => {
    const bundle = createBundle({
      bodyText: "안내 페이지: https://example.com/ 문의: help@example.com",
    });
    const output = createOutput({
      primary_action_url: "https://example.com/",
    });

    const result = resolveNoticePrimaryActionUrl({ output, bundle });

    expect(result.output.primary_action_url).toBeNull();
    expect(result.resolution.decision).toBe("cleared_generic_root");
  });

  it("clears a generated primary_action_url when it is not found in candidates", () => {
    const bundle = createBundle({
      bodyText: "신청은 아래 포털에서 진행합니다.",
    });
    const output = createOutput({
      primary_action_url: "https://missing.example.com/apply",
    });

    const result = resolveNoticePrimaryActionUrl({ output, bundle });

    expect(result.output.primary_action_url).toBeNull();
    expect(result.resolution.decision).toBe("cleared_unrecognized_url");
  });

  it("keeps a mailto primary_action_url when the notice contains a plain email address", () => {
    const bundle = createBundle({
      bodyText:
        "신청서 제출은 담당자 이메일 gjsw@daum.net 로 보내주시기 바랍니다.",
    });
    const output = createOutput({
      primary_action_channel: "email",
      primary_action_url: "mailto:gjsw@daum.net",
    });

    const result = resolveNoticePrimaryActionUrl({ output, bundle });

    expect(result.output.primary_action_url).toBe("mailto:gjsw@daum.net");
    expect(result.output.primary_action_channel).toBe("email");
    expect(result.resolution.decision).toBe("unchanged");
  });

  it("fills a missing primary_action_url when there is a sole matching direct email candidate", () => {
    const bundle = createBundle({
      attachmentTexts: [
        "접수방법: 공문과 첨부서류를 메일로 발송 (* gjsw@daum.net)",
      ],
    });
    const output = createOutput({
      primary_action_channel: "email",
      primary_action_url: null,
    });

    const result = resolveNoticePrimaryActionUrl({ output, bundle });

    expect(result.output.primary_action_url).toBe("mailto:gjsw@daum.net");
    expect(result.output.primary_action_channel).toBe("email");
    expect(result.resolution.decision).toBe("replaced_with_direct_candidate");
  });

  it("does not autofill a sole inquiry email when it only appears as contact information", () => {
    const bundle = createBundle({
      bodyText: "문의: help@example.com",
    });
    const output = createOutput({
      primary_action_channel: "email",
      primary_action_url: null,
    });

    const result = resolveNoticePrimaryActionUrl({ output, bundle });

    expect(result.output.primary_action_url).toBeNull();
    expect(result.resolution.decision).toBe("unchanged");
  });
});
