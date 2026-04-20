import { createHash } from "node:crypto";
import type { Pool } from "pg";
import {
  fetchCafeteriaOfficialPage,
  OfficialPageFetchError,
} from "../cafeterias/official-page-fetcher.js";
import { parseCafeteriaOfficialPage } from "../cafeterias/official-page-parser.js";
import { CAFETERIA_OFFICIAL_PAGE_SOURCES } from "../cafeterias/sources.js";
import type {
  CafeteriaOfficialFetchedPage,
  CafeteriaOfficialMenuDocumentInput,
  CafeteriaOfficialPageSource,
  CafeteriaOfficialPageWeekScope,
} from "../cafeterias/types.js";
import { CafeteriaRepository } from "../db/cafeteria-repository.js";

export interface CollectCafeteriaOfficialPageOptions {
  triggerReason: string;
  sourceIds?: string[];
  includePreviousWeek?: boolean;
}

export interface CafeteriaOfficialPageCollectMetrics {
  fetchedPageCount: number;
  processedPageCount: number;
  storedEntryCount: number;
}

export interface CafeteriaOfficialPageCollectSourceResult
  extends CafeteriaOfficialPageCollectMetrics {
  sourceId: string;
  status: "success" | "failed";
  errorMessage?: string;
}

export interface CollectCafeteriaOfficialPageResult
  extends CafeteriaOfficialPageCollectMetrics {
  scrapeRunId: number;
  sources: CafeteriaOfficialPageCollectSourceResult[];
}

export interface CafeteriaOfficialPageCollectorRepositoryLike {
  ensureOfficialPageSources(
    sources: CafeteriaOfficialPageSource[],
  ): Promise<void>;
  createScrapeRun(workerName: string, triggerReason: string): Promise<number>;
  finishScrapeRun(
    scrapeRunId: number,
    status: "success" | "failed",
    totalScrapedCount: number,
    totalProcessedCount: number,
    totalInsertedCount: number,
    totalUpdatedCount: number,
    errorMessage?: string,
  ): Promise<void>;
  createOfficialPageSnapshot(input: {
    sourceId: string;
    weekStartDate: string;
    weekScope: CafeteriaOfficialPageWeekScope;
    snapshotHash: string;
    rawHtml: string;
    fetchedAt: string;
    status: "succeeded" | "empty" | "failed";
    errorMessage?: string | null;
  }): Promise<{
    sourceSnapshotId: number;
  }>;
  markOfficialPageSnapshotFailed(
    sourceSnapshotId: number,
    errorMessage: string,
  ): Promise<void>;
  deleteOfficialMenuDocument(sourceDocumentId: number): Promise<void>;
  upsertOfficialMenuDocument(input: CafeteriaOfficialMenuDocumentInput): Promise<number>;
  replaceOfficialMenuEntries(params: {
    sourceDocumentId: number;
    sourceId: string;
    entries: Array<{
      serviceDate: string;
      mealType: "breakfast" | "lunch" | "dinner";
      isClosed: boolean;
      menuText: string;
      menuItems: string[];
      confidence?: number | null;
    }>;
    normalizationMethod?: string;
  }): Promise<void>;
}

interface CafeteriaOfficialPageCollectorDependencies {
  repository: CafeteriaOfficialPageCollectorRepositoryLike;
  sources: CafeteriaOfficialPageSource[];
  fetchPage: typeof fetchCafeteriaOfficialPage;
}

class CafeteriaOfficialPageCollectError extends Error {
  constructor(
    message: string,
    readonly metrics: CafeteriaOfficialPageCollectMetrics,
  ) {
    super(message);
    this.name = "CafeteriaOfficialPageCollectError";
  }
}

function hashHtml(rawHtml: string): string {
  return createHash("sha256").update(rawHtml).digest("hex");
}

function accumulateMetrics(
  target: CafeteriaOfficialPageCollectMetrics,
  source: CafeteriaOfficialPageCollectMetrics,
): void {
  target.fetchedPageCount += source.fetchedPageCount;
  target.processedPageCount += source.processedPageCount;
  target.storedEntryCount += source.storedEntryCount;
}

function buildWeekScopes(
  options: CollectCafeteriaOfficialPageOptions,
): CafeteriaOfficialPageWeekScope[] {
  return options.includePreviousWeek ? ["current", "previous"] : ["current"];
}

