import type { Pool } from "pg";
import { downloadBinary } from "../http/client.js";
import { ShuttleRepository } from "../db/shuttle-repository.js";
import { scrapeNoticeDetail } from "../notices/detail-scraper.js";
import { extractNoticeAttachmentText } from "../notices/attachment-extractor.js";
import { scrapeNoticeList } from "../notices/list-scraper.js";
import { LocalAssetStore } from "../storage/local-asset-store.js";
import { resolveCurrentAcademicTerm, selectCurrentSemesterShuttleNotice } from "../shuttles/notice-selector.js";
import { SHUTTLE_NOTICE_SOURCE } from "../shuttles/source.js";
import { normalizeShuttleTimetableText } from "../shuttles/timetable-normalizer.js";
import type { NoticeAttachment, StoredNoticeAttachment } from "../notices/types.js";
import type { ShuttleCollectorResult } from "../shuttles/types.js";

export interface CollectShuttleTimetableOptions {
  limit: number;
  triggerReason: string;
  storageLocalRoot: string;
  now?: Date;
}

async function extractAttachmentTexts(params: {
  attachments: NoticeAttachment[];
  sourceId: string;
  externalId: string;
  storageLocalRoot: string;
}): Promise<string[]> {
  const store = new LocalAssetStore(params.storageLocalRoot);
  const texts: string[] = [];

  for (const attachment of params.attachments) {
    try {
      const downloaded = await downloadBinary(attachment.downloadUrl);
      const stored = await store.putAsset({
        storageKeyBase: `shuttles/${params.sourceId}/${params.externalId}/attachments/${String(attachment.sortOrder).padStart(2, "0")}`,
        buffer: downloaded.buffer,
        contentType: downloaded.contentType,
        fileName: attachment.fileName,
        includeFileNameSuffix: false,
      });
      const extractable: StoredNoticeAttachment & { absolutePath: string } = {
        id: attachment.sortOrder + 1,
        fileName: attachment.fileName,
        downloadUrl: attachment.downloadUrl,
        storageKey: stored.storageKey,
        contentType: stored.contentType,
        sha256: stored.sha256,
        downloadStatus: "succeeded",
        absolutePath: stored.absolutePath,
      };
      const extraction = await extractNoticeAttachmentText(extractable);
      if (extraction?.extractedText) {
        texts.push(extraction.extractedText);
      }
    } catch (error) {
      console.warn(
        `shuttle attachment extraction skipped for ${attachment.fileName}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  return texts;
}

export async function collectShuttleTimetable(
  pool: Pool,
  schema: string,
  options: CollectShuttleTimetableOptions,
): Promise<ShuttleCollectorResult> {
  const repository = new ShuttleRepository(pool, schema);
  const term = resolveCurrentAcademicTerm(options.now);
  const listItems = await scrapeNoticeList(SHUTTLE_NOTICE_SOURCE, options.limit);
  const selected = selectCurrentSemesterShuttleNotice(listItems, options.now);

  if (!selected) {
    throw new Error(
      `${term.academicYear}학년도 ${term.termLabel} 셔틀 공지 후보를 찾지 못했습니다.`,
    );
  }

  const detail = await scrapeNoticeDetail(selected);
  const attachmentTexts = await extractAttachmentTexts({
    attachments: detail.attachments,
    sourceId: detail.sourceId,
    externalId: detail.externalId,
    storageLocalRoot: options.storageLocalRoot,
  });

  try {
    const departures = normalizeShuttleTimetableText({
      title: detail.title,
      bodyText: detail.bodyText,
      attachmentTexts,
      term,
    });
    const stored = await repository.replaceActiveTimetable({
      sourceId: detail.sourceId,
      sourceExternalId: detail.externalId,
      sourceTitle: detail.title,
      sourceUrl: detail.detailUrl,
      sourcePublishedAt: detail.publishedAt,
      academicYear: term.academicYear,
      termLabel: term.termLabel,
      departures,
      normalizedAt: new Date().toISOString(),
    });

    return {
      status: "success",
      sourceId: detail.sourceId,
      selectedNoticeExternalId: detail.externalId,
      selectedNoticeTitle: detail.title,
      academicYear: term.academicYear,
      termLabel: term.termLabel,
      attachmentTextCount: attachmentTexts.length,
      departureCount: stored.departureCount,
      timetableVersionId: stored.timetableVersionId,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    await repository.recordFailedTimetable({
      sourceId: detail.sourceId,
      sourceExternalId: detail.externalId,
      sourceTitle: detail.title,
      sourceUrl: detail.detailUrl,
      sourcePublishedAt: detail.publishedAt,
      academicYear: term.academicYear,
      termLabel: term.termLabel,
      errorMessage,
    });

    throw error;
  }
}
