import {
  calculatePerceptualHashDistance,
} from "./image-fingerprint.js";
import type {
  CafeteriaMenuSheetDetectionInput,
  CafeteriaPostClassificationResult,
} from "./types.js";

const MENU_THRESHOLD = 5;

const STRONG_CAPTION_MENU_KEYWORDS = [
  "주간식단표",
  "주중식단표",
  "주말식단표",
  "주간 메뉴표",
  "주간메뉴표",
  "식단나왔어요",
  "식단 나왔어요",
];

const MEDIUM_CAPTION_MENU_KEYWORDS = [
  "다음주 식단",
  "다음 주 식단",
  "다음주 메뉴",
  "다음 주 메뉴",
  "주간 메뉴",
  "주간메뉴",
];

const OCR_MENU_KEYWORDS = [
  "주간식단표",
  "주중식단표",
  "주말식단표",
  "주간 메뉴표",
  "주간메뉴표",
  "메뉴표",
  "식단표",
];

const IGNORED_HINT_KEYWORDS = [
  "운영시간 확장 안내",
  "운영시간 안내",
  "식당 안내",
  "이용금액",
  "코너 안내",
  "냉면 게시",
];

const MENU_LINE_IGNORED_WORDS = [
  "명지대",
  "명지대학교",
  "운영시간",
  "안내",
  "이용금액",
  "학식스타",
  "인스타",
  "영양사",
  "연락처",
  "직원식당",
  "생활관식당",
];

const MEAL_SIGNAL_PATTERN = /조식|아침밥|천원의아침|중식|점심|석식|저녁/;
const WEEKDAY_PATTERN = /[월화수목금토일](?:요일)?/g;
const WEEKEND_HINT_PATTERN = /주말식단표|주말\s*(?:중식|점심)|토요일|일요일/;
const DATE_RANGE_PATTERNS = [
  /(\d{4})[./-]\s*(\d{1,2})[./-]\s*(\d{1,2})\s*(?:~|-)\s*(\d{4})[./-]\s*(\d{1,2})[./-]\s*(\d{1,2})/,
  /(\d{4})[./-]\s*(\d{1,2})[./-]\s*(\d{1,2})\s*(?:~|-)\s*(\d{1,2})[./-]\s*(\d{1,2})/,
  /(\d{1,2})[./-]\s*(\d{1,2})(?:\s*\([^)]*\))?\s*(?:~|-)\s*(\d{1,2})[./-]\s*(\d{1,2})(?:\s*\([^)]*\))?/,
  /(\d{1,2})월\s*(\d{1,2})일\s*(?:~|-)\s*(\d{1,2})월\s*(\d{1,2})일/,
  /(\d{1,2})월\s*(\d{1,2})일\s*(?:~|-)\s*(\d{1,2})일/,
];

function normalizeForContains(value: string): string {
  return value.replace(/\s+/g, "").toLowerCase();
}

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function containsKeyword(text: string, keywords: string[]): string | undefined {
  const normalizedText = normalizeForContains(text);

  return keywords.find((keyword) =>
    normalizedText.includes(normalizeForContains(keyword)),
  );
}

function hasDateRange(text: string): boolean {
  return DATE_RANGE_PATTERNS.some((pattern) => pattern.test(text));
}

function countUniqueWeekdays(text: string): number {
  const matches = text.match(WEEKDAY_PATTERN) ?? [];
  return new Set(matches.map((match) => match[0]!)).size;
}

function countMealSignals(text: string): number {
  const matches = text.match(/조식|아침밥|천원의아침|중식|점심|석식|저녁/g) ?? [];
  return new Set(matches).size;
}

