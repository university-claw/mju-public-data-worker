import { load as loadHtml, type Cheerio } from "cheerio";
import type { AnyNode } from "domhandler";
import type {
  CafeteriaMenuDocumentScope,
  CafeteriaMenuMealType,
  CafeteriaOfficialMenuEntryInput,
  CafeteriaOfficialParsedMenuDocument,
} from "./types.js";

const PLACEHOLDER_PATTERN = /등록된\s*식단내용이\(가\)\s*없습니다/u;
const CLOSED_PATTERN = /(휴무|미운영|운영없음|운영하지 않습니다)/u;
const SECTION_HEADER_PATTERN = /^\[[^\]]+\]$/u;

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

function extractLines(cell: Cheerio<AnyNode>): string[] {
  const html = cell.html() ?? "";
  const normalizedHtml = html.replace(/<br\s*\/?>/giu, "\n");
  const $ = loadHtml(`<div>${normalizedHtml}</div>`);
  const text = $("div").text();

  return text
    .split("\n")
    .map((line) => normalizeWhitespace(line))
    .filter(Boolean);
}

function parseMealType(rawMealType: string): CafeteriaMenuMealType | null {
  const normalized = normalizeWhitespace(rawMealType);
  if (normalized === "조식") {
    return "breakfast";
  }

  if (normalized === "중식" || normalized === "점심") {
    return "lunch";
  }

  if (normalized === "석식" || normalized === "저녁") {
    return "dinner";
  }

  return null;
}

function resolveDateWithinWeek(
  rawDate: string,
  weekStartDate: string,
): string | null {
  const match = rawDate.match(/(\d{2})\.\s*(\d{2})/u);
  if (!match) {
    return null;
  }

  const weekStart = new Date(`${weekStartDate}T00:00:00+09:00`);
  const targetMonth = Number(match[1]);
  const targetDay = Number(match[2]);

  for (const year of [weekStart.getUTCFullYear() - 1, weekStart.getUTCFullYear(), weekStart.getUTCFullYear() + 1]) {
    for (let offset = 0; offset < 7; offset += 1) {
      const candidate = new Date(weekStart.getTime() + offset * 24 * 60 * 60 * 1000);
      const candidateYear = candidate.getUTCFullYear();
      const candidateMonth = candidate.getUTCMonth() + 1;
      const candidateDayValue = candidate.getUTCDate();

      if (
        candidateYear === year
        && candidateMonth === targetMonth
        && candidateDayValue === targetDay
      ) {
        return candidate.toISOString().slice(0, 10);
      }
    }
  }

  return null;
}

function inferDocumentScope(serviceDates: string[]): CafeteriaMenuDocumentScope {
  if (serviceDates.length === 0) {
    return "unknown";
  }

  const dayKinds = new Set(
    serviceDates.map((serviceDate) => {
      const date = new Date(`${serviceDate}T12:00:00+09:00`);
      const day = date.getUTCDay();
      return day === 0 || day === 6 ? "weekend" : "weekday";
    }),
  );

  if (dayKinds.size === 1) {
    return dayKinds.has("weekend") ? "weekend" : "weekday";
  }

  return "unknown";
}

function buildMenuItems(lines: string[]): string[] {
  const menuItems: string[] = [];
  let currentSection: string | null = null;

  for (const line of lines) {
    if (line === "-") {
      continue;
    }

    if (SECTION_HEADER_PATTERN.test(line)) {
      currentSection = line;
      continue;
    }

    menuItems.push(currentSection ? `${currentSection} ${line}` : line);
  }

  return menuItems;
}

export function parseCafeteriaOfficialPage(
  html: string,
  weekStartDate: string,
): CafeteriaOfficialParsedMenuDocument {
  const $ = loadHtml(html);
  const table = $("table").first();

  if (table.length === 0) {
    throw new Error("official cafeteria page does not contain a table");
  }

  const rows = table.find("tbody tr").toArray();
  if (rows.length === 0) {
    throw new Error("official cafeteria page does not contain any table rows");
  }

  let currentServiceDate: string | null = null;
  const seenServiceDates: string[] = [];
  const entries: CafeteriaOfficialMenuEntryInput[] = [];

  for (const row of rows) {
    const cells = $(row).children("th, td").toArray();
    if (cells.length < 4) {
      continue;
    }

    let dateCellOffset = 0;
    const firstCellTag = cells[0]?.tagName?.toLowerCase();
    if (firstCellTag === "th") {
      const parsedDate = resolveDateWithinWeek($(cells[0]).text(), weekStartDate);
      if (parsedDate) {
        currentServiceDate = parsedDate;
        seenServiceDates.push(parsedDate);
      } else {
        currentServiceDate = null;
      }
      dateCellOffset = 1;
    }

    if (!currentServiceDate) {
      continue;
    }

    const mealTypeCell = cells[dateCellOffset];
    const contentCell = cells[dateCellOffset + 2];
    if (!mealTypeCell || !contentCell) {
      continue;
    }

    const mealType = parseMealType($(mealTypeCell).text());
    if (!mealType) {
      continue;
    }

    const contentLines = extractLines($(contentCell));
    if (contentLines.some((line) => PLACEHOLDER_PATTERN.test(line))) {
      continue;
    }

    const menuTextLines = contentLines.filter((line) => line !== "-");
    const menuItems = buildMenuItems(menuTextLines);
    if (menuItems.length === 0) {
      continue;
    }

    const menuText = menuTextLines.join("\n");
    entries.push({
      serviceDate: currentServiceDate,
      mealType,
      isClosed: menuTextLines.some((line) => CLOSED_PATTERN.test(line)),
      menuText,
      menuItems,
      confidence: 1,
    });
  }

  const uniqueServiceDates = Array.from(new Set(seenServiceDates)).sort();
  const documentScope = inferDocumentScope(uniqueServiceDates);
  const mealTypes = new Set(entries.map((entry) => entry.mealType));

  return {
    weekStartDate,
    status: entries.length > 0 ? "succeeded" : "empty",
    documentScope,
    serviceStartDate: uniqueServiceDates[0] ?? null,
    serviceEndDate: uniqueServiceDates.at(-1) ?? null,
    breakfastAvailable: mealTypes.has("breakfast"),
    lunchAvailable: mealTypes.has("lunch"),
    dinnerAvailable: mealTypes.has("dinner"),
    entries,
  };
}
