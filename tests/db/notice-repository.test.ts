import { describe, expect, it, vi } from "vitest";
import { NoticeRepository } from "../../src/db/notice-repository.js";

describe("notice repository", () => {
  it("updates attachment download metadata by notice item and url", async () => {
    const pool = {
      query: vi.fn(async () => ({ rows: [] })),
    } as unknown as ConstructorParameters<typeof NoticeRepository>[0];
    const repository = new NoticeRepository(pool, "public_data");

    await repository.updateAttachmentProcessing(5, "https://example.com/file.hwp", {
      storageProvider: "local",
      storageKey: "notices/general/231000/attachments/00-file.hwp",
      contentType: "application/x-hwp",
      sizeBytes: 1234,
      sha256: "abc",
      downloadedAt: "2026-04-12T07:00:00.000Z",
      downloadStatus: "succeeded",
      errorMessage: null,
    });

    const [sql, values] = vi.mocked(pool.query).mock.calls[0]!;
    expect(String(sql)).toContain("UPDATE public_data.notice_attachments");
    expect(String(sql)).toContain("download_status");
    expect(values).toEqual([
      5,
      "https://example.com/file.hwp",
      "local",
      "notices/general/231000/attachments/00-file.hwp",
      "application/x-hwp",
      1234,
      "abc",
      "2026-04-12T07:00:00.000Z",
      "succeeded",
      null,
    ]);
  });

  it("updates image download failure metadata without storage details", async () => {
    const pool = {
      query: vi.fn(async () => ({ rows: [] })),
    } as unknown as ConstructorParameters<typeof NoticeRepository>[0];
    const repository = new NoticeRepository(pool, "public_data");

    await repository.updateImageProcessing(9, "https://example.com/image.png", {
      downloadStatus: "failed",
      errorMessage: "timeout",
    });

    const [sql, values] = vi.mocked(pool.query).mock.calls[0]!;
    expect(String(sql)).toContain("UPDATE public_data.notice_images");
    expect(String(sql)).toContain("COALESCE($3, storage_provider)");
    expect(values).toEqual([
      9,
      "https://example.com/image.png",
      null,
      null,
      null,
      null,
      null,
      null,
      "failed",
      "timeout",
    ]);
  });

  it("lists stored attachments in sort order for extraction", async () => {
    const pool = {
      query: vi.fn(async () => ({
        rows: [
          {
            id: 7,
            file_name: "안내문.pdf",
            download_url: "https://example.com/guide.pdf",
            storage_key: "notices/general/231000/attachments/00.pdf",
            content_type: "application/pdf",
            sha256: "file-hash",
            download_status: "succeeded",
            existing_extraction_status: "succeeded",
            existing_attachment_sha256: "file-hash",
          },
        ],
      })),
    } as unknown as ConstructorParameters<typeof NoticeRepository>[0];
    const repository = new NoticeRepository(pool, "public_data");

    const attachments = await repository.listStoredAttachmentsForNotice(11);

    expect(attachments).toEqual([
      {
        id: 7,
        fileName: "안내문.pdf",
        downloadUrl: "https://example.com/guide.pdf",
        storageKey: "notices/general/231000/attachments/00.pdf",
        contentType: "application/pdf",
        sha256: "file-hash",
        downloadStatus: "succeeded",
        existingExtractionStatus: "succeeded",
        existingAttachmentSha256: "file-hash",
      },
    ]);
    expect(String(vi.mocked(pool.query).mock.calls[0]![0])).toContain(
      "SELECT",
    );
  });

  it("upserts attachment extraction results", async () => {
    const pool = {
      query: vi.fn(async () => ({ rows: [] })),
    } as unknown as ConstructorParameters<typeof NoticeRepository>[0];
    const repository = new NoticeRepository(pool, "public_data");

    await repository.upsertAttachmentExtraction(7, {
      attachmentSha256: "file-hash",
      extractorType: "pdf",
      extractionStatus: "succeeded",
      extractedText: "본문",
      textSha256: "abc",
      extractedCharCount: 2,
      extractedAt: "2026-04-12T07:00:00.000Z",
      errorMessage: null,
    });

    const [sql, values] = vi.mocked(pool.query).mock.calls[0]!;
    expect(String(sql)).toContain(
      "INSERT INTO public_data.notice_attachment_extractions",
    );
    expect(values).toEqual([
      7,
      "file-hash",
      "pdf",
      "succeeded",
      "본문",
      "abc",
      2,
      "2026-04-12T07:00:00.000Z",
      null,
    ]);
  });

  it("lists stored images in sort order for ocr", async () => {
    const pool = {
      query: vi.fn(async () => ({
        rows: [
          {
            id: 9,
            image_url: "https://example.com/poster.png",
            alt_text: "포스터",
            storage_key: "notices/general/231000/images/00.png",
            content_type: "image/png",
            sha256: "image-hash",
            download_status: "succeeded",
            existing_ocr_status: "succeeded",
            existing_image_sha256: "image-hash",
            existing_ocr_language: "kor+eng",
          },
        ],
      })),
    } as unknown as ConstructorParameters<typeof NoticeRepository>[0];
    const repository = new NoticeRepository(pool, "public_data");

    const images = await repository.listStoredImagesForNotice(11);

    expect(images).toEqual([
      {
        id: 9,
        imageUrl: "https://example.com/poster.png",
        altText: "포스터",
        storageKey: "notices/general/231000/images/00.png",
        contentType: "image/png",
        sha256: "image-hash",
        downloadStatus: "succeeded",
        existingOcrStatus: "succeeded",
        existingImageSha256: "image-hash",
        existingOcrLanguage: "kor+eng",
      },
    ]);
    expect(String(vi.mocked(pool.query).mock.calls[0]![0])).toContain("SELECT");
  });

  it("upserts image ocr results", async () => {
    const pool = {
      query: vi.fn(async () => ({ rows: [] })),
    } as unknown as ConstructorParameters<typeof NoticeRepository>[0];
    const repository = new NoticeRepository(pool, "public_data");

    await repository.upsertImageOcr(9, {
      imageSha256: "image-hash",
      ocrStatus: "succeeded",
      ocrText: "장학 포스터",
      textSha256: "ocr-hash",
      ocrConfidence: 88.76,
      ocrLanguage: "kor+eng",
      ocrExtractedAt: "2026-04-12T07:00:00.000Z",
      errorMessage: null,
    });

    const [sql, values] = vi.mocked(pool.query).mock.calls[0]!;
    expect(String(sql)).toContain(
      "INSERT INTO public_data.notice_image_ocr_results",
    );
    expect(values).toEqual([
      9,
      "image-hash",
      "succeeded",
      "장학 포스터",
      "ocr-hash",
      88.76,
      "kor+eng",
      "2026-04-12T07:00:00.000Z",
      null,
    ]);
  });
});
