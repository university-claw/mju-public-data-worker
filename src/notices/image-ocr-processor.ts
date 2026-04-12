import path from "node:path";
import { OcrRecognizer } from "../cafeterias/ocr-recognizer.js";
import { sha256 } from "../shared/hash.js";
import { LocalAssetStore } from "../storage/local-asset-store.js";
import type {
  NoticeImageOcrUpdate,
  StoredNoticeImage,
} from "./types.js";

const MAX_OCR_TEXT_CHAR_COUNT = 200_000;
const SUPPORTED_IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp"]);
const SUPPORTED_IMAGE_CONTENT_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
]);

export interface NoticeImageOcrRepositoryLike {
  listStoredImagesForNotice(
    noticeItemId: number,
  ): Promise<StoredNoticeImage[]>;
  upsertImageOcr(
    imageId: number,
    update: NoticeImageOcrUpdate,
  ): Promise<void>;
}

export interface NoticeImageOcrSummary {
  succeededCount: number;
  unsupportedCount: number;
  failedCount: number;
  skippedCount: number;
}

interface NoticeImageOcrProcessorDependencies {
  repository: NoticeImageOcrRepositoryLike;
  assetStore: Pick<LocalAssetStore, "resolve">;
  ocrRecognizer: Pick<OcrRecognizer, "recognize" | "terminate">;
}

function buildFailedUpdate(
  errorMessage: string,
  imageSha256?: string | null,
): NoticeImageOcrUpdate {
  return {
    imageSha256: imageSha256 ?? null,
    ocrStatus: "failed",
    ocrText: null,
    textSha256: null,
    ocrConfidence: null,
    ocrLanguage: null,
    ocrExtractedAt: null,
    errorMessage,
  };
}

function buildUnsupportedUpdate(
  errorMessage: string,
  imageSha256?: string | null,
): NoticeImageOcrUpdate {
  return {
    imageSha256: imageSha256 ?? null,
    ocrStatus: "unsupported",
    ocrText: null,
    textSha256: null,
    ocrConfidence: null,
    ocrLanguage: null,
    ocrExtractedAt: null,
    errorMessage,
  };
}

function isSupportedImageForCurrentSlice(image: StoredNoticeImage): boolean {
  const contentType = image.contentType?.trim().toLowerCase();
  if (contentType && SUPPORTED_IMAGE_CONTENT_TYPES.has(contentType)) {
    return true;
  }

  const extension = path.extname(image.storageKey ?? image.imageUrl).toLowerCase();
  return SUPPORTED_IMAGE_EXTENSIONS.has(extension);
}

/**
 * 공지 본문 이미지는 첨부파일과 달리 "파일 타입 라우팅"보다는 저장된 이미지에 대해
 * 그대로 OCR을 수행하는 흐름이 핵심이다. 여기서는 notice row와 분리된 이미지 자산을
 * 읽어 "OCR 결과 적재"만 맡기고, 재다운로드나 수집 자체는 상위 단계에 남긴다.
 */
export class NoticeImageOcrProcessor {
  constructor(
    private readonly dependencies: NoticeImageOcrProcessorDependencies,
    private readonly ocrLanguages: string[],
  ) {}

  async processNotice(
    noticeItemId: number,
    extractedAt: string,
  ): Promise<NoticeImageOcrSummary> {
    const images = await this.dependencies.repository.listStoredImagesForNotice(
      noticeItemId,
    );
    const summary: NoticeImageOcrSummary = {
      succeededCount: 0,
      unsupportedCount: 0,
      failedCount: 0,
      skippedCount: 0,
    };

    for (const image of images) {
      const result = await this.processImage(image, extractedAt);
      if (result === "succeeded") {
        summary.succeededCount += 1;
      } else if (result === "unsupported") {
        summary.unsupportedCount += 1;
      } else if (result === "skipped") {
        summary.skippedCount += 1;
      } else {
        summary.failedCount += 1;
      }
    }

    return summary;
  }

  private async processImage(
    image: StoredNoticeImage,
    extractedAt: string,
  ): Promise<"succeeded" | "unsupported" | "skipped" | "failed"> {
    const ocrLanguageSignature = this.ocrLanguages.join("+");

    if (
      image.sha256 &&
      image.existingImageSha256 === image.sha256 &&
      image.existingOcrStatus === "succeeded" &&
      image.existingOcrLanguage === ocrLanguageSignature
    ) {
      return "skipped";
    }

    if (
      image.sha256 &&
      image.existingImageSha256 === image.sha256 &&
      image.existingOcrStatus === "unsupported"
    ) {
      return "skipped";
    }

    if (image.downloadStatus !== "succeeded" || !image.storageKey) {
      return "skipped";
    }

    if (!isSupportedImageForCurrentSlice(image)) {
      await this.dependencies.repository.upsertImageOcr(
        image.id,
        buildUnsupportedUpdate(
          `unsupported notice image format for current OCR slice: ${image.contentType ?? path.extname(image.storageKey)}`,
          image.sha256 ?? null,
        ),
      );
      return "unsupported";
    }

    try {
      const recognized = await this.dependencies.ocrRecognizer.recognize(
        this.dependencies.assetStore.resolve(image.storageKey),
      );
      const boundedText = recognized.text.slice(0, MAX_OCR_TEXT_CHAR_COUNT);
      if (!boundedText.trim()) {
        await this.dependencies.repository.upsertImageOcr(
          image.id,
          buildFailedUpdate("notice image OCR returned empty text", image.sha256 ?? null),
        );
        return "failed";
      }

      await this.dependencies.repository.upsertImageOcr(image.id, {
        imageSha256: image.sha256 ?? null,
        ocrStatus: "succeeded",
        ocrText: boundedText,
        textSha256: sha256(boundedText),
        ocrConfidence: recognized.confidence,
        ocrLanguage: ocrLanguageSignature,
        ocrExtractedAt: extractedAt,
        errorMessage: null,
      });
      return "succeeded";
    } catch (error) {
      await this.dependencies.repository.upsertImageOcr(
        image.id,
        buildFailedUpdate(
          error instanceof Error ? error.message : String(error),
          image.sha256 ?? null,
        ),
      );
      return "failed";
    }
  }

  async close(): Promise<void> {
    await this.dependencies.ocrRecognizer.terminate();
  }
}

export function createNoticeImageOcrProcessor(params: {
  repository: NoticeImageOcrRepositoryLike;
  storageLocalRoot: string;
  ocrLanguages: string[];
}): NoticeImageOcrProcessor {
  return new NoticeImageOcrProcessor(
    {
      repository: params.repository,
      assetStore: new LocalAssetStore(params.storageLocalRoot),
      ocrRecognizer: new OcrRecognizer(
        params.ocrLanguages,
        path.join(params.storageLocalRoot, ".ocr-cache", "notice-images"),
      ),
    },
    params.ocrLanguages,
  );
}
