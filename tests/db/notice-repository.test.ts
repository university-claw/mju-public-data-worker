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
});
