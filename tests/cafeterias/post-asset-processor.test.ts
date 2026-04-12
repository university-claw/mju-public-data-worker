import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Jimp } from "jimp";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  CafeteriaInstagramPost,
  CafeteriaInstagramUpsertResult,
} from "../../src/cafeterias/types.js";
import { buildCafeteriaImageFingerprint } from "../../src/cafeterias/image-fingerprint.js";
import { CafeteriaPostAssetProcessor } from "../../src/cafeterias/post-asset-processor.js";
import { LocalAssetStore } from "../../src/storage/local-asset-store.js";

function makePost(imageUrl?: string): CafeteriaInstagramPost {
  return {
    sourceId: "student-hall",
    postCode: "DW99EJ0E3mb",
    profileUrl: "https://www.instagram.com/mjhs_yongin/",
    permalink: "https://www.instagram.com/p/DW99EJ0E3mb/",
    caption: "다음주 식단표",
    postedAt: "2026-04-12T00:00:00.000Z",
    postedAtEpoch: 1775952000,
    imageUrl,
    rawItem: { code: "DW99EJ0E3mb" },
  };
}

function makePersisted(overrides: Partial<CafeteriaInstagramUpsertResult> = {}): CafeteriaInstagramUpsertResult {
  return {
    cafeteriaInstagramPostId: 1,
    wasInserted: true,
    imageStorageProvider: null,
    imageStorageKey: null,
    imageSha256: null,
    ocrStatus: "pending",
    ...overrides,
  };
}

const createdDirectories: string[] = [];

async function createTinyPngBuffer(): Promise<Buffer> {
  const image = new Jimp({
    width: 2,
    height: 2,
    color: 0xff0000ff,
  });

  return image.getBuffer("image/png");
}

afterEach(async () => {
  await Promise.all(
    createdDirectories.splice(0).map(async (directory) => {
      await fs.rm(directory, { recursive: true, force: true });
    }),
  );
});

