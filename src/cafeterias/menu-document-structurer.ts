import type {
  CafeteriaInstagramPostSnapshot,
  CafeteriaInstagramSource,
  CafeteriaMenuDocumentStructureResult,
} from "./types.js";

interface ParsedDateRange {
  startDate: string;
  endDate: string;
  reason: string;
}

function normalizeForContains(value: string): string {
  return value.replace(/\s+/g, "").toLowerCase();
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function toIsoDate(year: number, month: number, day: number): string {
  return `${year}-${pad(month)}-${pad(day)}`;
}

function extractBaseYear(postedAt: string): number {
  return Number(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Seoul",
      year: "numeric",
    }).format(new Date(postedAt)),
  );
}

function buildMonthDayRange(
  year: number,
  startMonth: number,
  startDay: number,
  endMonth: number,
  endDay: number,
  reason: string,
): ParsedDateRange {
  const endYear = endMonth < startMonth ? year + 1 : year;
  return {
    startDate: toIsoDate(year, startMonth, startDay),
    endDate: toIsoDate(endYear, endMonth, endDay),
    reason,
  };
}

function buildSingleMonthRange(
  year: number,
  month: number,
  startDay: number,
  endDay: number,
  reason: string,
): ParsedDateRange {
  const endMonth = endDay < startDay ? month + 1 : month;
  if (endMonth <= 12) {
    return {
      startDate: toIsoDate(year, month, startDay),
      endDate: toIsoDate(year, endMonth, endDay),
      reason,
    };
  }

  return {
    startDate: toIsoDate(year, month, startDay),
    endDate: toIsoDate(year + 1, endMonth - 12, endDay),
    reason,
  };
}

function parseDateRange(text: string, postedAt: string): ParsedDateRange | undefined {
  const normalizedText = text.replace(/\s+/g, " ");
  const baseYear = extractBaseYear(postedAt);

  let match =
    normalizedText.match(
      /(\d{4})[./-]\s*(\d{1,2})[./-]\s*(\d{1,2})\s*(?:~|-)\s*(\d{4})[./-]\s*(\d{1,2})[./-]\s*(\d{1,2})/,
    ) ??
    normalizedText.match(
      /(\d{4})[./-]\s*(\d{1,2})[./-]\s*(\d{1,2})\s*(?:~|-)\s*(\d{1,2})[./-]\s*(\d{1,2})/,
    );

  if (match) {
    if (match.length === 7) {
      return {
        startDate: toIsoDate(
          Number(match[1]),
          Number(match[2]),
          Number(match[3]),
        ),
        endDate: toIsoDate(
          Number(match[4]),
          Number(match[5]),
          Number(match[6]),
        ),
        reason: "parsed full year date range from text",
      };
    }

    return buildMonthDayRange(
      Number(match[1]),
      Number(match[2]),
      Number(match[3]),
      Number(match[4]),
      Number(match[5]),
      "parsed year-prefixed month/day range from text",
    );
  }

  match = normalizedText.match(
    /(\d{1,2})[./-]\s*(\d{1,2})(?:\s*\([^)]*\))?\s*(?:~|-)\s*(\d{1,2})[./-]\s*(\d{1,2})(?:\s*\([^)]*\))?/,
  );
  if (match) {
    return buildMonthDayRange(
      baseYear,
      Number(match[1]),
      Number(match[2]),
      Number(match[3]),
      Number(match[4]),
      "parsed month/day range from text",
    );
  }

  match = normalizedText.match(
    /(\d{1,2})월\s*(\d{1,2})일\s*(?:~|-)\s*(\d{1,2})월\s*(\d{1,2})일/,
  );
  if (match) {
    return buildMonthDayRange(
      baseYear,
      Number(match[1]),
      Number(match[2]),
      Number(match[3]),
      Number(match[4]),
      "parsed Korean month/day range from text",
    );
  }

  match = normalizedText.match(
    /(\d{1,2})월\s*(\d{1,2})일\s*(?:~|-)\s*(\d{1,2})일/,
  );
  if (match) {
    return buildSingleMonthRange(
      baseYear,
      Number(match[1]),
      Number(match[2]),
      Number(match[3]),
      "parsed Korean same-month range from text",
    );
  }

  return undefined;
}

