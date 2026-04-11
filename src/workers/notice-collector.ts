import type { Pool } from "pg";
import { NoticeRepository } from "../db/notice-repository.js";
import { scrapeNoticeDetail } from "../notices/detail-scraper.js";
import { scrapeNoticeList } from "../notices/list-scraper.js";
import { NOTICE_SOURCES } from "../notices/sources.js";
import type { NoticeSource } from "../notices/types.js";

export interface CollectNoticesOptions {
  limit: number;
  triggerReason: string;
}

export interface SourceCollectMetrics {
  scrapedCount: number;
  processedCount: number;
  insertedCount: number;
  updatedCount: number;
}

export interface SourceCollectResult extends SourceCollectMetrics {
  sourceId: string;
  status: "success" | "failed";
  errorMessage?: string;
}

export interface CollectNoticesResult extends SourceCollectMetrics {
  scrapeRunId: number;
  sources: SourceCollectResult[];
}

class SourceCollectError extends Error {
  constructor(
    message: string,
    readonly metrics: SourceCollectMetrics,
  ) {
    super(message);
    this.name = "SourceCollectError";
  }
}

/**
 * 첫 슬라이스에서는 "목록 수집 -> 상세 수집 -> DB 적재"가 실제로 끝까지
 * 연결되는지가 가장 중요하다. 그래서 절차를 숨기기보다, 한눈에 따라갈 수 있게
 * 명시적인 오케스트레이션 함수로 둔다.
 */
export async function collectNotices(
  pool: Pool,
  schema: string,
  options: CollectNoticesOptions,
): Promise<CollectNoticesResult> {
  const repository = new NoticeRepository(pool, schema);
  await repository.ensureSources(NOTICE_SOURCES);

  const scrapeRunId = await repository.createScrapeRun(
    "mju-public-data-worker",
    options.triggerReason,
  );

  const results: SourceCollectResult[] = [];
  const totals: SourceCollectMetrics = {
    scrapedCount: 0,
    processedCount: 0,
    insertedCount: 0,
    updatedCount: 0,
  };

  try {
    for (const source of NOTICE_SOURCES) {
      const sourceStartedAt = new Date().toISOString();

      try {
        const metrics = await collectSingleSource(
          repository,
          source,
          options.limit,
        );
        accumulateMetrics(totals, metrics);

        results.push({
          sourceId: source.id,
          ...metrics,
          status: "success",
        });

        await repository.recordSourceRun({
          scrapeRunId,
          sourceId: source.id,
          status: "success",
          ...metrics,
          startedAt: sourceStartedAt,
        });
      } catch (error) {
        const metrics =
          error instanceof SourceCollectError
            ? error.metrics
            : {
                scrapedCount: 0,
                processedCount: 0,
                insertedCount: 0,
                updatedCount: 0,
              };
        const errorMessage =
          error instanceof Error ? error.message : String(error);

        accumulateMetrics(totals, metrics);
        results.push({
          sourceId: source.id,
          ...metrics,
          status: "failed",
          errorMessage,
        });

        await repository.recordSourceRun({
          scrapeRunId,
          sourceId: source.id,
          status: "failed",
          ...metrics,
          startedAt: sourceStartedAt,
          errorMessage,
        });
      }
    }

    const hasFailure = results.some((result) => result.status === "failed");
    await repository.finishScrapeRun(
      scrapeRunId,
      hasFailure ? "failed" : "success",
      totals.scrapedCount,
      totals.processedCount,
      totals.insertedCount,
      totals.updatedCount,
      hasFailure ? "one or more sources failed" : undefined,
    );

    if (hasFailure) {
      throw new Error("one or more notice sources failed during collection");
    }

    return {
      scrapeRunId,
      sources: results,
      ...totals,
    };
  } catch (error) {
    if (!results.some((result) => result.status === "failed")) {
      await repository.finishScrapeRun(
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
  }
}

function accumulateMetrics(
  target: SourceCollectMetrics,
  source: SourceCollectMetrics,
): void {
  target.scrapedCount += source.scrapedCount;
  target.processedCount += source.processedCount;
  target.insertedCount += source.insertedCount;
  target.updatedCount += source.updatedCount;
}

async function collectSingleSource(
  repository: NoticeRepository,
  source: NoticeSource,
  limit: number,
): Promise<SourceCollectMetrics> {
  const listItems = await scrapeNoticeList(source, limit);
  const fetchedAt = new Date().toISOString();
  const metrics: SourceCollectMetrics = {
    scrapedCount: listItems.length,
    processedCount: 0,
    insertedCount: 0,
    updatedCount: 0,
  };

  // 오케스트레이터가 나중에 DB만 보고 답할 수 있으려면, 첫 슬라이스부터
  // 상세 본문과 자산 메타데이터까지 같이 적재해 두는 편이 훨씬 유리하다.
  for (const item of listItems) {
    try {
      const detail = await scrapeNoticeDetail(item);
      const upsertResult = await repository.upsertNotice({
        ...detail,
        sourceId: source.id,
        listUrl: source.listUrl,
        fetchedAt,
      });

      metrics.processedCount += 1;
      if (upsertResult.wasInserted) {
        metrics.insertedCount += 1;
      } else {
        metrics.updatedCount += 1;
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error);
      throw new SourceCollectError(
        `source "${source.id}" failed while processing notice "${item.externalId}": ${message}`,
        metrics,
      );
    }
  }

  return metrics;
}
