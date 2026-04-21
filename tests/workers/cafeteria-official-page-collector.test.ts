import { describe, expect, it, vi } from "vitest";
import { OfficialPageFetchError } from "../../src/cafeterias/official-page-fetcher.js";
import type { CafeteriaOfficialPageSource } from "../../src/cafeterias/types.js";
import {
  collectCafeteriaOfficialPagesWithDependencies,
  type CafeteriaOfficialPageCollectorRepositoryLike,
} from "../../src/workers/cafeteria-official-page-collector.js";

const SOURCES: CafeteriaOfficialPageSource[] = [
  {
    sourceId: "student-hall",
    pageKey: "486",
    pageUrl: "https://mjedu.mju.ac.kr/mjukr/486/subview.do",
    viewActionPath: "/diet/mjukr/5/view.do",
    name: "학생회관",
    active: true,
  },
  {
    sourceId: "myeongjin",
    pageKey: "485",
    pageUrl: "https://mjedu.mju.ac.kr/mjukr/485/subview.do",
    viewActionPath: "/diet/mjukr/4/view.do",
    name: "명진당",
    active: true,
  },
];

function createRepositoryMock(): CafeteriaOfficialPageCollectorRepositoryLike & {
  ensureOfficialPageSources: ReturnType<typeof vi.fn>;
  createScrapeRun: ReturnType<typeof vi.fn>;
  finishScrapeRun: ReturnType<typeof vi.fn>;
  getOfficialMenuDocumentSummary: ReturnType<typeof vi.fn>;
  syncOfficialMenuDocument: ReturnType<typeof vi.fn>;
} {
  return {
    ensureOfficialPageSources: vi.fn(async () => undefined),
    createScrapeRun: vi.fn(async () => 88),
    finishScrapeRun: vi.fn(async () => undefined),
    getOfficialMenuDocumentSummary: vi.fn(async () => null),
    syncOfficialMenuDocument: vi.fn(async ({ document, entries }) => ({
      sourceDocumentId: document.sourceId === "student-hall" ? 2001 : 2002,
      storedEntryCount: entries.length,
    })),
  };
}

