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
  createOfficialPageSnapshot: ReturnType<typeof vi.fn>;
  markOfficialPageSnapshotFailed: ReturnType<typeof vi.fn>;
  deleteOfficialMenuDocument: ReturnType<typeof vi.fn>;
  upsertOfficialMenuDocument: ReturnType<typeof vi.fn>;
  replaceOfficialMenuEntries: ReturnType<typeof vi.fn>;
} {
  return {
    ensureOfficialPageSources: vi.fn(async () => undefined),
    createScrapeRun: vi.fn(async () => 88),
    finishScrapeRun: vi.fn(async () => undefined),
    createOfficialPageSnapshot: vi.fn(async ({ sourceId, weekScope, status }) => ({
      sourceSnapshotId:
        sourceId === "student-hall"
          ? weekScope === "current"
            ? status === "failed" ? 1003 : 1001
            : 1004
          : weekScope === "current"
            ? status === "failed" ? 2003 : 2001
            : 2004,
    })),
    markOfficialPageSnapshotFailed: vi.fn(async () => undefined),
    deleteOfficialMenuDocument: vi.fn(async () => undefined),
    upsertOfficialMenuDocument: vi
      .fn()
      .mockResolvedValueOnce(2001)
      .mockResolvedValueOnce(2002)
      .mockResolvedValueOnce(2003)
      .mockResolvedValueOnce(2004),
    replaceOfficialMenuEntries: vi.fn(async () => undefined),
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
    expect(repository.createOfficialPageSnapshot).toHaveBeenCalledTimes(2);
    expect(repository.upsertOfficialMenuDocument).toHaveBeenCalledTimes(2);
    expect(repository.replaceOfficialMenuEntries).toHaveBeenCalledTimes(2);
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

  it("keeps current-week success even when the optional previous week fetch fails", async () => {
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
    expect(repository.createOfficialPageSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceId: "student-hall",
        weekScope: "previous",
        weekStartDate: "2026-04-13",
        status: "failed",
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

  it("fails the source when previous-week persistence breaks after fetch succeeds", async () => {
    const repository = createRepositoryMock();
    repository.replaceOfficialMenuEntries = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("previous persistence failed"));

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
        source: SOURCES[0],
        weekScope: "previous",
        weekStartDate: "2026-04-13",
        rawHtml:
          "<table><tbody><tr><th>04.13 (월)</th><td>중식</td><td>-</td><td>비빔밥</td><td>-</td></tr></tbody></table>",
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

    await expect(
      collectCafeteriaOfficialPagesWithDependencies(
        {
          repository,
          sources: SOURCES,
          fetchPage,
        },
        {
          triggerReason: "manual",
          includePreviousWeek: true,
        },
      ),
    ).rejects.toThrow(/one or more cafeteria official page sources failed/);

    expect(repository.deleteOfficialMenuDocument).toHaveBeenCalled();
    expect(repository.markOfficialPageSnapshotFailed).toHaveBeenCalled();
    expect(repository.finishScrapeRun).toHaveBeenCalledWith(
      88,
      "failed",
      4,
      2,
      2,
      0,
      "one or more cafeteria official page sources failed",
    );
  });

  it("still marks the snapshot failed when cleanup delete also fails", async () => {
    const repository = createRepositoryMock();
    repository.replaceOfficialMenuEntries = vi
      .fn()
      .mockRejectedValueOnce(new Error("entry replace failed"));
    repository.deleteOfficialMenuDocument = vi
      .fn()
      .mockRejectedValueOnce(new Error("delete cleanup failed"));

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

    expect(repository.markOfficialPageSnapshotFailed).toHaveBeenCalledWith(
      1001,
      expect.stringContaining("cleanup failed: delete cleanup failed"),
    );
  });
});
