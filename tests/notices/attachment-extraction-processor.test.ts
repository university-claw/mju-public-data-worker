import { describe, expect, it, vi } from "vitest";
import { NoticeAttachmentExtractionProcessor } from "../../src/notices/attachment-extraction-processor.js";

describe("notice attachment extraction processor", () => {
  it("stores succeeded, unsupported, and failed extraction outcomes without aborting the notice", async () => {
    const repository = {
      listStoredAttachmentsForNotice: vi.fn(async () => [
        {
          id: 1,
          fileName: "안내문.pdf",
          downloadUrl: "https://example.com/guide.pdf",
          storageKey: "notices/general/1/attachments/00.pdf",
          contentType: "application/pdf",
          sha256: "pdf-hash",
          downloadStatus: "succeeded" as const,
          existingExtractionStatus: null,
          existingAttachmentSha256: null,
        },
        {
          id: 2,
          fileName: "양식.hwp",
          downloadUrl: "https://example.com/form.hwp",
          storageKey: "notices/general/1/attachments/01.hwp",
          contentType: "application/x-hwp",
          sha256: "hwp-hash",
          downloadStatus: "succeeded" as const,
          existingExtractionStatus: null,
          existingAttachmentSha256: null,
        },
        {
          id: 3,
          fileName: "실패.pdf",
          downloadUrl: "https://example.com/broken.pdf",
          storageKey: null,
          contentType: "application/pdf",
          sha256: null,
          downloadStatus: "failed" as const,
          existingExtractionStatus: null,
          existingAttachmentSha256: null,
        },
      ]),
      upsertAttachmentExtraction: vi.fn(async () => undefined),
    };
    const processor = new NoticeAttachmentExtractionProcessor({
      repository,
      assetStore: {
        resolve: vi.fn((storageKey: string) => `C:/tmp/${storageKey}`),
      },
      extractAttachmentText: vi.fn(async (attachment) => {
        if (attachment.fileName.endsWith(".pdf")) {
          return {
            extractorType: "pdf",
            extractedText: "본문",
            textSha256: "abc",
            extractedCharCount: 2,
          };
        }

        return null;
      }),
    });

    const summary = await processor.processNotice(
      7,
      "2026-04-12T08:00:00.000Z",
    );

    expect(summary).toEqual({
      succeededCount: 1,
      unsupportedCount: 1,
      failedCount: 1,
    });
    expect(repository.upsertAttachmentExtraction).toHaveBeenNthCalledWith(
      1,
      1,
      expect.objectContaining({
        attachmentSha256: "pdf-hash",
        extractorType: "pdf",
        extractionStatus: "succeeded",
        extractedText: "본문",
      }),
    );
    expect(repository.upsertAttachmentExtraction).toHaveBeenNthCalledWith(
      2,
      2,
      expect.objectContaining({
        extractionStatus: "unsupported",
      }),
    );
    expect(repository.upsertAttachmentExtraction).toHaveBeenNthCalledWith(
      3,
      3,
      expect.objectContaining({
        extractionStatus: "failed",
        errorMessage: "attachment file is not downloaded yet",
      }),
    );
  });

  it("skips re-extraction when the stored file hash already matches a successful result", async () => {
    const repository = {
      listStoredAttachmentsForNotice: vi.fn(async () => [
        {
          id: 7,
          fileName: "안내문.pdf",
          downloadUrl: "https://example.com/guide.pdf",
          storageKey: "notices/general/1/attachments/00.pdf",
          contentType: "application/pdf",
          sha256: "same-hash",
          downloadStatus: "succeeded" as const,
          existingExtractionStatus: "succeeded" as const,
          existingAttachmentSha256: "same-hash",
        },
      ]),
      upsertAttachmentExtraction: vi.fn(async () => undefined),
    };
    const extractAttachmentText = vi.fn();
    const processor = new NoticeAttachmentExtractionProcessor({
      repository,
      assetStore: {
        resolve: vi.fn((storageKey: string) => `C:/tmp/${storageKey}`),
      },
      extractAttachmentText,
    });

    const summary = await processor.processNotice(
      9,
      "2026-04-12T08:00:00.000Z",
    );

    expect(summary).toEqual({
      succeededCount: 1,
      unsupportedCount: 0,
      failedCount: 0,
    });
    expect(extractAttachmentText).not.toHaveBeenCalled();
    expect(repository.upsertAttachmentExtraction).not.toHaveBeenCalled();
  });
});
