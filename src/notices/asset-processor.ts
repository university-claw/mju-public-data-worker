import path from "node:path";
import { downloadBinary } from "../http/client.js";
import { LocalAssetStore, type StoredLocalAsset } from "../storage/local-asset-store.js";
import type {
  NoticeAssetImage,
  NoticeAttachment,
  NoticeDetail,
} from "./types.js";

export interface NoticeAssetPersistedNotice {
  noticeItemId: number;
  obsoleteStorageKeys: string[];
}

export interface NoticeAssetRepositoryLike {
  updateAttachmentProcessing(
    noticeItemId: number,
    downloadUrl: string,
    update: {
      storageProvider?: "local" | null;
      storageKey?: string | null;
      contentType?: string | null;
      sizeBytes?: number | null;
      sha256?: string | null;
      downloadedAt?: string | null;
      downloadStatus: "pending" | "succeeded" | "failed";
      errorMessage?: string | null;
    },
  ): Promise<void>;
  updateImageProcessing(
    noticeItemId: number,
    imageUrl: string,
    update: {
      storageProvider?: "local" | null;
      storageKey?: string | null;
      contentType?: string | null;
      sizeBytes?: number | null;
      sha256?: string | null;
      downloadedAt?: string | null;
      downloadStatus: "pending" | "succeeded" | "failed";
      errorMessage?: string | null;
    },
  ): Promise<void>;
}

interface DownloadedAsset {
  buffer: Buffer;
  contentType: string | null;
}

interface NoticeAssetProcessorDependencies {
  repository: NoticeAssetRepositoryLike;
  assetStore: Pick<LocalAssetStore, "putAsset" | "delete">;
  downloadAsset(url: string): Promise<DownloadedAsset>;
}

async function downloadAsset(url: string): Promise<DownloadedAsset> {
  return downloadBinary(url);
}

function assertImageContentType(
  contentType: string | null,
  imageUrl: string,
): void {
  if (!contentType) {
    return;
  }

  if (!contentType.toLowerCase().startsWith("image/")) {
    throw new Error(
      `expected image content type for "${imageUrl}", received: ${contentType}`,
    );
  }
}

function hasHtmlLikeSignature(buffer: Buffer): boolean {
  const preview = buffer.toString("utf8", 0, Math.min(buffer.length, 256)).trim().toLowerCase();
  return preview.startsWith("<!doctype html") || preview.startsWith("<html") || preview.startsWith("<body");
}

function hasPdfSignature(buffer: Buffer): boolean {
  return buffer.subarray(0, 5).toString("ascii") === "%PDF-";
}

function hasOleCompoundSignature(buffer: Buffer): boolean {
  return buffer.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]));
}

function hasZipSignature(buffer: Buffer): boolean {
  const header = buffer.subarray(0, 4);
  return (
    header.equals(Buffer.from([0x50, 0x4b, 0x03, 0x04])) ||
    header.equals(Buffer.from([0x50, 0x4b, 0x05, 0x06])) ||
    header.equals(Buffer.from([0x50, 0x4b, 0x07, 0x08]))
  );
}

function assertAttachmentPayload(
  attachment: NoticeAttachment,
  downloadedAsset: DownloadedAsset,
): void {
  const contentType = downloadedAsset.contentType?.toLowerCase() ?? null;
  const extension = path.extname(attachment.fileName).trim().toLowerCase();

  if (contentType?.startsWith("text/html") || contentType?.startsWith("text/plain")) {
    throw new Error(
      `unexpected attachment content type for "${attachment.fileName}": ${contentType}`,
    );
  }

  if (hasHtmlLikeSignature(downloadedAsset.buffer)) {
    throw new Error(`attachment payload looks like HTML instead of "${attachment.fileName}"`);
  }

  if (extension === ".pdf" && !hasPdfSignature(downloadedAsset.buffer)) {
    throw new Error(`attachment payload is not a valid PDF: ${attachment.fileName}`);
  }

  if (extension === ".hwp" && !hasOleCompoundSignature(downloadedAsset.buffer)) {
    throw new Error(`attachment payload is not a valid HWP compound file: ${attachment.fileName}`);
  }

  if (extension === ".hwpx" && !hasZipSignature(downloadedAsset.buffer)) {
    throw new Error(`attachment payload is not a valid HWPX zip archive: ${attachment.fileName}`);
  }
}

function buildStoredUpdate(
  storedAsset: StoredLocalAsset,
  fetchedAt: string,
): {
  storageProvider: "local";
  storageKey: string;
  contentType: string;
  sizeBytes: number;
  sha256: string;
  downloadedAt: string;
  downloadStatus: "succeeded";
  errorMessage: null;
} {
  return {
    storageProvider: storedAsset.storageProvider,
    storageKey: storedAsset.storageKey,
    contentType: storedAsset.contentType,
    sizeBytes: storedAsset.sizeBytes,
    sha256: storedAsset.sha256,
    downloadedAt: fetchedAt,
    downloadStatus: "succeeded",
    errorMessage: null,
  };
}

