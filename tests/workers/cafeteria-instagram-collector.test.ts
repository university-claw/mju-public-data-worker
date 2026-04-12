import { describe, expect, it, vi } from "vitest";
import type {
  CafeteriaInstagramPost,
  CafeteriaInstagramSource,
  CafeteriaInstagramUpsertResult,
} from "../../src/cafeterias/types.js";
import {
  collectCafeteriaInstagramPostsWithDependencies,
  type CafeteriaCollectorRepositoryLike,
} from "../../src/workers/cafeteria-instagram-collector.js";

const SOURCES: CafeteriaInstagramSource[] = [
  {
    id: "student-hall",
    name: "학생회관",
    description: "학생회관",
    profileUrl: "https://www.instagram.com/mjhs_yongin/",
    instagramUsername: "mjhs_yongin",
    menuImageGroup: "student-hall-myeongjin",
    supportsWeekendMenu: true,
  },
  {
    id: "myeongjin",
    name: "명진당",
    description: "명진당",
    profileUrl: "https://www.instagram.com/mju_lounge/",
    instagramUsername: "mju_lounge",
    menuImageGroup: "student-hall-myeongjin",
    supportsWeekendMenu: false,
  },
];

function makePost(sourceId: string, postCode: string): CafeteriaInstagramPost {
  return {
    sourceId,
    postCode,
    profileUrl: `https://www.instagram.com/${sourceId}/`,
    permalink: `https://www.instagram.com/p/${postCode}/`,
    postedAt: "2026-04-12T00:00:00.000Z",
    postedAtEpoch: 1775952000,
    rawItem: { code: postCode },
  };
}

function createRepositoryMock(): CafeteriaCollectorRepositoryLike & {
  ensureInstagramSources: ReturnType<typeof vi.fn>;
  createScrapeRun: ReturnType<typeof vi.fn>;
  finishScrapeRun: ReturnType<typeof vi.fn>;
  recordInstagramSourceRun: ReturnType<typeof vi.fn>;
  upsertInstagramPost: ReturnType<typeof vi.fn>;
  updateInstagramPostProcessing: ReturnType<typeof vi.fn>;
} {
  const defaultUpsertResult: CafeteriaInstagramUpsertResult = {
    cafeteriaInstagramPostId: 1,
    wasInserted: true,
    imageStorageProvider: null,
    imageStorageKey: null,
    imageSha256: null,
    ocrStatus: "pending",
  };

  return {
    ensureInstagramSources: vi.fn(async () => undefined),
    createScrapeRun: vi.fn(async () => 77),
    finishScrapeRun: vi.fn(async () => undefined),
    recordInstagramSourceRun: vi.fn(async () => undefined),
    upsertInstagramPost: vi.fn(async () => defaultUpsertResult),
    updateInstagramPostProcessing: vi.fn(async () => undefined),
  };
}

