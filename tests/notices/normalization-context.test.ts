import { describe, expect, it } from "vitest";
import {
  createNoticeNormalizationContext,
  renderNoticeNormalizationContextPrompt,
} from "../../src/notices/normalization-context.js";

describe("notice normalization context", () => {
  it("creates a prompt-ready context with only the lean LLM input sections", () => {
    const context = createNoticeNormalizationContext(
      {
        source: {
          id: "scholarship",
          name: "장학공지",
          description: "장학/학자금 공지",
          listUrl: "https://example.com/scholarship",
        },
        notice: {
          noticeItemId: 184,
          sourceId: "scholarship",
          externalId: "230100",
          title: "테스트 장학 공지",
          categoryLabel: null,
          detailUrl: "https://example.com/notices/230100",
          listUrl: "https://example.com/scholarship",
          author: "학생지원팀",
          publishedAt: "2026-04-18T09:00:00+09:00",
          publishedAtRaw: "2026.04.18",
          bodyText: "첫째 줄 \r\n\r\n 둘째 줄 \r\n셋째 줄",
          bodyHtml: "<p>본문 <a href=\"https://example.com/apply\">지원 링크</a></p>",
          contentHash: "abc123",
          attachmentsCount: 2,
          imagesCount: 1,
          firstSeenAt: "2026-04-18T09:05:00+09:00",
          lastSeenAt: "2026-04-18T09:05:00+09:00",
          lastScrapedAt: "2026-04-18T09:05:00+09:00",
        },
        attachments: [
          {
            attachmentId: 77,
            fileName: "안내문.pdf",
            downloadUrl: "https://example.com/guide.pdf",
            sortOrder: 0,
            storageKey: "notices/scholarship/230100/attachments/00.pdf",
            contentType: "application/pdf",
            downloadStatus: "succeeded",
            extractionStatus: "succeeded",
            extractorType: "pdf",
            extractedText: "가".repeat(20),
            extractedCharCount: 20,
            extractedAt: "2026-04-18T09:06:00+09:00",
            errorMessage: null,
          },
          {
            attachmentId: 78,
            fileName: "양식.hwp",
            downloadUrl: "https://example.com/form.hwp",
            sortOrder: 1,
            storageKey: "notices/scholarship/230100/attachments/01.hwp",
            contentType: "application/x-hwp",
            downloadStatus: "succeeded",
            extractionStatus: "unsupported",
            extractorType: null,
            extractedText: null,
            extractedCharCount: null,
            extractedAt: null,
            errorMessage: null,
          },
        ],
        images: [
          {
            imageId: 91,
            imageUrl: "https://example.com/poster.png",
            altText: "포스터",
            sortOrder: 0,
            storageKey: "notices/scholarship/230100/images/00.png",
            contentType: "image/png",
            downloadStatus: "succeeded",
            ocrStatus: "succeeded",
            ocrText: "포스터 OCR 텍스트",
            ocrConfidence: 88.2,
            ocrLanguage: "kor+eng",
            ocrExtractedAt: "2026-04-18T09:07:00+09:00",
            errorMessage: null,
          },
        ],
      },
      {
        maxBodyChars: 100,
        maxAttachmentChars: 10,
        maxImageChars: 100,
      },
    );

    expect(context.bodyTextBlock).toMatchObject({
      text: "첫째 줄 \n\n 둘째 줄 \n셋째 줄",
      originalCharCount: 18,
      includedCharCount: 18,
      truncated: false,
    });
    expect(context.bodyLinks).toEqual([
      {
        href: "https://example.com/apply",
        text: "지원 링크",
      },
    ]);
    expect(context.attachments[0]?.textBlock?.truncated).toBe(true);
    expect(context.attachments[0]?.textBlock?.includedCharCount).toBe(10);
    expect(context.attachments).toHaveLength(1);
    expect(context.images[0]?.textBlock?.text).toBe("포스터 OCR 텍스트");
    expect(context.stats).toEqual({
      attachmentCount: 2,
      attachmentTextAvailableCount: 1,
      attachmentTextMissingCount: 1,
      attachmentOmittedCount: 1,
      imageCount: 1,
      imageTextAvailableCount: 1,
      imageTextMissingCount: 0,
      imageOmittedCount: 0,
    });
    expect(context.promptInput).toContain("[NOTICE TITLE]");
    expect(context.promptInput).toContain("title: 테스트 장학 공지");
    expect(context.promptInput).toContain("[NOTICE BODY LINKS]");
    expect(context.promptInput).toContain("- link_1_href: https://example.com/apply");
    expect(context.promptInput).toContain("link_1_text: 지원 링크");
    expect(context.promptInput).toContain("[ATTACHMENT EXTRACTION TEXTS]");
    expect(context.promptInput).toContain("## attachment_1");
    expect(context.promptInput).toContain("[TRUNCATED");
    expect(context.promptInput).toContain("[NOTICE IMAGE OCR TEXTS]");
    expect(context.promptInput).toContain("<<<BEGIN_NOTICE_SOURCE_TEXT>>>");
    expect(context.promptInput).not.toContain("[NOTICE SOURCE]");
    expect(context.promptInput).not.toContain("[NOTICE CORE]");
    expect(context.promptInput).not.toContain("[NOTICE BODY HTML EXCERPT]");
    expect(context.promptInput).not.toContain("[CONTEXT SUMMARY]");
    expect(context.promptInput).not.toContain("file_name:");
    expect(context.promptInput).not.toContain("ocr_status:");
    expect(context.promptInput).not.toContain("original_char_count:");
    expect(context.promptInput).not.toContain("included_char_count:");
    expect(context.promptInput).not.toContain("truncated:");
  });

  it("renders an existing context into a stable prompt string", () => {
    const prompt = renderNoticeNormalizationContextPrompt({
      source: {
        id: "general",
        name: "일반공지",
        description: "일반 공지",
        listUrl: "https://example.com/general",
      },
      notice: {
        noticeItemId: 11,
        sourceId: "general",
        externalId: "231000",
        title: "테스트 일반공지",
        categoryLabel: "학사",
        detailUrl: "https://example.com/notices/231000",
        listUrl: "https://example.com/general",
        author: null,
        publishedAt: "2026-04-18T10:00:00+09:00",
        publishedAtRaw: "2026.04.18",
        bodyText: null,
        bodyHtml: null,
        contentHash: null,
        attachmentsCount: 0,
        imagesCount: 0,
        firstSeenAt: "2026-04-18T10:01:00+09:00",
        lastSeenAt: "2026-04-18T10:01:00+09:00",
        lastScrapedAt: "2026-04-18T10:01:00+09:00",
      },
      bodyTextBlock: {
        text: null,
        originalCharCount: 0,
        includedCharCount: 0,
        truncated: false,
      },
      bodyLinks: [],
      attachments: [],
      images: [],
      stats: {
        attachmentCount: 0,
        attachmentTextAvailableCount: 0,
        attachmentTextMissingCount: 0,
        attachmentOmittedCount: 0,
        imageCount: 0,
        imageTextAvailableCount: 0,
        imageTextMissingCount: 0,
        imageOmittedCount: 0,
      },
    });

    expect(prompt).toContain("[NOTICE TITLE]");
    expect(prompt).toContain("title: 테스트 일반공지");
    expect(prompt).toContain("(no attachments)");
    expect(prompt).toContain("(no notice images)");
    expect(prompt).toContain("[NOTICE BODY TEXT]\n(no text)");
    expect(prompt).not.toContain("category_label:");
  });

  it("renders empty-text assets with the lean sentinel strings", () => {
    const prompt = renderNoticeNormalizationContextPrompt({
      source: {
        id: "career",
        name: "진로공지",
        description: "진로/취업 공지",
        listUrl: "https://example.com/career",
      },
      notice: {
        noticeItemId: 45,
        sourceId: "career",
        externalId: "231011",
        title: "텍스트 없는 자산 공지",
        categoryLabel: null,
        detailUrl: "https://example.com/notices/231011",
        listUrl: "https://example.com/career",
        author: null,
        publishedAt: "2026-04-18T10:00:00+09:00",
        publishedAtRaw: "2026.04.18",
        bodyText: null,
        bodyHtml: null,
        contentHash: null,
        attachmentsCount: 2,
        imagesCount: 1,
        firstSeenAt: "2026-04-18T10:01:00+09:00",
        lastSeenAt: "2026-04-18T10:01:00+09:00",
        lastScrapedAt: "2026-04-18T10:01:00+09:00",
      },
      bodyTextBlock: {
        text: null,
        originalCharCount: 0,
        includedCharCount: 0,
        truncated: false,
      },
      bodyLinks: [],
      attachments: [],
      images: [],
      stats: {
        attachmentCount: 2,
        attachmentTextAvailableCount: 0,
        attachmentTextMissingCount: 2,
        attachmentOmittedCount: 0,
        imageCount: 1,
        imageTextAvailableCount: 0,
        imageTextMissingCount: 1,
        imageOmittedCount: 0,
      },
    });

    expect(prompt).toContain("(no extracted attachment text)");
    expect(prompt).toContain("(no image OCR text)");
  });

  it("applies total budget and attachment selection before rendering prompt input", () => {
    const context = createNoticeNormalizationContext(
      {
        source: {
          id: "general",
          name: "일반공지",
          description: "일반 공지",
          listUrl: "https://example.com/general",
        },
        notice: {
          noticeItemId: 22,
          sourceId: "general",
          externalId: "231001",
          title: "예산 테스트 공지",
          categoryLabel: null,
          detailUrl: "https://example.com/notices/231001",
          listUrl: "https://example.com/general",
          author: null,
          publishedAt: "2026-04-18T10:00:00+09:00",
          publishedAtRaw: "2026.04.18",
          bodyText: "본문".repeat(20),
          bodyHtml: null,
          contentHash: null,
          attachmentsCount: 3,
          imagesCount: 0,
          firstSeenAt: "2026-04-18T10:01:00+09:00",
          lastSeenAt: "2026-04-18T10:01:00+09:00",
          lastScrapedAt: "2026-04-18T10:01:00+09:00",
        },
        attachments: [
          {
            attachmentId: 1,
            fileName: "1.pdf",
            downloadUrl: "https://example.com/1.pdf",
            sortOrder: 0,
            storageKey: null,
            contentType: "application/pdf",
            downloadStatus: "succeeded",
            extractionStatus: "succeeded",
            extractorType: "pdf",
            extractedText: "A".repeat(30),
            extractedCharCount: 30,
            extractedAt: null,
            errorMessage: null,
          },
          {
            attachmentId: 2,
            fileName: "2.pdf",
            downloadUrl: "https://example.com/2.pdf",
            sortOrder: 1,
            storageKey: null,
            contentType: "application/pdf",
            downloadStatus: "succeeded",
            extractionStatus: "succeeded",
            extractorType: "pdf",
            extractedText: "B".repeat(30),
            extractedCharCount: 30,
            extractedAt: null,
            errorMessage: null,
          },
          {
            attachmentId: 3,
            fileName: "3.hwp",
            downloadUrl: "https://example.com/3.hwp",
            sortOrder: 2,
            storageKey: null,
            contentType: "application/x-hwp",
            downloadStatus: "succeeded",
            extractionStatus: "unsupported",
            extractorType: null,
            extractedText: null,
            extractedCharCount: null,
            extractedAt: null,
            errorMessage: null,
          },
        ],
        images: [],
      },
      {
        maxBodyChars: 12,
        maxAttachmentChars: 15,
        maxAttachmentCount: 2,
        maxTotalChars: 28,
      },
    );

    expect(context.attachments).toHaveLength(2);
    expect(context.stats.attachmentOmittedCount).toBe(1);
    expect(context.bodyTextBlock.includedCharCount).toBe(12);
    expect(context.attachments[0]?.textBlock?.includedCharCount).toBe(15);
    expect(context.attachments[1]?.textBlock?.includedCharCount).toBe(1);
  });
});