function looksLikeMenuLine(line: string): boolean {
  if (line.length < 2 || line.length > 24) {
    return false;
  }

  if (!/[가-힣]/.test(line)) {
    return false;
  }

  const normalized = normalizeForContains(line);
  if (MENU_LINE_IGNORED_WORDS.some((word) => normalized.includes(normalizeForContains(word)))) {
    return false;
  }

  /**
   * 메뉴 행은 대체로 짧은 한글 문자열이고, 과도한 설명문보다 음식명처럼 보이는
   * 토막 라인이 연속해서 나온다. 이 필터는 OCR의 노이즈를 감수하되 "설명문"과
   * "메뉴 항목"을 대충 구분해 주는 역할을 한다.
   */
  return !/[#@]|https?:\/\//i.test(line);
}

function analyzeOcrLineStructure(ocrText: string | null | undefined): {
  lineCount: number;
  shortLineCount: number;
  menuLineCount: number;
  hasRepeatedShortLines: boolean;
} {
  const lines = (ocrText ?? "")
    .split(/\r?\n/)
    .map((line) => collapseWhitespace(line))
    .filter(Boolean);

  const shortLineCount = lines.filter(
    (line) => line.length >= 2 && line.length <= 24,
  ).length;
  const menuLineCount = lines.filter(looksLikeMenuLine).length;

  return {
    lineCount: lines.length,
    shortLineCount,
    menuLineCount,
    hasRepeatedShortLines: lines.length >= 10 && shortLineCount >= 8,
  };
}

function scoreReferenceSimilarity(
  imagePerceptualHash: string | null | undefined,
  referenceHashes: string[],
): {
  score: number;
  signal?: string;
} {
  if (!imagePerceptualHash || referenceHashes.length === 0) {
    return { score: 0 };
  }

  const distances = referenceHashes
    .filter(Boolean)
    .map((referenceHash) =>
      calculatePerceptualHashDistance(imagePerceptualHash, referenceHash),
    )
    .sort((left, right) => left - right);

  const bestDistance = distances[0];
  if (bestDistance === undefined) {
    return { score: 0 };
  }

  if (bestDistance <= 0.03) {
    return {
      score: 3,
      signal: `image-phash:strong(${bestDistance.toFixed(3)})`,
    };
  }

  if (bestDistance <= 0.08) {
    return {
      score: 2,
      signal: `image-phash:medium(${bestDistance.toFixed(3)})`,
    };
  }

  if (bestDistance <= 0.12) {
    return {
      score: 1,
      signal: `image-phash:weak(${bestDistance.toFixed(3)})`,
    };
  }

  return { score: 0 };
}

function buildConfidence(score: number, isMenuSheet: boolean): number {
  if (isMenuSheet) {
    return Math.min(0.6 + score * 0.05, 0.98);
  }

  return Math.max(0.25, 0.65 - Math.max(score, 0) * 0.05);
}

/**
 * 식단표 판별은 "키워드 하나 맞았다"보다 여러 신호를 합쳐 점수로 보는 편이
 * 훨씬 안정적이다. 캡션/OCR 텍스트, 날짜/요일/끼니 구조, OCR 행 패턴,
 * 그리고 같은 식당군에서 이미 수집된 식단표와의 perceptual hash 유사도를
 * 합쳐 최종 menu_sheet 여부를 결정한다.
 */
export function classifyCafeteriaInstagramPost(
  input: CafeteriaMenuSheetDetectionInput,
): CafeteriaPostClassificationResult {
  const { source, snapshot, referenceHashes } = input;
  const caption = snapshot.caption?.trim() ?? "";
  const ocrText = snapshot.ocrText?.trim() ?? "";
  const combinedText = [caption, ocrText].filter(Boolean).join("\n");
  const normalizedCombinedText = normalizeForContains(combinedText);
  const signals: string[] = [];
  let score = 0;

  const strongCaptionKeyword = caption
    ? containsKeyword(caption, STRONG_CAPTION_MENU_KEYWORDS)
    : undefined;
  if (strongCaptionKeyword) {
    score += 5;
    signals.push(`caption-keyword:strong(${strongCaptionKeyword})`);
  }

  const mediumCaptionKeyword = !strongCaptionKeyword && caption
    ? containsKeyword(caption, MEDIUM_CAPTION_MENU_KEYWORDS)
    : undefined;
  if (mediumCaptionKeyword) {
    score += 2;
    signals.push(`caption-keyword:medium(${mediumCaptionKeyword})`);
  }

  const ocrMenuKeyword = ocrText
    ? containsKeyword(ocrText, OCR_MENU_KEYWORDS)
    : undefined;
  if (ocrMenuKeyword) {
    score += 4;
    signals.push(`ocr-keyword(${ocrMenuKeyword})`);
  }

  const dateRangeDetected = hasDateRange(combinedText);
  if (dateRangeDetected) {
    score += 3;
    signals.push("date-range");
  }

  const weekdayCount = countUniqueWeekdays(combinedText);
  if (weekdayCount >= 3) {
    score += 2;
    signals.push(`weekday-columns(${weekdayCount})`);
  }

  const mealSignalCount = countMealSignals(combinedText);
  if (mealSignalCount >= 1) {
    score += 2;
    signals.push(`meal-signals(${mealSignalCount})`);
  }

  const lineMetrics = analyzeOcrLineStructure(ocrText);
  if (lineMetrics.hasRepeatedShortLines) {
    score += 1;
    signals.push(`ocr-short-lines(${lineMetrics.shortLineCount}/${lineMetrics.lineCount})`);
  }
  if (lineMetrics.menuLineCount >= 6) {
    score += 1;
    signals.push(`ocr-menu-lines(${lineMetrics.menuLineCount})`);
  }

  const referenceSimilarity = scoreReferenceSimilarity(
    snapshot.imagePerceptualHash,
    referenceHashes,
  );
  if (referenceSimilarity.score > 0 && referenceSimilarity.signal) {
    score += referenceSimilarity.score;
    signals.push(referenceSimilarity.signal);
  }

  const ignoredHint = combinedText
    ? containsKeyword(combinedText, IGNORED_HINT_KEYWORDS)
    : undefined;
  if (ignoredHint) {
    score -= 3;
    signals.push(`ignored-hint(${ignoredHint})`);
  }

  if (!source.supportsWeekendMenu && WEEKEND_HINT_PATTERN.test(normalizedCombinedText)) {
    score -= 2;
    signals.push("weekend-signal-on-weekday-only-source");
  }

  if (referenceHashes.length > 0) {
    signals.push(`group-ref-count(${referenceHashes.length})`);
  }

  const hasStructuralEvidence =
    Boolean(ocrMenuKeyword) ||
    dateRangeDetected ||
    weekdayCount >= 3 ||
    mealSignalCount >= 1;

  if (hasStructuralEvidence) {
    signals.push("structural-evidence");
  }

  const postKind =
    score >= MENU_THRESHOLD && hasStructuralEvidence ? "menu_sheet" : "ignored";
  const confidence = buildConfidence(score, postKind === "menu_sheet");

  return {
    postKind,
    score,
    confidence,
    reason: signals.join(", ") || "no menu-sheet evidence detected",
    signals,
  };
}

export const cafeteriaPostClassifierTestHelpers = {
  MENU_THRESHOLD,
  analyzeOcrLineStructure,
  countMealSignals,
  countUniqueWeekdays,
  hasDateRange,
  scoreReferenceSimilarity,
};