export async function collectCafeteriaOfficialPages(
  pool: Pool,
  schema: string,
  options: CollectCafeteriaOfficialPageOptions,
): Promise<CollectCafeteriaOfficialPageResult> {
  const repository = new CafeteriaRepository(pool, schema);
  const sources = options.sourceIds?.length
    ? CAFETERIA_OFFICIAL_PAGE_SOURCES.filter((source) =>
        options.sourceIds?.includes(source.sourceId),
      )
    : CAFETERIA_OFFICIAL_PAGE_SOURCES;

  if (sources.length === 0) {
    throw new Error(
      "no cafeteria official page sources matched the requested sourceIds",
    );
  }

  return collectCafeteriaOfficialPagesWithDependencies(
    {
      repository,
      sources,
      fetchPage: fetchCafeteriaOfficialPage,
    },
    options,
  );
}

export async function collectCafeteriaOfficialPagesWithDependencies(
  dependencies: CafeteriaOfficialPageCollectorDependencies,
  options: CollectCafeteriaOfficialPageOptions,
): Promise<CollectCafeteriaOfficialPageResult> {
  await dependencies.repository.ensureOfficialPageSources(dependencies.sources);
  const scrapeRunId = await dependencies.repository.createScrapeRun(
    "mju-public-data-worker:cafeteria-official-pages",
    options.triggerReason,
  );
  const totals: CafeteriaOfficialPageCollectMetrics = {
    fetchedPageCount: 0,
    processedPageCount: 0,
    storedEntryCount: 0,
  };
  const results: CafeteriaOfficialPageCollectSourceResult[] = [];
  const weekScopes = buildWeekScopes(options);

  try {
    for (const source of dependencies.sources) {
      try {
        const metrics = await collectSingleOfficialPageSource(
          dependencies.repository,
          dependencies.fetchPage,
          source,
          weekScopes,
        );
        accumulateMetrics(totals, metrics);
        results.push({
          sourceId: source.sourceId,
          status: "success",
          ...metrics,
        });
      } catch (error) {
        const metrics =
          error instanceof CafeteriaOfficialPageCollectError
            ? error.metrics
            : {
                fetchedPageCount: 0,
                processedPageCount: 0,
                storedEntryCount: 0,
              };
        const errorMessage = error instanceof Error ? error.message : String(error);
        accumulateMetrics(totals, metrics);
        results.push({
          sourceId: source.sourceId,
          status: "failed",
          errorMessage,
          ...metrics,
        });
      }
    }

    const hasFailure = results.some((result) => result.status === "failed");
    await dependencies.repository.finishScrapeRun(
      scrapeRunId,
      hasFailure ? "failed" : "success",
      totals.fetchedPageCount,
      totals.processedPageCount,
      totals.storedEntryCount,
      0,
      hasFailure
        ? "one or more cafeteria official page sources failed"
        : undefined,
    );

    if (hasFailure) {
      throw new Error("one or more cafeteria official page sources failed during collection");
    }

    return {
      scrapeRunId,
      sources: results,
      ...totals,
    };
  } catch (error) {
    if (!results.some((result) => result.status === "failed")) {
      await dependencies.repository.finishScrapeRun(
        scrapeRunId,
        "failed",
        totals.fetchedPageCount,
        totals.processedPageCount,
        totals.storedEntryCount,
        0,
        error instanceof Error ? error.message : String(error),
      );
    }

    throw error;
  }
}

async function collectSingleOfficialPageSource(
  repository: CafeteriaOfficialPageCollectorRepositoryLike,
  fetchPage: typeof fetchCafeteriaOfficialPage,
  source: CafeteriaOfficialPageSource,
  weekScopes: CafeteriaOfficialPageWeekScope[],
): Promise<CafeteriaOfficialPageCollectMetrics> {
  const metrics: CafeteriaOfficialPageCollectMetrics = {
    fetchedPageCount: 0,
    processedPageCount: 0,
    storedEntryCount: 0,
  };
  const currentPage = await fetchAndMaybePersistFailureSnapshot(
    repository,
    fetchPage,
    source,
    "current",
  );

  metrics.fetchedPageCount += 1;
  const currentPageEntryCount = await persistOfficialFetchedPage(
    repository,
    source,
    currentPage,
  );
  metrics.processedPageCount += 1;
  metrics.storedEntryCount += currentPageEntryCount;

  for (const weekScope of weekScopes) {
    if (weekScope === "current") {
      continue;
    }

    try {
      const page = await fetchAndMaybePersistFailureSnapshot(
        repository,
        fetchPage,
        source,
        weekScope,
        currentPage.rawHtml,
      );
      metrics.fetchedPageCount += 1;
      const entryCount = await persistOfficialFetchedPage(repository, source, page);
      metrics.processedPageCount += 1;
      metrics.storedEntryCount += entryCount;
    } catch (error) {
      if (error instanceof OfficialPageFetchError) {
        continue;
      }

      const message = error instanceof Error ? error.message : String(error);
      throw new CafeteriaOfficialPageCollectError(
        `source "${source.sourceId}" failed while processing official page scope "${weekScope}": ${message}`,
        metrics,
      );
    }
  }

  return metrics;
}

