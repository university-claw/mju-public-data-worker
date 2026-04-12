import fs from "node:fs/promises";
import path from "node:path";
import { Jimp, JimpMime } from "jimp";
import { PSM } from "tesseract.js";
import { OcrRecognizer } from "./ocr-recognizer.js";
import { LocalAssetStore } from "../storage/local-asset-store.js";
import type {
  CafeteriaMenuMealType,
  CafeteriaMenuNormalizationContext,
  CafeteriaMenuNormalizationResult,
  CafeteriaNormalizedMenuEntry,
} from "./types.js";

interface LayoutProfile {
  dayCount: number;
  tableRect: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  labelColumnRatio: number;
  headerHeightRatio: number;
  cellPaddingXRatio: number;
  cellPaddingYRatio: number;
  mealBands: Array<{
    mealType: CafeteriaMenuMealType;
    startRatio: number;
    heightRatio: number;
  }>;
}

interface CellOcrResult {
  text: string;
  confidence: number;
}

interface CafeteriaMenuNormalizerDependencies {
  assetStore: Pick<LocalAssetStore, "resolve">;
  ocrRecognizer: Pick<OcrRecognizer, "recognizeBuffer" | "terminate">;
}

const LAYOUT_PROFILES: Record<string, LayoutProfile> = {
  "student-hall:weekday": {
    dayCount: 5,
    tableRect: {
      x: 0.055,
      y: 0.16,
      width: 0.90,
      height: 0.61,
    },
    labelColumnRatio: 0.12,
    headerHeightRatio: 0.14,
    cellPaddingXRatio: 0.08,
    cellPaddingYRatio: 0.10,
    mealBands: [
      {
        mealType: "breakfast",
        startRatio: 0,
        heightRatio: 0.47,
      },
      {
        mealType: "lunch",
        startRatio: 0.47,
        heightRatio: 0.53,
      },
    ],
  },
  "student-hall:weekend": {
    dayCount: 2,
    tableRect: {
      x: 0.19,
      y: 0.245,
      width: 0.62,
      height: 0.44,
    },
    labelColumnRatio: 0.16,
    headerHeightRatio: 0.17,
    cellPaddingXRatio: 0.10,
    cellPaddingYRatio: 0.14,
    mealBands: [
      {
        mealType: "lunch",
        startRatio: 0,
        heightRatio: 1,
      },
    ],
  },
  "myeongjin:weekday": {
    dayCount: 5,
    tableRect: {
      x: 0.055,
      y: 0.16,
      width: 0.90,
      height: 0.61,
    },
    labelColumnRatio: 0.12,
    headerHeightRatio: 0.14,
    cellPaddingXRatio: 0.08,
    cellPaddingYRatio: 0.10,
    mealBands: [
      {
        mealType: "lunch",
        startRatio: 0,
        heightRatio: 1,
      },
    ],
  },
  "bokji-bangmok:weekday": {
    dayCount: 5,
    tableRect: {
      x: 0.03,
      y: 0.175,
      width: 0.94,
      height: 0.58,
    },
    labelColumnRatio: 0.055,
    headerHeightRatio: 0.115,
    cellPaddingXRatio: 0.06,
    cellPaddingYRatio: 0.08,
    mealBands: [
      {
        mealType: "lunch",
        startRatio: 0,
        heightRatio: 0.52,
      },
      {
        mealType: "dinner",
        startRatio: 0.52,
        heightRatio: 0.48,
      },
    ],
  },
};

const FILTERED_LINE_PATTERNS = [
  /명지대/i,
  /lounge/i,
  /운영시간/i,
  /efoodist/i,
  /영양사/i,
  /식자재/i,
  /원산지/i,
  /오늘의 메뉴/i,
  /주간\s*메뉴표/i,
  /주중식단표/i,
  /주말식단표/i,
  /[0-9]{2,3}[-)][0-9]{2,4}/,
];

function toKey(context: CafeteriaMenuNormalizationContext): string | null {
  if (context.source.id === "student-hall") {
    return `student-hall:${context.documentScope}`;
  }

  if (context.source.id === "myeongjin") {
    return "myeongjin:weekday";
  }

  if (context.source.id === "bokji" || context.source.id === "bangmok") {
    return "bokji-bangmok:weekday";
  }

  return null;
}

function expandServiceDates(
  serviceStartDate: string | null | undefined,
  serviceEndDate: string | null | undefined,
): string[] {
  if (!serviceStartDate || !serviceEndDate) {
    return [];
  }

  const dates: string[] = [];
  const cursor = new Date(`${serviceStartDate}T00:00:00Z`);
  const end = new Date(`${serviceEndDate}T00:00:00Z`);

  while (cursor <= end) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return dates;
}

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function isNoiseLine(line: string): boolean {
  if (!line) {
    return true;
  }

  if (FILTERED_LINE_PATTERNS.some((pattern) => pattern.test(line))) {
    return true;
  }

  if (/^[^0-9A-Za-z가-힣]+$/u.test(line)) {
    return true;
  }

  if (/^(월|화|수|목|금|토|일)$/u.test(line)) {
    return true;
  }

  if (/^\d{1,2}[./-]\d{1,2}/.test(line) || /^\d{4}[./-]\d{2}/.test(line)) {
    return true;
  }

  return false;
}

