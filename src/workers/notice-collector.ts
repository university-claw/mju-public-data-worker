import type { Pool } from "pg";
import { NoticeRepository } from "../db/notice-repository.js";
import {
  createNoticeAssetProcessor,
  type NoticeAssetProcessor,
} from "../notices/asset-processor.js";
import {
  createNoticeAttachmentExtractionProcessor,
  type NoticeAttachmentExtractionProcessor,
} from "../notices/attachment-extraction-processor.js";
import {
  createNoticeImageOcrProcessor,
  type NoticeImageOcrProcessor,
} from "../notices/image-ocr-processor.js";
import {
  createNoticeNormalizationRunner,
  type NoticeNormalizationRunner,
} from "../notices/normalization-runner.js";
import { scrapeNoticeDetail } from "../notices/detail-scraper.js";
import { scrapeNoticeList } from "../notices/list-scraper.js";
import { NOTICE_SOURCES } from "../notices/sources.js";
import type { NoticeSource } from "../notices/types.js";

export interface CollectNoticesOptions {
  limit: number;
  triggerReason: string;
  storageLocalRoot: string;
  ocrLanguages: string[];
  noticeNormalizationEnabled: boolean;
  noticeNormalizationApiKey?: string;
  noticeNormalizationModel: string;
  noticeNormalizationMaxOutputTokens: number;
}

export interface SourceCollectMetrics {
  scrapedCount: number;
  processedCount: number;
  insertedCount: number;
  updatedCount: number;
  attachmentExtractionSucceededCount: number;
  attachmentExtractionUnsupportedCount: number;
  attachmentExtractionFailedCount: number;
  noticeImageOcrSucceededCount: number;
  noticeImageOcrUnsupportedCount: number;
  noticeImageOcrFailedCount: number;
  noticeNormalizationSucceededCount: number;
  noticeNormalizationFailedCount: number;
}

export interface SourceCollectResult extends SourceCollectMetrics {
  sourceId: string;
  status: "success" | "failed";
  errorMessage?: string;
}

export interface FailedNoticeSource {
  sourceId: string;
  errorMessage: string;
}

export interface CollectNoticesResult extends SourceCollectMetrics {
  scrapeRunId: number;
  sources: SourceCollectResult[];
  failedSourceCount: number;
  failedSources: FailedNoticeSource[];
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
  const assetProcessor = createNoticeAssetProcessor({
    repository,
    storageLocalRoot: options.storageLocalRoot,
  });
  const attachmentExtractionProcessor = createNoticeAttachmentExtractionProcessor({
    repository,
    storageLocalRoot: options.storageLocalRoot,
  });
  const imageOcrProcessor = createNoticeImageOcrProcessor({
    repository,
    storageLocalRoot: options.storageLocalRoot,
    ocrLanguages: options.ocrLanguages,
  });
  const normalizationRunner = createNoticeNormalizationRunner({
    repository,
    enabled: options.noticeNormalizationEnabled,
    model: options.noticeNormalizationModel,
    maxOutputTokens: options.noticeNormalizationMaxOutputTokens,
    ...(options.noticeNormalizationApiKey
      ? { apiKey: options.noticeNormalizationApiKey }
      : {}),
  });
  await repository.ensureSources(NOTICE_SOURCES);

  const scrapeRunId = await repository.createScrapeRun(
    "mju-public-data-worker:notices",
    options.triggerReason,
  );

  const results: SourceCollectResult[] = [];
  const totals: SourceCollectMetrics = {
    scrapedCount: 0,
    processedCount: 0,
    insertedCount: 0,
    updatedCount: 0,
    attachmentExtractionSucceededCount: 0,
    attachmentExtractionUnsupportedCount: 0,
    attachmentExtractionFailedCount: 0,
    noticeImageOcrSucceededCount: 0,
    noticeImageOcrUnsupportedCount: 0,
    noticeImageOcrFailedCount: 0,
    noticeNormalizationSucceededCount: 0,
    noticeNormalizationFailedCount: 0,
  };

