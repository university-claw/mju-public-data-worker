import { createHash } from "node:crypto";
import type { Pool } from "pg";
import {
  fetchCafeteriaOfficialPage,
  OfficialPageFetchError,
} from "../cafeterias/official-page-fetcher.js";
import { parseCafeteriaOfficialPage } from "../cafeterias/official-page-parser.js";
import { refreshResolvedMenusForDateRange } from "../cafeterias/resolved-menu-selector.js";
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
  getOfficialMenuDocumentSummary(
    sourceId: string,
    weekStartDate: string,
  ): Promise<{
    sourceDocumentId: number;
    status: "succeeded" | "empty" | "failed";
  } | null>;
  syncOfficialMenuDocument(params: {
    document: CafeteriaOfficialMenuDocumentInput;
    entries: Array<{
      serviceDate: string;
      mealType: "breakfast" | "lunch" | "dinner";
      isClosed: boolean;
      menuText: string;
      menuItems: string[];
      confidence?: number | null;
    }>;
    normalizationMethod?: string;
  }): Promise<{
    sourceDocumentId: number;
    storedEntryCount: number;
  }>;
  listInstagramMenuEntryCandidates(
    sourceId: string,
    startDate: string,
    endDate: string,
  ): Promise<
    Array<{
      entryId: number;
      sourceId: string;
      serviceDate: string;
      mealType: "breakfast" | "lunch" | "dinner";
      isClosed: boolean;
      menuText: string;
      menuItems: string[];
    }>
  >;
  listOfficialMenuEntryCandidates(
    sourceId: string,
    startDate: string,
    endDate: string,
  ): Promise<
    Array<{
      entryId: number;
      sourceId: string;
      serviceDate: string;
      mealType: "breakfast" | "lunch" | "dinner";
      isClosed: boolean;
      menuText: string;
      menuItems: string[];
    }>
  >;
  listResolvedMenuEntryKeys(
    sourceId: string,
    startDate: string,
    endDate: string,
  ): Promise<Array<{ serviceDate: string; mealType: "breakfast" | "lunch" | "dinner" }>>;
  syncResolvedMenuEntriesForDateRange(params: {
    sourceId: string;
    startDate: string;
    endDate: string;
    entries: Array<{
      sourceId: string;
      serviceDate: string;
      mealType: "breakfast" | "lunch" | "dinner";
      selectedSourceKind: "instagram_ocr" | "official_page";
      isClosed: boolean;
      menuText: string;
      menuItems: string[];
      selectedAt?: string | null;
    }>;
  }): Promise<{ upsertedCount: number; deletedCount: number }>;
  upsertResolvedMenuEntry(input: {
    sourceId: string;
    serviceDate: string;
    mealType: "breakfast" | "lunch" | "dinner";
    selectedSourceKind: "instagram_ocr" | "official_page";
    isClosed: boolean;
    menuText: string;
    menuItems: string[];
    selectedAt?: string | null;
  }): Promise<void>;
  deleteResolvedMenuEntry(
    sourceId: string,
    serviceDate: string,
    mealType: "breakfast" | "lunch" | "dinner",
  ): Promise<void>;
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

