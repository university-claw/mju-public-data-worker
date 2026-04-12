import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  CafeteriaInstagramPost,
  CafeteriaInstagramUpsertResult,
} from "../../src/cafeterias/types.js";
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
          buffer: Buffer.from("fake-image-content"),
          contentType: "image/jpeg",
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
          "cafeterias/student-hall/DW99EJ0E3mb/original.jpg",
        imageContentType: "image/jpeg",
        imageSizeBytes: Buffer.byteLength("fake-image-content"),
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
      "original.jpg",
    );
    await expect(fs.access(savedPath)).resolves.toBeUndefined();
  });

  it("skips OCR when the same image hash already succeeded", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "cafeteria-assets-"));
    createdDirectories.push(directory);

    const assetStore = new LocalAssetStore(directory);
    const stored = await assetStore.putImage({
      storageKeyBase: "cafeterias/student-hall/DW99EJ0E3mb/original",
      buffer: Buffer.from("same-image"),
      contentType: "image/jpeg",
    });

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
          buffer: Buffer.from("same-image"),
          contentType: "image/jpeg",
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
          buffer: Buffer.from("unused"),
          contentType: "image/jpeg",
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
          buffer: Buffer.from("fake-image-content"),
          contentType: "image/jpeg",
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
        ocrStatus: "failed",
        ocrErrorMessage: "ocr engine failed",
      }),
    );
  });
});