  try {
    for (const source of NOTICE_SOURCES) {
      const sourceStartedAt = new Date().toISOString();

      try {
        const metrics = await collectSingleSource(
          repository,
          assetProcessor,
          attachmentExtractionProcessor,
          imageOcrProcessor,
          normalizationRunner,
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
              attachmentExtractionSucceededCount: 0,
              attachmentExtractionUnsupportedCount: 0,
              attachmentExtractionFailedCount: 0,
              noticeImageOcrSucceededCount: 0,
              noticeImageOcrUnsupportedCount: 0,
              noticeImageOcrFailedCount: 0,
              noticeNormalizationSucceededCount: 0,
              noticeNormalizationFailedCount: 0,
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

    const failedSources = results
      .filter(
        (result): result is SourceCollectResult & { errorMessage: string } =>
          result.status === "failed" && Boolean(result.errorMessage),
      )
      .map((result) => ({
        sourceId: result.sourceId,
        errorMessage: result.errorMessage,
      }));
    const hasFailure = failedSources.length > 0;
    const hasSuccess = results.some((result) => result.status === "success");
    await repository.finishScrapeRun(
      scrapeRunId,
      hasFailure && !hasSuccess ? "failed" : "success",
      totals.scrapedCount,
      totals.processedCount,
      totals.insertedCount,
      totals.updatedCount,
      totals.attachmentExtractionSucceededCount,
      totals.attachmentExtractionUnsupportedCount,
      totals.attachmentExtractionFailedCount,
      totals.noticeImageOcrSucceededCount,
      totals.noticeImageOcrUnsupportedCount,
      totals.noticeImageOcrFailedCount,
      totals.noticeNormalizationSucceededCount,
      totals.noticeNormalizationFailedCount,
      hasFailure && !hasSuccess ? "one or more sources failed" : undefined,
    );

    if (hasFailure && !hasSuccess) {
      throw new Error("one or more notice sources failed during collection");
    }

    return {
      scrapeRunId,
      sources: results,
      failedSourceCount: failedSources.length,
      failedSources,
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
        totals.attachmentExtractionSucceededCount,
        totals.attachmentExtractionUnsupportedCount,
        totals.attachmentExtractionFailedCount,
        totals.noticeImageOcrSucceededCount,
        totals.noticeImageOcrUnsupportedCount,
        totals.noticeImageOcrFailedCount,
        totals.noticeNormalizationSucceededCount,
        totals.noticeNormalizationFailedCount,
        error instanceof Error ? error.message : String(error),
      );
    }
    throw error;
  } finally {
    await safeCloseProcessor(assetProcessor.close.bind(assetProcessor));
    await safeCloseProcessor(imageOcrProcessor.close.bind(imageOcrProcessor));
  }
}

async function safeCloseProcessor(close: () => Promise<void>): Promise<void> {
  try {
    await close();
  } catch (error) {
    console.warn(
      "notice collector cleanup failed:",
      error instanceof Error ? error.message : String(error),
    );
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
  target.attachmentExtractionSucceededCount +=
    source.attachmentExtractionSucceededCount;
  target.attachmentExtractionUnsupportedCount +=
    source.attachmentExtractionUnsupportedCount;
  target.attachmentExtractionFailedCount +=
    source.attachmentExtractionFailedCount;
  target.noticeImageOcrSucceededCount += source.noticeImageOcrSucceededCount;
  target.noticeImageOcrUnsupportedCount += source.noticeImageOcrUnsupportedCount;
  target.noticeImageOcrFailedCount += source.noticeImageOcrFailedCount;
  target.noticeNormalizationSucceededCount +=
    source.noticeNormalizationSucceededCount;
  target.noticeNormalizationFailedCount += source.noticeNormalizationFailedCount;
}

async function collectSingleSource(
  repository: NoticeRepository,
  assetProcessor: NoticeAssetProcessor,
  attachmentExtractionProcessor: NoticeAttachmentExtractionProcessor,
  imageOcrProcessor: NoticeImageOcrProcessor,
  normalizationRunner: NoticeNormalizationRunner,
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
    attachmentExtractionSucceededCount: 0,
    attachmentExtractionUnsupportedCount: 0,
    attachmentExtractionFailedCount: 0,
    noticeImageOcrSucceededCount: 0,
    noticeImageOcrUnsupportedCount: 0,
    noticeImageOcrFailedCount: 0,
    noticeNormalizationSucceededCount: 0,
    noticeNormalizationFailedCount: 0,
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
      await assetProcessor.processNotice(detail, upsertResult, fetchedAt);
      const extractionSummary = await attachmentExtractionProcessor.processNotice(
        upsertResult.noticeItemId,
        fetchedAt,
      );
      const imageOcrSummary = await imageOcrProcessor.processNotice(
        upsertResult.noticeItemId,
        fetchedAt,
      );
      const normalizationResult = await normalizationRunner.normalizeNotice(
        upsertResult.noticeItemId,
      );
      if (normalizationResult.status === "succeeded") {
        metrics.noticeNormalizationSucceededCount += 1;
      }
      if (normalizationResult.status === "failed") {
        metrics.noticeNormalizationFailedCount += 1;
        console.warn(
          `notice normalization failed for ${source.id}:${item.externalId}: ${normalizationResult.errorMessage ?? "unknown error"}${
            normalizationResult.persistedFailureState === false
              ? " (read model row not created yet; failure stored on notice item)"
              : ""
          }`,
        );
      }

      metrics.processedCount += 1;
      metrics.attachmentExtractionSucceededCount += extractionSummary.succeededCount;
      metrics.attachmentExtractionUnsupportedCount += extractionSummary.unsupportedCount;
      metrics.attachmentExtractionFailedCount += extractionSummary.failedCount;
      metrics.noticeImageOcrSucceededCount += imageOcrSummary.succeededCount;
      metrics.noticeImageOcrUnsupportedCount += imageOcrSummary.unsupportedCount;
      metrics.noticeImageOcrFailedCount += imageOcrSummary.failedCount;
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
