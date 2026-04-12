import { httpClient } from "../http/client.js";
import path from "node:path";
import type {
  CafeteriaInstagramPost,
  CafeteriaInstagramProcessingUpdate,
  CafeteriaInstagramUpsertResult,
} from "./types.js";
import { LocalAssetStore, type StoredLocalAsset } from "../storage/local-asset-store.js";
import { OcrRecognizer } from "./ocr-recognizer.js";

export interface CafeteriaPostAssetRepositoryLike {
  updateInstagramPostProcessing(
    postId: number,
    update: CafeteriaInstagramProcessingUpdate,
  ): Promise<void>;
}

export interface CafeteriaPostAssetProcessorLike {
  processPost(
    post: CafeteriaInstagramPost,
    persisted: CafeteriaInstagramUpsertResult,
    fetchedAt: string,
  ): Promise<void>;
  close(): Promise<void>;
}

interface DownloadedImage {
  buffer: Buffer;
  contentType: string | null;
}

interface CafeteriaPostAssetProcessorDependencies {
  repository: CafeteriaPostAssetRepositoryLike;
  assetStore: Pick<LocalAssetStore, "putImage">;
  ocrRecognizer: Pick<OcrRecognizer, "recognize" | "terminate">;
  downloadImage(url: string): Promise<DownloadedImage>;
}

async function downloadImage(url: string): Promise<DownloadedImage> {
  const response = await httpClient.get(url, {
    headers: {
      accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
      referer: "https://www.instagram.com/",
    },
    responseType: "buffer",
  });

  return {
    buffer: response.rawBody,
    contentType: response.headers["content-type"] ?? null,
  };
}

function assertImageContentType(contentType: string | null): void {
  if (!contentType) {
    return;
  }

  if (!contentType.toLowerCase().startsWith("image/")) {
    throw new Error(`downloaded response is not an image: ${contentType}`);
  }
}

/**
 * 이번 슬라이스에서는 학식표 이미지를 "나중에 다시 OCR 가능한 원본 자산"으로
 * 남기는 것이 핵심이다. 그래서 raw JSON만 저장하던 흐름에 이미지 다운로드,
 * 로컬 저장, OCR 텍스트 적재를 한 번의 post-processing 단계로 묶는다.
 */
export class CafeteriaPostAssetProcessor
  implements CafeteriaPostAssetProcessorLike
{
  private readonly ocrLanguageLabel: string;

  constructor(
    private readonly dependencies: CafeteriaPostAssetProcessorDependencies,
    ocrLanguages: string[],
  ) {
    this.ocrLanguageLabel = ocrLanguages.join("+");
  }

  async processPost(
    post: CafeteriaInstagramPost,
    persisted: CafeteriaInstagramUpsertResult,
    fetchedAt: string,
  ): Promise<void> {
    if (!post.imageUrl) {
      await this.dependencies.repository.updateInstagramPostProcessing(
        persisted.cafeteriaInstagramPostId,
        {
          ocrStatus: "skipped",
          ocrText: null,
          ocrConfidence: null,
          ocrLanguage: null,
          ocrExtractedAt: null,
          ocrErrorMessage: "image url missing",
        },
      );
      return;
    }

    const downloadedImage = await this.dependencies.downloadImage(post.imageUrl);
    assertImageContentType(downloadedImage.contentType);
    const storedImage = await this.dependencies.assetStore.putImage({
      storageKeyBase: `cafeterias/${post.sourceId}/${post.postCode}/original`,
      buffer: downloadedImage.buffer,
      contentType: downloadedImage.contentType,
    });

    const shouldSkipOcr =
      persisted.imageSha256 === storedImage.sha256 &&
      persisted.ocrStatus === "succeeded" &&
      persisted.imageStorageKey === storedImage.storageKey;

    if (shouldSkipOcr) {
      return;
    }

    try {
      const ocrResult = await this.dependencies.ocrRecognizer.recognize(
        storedImage.absolutePath,
      );

      await this.dependencies.repository.updateInstagramPostProcessing(
        persisted.cafeteriaInstagramPostId,
        buildProcessingUpdate({
          storedImage,
          fetchedAt,
          ocrStatus: "succeeded",
          ocrText: ocrResult.text,
          ocrConfidence: ocrResult.confidence,
          ocrLanguage: this.ocrLanguageLabel,
          ocrExtractedAt: fetchedAt,
          ocrErrorMessage: null,
        }),
      );
    } catch (error) {
      await this.dependencies.repository.updateInstagramPostProcessing(
        persisted.cafeteriaInstagramPostId,
        buildProcessingUpdate({
          storedImage,
          fetchedAt,
          ocrStatus: "failed",
          ocrText: null,
          ocrConfidence: null,
          ocrLanguage: this.ocrLanguageLabel,
          ocrExtractedAt: null,
          ocrErrorMessage: error instanceof Error ? error.message : String(error),
        }),
      );
      throw error;
    }
  }

  async close(): Promise<void> {
    await this.dependencies.ocrRecognizer.terminate();
  }
}

function buildProcessingUpdate(params: {
  storedImage: StoredLocalAsset;
  fetchedAt: string;
  ocrStatus: CafeteriaInstagramProcessingUpdate["ocrStatus"];
  ocrText: string | null;
  ocrConfidence: number | null;
  ocrLanguage: string | null;
  ocrExtractedAt: string | null;
  ocrErrorMessage: string | null;
}): CafeteriaInstagramProcessingUpdate {
  return {
    imageStorageProvider: params.storedImage.storageProvider,
    imageStorageKey: params.storedImage.storageKey,
    imageContentType: params.storedImage.contentType,
    imageSizeBytes: params.storedImage.sizeBytes,
    imageSha256: params.storedImage.sha256,
    imageDownloadedAt: params.fetchedAt,
    ocrStatus: params.ocrStatus,
    ocrText: params.ocrText,
    ocrConfidence: params.ocrConfidence,
    ocrLanguage: params.ocrLanguage,
    ocrExtractedAt: params.ocrExtractedAt,
    ocrErrorMessage: params.ocrErrorMessage,
  };
}

export function createCafeteriaPostAssetProcessor(params: {
  repository: CafeteriaPostAssetRepositoryLike;
  storageLocalRoot: string;
  ocrLanguages: string[];
}): CafeteriaPostAssetProcessor {
  return new CafeteriaPostAssetProcessor({
    repository: params.repository,
    assetStore: new LocalAssetStore(params.storageLocalRoot),
    ocrRecognizer: new OcrRecognizer(
      params.ocrLanguages,
      path.join(params.storageLocalRoot, ".tesseract-cache"),
    ),
    downloadImage,
  }, params.ocrLanguages);
}