describe("cafeteria-official-page-collector", () => {
  it("stores current-week official page provenance for all sources", async () => {
    const repository = createRepositoryMock();
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce({
        source: SOURCES[0],
        weekScope: "current",
        weekStartDate: "2026-04-20",
        rawHtml:
          "<table><tbody><tr><th>04.20 (월)</th><td>중식</td><td>-</td><td>김치볶음밥</td><td>-</td></tr></tbody></table>",
        fetchedAt: "2026-04-20T00:00:00.000Z",
      })
      .mockResolvedValueOnce({
        source: SOURCES[1],
        weekScope: "current",
        weekStartDate: "2026-04-20",
        rawHtml:
          "<table><tbody><tr><th>04.20 (월)</th><td>중식</td><td>-</td><td>제육볶음</td><td>-</td></tr></tbody></table>",
        fetchedAt: "2026-04-20T00:00:00.000Z",
      });

    const result = await collectCafeteriaOfficialPagesWithDependencies(
      {
        repository,
        sources: SOURCES,
        fetchPage,
      },
      {
        triggerReason: "manual",
      },
    );

    expect(result).toMatchObject({
      scrapeRunId: 88,
      fetchedPageCount: 2,
      processedPageCount: 2,
      storedEntryCount: 2,
    });
    expect(repository.ensureOfficialPageSources).toHaveBeenCalledWith(SOURCES);
    expect(repository.syncOfficialMenuDocument).toHaveBeenCalledTimes(2);
    expect(repository.finishScrapeRun).toHaveBeenCalledWith(
      88,
      "success",
      2,
      2,
      2,
      0,
      undefined,
    );
  });

  it("fails the run when the current official page source errors", async () => {
    const repository = createRepositoryMock();
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce({
        source: SOURCES[0],
        weekScope: "current",
        weekStartDate: "2026-04-20",
        rawHtml:
          "<table><tbody><tr><th>04.20 (월)</th><td>중식</td><td>-</td><td>김치볶음밥</td><td>-</td></tr></tbody></table>",
        fetchedAt: "2026-04-20T00:00:00.000Z",
      })
      .mockRejectedValueOnce(new Error("source fetch failed"));

    await expect(
      collectCafeteriaOfficialPagesWithDependencies(
        {
          repository,
          sources: SOURCES,
          fetchPage,
        },
        {
          triggerReason: "manual",
        },
      ),
    ).rejects.toThrow(/one or more cafeteria official page sources failed/);

    expect(repository.finishScrapeRun).toHaveBeenCalledWith(
      88,
      "failed",
      1,
      1,
      1,
      0,
      "one or more cafeteria official page sources failed",
    );
  });

  it("keeps current-week success when the optional previous week fetch fails", async () => {
    const repository = createRepositoryMock();
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce({
        source: SOURCES[0],
        weekScope: "current",
        weekStartDate: "2026-04-20",
        rawHtml:
          "<table><tbody><tr><th>04.20 (월)</th><td>중식</td><td>-</td><td>김치볶음밥</td><td>-</td></tr></tbody></table>",
        fetchedAt: "2026-04-20T00:00:00.000Z",
      })
      .mockRejectedValueOnce(
        new OfficialPageFetchError(
          "failed to fetch previous",
          "previous",
          "2026-04-13",
          "",
        ),
      )
      .mockResolvedValueOnce({
        source: SOURCES[1],
        weekScope: "current",
        weekStartDate: "2026-04-20",
        rawHtml:
          "<table><tbody><tr><th>04.20 (월)</th><td>중식</td><td>-</td><td>제육볶음</td><td>-</td></tr></tbody></table>",
        fetchedAt: "2026-04-20T00:00:00.000Z",
      })
      .mockRejectedValueOnce(
        new OfficialPageFetchError(
          "failed to fetch previous",
          "previous",
          "2026-04-13",
          "",
        ),
      );

    const result = await collectCafeteriaOfficialPagesWithDependencies(
      {
        repository,
        sources: SOURCES,
        fetchPage,
      },
      {
        triggerReason: "manual",
        includePreviousWeek: true,
      },
    );

    expect(result).toMatchObject({
      scrapeRunId: 88,
      fetchedPageCount: 2,
      processedPageCount: 2,
      storedEntryCount: 2,
    });
    expect(repository.syncOfficialMenuDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        document: expect.objectContaining({
          sourceId: "student-hall",
          weekStartDate: "2026-04-13",
          status: "failed",
        }),
        entries: [],
      }),
    );
    expect(repository.finishScrapeRun).toHaveBeenCalledWith(
      88,
      "success",
      2,
      2,
      2,
      0,
      undefined,
    );
  });

  it("does not overwrite a previously succeeded document with an empty page", async () => {
    const repository = createRepositoryMock();
    repository.getOfficialMenuDocumentSummary.mockImplementation(
      async (sourceId: string, weekStartDate: string) =>
        sourceId === "student-hall" && weekStartDate === "2026-04-20"
          ? {
              sourceDocumentId: 3001,
              status: "succeeded" as const,
            }
          : null,
    );
    const fetchPage = vi.fn().mockResolvedValueOnce({
      source: SOURCES[0],
      weekScope: "current",
      weekStartDate: "2026-04-20",
      rawHtml:
        "<table><tbody><tr><th>04.20 (월)</th><td>중식</td><td>-</td><td>등록된 식단내용이(가) 없습니다.</td><td>-</td></tr></tbody></table>",
      fetchedAt: "2026-04-20T00:00:00.000Z",
    });

    const result = await collectCafeteriaOfficialPagesWithDependencies(
      {
        repository,
        sources: [SOURCES[0]!],
        fetchPage,
      },
      {
        triggerReason: "manual",
      },
    );

    expect(result).toMatchObject({
      fetchedPageCount: 1,
      processedPageCount: 1,
      storedEntryCount: 0,
    });
    expect(repository.syncOfficialMenuDocument).not.toHaveBeenCalled();
  });

  it("preserves a previously succeeded document when later persistence fails", async () => {
    const repository = createRepositoryMock();
    repository.getOfficialMenuDocumentSummary.mockResolvedValue({
      sourceDocumentId: 3001,
      status: "succeeded",
    });
    repository.syncOfficialMenuDocument = vi
      .fn()
      .mockRejectedValueOnce(new Error("entry replace failed"));

    const fetchPage = vi.fn().mockResolvedValueOnce({
      source: SOURCES[0],
      weekScope: "current",
      weekStartDate: "2026-04-20",
      rawHtml:
        "<table><tbody><tr><th>04.20 (월)</th><td>중식</td><td>-</td><td>김치볶음밥</td><td>-</td></tr></tbody></table>",
      fetchedAt: "2026-04-20T00:00:00.000Z",
    });

    await expect(
      collectCafeteriaOfficialPagesWithDependencies(
        {
          repository,
          sources: [SOURCES[0]!],
          fetchPage,
        },
        {
          triggerReason: "manual",
        },
      ),
    ).rejects.toThrow(/one or more cafeteria official page sources failed/);

    expect(repository.syncOfficialMenuDocument).toHaveBeenCalledTimes(1);
    expect(repository.finishScrapeRun).toHaveBeenCalledWith(
      88,
      "failed",
      1,
      0,
      0,
      0,
      "one or more cafeteria official page sources failed",
    );
  });
});
