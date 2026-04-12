import type {
  CafeteriaPostClassificationResult,
  CafeteriaInstagramPostSnapshot,
} from "./types.js";

const STRONG_MENU_KEYWORDS = [
  "주간식단표",
  "주중식단표",
  "주말식단표",
  "주간 메뉴표",
  "주간메뉴표",
  "메뉴표",
  "식단표",
  "식단나왔어요",
  "식단 나왔어요",
];

const NON_MENU_KEYWORDS = [
  "운영시간 확장 안내",
  "운영시간 안내",
  "식당 안내",
  "확장 안내",
  "냉면 게시",
];

function normalizeForContains(value: string): string {
  return value.replace(/\s+/g, "").toLowerCase();
}

function containsAny(text: string, keywords: string[]): string | undefined {
  const normalizedText = normalizeForContains(text);

  return keywords.find((keyword) =>
    normalizedText.includes(normalizeForContains(keyword)),
  );
}

function hasMenuLikeOcrStructure(text: string): boolean {
  const normalizedText = text.replace(/\s+/g, " ");
  const hasDateRange =
    /\d{1,2}[./-]\d{1,2}\s*(?:~|-)\s*\d{1,2}[./-]\d{1,2}/.test(normalizedText) ||
    /\d{4}[./-]\d{2}[./-]\d{2}\s*(?:~|-)\s*\d{2}[./-]\d{2}/.test(normalizedText);
  const hasWeekdays = ["월", "화", "수", "목", "금"].filter((day) =>
    normalizedText.includes(day),
  ).length >= 3;
  const hasMealSignals =
    /점심|중식|석식|조식/.test(normalizedText);

  return hasDateRange && (hasWeekdays || hasMealSignals);
}

/**
 * 학식 인스타 분류는 이후 정규화 파이프라인 입구를 깨끗하게 만드는 단계다.
 * OCR이나 캡션에 식단표 신호가 강하면 menu_sheet로 올리고, 운영시간 공지처럼
 * 명백한 비메뉴 게시물은 non_menu로 분리한다. 애매하면 unknown으로 남긴다.
 * 현재는 source별 예외 규칙을 아직 두지 않고, caption/OCR 텍스트만으로
 * source-agnostic 하게 분류한다.
 */
export function classifyCafeteriaInstagramPost(
  snapshot: CafeteriaInstagramPostSnapshot,
): CafeteriaPostClassificationResult {
  const caption = snapshot.caption?.trim() ?? "";
  const ocrText = snapshot.ocrText?.trim() ?? "";
  const combined = [caption, ocrText].filter(Boolean).join("\n");

  const menuKeyword = combined
    ? containsAny(combined, STRONG_MENU_KEYWORDS)
    : undefined;
  if (menuKeyword) {
    return {
      postKind: "menu_sheet",
      confidence: 0.95,
      reason: `matched menu keyword: ${menuKeyword}`,
    };
  }

  if (ocrText && hasMenuLikeOcrStructure(ocrText)) {
    return {
      postKind: "menu_sheet",
      confidence: 0.88,
      reason: "ocr text has date range and weekday/meal structure",
    };
  }

  const nonMenuKeyword = combined
    ? containsAny(combined, NON_MENU_KEYWORDS)
    : undefined;
  if (nonMenuKeyword) {
    return {
      postKind: "non_menu",
      confidence: 0.82,
      reason: `matched non-menu keyword: ${nonMenuKeyword}`,
    };
  }

  return {
    postKind: "unknown",
    confidence: 0.4,
    reason: "no strong menu or non-menu signal detected",
  };
}