function cleanMenuItems(text: string): string[] {
  const rawLines = text
    .split(/\r?\n/)
    .map((line) =>
      collapseWhitespace(
        line
          .replace(/[|]/g, " ")
          .replace(/[•·]/g, " ")
          .replace(/[“”"]/g, " ")
          .replace(/\s*\*\s*/g, " *"),
      ),
    )
    .filter(Boolean);

  const items: string[] = [];
  for (const line of rawLines) {
    if (isNoiseLine(line)) {
      continue;
    }

    if (items.at(-1) === line) {
      continue;
    }

    items.push(line);
  }

  return items;
}

function shouldMarkClosedCell(menuItems: string[]): boolean {
  if (menuItems.length === 0) {
    return false;
  }

  return menuItems.every((item) => /^(미운영|휴무|휴일)$/u.test(item));
}

function clampCropValue(value: number, max: number): number {
  return Math.max(0, Math.min(value, max));
}

async function cropCellBuffer(params: {
  image: any;
  profile: LayoutProfile;
  band: LayoutProfile["mealBands"][number];
  dayIndex: number;
}): Promise<Buffer> {
  const { image, profile, band, dayIndex } = params;
  const tableX = image.width * profile.tableRect.x;
  const tableY = image.height * profile.tableRect.y;
  const tableWidth = image.width * profile.tableRect.width;
  const tableHeight = image.height * profile.tableRect.height;
  const headerHeight = tableHeight * profile.headerHeightRatio;
  const labelColumnWidth = tableWidth * profile.labelColumnRatio;
  const dayColumnWidth = (tableWidth - labelColumnWidth) / profile.dayCount;
  const bodyHeight = tableHeight - headerHeight;
  const bandY = tableY + headerHeight + bodyHeight * band.startRatio;
  const bandHeight = bodyHeight * band.heightRatio;

  const paddingX = dayColumnWidth * profile.cellPaddingXRatio;
  const paddingY = bandHeight * profile.cellPaddingYRatio;
  const cropX = clampCropValue(
    Math.round(tableX + labelColumnWidth + dayColumnWidth * dayIndex + paddingX),
    image.width - 1,
  );
  const cropY = clampCropValue(
    Math.round(bandY + paddingY),
    image.height - 1,
  );
  const cropWidth = clampCropValue(
    Math.round(dayColumnWidth - paddingX * 2),
    image.width - cropX,
  );
  const cropHeight = clampCropValue(
    Math.round(bandHeight - paddingY * 2),
    image.height - cropY,
  );

  const cropped = image
    .clone()
    .crop({
      x: cropX,
      y: cropY,
      w: cropWidth,
      h: cropHeight,
    })
    .greyscale()
    .contrast(0.25)
    .normalize()
    .resize({
      w: Math.max(cropWidth * 2, 400),
      h: Math.max(cropHeight * 2, 260),
    });

  return cropped.getBuffer(JimpMime.png);
}

function createClosedEntry(params: {
  serviceDate: string;
  mealType: CafeteriaMenuMealType;
}): CafeteriaNormalizedMenuEntry {
  return {
    serviceDate: params.serviceDate,
    mealType: params.mealType,
    isClosed: true,
    menuItems: ["미운영"],
    menuText: "미운영",
    confidence: 1,
  };
}

function summariseNormalizationResult(params: {
  expectedCount: number;
  entries: CafeteriaNormalizedMenuEntry[];
  errors: string[];
}): Pick<
  CafeteriaMenuNormalizationResult,
  "status" | "confidence" | "reason" | "errorMessage"
> {
  if (params.entries.length === 0) {
    return {
      status: "failed",
      confidence: 0.2,
      reason: "no normalized cafeteria menu entries were produced",
      errorMessage: params.errors.join(" | ") || "normalizer could not extract any entries",
    };
  }

  const averageConfidence =
    params.entries.reduce((sum, entry) => sum + entry.confidence, 0) /
    params.entries.length;

  if (params.errors.length > 0 || params.entries.length < params.expectedCount) {
    return {
      status: "partial",
      confidence: Number(averageConfidence.toFixed(2)),
      reason: `normalized ${params.entries.length}/${params.expectedCount} menu entries`,
      errorMessage: params.errors.join(" | ") || null,
    };
  }

  return {
    status: "succeeded",
    confidence: Number(averageConfidence.toFixed(2)),
    reason: `normalized ${params.entries.length}/${params.expectedCount} menu entries`,
    errorMessage: null,
  };
}

/**
 * 이 정규화기는 서비스가 실제로 읽을 수 있는 "날짜별 / 식당별 / 끼니별 메뉴"를
 * 만드는 단계다. 전체 이미지 OCR 한 번으로는 날짜별 셀 경계가 자주 무너지기 때문에,
 * 템플릿별 layout profile을 기준으로 셀을 잘라 다시 OCR해서 서비스 정본 row를 만든다.
 */
export class CafeteriaMenuNormalizer {
  constructor(
    private readonly dependencies: CafeteriaMenuNormalizerDependencies,
  ) {}

  async normalizeDocument(
    context: CafeteriaMenuNormalizationContext,
  ): Promise<CafeteriaMenuNormalizationResult> {
    const layoutKey = toKey(context);
    const profile = layoutKey ? LAYOUT_PROFILES[layoutKey] : undefined;
    if (!profile) {
      return {
        status: "failed",
        confidence: 0.1,
        reason: `no layout profile for source ${context.source.id} (${context.documentScope})`,
        entries: [],
        errorMessage: "layout profile is missing for this cafeteria template",
      };
    }

    const serviceDates = expandServiceDates(
      context.serviceStartDate,
      context.serviceEndDate,
    );
    if (serviceDates.length === 0) {
      return {
        status: "failed",
        confidence: 0.15,
        reason: "menu document is missing service date range",
        entries: [],
        errorMessage: "service_start_date/service_end_date is required for normalization",
      };
    }

    if (serviceDates.length > profile.dayCount) {
      return {
        status: "failed",
        confidence: 0.2,
        reason: `service date range (${serviceDates.length}) exceeds layout day count (${profile.dayCount})`,
        entries: [],
        errorMessage: "service date range is wider than the selected cafeteria layout profile",
      };
    }

    const imagePath = this.dependencies.assetStore.resolve(context.imageStorageKey);
    const image = await Jimp.read(await fs.readFile(imagePath));
    const expectedDays = Math.min(profile.dayCount, serviceDates.length);
    const entries: CafeteriaNormalizedMenuEntry[] = [];
    const errors: string[] = [];

    for (let dayIndex = 0; dayIndex < expectedDays; dayIndex += 1) {
      const serviceDate = serviceDates[dayIndex]!;

      for (const band of profile.mealBands) {
        if (!isMealEnabled(context, band.mealType)) {
          continue;
        }

        try {
          const buffer = await cropCellBuffer({
            image,
            profile,
            band,
            dayIndex,
          });
          const ocrResult = await this.dependencies.ocrRecognizer.recognizeBuffer(
            buffer,
            { psm: PSM.SINGLE_BLOCK },
          );
          const menuItems = cleanMenuItems(ocrResult.text);

          if (shouldMarkClosedCell(menuItems)) {
            entries.push(
              createClosedEntry({
                serviceDate,
                mealType: band.mealType,
              }),
            );
            continue;
          }

          if (menuItems.length === 0) {
            errors.push(
              `${context.source.id}:${serviceDate}:${band.mealType} produced no menu lines`,
            );
            continue;
          }

          entries.push({
            serviceDate,
            mealType: band.mealType,
            isClosed: false,
            menuItems,
            menuText: menuItems.join("\n"),
            confidence:
              typeof ocrResult.confidence === "number"
                ? Number((ocrResult.confidence / 100).toFixed(2))
                : 0.65,
          });
        } catch (error) {
          errors.push(
            `${context.source.id}:${serviceDate}:${band.mealType} failed: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
    }

    const expectedEntryCount =
      expectedDays *
      profile.mealBands.filter((band) => isMealEnabled(context, band.mealType)).length;

    return {
      entries,
      ...summariseNormalizationResult({
        expectedCount: expectedEntryCount,
        entries,
        errors,
      }),
    };
  }

  async close(): Promise<void> {
    await this.dependencies.ocrRecognizer.terminate();
  }
}

function isMealEnabled(
  context: CafeteriaMenuNormalizationContext,
  mealType: CafeteriaMenuMealType,
): boolean {
  switch (mealType) {
    case "breakfast":
      return context.breakfastAvailable;
    case "lunch":
      return context.lunchAvailable;
    case "dinner":
      return context.dinnerAvailable;
  }
}

export function createCafeteriaMenuNormalizer(params: {
  storageLocalRoot: string;
  ocrLanguages: string[];
}): CafeteriaMenuNormalizer {
  return new CafeteriaMenuNormalizer({
    assetStore: new LocalAssetStore(params.storageLocalRoot),
    ocrRecognizer: new OcrRecognizer(
      params.ocrLanguages,
      path.join(params.storageLocalRoot, ".tesseract-cache"),
    ),
  });
}

export const cafeteriaMenuNormalizerTestHelpers = {
  cleanMenuItems,
  expandServiceDates,
  isMealEnabled,
  shouldMarkClosedCell,
};