function dayOfWeek(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

function daysBetween(startDate: string, endDate: string): number {
  const start = new Date(`${startDate}T00:00:00Z`).getTime();
  const end = new Date(`${endDate}T00:00:00Z`).getTime();
  return Math.round((end - start) / 86_400_000);
}

function detectScope(
  source: CafeteriaInstagramSource,
  text: string,
  range?: ParsedDateRange,
): Pick<
  CafeteriaMenuDocumentStructureResult,
  "documentScope" | "scopeConfidence" | "scopeReason"
> {
  const normalized = normalizeForContains(text);

  if (normalized.includes("주말식단표") || normalized.includes("주말중식운영시간")) {
    return {
      documentScope: "weekend",
      scopeConfidence: 0.98,
      scopeReason: "matched explicit weekend keyword",
    };
  }

  if (normalized.includes("주중식단표")) {
    return {
      documentScope: "weekday",
      scopeConfidence: 0.98,
      scopeReason: "matched explicit weekday keyword",
    };
  }

  if (range) {
    const spanDays = daysBetween(range.startDate, range.endDate);
    const startDay = dayOfWeek(range.startDate);
    const endDay = dayOfWeek(range.endDate);

    if (spanDays === 1 && startDay === 6 && endDay === 0) {
      return {
        documentScope: "weekend",
        scopeConfidence: source.supportsWeekendMenu ? 0.96 : 0.45,
        scopeReason: source.supportsWeekendMenu
          ? `date range ${range.startDate}~${range.endDate} maps to Saturday-Sunday`
          : `date range ${range.startDate}~${range.endDate} looks like weekend but source usually does not support weekend menus`,
      };
    }

    if (spanDays === 4 && startDay === 1 && endDay === 5) {
      return {
        documentScope: "weekday",
        scopeConfidence: 0.94,
        scopeReason: `date range ${range.startDate}~${range.endDate} maps to Monday-Friday`,
      };
    }
  }

  if (!source.supportsWeekendMenu) {
    return {
      documentScope: "weekday",
      scopeConfidence: 0.8,
      scopeReason: "source metadata indicates weekday-only cafeteria",
    };
  }

  if (normalized.includes("조식") || normalized.includes("중식") || normalized.includes("점심")) {
    return {
      documentScope: "weekday",
      scopeConfidence: 0.72,
      scopeReason: "defaulted to weekday because no weekend signal was detected",
    };
  }

  return {
    documentScope: "unknown",
    scopeConfidence: 0.4,
    scopeReason: "could not determine weekday/weekend scope",
  };
}

function detectMealAvailability(
  source: CafeteriaInstagramSource,
  combinedText: string,
  documentScope: CafeteriaMenuDocumentStructureResult["documentScope"],
): Pick<
  CafeteriaMenuDocumentStructureResult,
  "breakfastAvailable" | "lunchAvailable" | "dinnerAvailable"
> {
  const normalized = normalizeForContains(combinedText);

  const breakfastAvailable =
    normalized.includes("조식") ||
    normalized.includes("아침밥") ||
    normalized.includes("천원의아침");
  let lunchAvailable =
    normalized.includes("중식") || normalized.includes("점심");
  let dinnerAvailable =
    normalized.includes("석식") || normalized.includes("저녁");

  if (documentScope === "weekend" && source.id === "student-hall") {
    lunchAvailable = true;
    dinnerAvailable = false;
  }

  if (documentScope === "weekday" && !lunchAvailable) {
    /**
     * 현재 메뉴 시트는 평일 문서인 경우 최소 한 끼 이상은 제공한다.
     * OCR이 운영시간 라인을 조금 놓쳐도 다음 슬라이스 정규화의 출발점이
     * 끊기지 않도록, 평일 메뉴 문서는 lunch를 기본값으로 본다.
     */
    lunchAvailable = true;
  }

  return {
    breakfastAvailable,
    lunchAvailable,
    dinnerAvailable,
  };
}

/**
 * 2차 슬라이스에서는 메뉴를 날짜별 row로 나누기 전에,
 * "이 문서가 언제 적용되는 어떤 타입의 식단표인가"를 먼저 구조화한다.
 * 여기서 정리된 scope/date/meal 정보가 다음 정규화 파이프라인의 입력 계약이 된다.
 */
export function structureCafeteriaMenuDocument(
  source: CafeteriaInstagramSource,
  snapshot: CafeteriaInstagramPostSnapshot,
): CafeteriaMenuDocumentStructureResult {
  const combinedText = [snapshot.caption ?? "", snapshot.ocrText ?? ""]
    .filter(Boolean)
    .join("\n");
  const parsedRange = parseDateRange(combinedText, snapshot.postedAt);
  const scope = detectScope(source, combinedText, parsedRange);
  const meals = detectMealAvailability(source, combinedText, scope.documentScope);

  return {
    ...scope,
    ...meals,
    serviceStartDate: parsedRange?.startDate ?? null,
    serviceEndDate: parsedRange?.endDate ?? null,
  };
}
