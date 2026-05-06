import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Jimp, JimpMime } from "jimp";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CafeteriaMenuNormalizer, cafeteriaMenuNormalizerTestHelpers } from "../../src/cafeterias/menu-normalizer.js";
import type { OcrTextBlock } from "../../src/cafeterias/ocr-recognizer.js";
import type { CafeteriaMenuNormalizationContext } from "../../src/cafeterias/types.js";

async function createBlankImageFile(): Promise<string> {
  const filePath = path.join(
    os.tmpdir(),
    `mju-public-data-worker-normalizer-${Date.now()}-${Math.random().toString(16).slice(2)}.png`,
  );
  const image = new Jimp({
    width: 1400,
    height: 1000,
    color: 0xffffffff,
  });
  const buffer = await image.getBuffer(JimpMime.png);
  await fs.writeFile(filePath, buffer);
  return filePath;
}

function createContext(
  overrides: Partial<CafeteriaMenuNormalizationContext> = {},
): CafeteriaMenuNormalizationContext {
  return {
    sourceDocumentId: 1,
    sourcePostId: 2,
    source: {
      id: "student-hall",
      name: "학생회관",
      description: "학생회관 식당",
      profileUrl: "https://www.instagram.com/mjhs_yongin/",
      instagramUsername: "mjhs_yongin",
      menuImageGroup: "student-hall-myeongjin",
      supportsWeekendMenu: true,
    },
    imageStorageKey: "cafeterias/student-hall/test/original.png",
    documentScope: "weekday",
    serviceStartDate: "2026-04-13",
    serviceEndDate: "2026-04-17",
    breakfastAvailable: true,
    lunchAvailable: true,
    dinnerAvailable: false,
    ...overrides,
  };
}

const temporaryFiles = new Set<string>();

function makeBlock(
  text: string,
  x: number,
  y: number,
  confidence = 95,
): OcrTextBlock {
  return {
    text,
    confidence,
    box: {
      x1: x - 40,
      y1: y - 8,
      x2: x + 40,
      y2: y + 8,
    },
  };
}

afterEach(async () => {
  await Promise.all(
    [...temporaryFiles].map(async (filePath) => {
      temporaryFiles.delete(filePath);
      await fs.rm(filePath, { force: true });
    }),
  );
});

describe("cafeteria menu normalizer helpers", () => {
  it("expands inclusive service dates", () => {
    expect(
      cafeteriaMenuNormalizerTestHelpers.expandServiceDates(
        "2026-04-13",
        "2026-04-17",
      ),
    ).toEqual([
      "2026-04-13",
      "2026-04-14",
      "2026-04-15",
      "2026-04-16",
      "2026-04-17",
    ]);
  });

  it("filters cafeteria layout noise and keeps real menu lines", () => {
    expect(
      cafeteriaMenuNormalizerTestHelpers.cleanMenuItems(`
        명지대자연캠퍼스 직원식당
        2026.04.13-04.17
        월
        주간 메뉴표
        고구마치즈돈까스
        잡곡밥/백미밥
        미운영
      `),
    ).toEqual([
      "고구마치즈돈까스",
      "잡곡밥/백미밥",
      "미운영",
    ]);
  });

  it("treats exact close markers as closed cells only", () => {
    expect(
      cafeteriaMenuNormalizerTestHelpers.shouldMarkClosedCell(["미운영"]),
    ).toBe(true);
    expect(
      cafeteriaMenuNormalizerTestHelpers.shouldMarkClosedCell(["휴일"]),
    ).toBe(true);
    expect(
      cafeteriaMenuNormalizerTestHelpers.shouldMarkClosedCell([
        "미운영",
        "잡곡밥/백미밥",
      ]),
    ).toBe(false);
  });
});

