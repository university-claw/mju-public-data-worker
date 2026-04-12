import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Jimp } from "jimp";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NoticeAssetProcessor } from "../../src/notices/asset-processor.js";
import { LocalAssetStore } from "../../src/storage/local-asset-store.js";
import type { NoticeDetail } from "../../src/notices/types.js";

const createdDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    createdDirectories.splice(0).map(async (directory) => {
      await fs.rm(directory, { recursive: true, force: true });
    }),
  );
});

function makeNotice(): NoticeDetail {
  return {
    sourceId: "general",
    externalId: "231000",
    title: "공지 테스트",
    detailUrl: "https://www.mju.ac.kr/bbs/mjukr/141/231000/artclView.do",
    author: "테스트",
    publishedAt: "2026-04-12T00:00:00.000Z",
    publishedAtRaw: "2026.04.12",
    bodyHtml: "<p>본문</p>",
    bodyText: "본문",
    contentHash: "hash",
    attachments: [
      {
        fileName: "지원서 양식.hwp",
        downloadUrl: "https://www.mju.ac.kr/bbs/mjukr/141/176543/download.do",
        sortOrder: 0,
      },
    ],
    images: [
      {
        imageUrl: "https://www.mju.ac.kr/CrossEditor/binary/images/000389/sample.png",
        altText: "sample",
        sortOrder: 0,
      },
    ],
    categoryLabel: undefined,
  };
}

async function createTinyPngBuffer(): Promise<Buffer> {
  const image = new Jimp({
    width: 2,
    height: 2,
    color: 0xff0000ff,
  });

  return image.getBuffer("image/png");
}

function createFakeHwpBuffer(): Buffer {
  return Buffer.concat([
    Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
    Buffer.from("fake-hwp-payload"),
  ]);
}

describe("notice asset processor", () => {
  it("downloads attachments and images into local storage and stores success metadata", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "notice-assets-"));
    createdDirectories.push(directory);
    const tinyPng = await createTinyPngBuffer();
    const attachmentBuffer = createFakeHwpBuffer();

    const repository = {
      updateAttachmentProcessing: vi.fn(async () => undefined),
      updateImageProcessing: vi.fn(async () => undefined),
    };
    const processor = new NoticeAssetProcessor({
      repository,
      assetStore: new LocalAssetStore(directory),
      downloadAsset: vi.fn(async (url: string) => {
        if (url.includes("download.do")) {
          return {
            buffer: attachmentBuffer,
            contentType: "application/x-hwp",
          };
        }

        return {
          buffer: tinyPng,
          contentType: "image/png",
        };
      }),
    });

    await processor.processNotice(
      makeNotice(),
      { noticeItemId: 7, obsoleteStorageKeys: [] },
      "2026-04-12T07:00:00.000Z",
    );

    expect(repository.updateAttachmentProcessing).toHaveBeenCalledWith(
      7,
      "https://www.mju.ac.kr/bbs/mjukr/141/176543/download.do",
      expect.objectContaining({
        storageProvider: "local",
        storageKey: "notices/general/231000/attachments/00.hwp",
        contentType: "application/x-hwp",
        sizeBytes: attachmentBuffer.byteLength,
        downloadStatus: "succeeded",
      }),
    );
    expect(repository.updateImageProcessing).toHaveBeenCalledWith(
      7,
      "https://www.mju.ac.kr/CrossEditor/binary/images/000389/sample.png",
      expect.objectContaining({
        storageProvider: "local",
        storageKey: "notices/general/231000/images/00.png",
        contentType: "image/png",
        sizeBytes: tinyPng.byteLength,
        downloadStatus: "succeeded",
      }),
    );

    await expect(
      fs.access(
        path.join(
          directory,
          "notices",
          "general",
          "231000",
          "attachments",
          "00.hwp",
        ),
      ),
    ).resolves.toBeUndefined();

    await expect(
      fs.access(
        path.join(
          directory,
          "notices",
          "general",
          "231000",
          "images",
          "00.png",
        ),
      ),
    ).resolves.toBeUndefined();
  });

  it("marks a broken image as failed but continues processing the notice", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "notice-assets-"));
    createdDirectories.push(directory);

    const repository = {
      updateAttachmentProcessing: vi.fn(async () => undefined),
      updateImageProcessing: vi.fn(async () => undefined),
    };
    const processor = new NoticeAssetProcessor({
      repository,
      assetStore: new LocalAssetStore(directory),
      downloadAsset: vi.fn(async (url: string) => {
        if (url.includes("download.do")) {
          return {
            buffer: createFakeHwpBuffer(),
            contentType: "application/x-hwp",
          };
        }

        throw new Error("image download failed");
      }),
    });

    await expect(
      processor.processNotice(
        makeNotice(),
        { noticeItemId: 11, obsoleteStorageKeys: [] },
        "2026-04-12T07:00:00.000Z",
      ),
    ).resolves.toEqual({
      attachmentFailures: 0,
      imageFailures: 1,
    });

    expect(repository.updateAttachmentProcessing).toHaveBeenCalledWith(
      11,
      "https://www.mju.ac.kr/bbs/mjukr/141/176543/download.do",
      expect.objectContaining({
        downloadStatus: "succeeded",
      }),
    );
    expect(repository.updateImageProcessing).toHaveBeenCalledWith(
      11,
      "https://www.mju.ac.kr/CrossEditor/binary/images/000389/sample.png",
      expect.objectContaining({
        downloadStatus: "failed",
        errorMessage: "image download failed",
      }),
    );
  });
});
