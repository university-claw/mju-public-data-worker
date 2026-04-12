import { describe, expect, it, vi } from "vitest";
import { NoticeImageOcrProcessor } from "../../src/notices/image-ocr-processor.js";

describe("notice image ocr processor", () => {
  it("stores succeeded OCR results and skips images that were not downloaded", async () => {
    const repository = {
      listStoredImagesForNotice: vi.fn(async () => [
        {
          id: 1,
          imageUrl: "https://example.com/notice-image.png",
          altText: "포스터",
          storageKey: "notices/general/1/images/00.png",
          contentType: "image/png",
          sha256: "image-hash",
          downloadStatus: "succeeded" as const,
          existingOcrStatus: null,
          existingImageSha256: null,
          existingOcrLanguage: null,
        },
        {
          id: 2,
          imageUrl: "https://example.com/missing.png",
          altText: null,
          storageKey: null,
          contentType: "image/png",
          sha256: null,
          downloadStatus: "failed" as const,
          existingOcrStatus: null,
          existingImageSha256: null,
          existingOcrLanguage: null,
        },
      ]),
      upsertImageOcr: vi.fn(async () => undefined),
    };
    const processor = new NoticeImageOcrProcessor(
      {
        repository,
        assetStore: {
          resolve: vi.fn((storageKey: string) => `C:/tmp/${storageKey}`),
        },
        ocrRecognizer: {
          recognize: vi.fn(async () => ({
            text: "장학 안내 포스터",
            confidence: 87.23,
          })),
          terminate: vi.fn(async () => undefined),
        },
      },
      ["kor", "eng"],
    );

    const summary = await processor.processNotice(
      7,
      "2026-04-12T08:00:00.000Z",
    );

    expect(summary).toEqual({
      succeededCount: 1,
      unsupportedCount: 0,
      failedCount: 0,
      skippedCount: 1,
    });
    expect(repository.upsertImageOcr).toHaveBeenCalledTimes(1);
    expect(repository.upsertImageOcr).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        imageSha256: "image-hash",
        ocrStatus: "succeeded",
        ocrText: "장학 안내 포스터",
        ocrLanguage: "kor+eng",
      }),
    );
  });

  it("skips re-ocr when the stored image hash already matches a successful result", async () => {
    const repository = {
      listStoredImagesForNotice: vi.fn(async () => [
        {
          id: 7,
          imageUrl: "https://example.com/notice-image.png",
          altText: null,
          storageKey: "notices/general/1/images/00.png",
          contentType: "image/png",
          sha256: "same-hash",
          downloadStatus: "succeeded" as const,
          existingOcrStatus: "succeeded" as const,
          existingImageSha256: "same-hash",
          existingOcrLanguage: "kor+eng",
        },
      ]),
      upsertImageOcr: vi.fn(async () => undefined),
    };
    const recognize = vi.fn();
    const processor = new NoticeImageOcrProcessor(
      {
        repository,
        assetStore: {
          resolve: vi.fn((storageKey: string) => `C:/tmp/${storageKey}`),
        },
        ocrRecognizer: {
          recognize,
          terminate: vi.fn(async () => undefined),
        },
      },
      ["kor", "eng"],
    );

    const summary = await processor.processNotice(
      9,
      "2026-04-12T08:00:00.000Z",
    );

    expect(summary).toEqual({
      succeededCount: 0,
      unsupportedCount: 0,
      failedCount: 0,
      skippedCount: 1,
    });
    expect(recognize).not.toHaveBeenCalled();
    expect(repository.upsertImageOcr).not.toHaveBeenCalled();
  });

  it("stores failed OCR status before continuing", async () => {
    const repository = {
      listStoredImagesForNotice: vi.fn(async () => [
        {
          id: 11,
          imageUrl: "https://example.com/notice-image.png",
          altText: null,
          storageKey: "notices/general/1/images/00.png",
          contentType: "image/png",
          sha256: "image-hash",
          downloadStatus: "succeeded" as const,
          existingOcrStatus: null,
          existingImageSha256: null,
          existingOcrLanguage: null,
        },
      ]),
      upsertImageOcr: vi.fn(async () => undefined),
    };
    const processor = new NoticeImageOcrProcessor(
      {
        repository,
        assetStore: {
          resolve: vi.fn((storageKey: string) => `C:/tmp/${storageKey}`),
        },
        ocrRecognizer: {
          recognize: vi.fn(async () => {
            throw new Error("ocr engine failed");
          }),
          terminate: vi.fn(async () => undefined),
        },
      },
      ["kor", "eng"],
    );

    const summary = await processor.processNotice(
      11,
      "2026-04-12T08:00:00.000Z",
    );

    expect(summary).toEqual({
      succeededCount: 0,
      unsupportedCount: 0,
      failedCount: 1,
      skippedCount: 0,
    });
    expect(repository.upsertImageOcr).toHaveBeenCalledWith(
      11,
      expect.objectContaining({
        imageSha256: "image-hash",
        ocrStatus: "failed",
        errorMessage: "ocr engine failed",
      }),
    );
  });

  it("re-runs OCR when the image hash matches but OCR languages changed", async () => {
    const repository = {
      listStoredImagesForNotice: vi.fn(async () => [
        {
          id: 15,
          imageUrl: "https://example.com/poster.png",
          altText: null,
          storageKey: "notices/general/1/images/00.png",
          contentType: "image/png",
          sha256: "same-hash",
          downloadStatus: "succeeded" as const,
          existingOcrStatus: "succeeded" as const,
          existingImageSha256: "same-hash",
          existingOcrLanguage: "kor",
        },
      ]),
      upsertImageOcr: vi.fn(async () => undefined),
    };
    const recognize = vi.fn(async () => ({
      text: "장학 포스터",
      confidence: 91.5,
    }));
    const processor = new NoticeImageOcrProcessor(
      {
        repository,
        assetStore: {
          resolve: vi.fn((storageKey: string) => `C:/tmp/${storageKey}`),
        },
        ocrRecognizer: {
          recognize,
          terminate: vi.fn(async () => undefined),
        },
      },
      ["kor", "eng"],
    );

    const summary = await processor.processNotice(
      15,
      "2026-04-12T08:00:00.000Z",
    );

    expect(summary).toEqual({
      succeededCount: 1,
      unsupportedCount: 0,
      failedCount: 0,
      skippedCount: 0,
    });
    expect(recognize).toHaveBeenCalledTimes(1);
  });

  it("marks unsupported image formats without retrying OCR", async () => {
    const repository = {
      listStoredImagesForNotice: vi.fn(async () => [
        {
          id: 21,
          imageUrl: "https://example.com/poster.svg",
          altText: null,
          storageKey: "notices/general/1/images/00.svg",
          contentType: "image/svg+xml",
          sha256: "svg-hash",
          downloadStatus: "succeeded" as const,
          existingOcrStatus: null,
          existingImageSha256: null,
          existingOcrLanguage: null,
        },
      ]),
      upsertImageOcr: vi.fn(async () => undefined),
    };
    const recognize = vi.fn();
    const processor = new NoticeImageOcrProcessor(
      {
        repository,
        assetStore: {
          resolve: vi.fn((storageKey: string) => `C:/tmp/${storageKey}`),
        },
        ocrRecognizer: {
          recognize,
          terminate: vi.fn(async () => undefined),
        },
      },
      ["kor", "eng"],
    );

    const summary = await processor.processNotice(
      21,
      "2026-04-12T08:00:00.000Z",
    );

    expect(summary).toEqual({
      succeededCount: 0,
      unsupportedCount: 1,
      failedCount: 0,
      skippedCount: 0,
    });
    expect(recognize).not.toHaveBeenCalled();
    expect(repository.upsertImageOcr).toHaveBeenCalledWith(
      21,
      expect.objectContaining({
        imageSha256: "svg-hash",
        ocrStatus: "unsupported",
      }),
    );
  });

  it("skips re-ocr when the same image hash is already marked unsupported", async () => {
    const repository = {
      listStoredImagesForNotice: vi.fn(async () => [
        {
          id: 23,
          imageUrl: "https://example.com/poster.svg",
          altText: null,
          storageKey: "notices/general/1/images/00.svg",
          contentType: "image/svg+xml",
          sha256: "svg-hash",
          downloadStatus: "succeeded" as const,
          existingOcrStatus: "unsupported" as const,
          existingImageSha256: "svg-hash",
          existingOcrLanguage: null,
        },
      ]),
      upsertImageOcr: vi.fn(async () => undefined),
    };
    const recognize = vi.fn();
    const processor = new NoticeImageOcrProcessor(
      {
        repository,
        assetStore: {
          resolve: vi.fn((storageKey: string) => `C:/tmp/${storageKey}`),
        },
        ocrRecognizer: {
          recognize,
          terminate: vi.fn(async () => undefined),
        },
      },
      ["kor", "eng"],
    );

    const summary = await processor.processNotice(
      23,
      "2026-04-12T08:00:00.000Z",
    );

    expect(summary).toEqual({
      succeededCount: 0,
      unsupportedCount: 0,
      failedCount: 0,
      skippedCount: 1,
    });
    expect(recognize).not.toHaveBeenCalled();
    expect(repository.upsertImageOcr).not.toHaveBeenCalled();
  });

  it("stores failed status when OCR returns blank text", async () => {
    const repository = {
      listStoredImagesForNotice: vi.fn(async () => [
        {
          id: 25,
          imageUrl: "https://example.com/poster.png",
          altText: null,
          storageKey: "notices/general/1/images/00.png",
          contentType: "image/png",
          sha256: "blank-hash",
          downloadStatus: "succeeded" as const,
          existingOcrStatus: null,
          existingImageSha256: null,
          existingOcrLanguage: null,
        },
      ]),
      upsertImageOcr: vi.fn(async () => undefined),
    };
    const processor = new NoticeImageOcrProcessor(
      {
        repository,
        assetStore: {
          resolve: vi.fn((storageKey: string) => `C:/tmp/${storageKey}`),
        },
        ocrRecognizer: {
          recognize: vi.fn(async () => ({
            text: "   \n  ",
            confidence: 12.34,
          })),
          terminate: vi.fn(async () => undefined),
        },
      },
      ["kor", "eng"],
    );

    const summary = await processor.processNotice(
      25,
      "2026-04-12T08:00:00.000Z",
    );

    expect(summary).toEqual({
      succeededCount: 0,
      unsupportedCount: 0,
      failedCount: 1,
      skippedCount: 0,
    });
    expect(repository.upsertImageOcr).toHaveBeenCalledWith(
      25,
      expect.objectContaining({
        imageSha256: "blank-hash",
        ocrStatus: "failed",
        errorMessage: "notice image OCR returned empty text",
      }),
    );
  });
});
