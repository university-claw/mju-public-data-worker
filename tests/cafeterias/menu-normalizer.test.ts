import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Jimp, JimpMime } from "jimp";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CafeteriaMenuNormalizer, cafeteriaMenuNormalizerTestHelpers } from "../../src/cafeterias/menu-normalizer.js";
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
