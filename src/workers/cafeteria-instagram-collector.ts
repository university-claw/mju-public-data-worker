import type { Pool } from "pg";
import { classifyCafeteriaInstagramPost } from "../cafeterias/post-classifier.js";
import {
  createCafeteriaMenuNormalizer,
  type CafeteriaMenuNormalizer,
} from "../cafeterias/menu-normalizer.js";
import { refreshResolvedMenusForDateRange } from "../cafeterias/resolved-menu-selector.js";
import { structureCafeteriaMenuDocument } from "../cafeterias/menu-document-structurer.js";
import { CAFETERIA_INSTAGRAM_SOURCES } from "../cafeterias/sources.js";
import { DEFAULT_CAFETERIA_OCR_COMMAND } from "../cafeterias/ocr-defaults.js";
import {
  createCafeteriaPostAssetProcessor,
  type CafeteriaPostAssetProcessorLike,
} from "../cafeterias/post-asset-processor.js";
import { scrapeCafeteriaInstagramPosts } from "../cafeterias/instagram-scraper.js";
import type {
  CafeteriaInstagramProcessingUpdate,
  CafeteriaInstagramPost,
  CafeteriaInstagramPostSnapshot,
  CafeteriaInstagramSource,
  CafeteriaInstagramUpsertResult,
  CafeteriaMenuNormalizationContext,
  CafeteriaMenuNormalizationResult,
  CafeteriaMenuDocumentStructureResult,
  CafeteriaPostClassificationResult,
} from "../cafeterias/types.js";
import { CafeteriaRepository } from "../db/cafeteria-repository.js";

export interface CollectCafeteriaInstagramOptions {
  limit: number;
  triggerReason: string;
  storageLocalRoot: string;
  ocrLanguages: string[];
  cafeteriaOcrCommand?: string;
  sourceIds?: string[];
}

export interface CafeteriaCollectMetrics {
  scrapedCount: number;
  processedCount: number;
  insertedCount: number;
  updatedCount: number;
}

export interface CafeteriaCollectSourceResult extends CafeteriaCollectMetrics {
  sourceId: string;
  status: "success" | "failed";
  errorMessage?: string;
}

export interface CollectCafeteriaInstagramResult extends CafeteriaCollectMetrics {
  scrapeRunId: number;
  sources: CafeteriaCollectSourceResult[];
}

