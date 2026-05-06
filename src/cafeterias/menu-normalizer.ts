import fs from "node:fs/promises";
import path from "node:path";
import { Jimp, JimpMime } from "jimp";
import { PSM } from "tesseract.js";
import { OcrRecognizer, type OcrTextBlock } from "./ocr-recognizer.js";
import { DEFAULT_CAFETERIA_OCR_COMMAND } from "./ocr-defaults.js";
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
  ocrRecognizer: Pick<OcrRecognizer, "recognizeBuffer" | "terminate"> &
    Partial<Pick<OcrRecognizer, "recognize">>;
}

const LAYOUT_PROFILES: Record<string, LayoutProfile> = {
  "student-hall:weekday": {
    dayCount: 5,
    tableRect: {
      x: 0.055,
      y: 0.19,
      width: 0.90,
      height: 0.65,
    },
    labelColumnRatio: 0.12,
    headerHeightRatio: 0.105,
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
  "bokji:weekday": {
    dayCount: 5,
    tableRect: {
      x: 0.018,
      y: 0.214,
      width: 0.97,
      height: 0.72,
    },
    labelColumnRatio: 0.064,
    headerHeightRatio: 0.083,
    cellPaddingXRatio: 0.06,
    cellPaddingYRatio: 0.08,
    mealBands: [
      {
        mealType: "lunch",
        startRatio: 0,
        heightRatio: 0.505,
      },
      {
        mealType: "dinner",
        startRatio: 0.505,
        heightRatio: 0.495,
      },
    ],
  },
  "bangmok:weekday": {
    dayCount: 5,
    tableRect: {
      x: 0.01,
      y: 0.188,
      width: 0.98,
      height: 0.735,
    },
    labelColumnRatio: 0.058,
    headerHeightRatio: 0.09,
    cellPaddingXRatio: 0.06,
    cellPaddingYRatio: 0.08,
    mealBands: [
      {
        mealType: "lunch",
        startRatio: 0,
        heightRatio: 0.49,
      },
      {
        mealType: "dinner",
        startRatio: 0.49,
        heightRatio: 0.51,
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

  if (context.source.id === "bokji") {
    return "bokji:weekday";
  }

  if (context.source.id === "bangmok") {
    return "bangmok:weekday";
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

function repairKnownMenuOcrText(value: string): string {
  return value
    .replace(/행김치볶음밥/g, "햄김치볶음밥")
    .replace(/햄김치복음밥/g, "햄김치볶음밥")
    .replace(/비[밤빙범방]밥/g, "비빔밥")
    .replace(/비[밤빙범방]우동/g, "비빔우동")
    .replace(/깨잎/g, "깻잎")
    .replace(/케칩/g, "케찹")
    .replace(/동그랑맹/g, "동그랑땡")
    .replace(/[숙쑥]갖어묵우동/g, "쑥갓어묵우동")
    .replace(/숙갓어묵우동/g, "쑥갓어묵우동")
    .replace(/마늘[쯤쯩]무침/g, "마늘쫑무침");
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
      repairKnownMenuOcrText(
        collapseWhitespace(
          line
            .replace(/[|]/g, " ")
            .replace(/[•·]/g, " ")
            .replace(/[“”"]/g, " ")
            .replace(/\s*\*\s*/g, " *"),
        ),
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

function mergeMenuContinuationItems(items: string[]): string[] {
  const merged: string[] = [];
  for (const item of items) {
    if (/^\([^)]*\)$/u.test(item) && merged.length > 0) {
      merged[merged.length - 1] = `${merged.at(-1)}${item}`;
    } else {
      merged.push(item);
    }
  }

  return merged;
}

function isClosedMarker(item: string): boolean {
  return /^(미운영|공휴일|휴무|휴일)$/u.test(item);
}

function shouldMarkClosedCell(menuItems: string[]): boolean {
  if (menuItems.length === 0) {
    return false;
  }

  return menuItems.every(isClosedMarker);
}

function getClosedMarker(menuItems: string[]): string | null {
  const marker = menuItems.find(isClosedMarker);
  return marker ?? null;
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
  closedText?: string;
}): CafeteriaNormalizedMenuEntry {
  const closedText = params.closedText ?? "미운영";
  return {
    serviceDate: params.serviceDate,
    mealType: params.mealType,
    isClosed: true,
    menuItems: [closedText],
    menuText: closedText,
    confidence: 1,
  };
}

function blockCenter(block: OcrTextBlock): { x: number; y: number } {
  return {
    x: (block.box.x1 + block.box.x2) / 2,
    y: (block.box.y1 + block.box.y2) / 2,
  };
}

function resolveDayIndexFromBlock(params: {
  block: OcrTextBlock;
  image: any;
  profile: LayoutProfile;
}): number | null {
  const { block, image, profile } = params;
  const tableX = image.width * profile.tableRect.x;
  const tableWidth = image.width * profile.tableRect.width;
  const labelColumnWidth = tableWidth * profile.labelColumnRatio;
  const dayColumnWidth = (tableWidth - labelColumnWidth) / profile.dayCount;
  const contentX = tableX + labelColumnWidth;
  const center = blockCenter(block);

  if (center.x < contentX || center.x >= contentX + dayColumnWidth * profile.dayCount) {
    return null;
  }

  return Math.min(
    profile.dayCount - 1,
    Math.max(0, Math.floor((center.x - contentX) / dayColumnWidth)),
  );
}

function isBlockInsideBand(params: {
  block: OcrTextBlock;
  image: any;
  profile: LayoutProfile;
  band: LayoutProfile["mealBands"][number];
}): boolean {
  const { block, image, profile, band } = params;
  const tableY = image.height * profile.tableRect.y;
  const tableHeight = image.height * profile.tableRect.height;
  const headerHeight = tableHeight * profile.headerHeightRatio;
  const bodyHeight = tableHeight - headerHeight;
  const bandY = tableY + headerHeight + bodyHeight * band.startRatio;
  const bandHeight = bodyHeight * band.heightRatio;
  const center = blockCenter(block);

  return center.y >= bandY && center.y < bandY + bandHeight;
}

function cleanMenuItemsFromBlocks(blocks: OcrTextBlock[]): string[] {
  const text = [...blocks]
    .sort((a, b) => {
      const yDelta = a.box.y1 - b.box.y1;
      if (Math.abs(yDelta) > 6) {
        return yDelta;
      }
      return a.box.x1 - b.box.x1;
    })
    .map((block) => block.text)
    .join("\n");

  return mergeMenuContinuationItems(cleanMenuItems(text));
}

function confidenceFromBlocks(blocks: OcrTextBlock[]): number {
  const confidences = blocks
    .map((block) => block.confidence)
    .filter((confidence): confidence is number =>
      typeof confidence === "number" && Number.isFinite(confidence),
    );
  if (confidences.length === 0) {
    return 0.72;
  }

  const average = confidences.reduce((sum, confidence) => sum + confidence, 0) /
    confidences.length;
  return Number((average / 100).toFixed(2));
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
    const coordinateResult = await this.normalizeDocumentWithOcrBlocks({
      context,
      profile,
      serviceDates,
      imagePath,
      image,
    });
    if (coordinateResult) {
      return coordinateResult;
    }

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
          const menuItems = mergeMenuContinuationItems(cleanMenuItems(ocrResult.text));

          if (shouldMarkClosedCell(menuItems)) {
            const closedText = getClosedMarker(menuItems);
            entries.push(
              createClosedEntry({
                serviceDate,
                mealType: band.mealType,
                ...(closedText ? { closedText } : {}),
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

  private async normalizeDocumentWithOcrBlocks(params: {
    context: CafeteriaMenuNormalizationContext;
    profile: LayoutProfile;
    serviceDates: string[];
    imagePath: string;
    image: any;
  }): Promise<CafeteriaMenuNormalizationResult | null> {
    const recognize = this.dependencies.ocrRecognizer.recognize;
    if (typeof recognize !== "function") {
      return null;
    }

    let blocks: OcrTextBlock[] | undefined;
    try {
      const ocrResult = await recognize.call(
        this.dependencies.ocrRecognizer,
        params.imagePath,
      );
      blocks = ocrResult.blocks;
    } catch {
      return null;
    }

    if (!blocks?.length) {
      return null;
    }

    const expectedDays = Math.min(params.profile.dayCount, params.serviceDates.length);
    const entries: CafeteriaNormalizedMenuEntry[] = [];
    const errors: string[] = [];
    const closedDays = new Map<number, string>();

    for (const block of blocks) {
      const dayIndex = resolveDayIndexFromBlock({
        block,
        image: params.image,
        profile: params.profile,
      });
      if (dayIndex === null) {
        continue;
      }

      const marker = getClosedMarker(cleanMenuItems(block.text));
      if (marker) {
        closedDays.set(dayIndex, marker);
      }
    }

    for (let dayIndex = 0; dayIndex < expectedDays; dayIndex += 1) {
      const serviceDate = params.serviceDates[dayIndex]!;
      const closedText = closedDays.get(dayIndex);

      for (const band of params.profile.mealBands) {
        if (!isMealEnabled(params.context, band.mealType)) {
          continue;
        }

        const cellBlocks = blocks.filter((block) => {
          const blockDayIndex = resolveDayIndexFromBlock({
            block,
            image: params.image,
            profile: params.profile,
          });
          return blockDayIndex === dayIndex &&
            isBlockInsideBand({
              block,
              image: params.image,
              profile: params.profile,
              band,
            });
        });
        const menuItems = cleanMenuItemsFromBlocks(cellBlocks);
        const cellClosedText = getClosedMarker(menuItems) ?? closedText;

        if (cellClosedText && (menuItems.length === 0 || shouldMarkClosedCell(menuItems))) {
          entries.push(
            createClosedEntry({
              serviceDate,
              mealType: band.mealType,
              closedText: cellClosedText,
            }),
          );
          continue;
        }

        if (menuItems.length === 0) {
          errors.push(
            `${params.context.source.id}:${serviceDate}:${band.mealType} produced no menu lines`,
          );
          continue;
        }

        entries.push({
          serviceDate,
          mealType: band.mealType,
          isClosed: false,
          menuItems,
          menuText: menuItems.join("\n"),
          confidence: confidenceFromBlocks(cellBlocks),
        });
      }
    }

    const expectedEntryCount =
      expectedDays *
      params.profile.mealBands.filter((band) =>
        isMealEnabled(params.context, band.mealType),
      ).length;
    const result = {
      entries,
      ...summariseNormalizationResult({
        expectedCount: expectedEntryCount,
        entries,
        errors,
      }),
    };

    return result.status === "failed" ? null : result;
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
  ocrCommand?: string;
}): CafeteriaMenuNormalizer {
  const ocrCommand = params.ocrCommand?.trim() || DEFAULT_CAFETERIA_OCR_COMMAND;

  return new CafeteriaMenuNormalizer({
    assetStore: new LocalAssetStore(params.storageLocalRoot),
    ocrRecognizer: new OcrRecognizer(
      params.ocrLanguages,
      path.join(params.storageLocalRoot, ".tesseract-cache"),
      { externalCommand: ocrCommand },
    ),
  });
}

export const cafeteriaMenuNormalizerTestHelpers = {
  cleanMenuItems,
  expandServiceDates,
  isMealEnabled,
  shouldMarkClosedCell,
};
