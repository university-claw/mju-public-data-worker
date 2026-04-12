import type { Pool } from "pg";
import { CAFETERIA_INSTAGRAM_SOURCES } from "../cafeterias/sources.js";
import {
  createCafeteriaPostAssetProcessor,
  type CafeteriaPostAssetProcessorLike,
} from "../cafeterias/post-asset-processor.js";
import { scrapeCafeteriaInstagramPosts } from "../cafeterias/instagram-scraper.js";
import type {
  CafeteriaInstagramProcessingUpdate,
  CafeteriaInstagramPost,
  CafeteriaInstagramSource,
  CafeteriaInstagramUpsertResult,
} from "../cafeterias/types.js";
import { CafeteriaRepository } from "../db/cafeteria-repository.js";

export interface CollectCafeteriaInstagramOptions {
  limit: number;
  triggerReason: string;
  storageLocalRoot: string;
  ocrLanguages: string[];
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
  return collectCafeteriaInstagramPostsWithDependencies(
    {
      repository,
      sources: CAFETERIA_INSTAGRAM_SOURCES,
      scrapePosts: scrapeCafeteriaInstagramPosts,
      assetProcessor: createCafeteriaPostAssetProcessor({
        repository,
        storageLocalRoot: options.storageLocalRoot,
        ocrLanguages: options.ocrLanguages,
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