export interface CafeteriaCollectorRepositoryLike {
  ensureInstagramSources(
    sources: CafeteriaInstagramSource[],
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
  recordInstagramSourceRun(params: {
    scrapeRunId: number;
    sourceId: string;
    status: "success" | "failed";
    scrapedCount: number;
    processedCount: number;
    insertedCount: number;
    updatedCount: number;
    startedAt: string;
    errorMessage?: string;
  }): Promise<void>;
  upsertInstagramPost(
    post: CafeteriaInstagramPost,
    fetchedAt: string,
  ): Promise<CafeteriaInstagramUpsertResult>;
  getInstagramPostSnapshot(
    postId: number,
  ): Promise<CafeteriaInstagramPostSnapshot>;
  listMenuSheetReferenceHashes(
    menuImageGroup: string,
    excludePostId?: number,
  ): Promise<string[]>;
  syncInstagramPostClassification(
    postId: number,
    classification: CafeteriaPostClassificationResult,
    documentStructure?: CafeteriaMenuDocumentStructureResult,
  ): Promise<void>;
  getExistingMenuDocumentRangeForSourcePost(
    postId: number,
  ): Promise<{
    sourceId: string;
    serviceStartDate: string | null;
    serviceEndDate: string | null;
  } | null>;
  getMenuNormalizationContext(
    postId: number,
  ): Promise<CafeteriaMenuNormalizationContext>;
  syncMenuNormalization(
    context: CafeteriaMenuNormalizationContext,
    result: CafeteriaMenuNormalizationResult,
  ): Promise<void>;
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
  updateInstagramPostProcessing(
    postId: number,
    update: CafeteriaInstagramProcessingUpdate,
  ): Promise<void>;
}

interface CafeteriaCollectorDependencies {
  repository: CafeteriaCollectorRepositoryLike;
  sources: CafeteriaInstagramSource[];
  scrapePosts: (
    source: CafeteriaInstagramSource,
    limit: number,
  ) => Promise<CafeteriaInstagramPost[]>;
  assetProcessor: CafeteriaPostAssetProcessorLike;
  menuNormalizer: Pick<CafeteriaMenuNormalizer, "normalizeDocument" | "close">;
}

class CafeteriaCollectError extends Error {
  constructor(
    message: string,
    readonly metrics: CafeteriaCollectMetrics,
  ) {
    super(message);
    this.name = "CafeteriaCollectError";
  }
}

/**
 * 학식 인스타 1차 수집은 "게시물 raw를 안전하게 DB에 쌓는 것"에 집중한다.
 * 메뉴 OCR이나 게시물 판별은 다음 슬라이스에서 붙이더라도, 이 단계에서 이미
 * 최신 게시물 code / caption / taken_at / imageUrl / raw JSON이 남아 있어야 한다.
 */
export async function collectCafeteriaInstagramPosts(
  pool: Pool,
  schema: string,
  options: CollectCafeteriaInstagramOptions,
): Promise<CollectCafeteriaInstagramResult> {
  const repository = new CafeteriaRepository(pool, schema);
  const cafeteriaOcrCommand =
    options.cafeteriaOcrCommand?.trim() || DEFAULT_CAFETERIA_OCR_COMMAND;
  const sources = options.sourceIds?.length
    ? CAFETERIA_INSTAGRAM_SOURCES.filter((source) =>
        options.sourceIds?.includes(source.id),
      )
    : CAFETERIA_INSTAGRAM_SOURCES;

  if (sources.length === 0) {
    throw new Error("no cafeteria instagram sources matched the requested sourceIds");
  }

  return collectCafeteriaInstagramPostsWithDependencies(
    {
      repository,
      sources,
      scrapePosts: scrapeCafeteriaInstagramPosts,
      assetProcessor: createCafeteriaPostAssetProcessor({
        repository,
        storageLocalRoot: options.storageLocalRoot,
        ocrLanguages: options.ocrLanguages,
        ocrCommand: cafeteriaOcrCommand,
      }),
      menuNormalizer: createCafeteriaMenuNormalizer({
        storageLocalRoot: options.storageLocalRoot,
        ocrLanguages: options.ocrLanguages,
        ocrCommand: cafeteriaOcrCommand,
      }),
    },
    options,
  );
}

export async function collectCafeteriaInstagramPostsWithDependencies(
  dependencies: CafeteriaCollectorDependencies,
  options: CollectCafeteriaInstagramOptions,
): Promise<CollectCafeteriaInstagramResult> {
  await dependencies.repository.ensureInstagramSources(dependencies.sources);

  const scrapeRunId = await dependencies.repository.createScrapeRun(
    "mju-public-data-worker:cafeteria-instagram",
    options.triggerReason,
  );

  const totals: CafeteriaCollectMetrics = {
    scrapedCount: 0,
    processedCount: 0,
    insertedCount: 0,
    updatedCount: 0,
  };
  const results: CafeteriaCollectSourceResult[] = [];

  try {
    for (const source of dependencies.sources) {
      const sourceStartedAt = new Date().toISOString();

      try {
        const metrics = await collectSingleCafeteriaSource(
          dependencies.repository,
          dependencies.scrapePosts,
          dependencies.assetProcessor,
          dependencies.menuNormalizer,
          source,
          options.limit,
        );
        accumulateMetrics(totals, metrics);

        results.push({
          sourceId: source.id,
          ...metrics,
          status: "success",
        });

        await dependencies.repository.recordInstagramSourceRun({
          scrapeRunId,
          sourceId: source.id,
          status: "success",
          startedAt: sourceStartedAt,
          ...metrics,
        });
      } catch (error) {
        const metrics =
          error instanceof CafeteriaCollectError
            ? error.metrics
            : {
                scrapedCount: 0,
                processedCount: 0,
                insertedCount: 0,
                updatedCount: 0,
              };
        const errorMessage = error instanceof Error ? error.message : String(error);

        accumulateMetrics(totals, metrics);
        results.push({
          sourceId: source.id,
          ...metrics,
          status: "failed",
          errorMessage,
        });

        await dependencies.repository.recordInstagramSourceRun({
          scrapeRunId,
          sourceId: source.id,
          status: "failed",
          startedAt: sourceStartedAt,
          errorMessage,
          ...metrics,
        });
      }
    }

    const hasFailure = results.some((result) => result.status === "failed");
    await dependencies.repository.finishScrapeRun(
      scrapeRunId,
      hasFailure ? "failed" : "success",
      totals.scrapedCount,
      totals.processedCount,
      totals.insertedCount,
      totals.updatedCount,
      hasFailure ? "one or more cafeteria instagram sources failed" : undefined,
    );

    if (hasFailure) {
      throw new Error("one or more cafeteria instagram sources failed during collection");
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
        totals.scrapedCount,
        totals.processedCount,
        totals.insertedCount,
        totals.updatedCount,
        error instanceof Error ? error.message : String(error),
      );
    }

    throw error;
  } finally {
    await dependencies.assetProcessor.close();
    await dependencies.menuNormalizer.close();
  }
}