describe("cafeteria-instagram-collector", () => {
  it("records a successful scrape run across all sources", async () => {
    const repository = createRepositoryMock();
    const scrapePosts = vi
      .fn<() => Promise<CafeteriaInstagramPost[]>>()
      .mockResolvedValueOnce([
        makePost("student-hall", "code-1"),
        makePost("student-hall", "code-2"),
      ])
      .mockResolvedValueOnce([makePost("myeongjin", "code-3")]);
    const assetProcessor = {
      processPost: vi.fn(async () => undefined),
      close: vi.fn(async () => undefined),
    };

    const result = await collectCafeteriaInstagramPostsWithDependencies(
      {
        repository,
        sources: SOURCES,
        scrapePosts,
        assetProcessor,
      },
      {
        limit: 3,
        triggerReason: "manual",
        storageLocalRoot: "C:/tmp/assets",
        ocrLanguages: ["kor", "eng"],
      },
    );

    expect(result).toMatchObject({
      scrapeRunId: 77,
      scrapedCount: 3,
      processedCount: 3,
      insertedCount: 3,
      updatedCount: 0,
    });
    expect(repository.finishScrapeRun).toHaveBeenCalledWith(
      77,
      "success",
      3,
      3,
      3,
      0,
      undefined,
    );
    expect(repository.recordInstagramSourceRun).toHaveBeenCalledTimes(2);
    expect(assetProcessor.processPost).toHaveBeenCalledTimes(3);
    expect(assetProcessor.close).toHaveBeenCalledTimes(1);
  });

  it("keeps partial metrics when a post upsert fails mid-source", async () => {
    const repository = createRepositoryMock();
    repository.upsertInstagramPost = vi
      .fn()
      .mockResolvedValueOnce({
        cafeteriaInstagramPostId: 1,
        wasInserted: true,
        imageStorageProvider: null,
        imageStorageKey: null,
        imageSha256: null,
        ocrStatus: "pending",
      })
      .mockRejectedValueOnce(new Error("db write failed"))
      .mockResolvedValueOnce({
        cafeteriaInstagramPostId: 2,
        wasInserted: false,
        imageStorageProvider: null,
        imageStorageKey: null,
        imageSha256: null,
        ocrStatus: "pending",
      });

    const scrapePosts = vi
      .fn<() => Promise<CafeteriaInstagramPost[]>>()
      .mockResolvedValueOnce([
        makePost("student-hall", "code-1"),
        makePost("student-hall", "code-2"),
      ])
      .mockResolvedValueOnce([makePost("myeongjin", "code-3")]);
    const assetProcessor = {
      processPost: vi.fn(async () => undefined),
      close: vi.fn(async () => undefined),
    };

    await expect(
      collectCafeteriaInstagramPostsWithDependencies(
        {
          repository,
          sources: SOURCES,
          scrapePosts,
          assetProcessor,
        },
        {
          limit: 3,
          triggerReason: "manual",
          storageLocalRoot: "C:/tmp/assets",
          ocrLanguages: ["kor", "eng"],
        },
      ),
    ).rejects.toThrow(/one or more cafeteria instagram sources failed/);

    expect(repository.recordInstagramSourceRun).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        sourceId: "student-hall",
        status: "failed",
        scrapedCount: 2,
        processedCount: 1,
        insertedCount: 1,
        updatedCount: 0,
      }),
    );
    expect(repository.recordInstagramSourceRun).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        sourceId: "myeongjin",
        status: "success",
        scrapedCount: 1,
        processedCount: 1,
        insertedCount: 0,
        updatedCount: 1,
      }),
    );
    expect(repository.finishScrapeRun).toHaveBeenCalledWith(
      77,
      "failed",
      3,
      2,
      1,
      1,
      "one or more cafeteria instagram sources failed",
    );
    expect(assetProcessor.processPost).toHaveBeenCalledTimes(2);
    expect(assetProcessor.close).toHaveBeenCalledTimes(1);
  });

  it("treats post-processing failure as a source failure after the row upsert", async () => {
    const repository = createRepositoryMock();
    const scrapePosts = vi
      .fn<() => Promise<CafeteriaInstagramPost[]>>()
      .mockResolvedValueOnce([makePost("student-hall", "code-1")])
      .mockResolvedValueOnce([makePost("myeongjin", "code-2")]);
    const assetProcessor = {
      processPost: vi
        .fn()
        .mockRejectedValueOnce(new Error("ocr failed"))
        .mockResolvedValueOnce(undefined),
      close: vi.fn(async () => undefined),
    };

    await expect(
      collectCafeteriaInstagramPostsWithDependencies(
        {
          repository,
          sources: SOURCES,
          scrapePosts,
          assetProcessor,
        },
        {
          limit: 1,
          triggerReason: "manual",
          storageLocalRoot: "C:/tmp/assets",
          ocrLanguages: ["kor", "eng"],
        },
      ),
    ).rejects.toThrow(/one or more cafeteria instagram sources failed/);

    expect(repository.recordInstagramSourceRun).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        sourceId: "student-hall",
        status: "failed",
        scrapedCount: 1,
        processedCount: 0,
      }),
    );
    expect(repository.recordInstagramSourceRun).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        sourceId: "myeongjin",
        status: "success",
        processedCount: 1,
      }),
    );
  });
});