describe("cafeteria post asset processor", () => {
  it("downloads the instagram image, stores it locally, and persists OCR output", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "cafeteria-assets-"));
    createdDirectories.push(directory);
    const tinyPngBuffer = await createTinyPngBuffer();

    const repository = {
      updateInstagramPostProcessing: vi.fn(async () => undefined),
    };
    const ocrRecognizer = {
      recognize: vi.fn(async () => ({
        text: "4월 13일~17일 주간식단표",
        confidence: 88.76,
      })),
      terminate: vi.fn(async () => undefined),
    };
    const processor = new CafeteriaPostAssetProcessor(
      {
        repository,
        assetStore: new LocalAssetStore(directory),
        ocrRecognizer,
        downloadImage: vi.fn(async () => ({
          buffer: tinyPngBuffer,
          contentType: "image/png",
        })),
      },
      ["kor", "eng"],
    );

    await processor.processPost(
      makePost("https://cdn.example.com/menu.jpg"),
      makePersisted(),
      "2026-04-12T06:30:00.000Z",
    );

    expect(ocrRecognizer.recognize).toHaveBeenCalledTimes(1);
    expect(repository.updateInstagramPostProcessing).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        imageStorageProvider: "local",
        imageStorageKey:
          "cafeterias/student-hall/DW99EJ0E3mb/original.png",
        imageContentType: "image/png",
        imageSizeBytes: tinyPngBuffer.byteLength,
        imagePerceptualHash: expect.any(String),
        ocrStatus: "succeeded",
        ocrText: "4월 13일~17일 주간식단표",
        ocrConfidence: 88.76,
        ocrLanguage: "kor+eng",
      }),
    );

    const savedPath = path.join(
      directory,
      "cafeterias",
      "student-hall",
      "DW99EJ0E3mb",
      "original.png",
    );
    await expect(fs.access(savedPath)).resolves.toBeUndefined();
  });

  it("skips OCR when the same image hash already succeeded", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "cafeteria-assets-"));
    createdDirectories.push(directory);
    const tinyPngBuffer = await createTinyPngBuffer();

    const assetStore = new LocalAssetStore(directory);
    const sameImageBuffer = tinyPngBuffer;
    const stored = await assetStore.putImage({
      storageKeyBase: "cafeterias/student-hall/DW99EJ0E3mb/original",
      buffer: sameImageBuffer,
      contentType: "image/png",
    });
    const fingerprint = await buildCafeteriaImageFingerprint(sameImageBuffer);

    const repository = {
      updateInstagramPostProcessing: vi.fn(async () => undefined),
    };
    const ocrRecognizer = {
      recognize: vi.fn(async () => ({
        text: "should not run",
        confidence: 50,
      })),
      terminate: vi.fn(async () => undefined),
    };
    const processor = new CafeteriaPostAssetProcessor(
      {
        repository,
        assetStore,
        ocrRecognizer,
        downloadImage: vi.fn(async () => ({
          buffer: sameImageBuffer,
          contentType: "image/png",
        })),
      },
      ["kor", "eng"],
    );

    await processor.processPost(
      makePost("https://cdn.example.com/menu.jpg"),
      makePersisted({
        imageStorageProvider: "local",
        imageStorageKey: stored.storageKey,
        imageSha256: stored.sha256,
        imagePerceptualHash: fingerprint.perceptualHash,
        ocrStatus: "succeeded",
      }),
      "2026-04-12T06:30:00.000Z",
    );

    expect(ocrRecognizer.recognize).not.toHaveBeenCalled();
    expect(repository.updateInstagramPostProcessing).not.toHaveBeenCalled();
  });

  it("marks the row as skipped when no image url exists", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "cafeteria-assets-"));
    createdDirectories.push(directory);
    const tinyPngBuffer = await createTinyPngBuffer();

    const repository = {
      updateInstagramPostProcessing: vi.fn(async () => undefined),
    };
    const processor = new CafeteriaPostAssetProcessor(
      {
        repository,
        assetStore: new LocalAssetStore(directory),
        ocrRecognizer: {
          recognize: vi.fn(async () => ({ text: "", confidence: null })),
          terminate: vi.fn(async () => undefined),
        },
        downloadImage: vi.fn(async () => ({
          buffer: tinyPngBuffer,
          contentType: "image/png",
        })),
      },
      ["kor", "eng"],
    );

    await processor.processPost(
      makePost(undefined),
      makePersisted(),
      "2026-04-12T06:30:00.000Z",
    );

    expect(repository.updateInstagramPostProcessing).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        ocrStatus: "skipped",
        ocrErrorMessage: "image url missing",
      }),
    );
  });

  it("stores failed OCR status before rethrowing the error", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "cafeteria-assets-"));
    createdDirectories.push(directory);
    const tinyPngBuffer = await createTinyPngBuffer();

    const repository = {
      updateInstagramPostProcessing: vi.fn(async () => undefined),
    };
    const ocrRecognizer = {
      recognize: vi.fn(async () => {
        throw new Error("ocr engine failed");
      }),
      terminate: vi.fn(async () => undefined),
    };
    const processor = new CafeteriaPostAssetProcessor(
      {
        repository,
        assetStore: new LocalAssetStore(directory),
        ocrRecognizer,
        downloadImage: vi.fn(async () => ({
          buffer: tinyPngBuffer,
          contentType: "image/png",
        })),
      },
      ["kor", "eng"],
    );

    await expect(
      processor.processPost(
        makePost("https://cdn.example.com/menu.jpg"),
        makePersisted(),
        "2026-04-12T06:30:00.000Z",
      ),
    ).rejects.toThrow(/ocr engine failed/);

    expect(repository.updateInstagramPostProcessing).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        imageStorageProvider: "local",
        imagePerceptualHash: expect.any(String),
        ocrStatus: "failed",
        ocrErrorMessage: "ocr engine failed",
      }),
    );
  });

  it("continues OCR processing even when perceptual hash extraction fails", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "cafeteria-assets-"));
    createdDirectories.push(directory);

    const repository = {
      updateInstagramPostProcessing: vi.fn(async () => undefined),
    };
    const processor = new CafeteriaPostAssetProcessor(
      {
        repository,
        assetStore: new LocalAssetStore(directory),
        ocrRecognizer: {
          recognize: vi.fn(async () => ({
            text: "주간식단표",
            confidence: 87.2,
          })),
          terminate: vi.fn(async () => undefined),
        },
        downloadImage: vi.fn(async () => ({
          buffer: Buffer.from("not-a-real-image"),
          contentType: "image/png",
        })),
      },
      ["kor", "eng"],
    );

    await processor.processPost(
      makePost("https://cdn.example.com/menu.png"),
      makePersisted(),
      "2026-04-12T06:30:00.000Z",
    );

    expect(repository.updateInstagramPostProcessing).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        imagePerceptualHash: null,
        ocrStatus: "succeeded",
        ocrText: "주간식단표",
      }),
    );
  });
});