async function fetchAndMaybePersistFailureSnapshot(
  repository: CafeteriaOfficialPageCollectorRepositoryLike,
  fetchPage: typeof fetchCafeteriaOfficialPage,
  source: CafeteriaOfficialPageSource,
  weekScope: CafeteriaOfficialPageWeekScope,
  currentPageHtml?: string,
): Promise<CafeteriaOfficialFetchedPage> {
  try {
    return await fetchPage(source, weekScope, undefined, {
      ...(currentPageHtml ? { currentPageHtml } : {}),
    });
  } catch (error) {
    if (
      error instanceof OfficialPageFetchError
      && error.weekStartDate
    ) {
      await repository.createOfficialPageSnapshot({
        sourceId: source.sourceId,
        weekStartDate: error.weekStartDate,
        weekScope,
        snapshotHash: hashHtml(error.rawHtml ?? ""),
        rawHtml: error.rawHtml ?? "",
        fetchedAt: new Date().toISOString(),
        status: "failed",
        errorMessage: error.message,
      });
    }

    throw error;
  }
}

async function persistOfficialFetchedPage(
  repository: CafeteriaOfficialPageCollectorRepositoryLike,
  source: CafeteriaOfficialPageSource,
  page: CafeteriaOfficialFetchedPage,
): Promise<number> {
  let sourceSnapshotId: number | null = null;
  let sourceDocumentId: number | null = null;

  try {
    const parsed = parseCafeteriaOfficialPage(page.rawHtml, page.weekStartDate);
    const snapshot = await repository.createOfficialPageSnapshot({
      sourceId: source.sourceId,
      weekStartDate: page.weekStartDate,
      weekScope: page.weekScope,
      snapshotHash: hashHtml(page.rawHtml),
      rawHtml: page.rawHtml,
      fetchedAt: page.fetchedAt,
      status: parsed.status,
    });
    sourceSnapshotId = snapshot.sourceSnapshotId;

    sourceDocumentId = await repository.upsertOfficialMenuDocument({
      sourceSnapshotId: snapshot.sourceSnapshotId,
      sourceId: source.sourceId,
      weekStartDate: parsed.weekStartDate,
      documentScope: parsed.documentScope,
      serviceStartDate: parsed.serviceStartDate ?? null,
      serviceEndDate: parsed.serviceEndDate ?? null,
      breakfastAvailable: parsed.breakfastAvailable,
      lunchAvailable: parsed.lunchAvailable,
      dinnerAvailable: parsed.dinnerAvailable,
      normalizedAt: page.fetchedAt,
    });

    await repository.replaceOfficialMenuEntries({
      sourceDocumentId,
      sourceId: source.sourceId,
      entries: parsed.entries,
      normalizationMethod: "html_table",
    });

    return parsed.entries.length;
  } catch (error) {
    const baseErrorMessage = error instanceof Error ? error.message : String(error);
    let errorMessage = baseErrorMessage;

    if (sourceDocumentId != null) {
      try {
        await repository.deleteOfficialMenuDocument(sourceDocumentId);
      } catch (cleanupError) {
        const cleanupMessage =
          cleanupError instanceof Error ? cleanupError.message : String(cleanupError);
        errorMessage = `${baseErrorMessage} (cleanup failed: ${cleanupMessage})`;
      }
    }

    if (sourceSnapshotId != null) {
      await repository.markOfficialPageSnapshotFailed(
        sourceSnapshotId,
        errorMessage,
      );
    } else {
      await repository.createOfficialPageSnapshot({
        sourceId: source.sourceId,
        weekStartDate: page.weekStartDate,
        weekScope: page.weekScope,
        snapshotHash: hashHtml(page.rawHtml),
        rawHtml: page.rawHtml,
        fetchedAt: page.fetchedAt,
        status: "failed",
        errorMessage,
      });
    }

    throw error;
  }
}