function addDays(dateText: string, days: number): string {
  const date = new Date(`${dateText}T12:00:00+09:00`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function inferCurrentWeekStartDate(date = new Date()): string {
  const kstDate = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  const kstWeekday = kstDate.getUTCDay() === 0 ? 7 : kstDate.getUTCDay();
  kstDate.setUTCDate(kstDate.getUTCDate() - (kstWeekday - 1));
  return kstDate.toISOString().slice(0, 10);
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
  let currentPageHtml: string | undefined;

  for (const weekScope of weekScopes) {
    const isOptionalScope = weekScope !== "current";
    if (weekScope === "current") {
      const currentWeekStartDate = inferCurrentWeekStartDate();
      const existingDocument = await repository.getOfficialMenuDocumentSummary(
        source.sourceId,
        currentWeekStartDate,
      );

      if (existingDocument?.status === "succeeded") {
        continue;
      }
    }

    let page: CafeteriaOfficialFetchedPage;

    try {
      page = await fetchPage(source, weekScope, undefined, {
        ...(weekScope === "previous" && currentPageHtml
          ? { currentPageHtml }
          : {}),
      });
      metrics.fetchedPageCount += 1;
      if (weekScope === "current") {
        currentPageHtml = page.rawHtml;
      }
    } catch (error) {
      if (error instanceof OfficialPageFetchError) {
        if (error.weekStartDate) {
          const didPersistFailure = await persistOfficialFailedPage(
            repository,
            source,
            error.weekStartDate,
            error.rawHtml ?? "",
            new Date().toISOString(),
            error.message,
          );
          if (didPersistFailure) {
            await refreshResolvedMenusForDateRange(repository, {
              sourceId: source.sourceId,
              startDate: error.weekStartDate,
              endDate: addDays(error.weekStartDate, 6),
            });
          }
        }

        if (isOptionalScope) {
          continue;
        }
      }

      const message = error instanceof Error ? error.message : String(error);
      throw new CafeteriaOfficialPageCollectError(
        `source "${source.sourceId}" failed while processing official page scope "${weekScope}": ${message}`,
        metrics,
      );
    }

    try {
      const persisted = await persistOfficialFetchedPage(repository, source, page);
      metrics.processedPageCount += 1;
      metrics.storedEntryCount += persisted.storedEntryCount;
      await refreshResolvedMenusForDateRange(repository, {
        sourceId: source.sourceId,
        startDate: page.weekStartDate,
        endDate: addDays(page.weekStartDate, 6),
      });
    } catch (error) {
      const didPersistFailure = await persistOfficialFailedPage(
        repository,
        source,
        page.weekStartDate,
        page.rawHtml,
        page.fetchedAt,
        error instanceof Error ? error.message : String(error),
      );
      if (didPersistFailure) {
        await refreshResolvedMenusForDateRange(repository, {
          sourceId: source.sourceId,
          startDate: page.weekStartDate,
          endDate: addDays(page.weekStartDate, 6),
        });
      }

      throw new CafeteriaOfficialPageCollectError(
        `source "${source.sourceId}" failed while processing official page scope "${weekScope}": ${error instanceof Error ? error.message : String(error)}`,
        metrics,
      );
    }
  }

  return metrics;
}

async function persistOfficialFetchedPage(
  repository: CafeteriaOfficialPageCollectorRepositoryLike,
  source: CafeteriaOfficialPageSource,
  page: CafeteriaOfficialFetchedPage,
): Promise<{ storedEntryCount: number }> {
  const parsed = parseCafeteriaOfficialPage(page.rawHtml, page.weekStartDate);
  const existingDocument = await repository.getOfficialMenuDocumentSummary(
    source.sourceId,
    parsed.weekStartDate,
  );

  if (parsed.status !== "succeeded" && existingDocument?.status === "succeeded") {
    return { storedEntryCount: 0 };
  }

  const result = await repository.syncOfficialMenuDocument({
    document: {
      sourceId: source.sourceId,
      weekStartDate: parsed.weekStartDate,
      rawHtml: page.rawHtml,
      contentHash: hashHtml(page.rawHtml),
      fetchedAt: page.fetchedAt,
      status: parsed.status,
      errorMessage: null,
      documentScope: parsed.documentScope,
      serviceStartDate: parsed.serviceStartDate ?? null,
      serviceEndDate: parsed.serviceEndDate ?? null,
      breakfastAvailable: parsed.breakfastAvailable,
      lunchAvailable: parsed.lunchAvailable,
      dinnerAvailable: parsed.dinnerAvailable,
      normalizedAt: page.fetchedAt,
    },
    entries: parsed.entries,
    normalizationMethod: "html_table",
  });

  return { storedEntryCount: result.storedEntryCount };
}

async function persistOfficialFailedPage(
  repository: CafeteriaOfficialPageCollectorRepositoryLike,
  source: CafeteriaOfficialPageSource,
  weekStartDate: string,
  rawHtml: string,
  fetchedAt: string,
  errorMessage: string,
): Promise<boolean> {
  const existingDocument = await repository.getOfficialMenuDocumentSummary(
    source.sourceId,
    weekStartDate,
  );

  if (existingDocument?.status === "succeeded") {
    return false;
  }

  await repository.syncOfficialMenuDocument({
    document: {
      sourceId: source.sourceId,
      weekStartDate,
      rawHtml,
      contentHash: hashHtml(rawHtml),
      fetchedAt,
      status: "failed",
      errorMessage,
      documentScope: "unknown",
      serviceStartDate: null,
      serviceEndDate: null,
      breakfastAvailable: false,
      lunchAvailable: false,
      dinnerAvailable: false,
      normalizedAt: null,
    },
    entries: [],
    normalizationMethod: "html_table",
  });
  return true;
}
