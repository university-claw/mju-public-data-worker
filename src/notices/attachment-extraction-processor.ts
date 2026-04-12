import { LocalAssetStore } from "../storage/local-asset-store.js";
import {
  detectNoticeAttachmentExtractorType,
  extractNoticeAttachmentText,
  type ExtractableNoticeAttachment,
} from "./attachment-extractor.js";
import type {
  NoticeAttachmentExtractionUpdate,
  StoredNoticeAttachment,
} from "./types.js";

export interface NoticeAttachmentExtractionRepositoryLike {
  listStoredAttachmentsForNotice(
    noticeItemId: number,
  ): Promise<StoredNoticeAttachment[]>;
  upsertAttachmentExtraction(
    attachmentId: number,
    update: NoticeAttachmentExtractionUpdate,
  ): Promise<void>;
}

export interface NoticeAttachmentExtractionSummary {
  succeededCount: number;
  unsupportedCount: number;
  failedCount: number;
}

interface NoticeAttachmentExtractionProcessorDependencies {
  repository: NoticeAttachmentExtractionRepositoryLike;
  assetStore: Pick<LocalAssetStore, "resolve">;
  extractAttachmentText(
    attachment: ExtractableNoticeAttachment,
  ): ReturnType<typeof extractNoticeAttachmentText>;
}

function buildUnsupportedUpdate(attachment: StoredNoticeAttachment): NoticeAttachmentExtractionUpdate {
  return {
    attachmentSha256: attachment.sha256 ?? null,
    extractionStatus: "unsupported",
    extractorType: null,
    extractedText: null,
    textSha256: null,
    extractedCharCount: null,
    extractedAt: null,
    errorMessage: `unsupported attachment type: ${attachment.fileName}`,
  };
}

function buildFailedUpdate(
  errorMessage: string,
  extractorType?: "pdf" | "docx" | "hwpx" | null,
  attachmentSha256?: string | null,
): NoticeAttachmentExtractionUpdate {
  return {
    attachmentSha256: attachmentSha256 ?? null,
    extractionStatus: "failed",
    extractorType: extractorType ?? null,
    extractedText: null,
    textSha256: null,
    extractedCharCount: null,
    extractedAt: null,
    errorMessage,
  };
}

/**
 * 첨부파일 추출은 자산 다운로드와 달리 "지원 포맷인지"를 먼저 판단해야 한다.
 * 그래서 저장 단계와 추출 단계를 분리하고, 여기서는 저장된 첨부 메타데이터를 읽어
 * 포맷 라우팅 / 추출 / 결과 적재만 맡긴다.
 */
export class NoticeAttachmentExtractionProcessor {
  constructor(
    private readonly dependencies: NoticeAttachmentExtractionProcessorDependencies,
  ) {}

  async processNotice(noticeItemId: number, extractedAt: string): Promise<NoticeAttachmentExtractionSummary> {
    const attachments = await this.dependencies.repository.listStoredAttachmentsForNotice(
      noticeItemId,
    );
    const summary: NoticeAttachmentExtractionSummary = {
      succeededCount: 0,
      unsupportedCount: 0,
      failedCount: 0,
    };

    for (const attachment of attachments) {
      const result = await this.processAttachment(attachment, extractedAt);
      if (result === "succeeded") {
        summary.succeededCount += 1;
      } else if (result === "unsupported") {
        summary.unsupportedCount += 1;
      } else {
        summary.failedCount += 1;
      }
    }

    return summary;
  }

  private async processAttachment(
    attachment: StoredNoticeAttachment,
    extractedAt: string,
  ): Promise<"succeeded" | "unsupported" | "failed"> {
    if (attachment.downloadStatus !== "succeeded" || !attachment.storageKey) {
      await this.dependencies.repository.upsertAttachmentExtraction(
        attachment.id,
        buildFailedUpdate("attachment file is not downloaded yet"),
      );
      return "failed";
    }

    const extractorType = detectNoticeAttachmentExtractorType(attachment);
    if (!extractorType) {
      await this.dependencies.repository.upsertAttachmentExtraction(
        attachment.id,
        buildUnsupportedUpdate(attachment),
      );
      return "unsupported";
    }

    if (
      attachment.sha256 &&
      attachment.existingAttachmentSha256 === attachment.sha256 &&
      attachment.existingExtractionStatus === "succeeded"
    ) {
      return "succeeded";
    }

    if (
      attachment.sha256 &&
      attachment.existingAttachmentSha256 === attachment.sha256 &&
      attachment.existingExtractionStatus === "unsupported"
    ) {
      return "unsupported";
    }

    try {
      const extraction = await this.dependencies.extractAttachmentText({
        ...attachment,
        absolutePath: this.dependencies.assetStore.resolve(attachment.storageKey),
      });

      if (!extraction) {
        await this.dependencies.repository.upsertAttachmentExtraction(
          attachment.id,
          buildUnsupportedUpdate(attachment),
        );
        return "unsupported";
      }

      await this.dependencies.repository.upsertAttachmentExtraction(attachment.id, {
        attachmentSha256: attachment.sha256 ?? null,
        extractorType: extraction.extractorType,
        extractionStatus: "succeeded",
        extractedText: extraction.extractedText,
        textSha256: extraction.textSha256,
        extractedCharCount: extraction.extractedCharCount,
        extractedAt,
        errorMessage: null,
      });
      return "succeeded";
    } catch (error) {
      await this.dependencies.repository.upsertAttachmentExtraction(
        attachment.id,
        buildFailedUpdate(
          error instanceof Error ? error.message : String(error),
          extractorType,
          attachment.sha256 ?? null,
        ),
      );
      return "failed";
    }
  }
}

export function createNoticeAttachmentExtractionProcessor(params: {
  repository: NoticeAttachmentExtractionRepositoryLike;
  storageLocalRoot: string;
}): NoticeAttachmentExtractionProcessor {
  return new NoticeAttachmentExtractionProcessor({
    repository: params.repository,
    assetStore: new LocalAssetStore(params.storageLocalRoot),
    extractAttachmentText: extractNoticeAttachmentText,
  });
}