/**
 * 공지 자산은 "메타데이터만 저장" 단계에서 한 걸음 더 나아가, 실제 첨부파일과
 * 본문 이미지를 우리 스토리지로 확보하는 것이 핵심이다. 첨부파일은 향후 텍스트
 * 추출의 원본이 되고, 본문 이미지는 원문 사이트 변경이나 삭제에 덜 흔들리는
 * 재현 가능한 자산이 된다.
 */
export class NoticeAssetProcessor {
  constructor(private readonly dependencies: NoticeAssetProcessorDependencies) {}

  async processNotice(
    notice: NoticeDetail,
    persisted: NoticeAssetPersistedNotice,
    fetchedAt: string,
  ): Promise<{
    attachmentFailures: number;
    imageFailures: number;
  }> {
    let attachmentFailures = 0;
    let imageFailures = 0;

    for (const attachment of notice.attachments) {
      const succeeded = await this.processAttachment(
        notice,
        persisted.noticeItemId,
        attachment,
        fetchedAt,
      );
      if (!succeeded) {
        attachmentFailures += 1;
      }
    }

    for (const image of notice.images) {
      const succeeded = await this.processImage(
        notice,
        persisted.noticeItemId,
        image,
        fetchedAt,
      );
      if (!succeeded) {
        imageFailures += 1;
      }
    }

    for (const storageKey of persisted.obsoleteStorageKeys) {
      await this.dependencies.assetStore.delete(storageKey);
    }

    return { attachmentFailures, imageFailures };
  }

  private async processAttachment(
    notice: NoticeDetail,
    noticeItemId: number,
    attachment: NoticeAttachment,
    fetchedAt: string,
  ): Promise<boolean> {
    try {
      const downloadedAsset = await this.dependencies.downloadAsset(
        attachment.downloadUrl,
      );
      assertAttachmentPayload(attachment, downloadedAsset);
      const storedAsset = await this.dependencies.assetStore.putAsset({
        storageKeyBase: `notices/${notice.sourceId}/${notice.externalId}/attachments/${String(attachment.sortOrder).padStart(2, "0")}`,
        buffer: downloadedAsset.buffer,
        contentType: downloadedAsset.contentType,
        fileName: attachment.fileName,
        includeFileNameSuffix: false,
      });

      await this.dependencies.repository.updateAttachmentProcessing(
        noticeItemId,
        attachment.downloadUrl,
        buildStoredUpdate(storedAsset, fetchedAt),
      );
      return true;
    } catch (error) {
      await this.dependencies.repository.updateAttachmentProcessing(
        noticeItemId,
        attachment.downloadUrl,
        {
          downloadStatus: "failed",
          errorMessage: error instanceof Error ? error.message : String(error),
        },
      );
      return false;
    }
  }

  private async processImage(
    notice: NoticeDetail,
    noticeItemId: number,
    image: NoticeAssetImage,
    fetchedAt: string,
  ): Promise<boolean> {
    try {
      const downloadedAsset = await this.dependencies.downloadAsset(image.imageUrl);
      assertImageContentType(downloadedAsset.contentType, image.imageUrl);
      const storedAsset = await this.dependencies.assetStore.putAsset({
        storageKeyBase: `notices/${notice.sourceId}/${notice.externalId}/images/${String(image.sortOrder).padStart(2, "0")}`,
        buffer: downloadedAsset.buffer,
        contentType: downloadedAsset.contentType,
        fileName: path.basename(new URL(image.imageUrl).pathname),
        includeFileNameSuffix: false,
      });

      await this.dependencies.repository.updateImageProcessing(
        noticeItemId,
        image.imageUrl,
        buildStoredUpdate(storedAsset, fetchedAt),
      );
      return true;
    } catch (error) {
      await this.dependencies.repository.updateImageProcessing(noticeItemId, image.imageUrl, {
        downloadStatus: "failed",
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  async close(): Promise<void> {
    // 현재 notice 자산 처리에는 해제할 핸들이 없지만, worker가 cafeteria와 같은
    // 패턴으로 자원 lifecycle을 다룰 수 있게 no-op close를 맞춰 둔다.
  }
}

export function createNoticeAssetProcessor(params: {
  repository: NoticeAssetRepositoryLike;
  storageLocalRoot: string;
}): NoticeAssetProcessor {
  return new NoticeAssetProcessor({
    repository: params.repository,
    assetStore: new LocalAssetStore(params.storageLocalRoot),
    downloadAsset,
  });
}