describe("cafeteria menu normalizer", () => {
  it("fails fast when the cafeteria template does not have a known layout profile", async () => {
    const imagePath = await createBlankImageFile();
    temporaryFiles.add(imagePath);
    const normalizer = new CafeteriaMenuNormalizer({
      assetStore: {
        resolve: () => imagePath,
      },
      ocrRecognizer: {
        recognizeBuffer: vi.fn(),
        terminate: vi.fn(),
      },
    });

    const result = await normalizer.normalizeDocument(
      createContext({
        source: {
          id: "mystery-cafeteria",
          name: "알수없음",
          description: "알수없음",
          profileUrl: "https://example.com",
          instagramUsername: "mystery",
          menuImageGroup: "mystery",
          supportsWeekendMenu: false,
        },
      }),
    );

    expect(result.status).toBe("failed");
    expect(result.reason).toContain("no layout profile");
  });

  it("marks weekend lunch cells as closed only when the OCR cell is an exact close marker", async () => {
    const imagePath = await createBlankImageFile();
    temporaryFiles.add(imagePath);
    const recognizeBuffer = vi
      .fn()
      .mockResolvedValueOnce({
        text: "고추장제육덮밥\n팽이유부된장국\n배추김치",
        confidence: 90,
      })
      .mockResolvedValueOnce({
        text: "미운영",
        confidence: 96,
      });
    const normalizer = new CafeteriaMenuNormalizer({
      assetStore: {
        resolve: () => imagePath,
      },
      ocrRecognizer: {
        recognizeBuffer,
        terminate: vi.fn(),
      },
    });

    const result = await normalizer.normalizeDocument(
      createContext({
        documentScope: "weekend",
        serviceStartDate: "2026-04-11",
        serviceEndDate: "2026-04-12",
        breakfastAvailable: false,
        lunchAvailable: true,
      }),
    );

    expect(result.status).toBe("succeeded");
    expect(result.entries).toEqual([
      expect.objectContaining({
        serviceDate: "2026-04-11",
        mealType: "lunch",
        isClosed: false,
      }),
      expect.objectContaining({
        serviceDate: "2026-04-12",
        mealType: "lunch",
        isClosed: true,
        menuText: "미운영",
      }),
    ]);
  });

  it("uses full-image OCR coordinates before falling back to cell crops", async () => {
    const imagePath = await createBlankImageFile();
    temporaryFiles.add(imagePath);
    const recognize = vi.fn().mockResolvedValue({
      text: "공휴일\n오코노미온더까스\n(퓨전식돈까스)\n쉬림프콥샐러드\n*시저D",
      confidence: 96,
      blocks: [
        makeBlock("공휴일", 450, 545),
        makeBlock("오코노미온더까스", 780, 555),
        makeBlock("(퓨전식돈까스)", 780, 580),
        makeBlock("쉬림프콥샐러드", 780, 710),
        makeBlock("*시저D", 780, 735),
      ],
    });
    const recognizeBuffer = vi.fn();
    const normalizer = new CafeteriaMenuNormalizer({
      assetStore: {
        resolve: () => imagePath,
      },
      ocrRecognizer: {
        recognize,
        recognizeBuffer,
        terminate: vi.fn(),
      },
    });

    const result = await normalizer.normalizeDocument(
      createContext({
        serviceStartDate: "2026-05-04",
        serviceEndDate: "2026-05-08",
        breakfastAvailable: true,
        lunchAvailable: true,
      }),
    );

    expect(recognize).toHaveBeenCalledWith(imagePath);
    expect(recognizeBuffer).not.toHaveBeenCalled();
    expect(result.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          serviceDate: "2026-05-05",
          mealType: "breakfast",
          isClosed: true,
          menuText: "공휴일",
        }),
        expect.objectContaining({
          serviceDate: "2026-05-05",
          mealType: "lunch",
          isClosed: true,
          menuText: "공휴일",
        }),
        expect.objectContaining({
          serviceDate: "2026-05-06",
          mealType: "lunch",
          menuItems: [
            "오코노미온더까스(퓨전식돈까스)",
            "쉬림프콥샐러드",
            "*시저D",
          ],
        }),
      ]),
    );
  });

  it.each([
    ["bokji", 530, 857],
    ["bangmok", 532, 872],
  ])(
    "keeps %s Foodist lunch footer lines in lunch and includes lower dinner lines",
    async (sourceId, lunchFooterY, dinnerFooterY) => {
      const imagePath = await createBlankImageFile();
      temporaryFiles.add(imagePath);
      const recognize = vi.fn().mockResolvedValue({
        text: "lunch-main\nlunch-footer\ndinner-main\ndinner-footer",
        confidence: 96,
        blocks: [
          makeBlock("lunch-main", 240, 350),
          makeBlock("lunch-footer", 240, lunchFooterY),
          makeBlock("dinner-main", 240, 675),
          makeBlock("dinner-footer", 240, dinnerFooterY),
        ],
      });
      const recognizeBuffer = vi.fn();
      const normalizer = new CafeteriaMenuNormalizer({
        assetStore: {
          resolve: () => imagePath,
        },
        ocrRecognizer: {
          recognize,
          recognizeBuffer,
          terminate: vi.fn(),
        },
      });

      const result = await normalizer.normalizeDocument(
        createContext({
          source: {
            id: sourceId,
            name: sourceId,
            description: sourceId,
            profileUrl: "https://example.com",
            instagramUsername: sourceId,
            menuImageGroup: "bokji-bangmok",
            supportsWeekendMenu: false,
          },
          serviceStartDate: "2026-05-04",
          serviceEndDate: "2026-05-04",
          breakfastAvailable: false,
          lunchAvailable: true,
          dinnerAvailable: true,
        }),
      );

      expect(recognize).toHaveBeenCalledWith(imagePath);
      expect(recognizeBuffer).not.toHaveBeenCalled();
      expect(result.status).toBe("succeeded");
      expect(result.entries).toEqual([
        expect.objectContaining({
          serviceDate: "2026-05-04",
          mealType: "lunch",
          menuItems: ["lunch-main", "lunch-footer"],
        }),
        expect.objectContaining({
          serviceDate: "2026-05-04",
          mealType: "dinner",
          menuItems: ["dinner-main", "dinner-footer"],
        }),
      ]);
    },
  );

  it("returns partial when some expected menu cells are empty", async () => {
    const imagePath = await createBlankImageFile();
    temporaryFiles.add(imagePath);
    const recognizeBuffer = vi
      .fn()
      .mockResolvedValueOnce({
        text: "고추장제육덮밥\n팽이유부된장국",
        confidence: 88,
      })
      .mockResolvedValueOnce({
        text: "",
        confidence: 12,
      });
    const normalizer = new CafeteriaMenuNormalizer({
      assetStore: {
        resolve: () => imagePath,
      },
      ocrRecognizer: {
        recognizeBuffer,
        terminate: vi.fn(),
      },
    });

    const result = await normalizer.normalizeDocument(
      createContext({
        documentScope: "weekend",
        serviceStartDate: "2026-04-11",
        serviceEndDate: "2026-04-12",
        breakfastAvailable: false,
        lunchAvailable: true,
      }),
    );

    expect(result.status).toBe("partial");
    expect(result.entries).toHaveLength(1);
    expect(result.reason).toContain("1/2");
  });
});