function accumulateMetrics(
  target: CafeteriaCollectMetrics,
  source: CafeteriaCollectMetrics,
): void {
  target.scrapedCount += source.scrapedCount;
  target.processedCount += source.processedCount;
  target.insertedCount += source.insertedCount;
  target.updatedCount += source.updatedCount;
}

async function collectSingleCafeteriaSource(
  repository: CafeteriaCollectorRepositoryLike,
  scrapePosts: (
    source: CafeteriaInstagramSource,
    limit: number,
  ) => Promise<CafeteriaInstagramPost[]>,
  assetProcessor: CafeteriaPostAssetProcessorLike,
  menuNormalizer: Pick<CafeteriaMenuNormalizer, "normalizeDocument">,
  source: CafeteriaInstagramSource,
  limit: number,
): Promise<CafeteriaCollectMetrics> {
  const posts = await scrapePosts(source, limit);
  const fetchedAt = new Date().toISOString();
  const metrics: CafeteriaCollectMetrics = {
    scrapedCount: posts.length,
    processedCount: 0,
    insertedCount: 0,
    updatedCount: 0,
  };

  for (const post of posts) {
    try {
      const upsertResult = await repository.upsertInstagramPost(post, fetchedAt);
      await assetProcessor.processPost(post, upsertResult, fetchedAt);
      const snapshot = await repository.getInstagramPostSnapshot(
        upsertResult.cafeteriaInstagramPostId,
      );
      const referenceHashes = await repository.listMenuSheetReferenceHashes(
        source.menuImageGroup,
        upsertResult.cafeteriaInstagramPostId,
      );
      const classification = classifyCafeteriaInstagramPost({
        source,
        snapshot,
        referenceHashes,
      });
      const existingMenuDocumentRange =
        classification.postKind === "menu_sheet"
          ? null
          : await repository.getExistingMenuDocumentRangeForSourcePost(
              upsertResult.cafeteriaInstagramPostId,
            );
      const documentStructure =
        classification.postKind === "menu_sheet"
          ? structureCafeteriaMenuDocument(source, snapshot)
          : undefined;
      await repository.syncInstagramPostClassification(
        upsertResult.cafeteriaInstagramPostId,
        classification,
        documentStructure,
      );

      if (classification.postKind === "menu_sheet") {
        const normalizationContext = await repository.getMenuNormalizationContext(
          upsertResult.cafeteriaInstagramPostId,
        );
        const normalizationResult = await safelyNormalizeMenuDocument(
          menuNormalizer,
          normalizationContext,
        );
        await repository.syncMenuNormalization(
          normalizationContext,
          normalizationResult,
        );
        const resolvedRange = resolveCafeteriaSelectionRange(
          normalizationContext.serviceStartDate ?? null,
          normalizationContext.serviceEndDate ?? null,
          normalizationResult.entries,
        );
        if (resolvedRange) {
          await refreshResolvedMenusForDateRange(repository, {
            sourceId: normalizationContext.source.id,
            startDate: resolvedRange.startDate,
            endDate: resolvedRange.endDate,
          });
        }
      } else if (
        existingMenuDocumentRange?.serviceStartDate
        && existingMenuDocumentRange.serviceEndDate
      ) {
        await refreshResolvedMenusForDateRange(repository, {
          sourceId: existingMenuDocumentRange.sourceId,
          startDate: existingMenuDocumentRange.serviceStartDate,
          endDate: existingMenuDocumentRange.serviceEndDate,
        });
      }

      metrics.processedCount += 1;

      if (upsertResult.wasInserted) {
        metrics.insertedCount += 1;
      } else {
        metrics.updatedCount += 1;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new CafeteriaCollectError(
        `source "${source.id}" failed while processing instagram post "${post.postCode}": ${message}`,
        metrics,
      );
    }
  }

  return metrics;
}

function resolveCafeteriaSelectionRange(
  serviceStartDate: string | null,
  serviceEndDate: string | null,
  entries: Array<{ serviceDate: string }>,
): { startDate: string; endDate: string } | null {
  const entryDates = entries.map((entry) => entry.serviceDate).sort();
  const startDate = serviceStartDate ?? entryDates[0] ?? null;
  const endDate = serviceEndDate ?? entryDates.at(-1) ?? startDate;

  if (!startDate || !endDate) {
    return null;
  }

  return { startDate, endDate };
}

async function safelyNormalizeMenuDocument(
  menuNormalizer: Pick<CafeteriaMenuNormalizer, "normalizeDocument">,
  context: CafeteriaMenuNormalizationContext,
): Promise<CafeteriaMenuNormalizationResult> {
  try {
    return await menuNormalizer.normalizeDocument(context);
  } catch (error) {
    return {
      status: "failed",
      confidence: 0.1,
      reason: "unexpected error while normalizing cafeteria menu document",
      entries: [],
      errorMessage: error instanceof Error ? error.message : String(error),
    };
  }
}
