import { beforeEach, describe, expect, it, vi } from "vitest";

const repositoryMock = {
  ensureSources: vi.fn(async () => undefined),
  createScrapeRun: vi.fn(async () => 101),
  finishScrapeRun: vi.fn(async () => undefined),
  recordSourceRun: vi.fn(async () => undefined),
  upsertNotice: vi.fn(async () => ({
    noticeItemId: 1,
    wasInserted: true,
    obsoleteStorageKeys: [],
  })),
};

const assetProcessorMock = {
  processNotice: vi.fn(async () => ({ attachmentFailures: 0, imageFailures: 0 })),
  close: vi.fn(async () => undefined),
};

vi.mock("../../src/db/notice-repository.js", () => ({
  NoticeRepository: vi.fn(
    class MockNoticeRepository {
      constructor() {
        return repositoryMock;
      }
    },
  ),
}));

vi.mock("../../src/notices/asset-processor.js", () => ({
  createNoticeAssetProcessor: vi.fn(() => assetProcessorMock),
}));

vi.mock("../../src/notices/list-scraper.js", () => ({
  scrapeNoticeList: vi.fn(),
}));

vi.mock("../../src/notices/detail-scraper.js", () => ({
  scrapeNoticeDetail: vi.fn(),
}));

describe("notice collector", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("processes downloaded notice assets after upserting the notice row", async () => {
    const { collectNotices } = await import("../../src/workers/notice-collector.js");
    const { scrapeNoticeList } = await import("../../src/notices/list-scraper.js");
    const { scrapeNoticeDetail } = await import("../../src/notices/detail-scraper.js");

    vi.mocked(scrapeNoticeList).mockResolvedValueOnce([
      {
        sourceId: "general",
        externalId: "231000",
        title: "목록 제목",
        detailUrl: "https://example.com/detail/231000",
        publishedAt: "2026-04-12T00:00:00.000Z",
        publishedAtRaw: "2026.04.12",
      },
    ]);
    vi.mocked(scrapeNoticeList)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    vi.mocked(scrapeNoticeDetail).mockResolvedValueOnce({
      sourceId: "general",
      externalId: "231000",
      title: "상세 제목",
      detailUrl: "https://example.com/detail/231000",
      publishedAt: "2026-04-12T00:00:00.000Z",
      publishedAtRaw: "2026.04.12",
      bodyHtml: "<p>본문</p>",
      bodyText: "본문",
      contentHash: "hash",
      attachments: [],
      images: [],
    });

    const result = await collectNotices({} as never, "public_data", {
      limit: 1,
      triggerReason: "manual",
      storageLocalRoot: "C:/tmp/assets",
    });

    expect(result.scrapeRunId).toBe(101);
    expect(repositoryMock.upsertNotice).toHaveBeenCalledTimes(1);
    expect(assetProcessorMock.processNotice).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceId: "general",
        externalId: "231000",
      }),
      { noticeItemId: 1, wasInserted: true, obsoleteStorageKeys: [] },
      expect.any(String),
    );
    expect(assetProcessorMock.close).toHaveBeenCalledTimes(1);
  });

  it("keeps the source successful when asset processing reports failures without throwing", async () => {
    const { collectNotices } = await import("../../src/workers/notice-collector.js");
    const { scrapeNoticeList } = await import("../../src/notices/list-scraper.js");
    const { scrapeNoticeDetail } = await import("../../src/notices/detail-scraper.js");

    vi.mocked(scrapeNoticeList).mockResolvedValueOnce([
      {
        sourceId: "general",
        externalId: "231000",
        title: "목록 제목",
        detailUrl: "https://example.com/detail/231000",
        publishedAt: "2026-04-12T00:00:00.000Z",
        publishedAtRaw: "2026.04.12",
      },
    ]);
    vi.mocked(scrapeNoticeList)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    vi.mocked(scrapeNoticeDetail).mockResolvedValueOnce({
      sourceId: "general",
      externalId: "231000",
      title: "상세 제목",
      detailUrl: "https://example.com/detail/231000",
      publishedAt: "2026-04-12T00:00:00.000Z",
      publishedAtRaw: "2026.04.12",
      bodyHtml: "<p>본문</p>",
      bodyText: "본문",
      contentHash: "hash",
      attachments: [],
      images: [],
    });
    assetProcessorMock.processNotice.mockResolvedValueOnce(
      {
        attachmentFailures: 1,
        imageFailures: 0,
      },
    );

    const result = await collectNotices({} as never, "public_data", {
      limit: 1,
      triggerReason: "manual",
      storageLocalRoot: "C:/tmp/assets",
    });

    expect(result.scrapeRunId).toBe(101);
    expect(repositoryMock.recordSourceRun).toHaveBeenCalledWith(
      expect.objectContaining({
        scrapeRunId: 101,
        sourceId: "general",
        status: "success",
      }),
    );
    expect(repositoryMock.finishScrapeRun).toHaveBeenCalledWith(
      101,
      "success",
      1,
      1,
      1,
      0,
      undefined,
    );
    expect(assetProcessorMock.close).toHaveBeenCalledTimes(1);
  });
});
