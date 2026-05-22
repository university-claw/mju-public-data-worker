import { collapseWhitespace } from "../shared/text.js";
import type {
  CurrentAcademicTerm,
  ShuttleDayType,
  ShuttleDepartureInput,
} from "./types.js";

const TIME_PATTERN = /(?:^|[^0-9])([01]?\d|2[0-3]):([0-5]\d)(?![0-9])/gu;

function normalizeTextBlock(input: string): string[] {
  return input
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => collapseWhitespace(line))
    .filter(Boolean);
}

function normalizeTime(hour: string, minute: string): string {
  return `${hour.padStart(2, "0")}:${minute}`;
}

function extractTimes(line: string): string[] {
  const times: string[] = [];
  for (const match of line.matchAll(TIME_PATTERN)) {
    times.push(normalizeTime(match[1]!, match[2]!));
  }

  return times;
}

function stripTimes(line: string): string {
  return collapseWhitespace(
    line
      .replace(TIME_PATTERN, " ")
      .replace(/[,:;|]+/g, " ")
      .replace(/\s+/g, " "),
  );
}

function inferCampus(line: string, currentCampus?: string | null): string | null {
  if (/(자연|용인)/u.test(line)) {
    return "자연";
  }
  if (/(인문|서울)/u.test(line)) {
    return "인문";
  }

  return currentCampus ?? null;
}

function inferDayType(line: string, currentDayType: ShuttleDayType): ShuttleDayType {
  if (/매일/u.test(line)) {
    return "daily";
  }
  if (/토요일|토요|토\b/u.test(line)) {
    return "saturday";
  }
  if (/일요일|공휴일|휴일/u.test(line)) {
    return "holiday";
  }
  if (/평일|월\s*[-~]\s*금|학기\s*중/u.test(line)) {
    return "weekday";
  }

  return currentDayType;
}

function extractDirection(line: string): string | null {
  const arrowMatch = /([가-힣A-Za-z0-9()\s]+?)\s*(?:->|→|⇒|↔|▶)\s*([가-힣A-Za-z0-9()\s]+)/u.exec(line);
  if (arrowMatch) {
    return `${collapseWhitespace(arrowMatch[1]!)} -> ${collapseWhitespace(arrowMatch[2]!)}`;
  }

  const headingMatch = /([가-힣A-Za-z0-9()\s]+행)\b/u.exec(line);
  return headingMatch ? collapseWhitespace(headingMatch[1]!) : null;
}

function parseRouteHeader(line: string): string | null {
  if (extractTimes(line).length > 0) {
    return null;
  }

  const explicitMatch = /(?:노선명?|구간|운행\s*구간)\s*[:：]\s*(.+)$/u.exec(line);
  if (explicitMatch) {
    return collapseWhitespace(explicitMatch[1]!);
  }

  if (/(노선|셔틀|통학|버스)/u.test(line) && !/(공지|문의|유의|운행기간|기간)/u.test(line)) {
    return collapseWhitespace(line.replace(/^[\-*ㆍ·]\s*/u, ""));
  }

  return null;
}

function buildStopName(lineWithoutTimes: string, currentRouteName: string): string {
  const cleaned = collapseWhitespace(
    lineWithoutTimes
      .replace(/^(평일|토요일|토요|일요일|공휴일|매일|학기\s*중)\s*/u, "")
      .replace(/(?:출발|시간|시각|운행|정류장)\s*[:：]?/gu, " ")
      .replace(/^[\-*ㆍ·]\s*/u, ""),
  );

  if (!cleaned) {
    return currentRouteName;
  }

  const beforeArrow = cleaned.split(/->|→|⇒|↔|▶/u)[0]?.trim();
  return beforeArrow || cleaned;
}

function dedupeDepartures(departures: ShuttleDepartureInput[]): ShuttleDepartureInput[] {
  const deduped = new Map<string, ShuttleDepartureInput>();

  for (const departure of departures) {
    const key = [
      departure.campus ?? "",
      departure.routeName,
      departure.direction ?? "",
      departure.stopName,
      departure.dayType,
      departure.departureTime,
      departure.note ?? "",
    ].join("|");

    if (!deduped.has(key)) {
      deduped.set(key, departure);
    }
  }

  return [...deduped.values()].map((departure, index) => ({
    ...departure,
    sortOrder: index,
  }));
}

export function normalizeShuttleTimetableText(params: {
  title: string;
  bodyText: string;
  attachmentTexts: string[];
  term: CurrentAcademicTerm;
}): ShuttleDepartureInput[] {
  const lines = normalizeTextBlock(
    [params.title, params.bodyText, ...params.attachmentTexts].join("\n"),
  );
  const departures: ShuttleDepartureInput[] = [];
  let currentCampus: string | null = null;
  let currentRouteName = "셔틀";
  let currentDayType: ShuttleDayType = "weekday";

  for (const line of lines) {
    currentCampus = inferCampus(line, currentCampus);
    currentDayType = inferDayType(line, currentDayType);

    const routeHeader = parseRouteHeader(line);
    if (routeHeader) {
      currentRouteName = routeHeader;
      continue;
    }

    const times = extractTimes(line);
    if (times.length === 0) {
      continue;
    }

    const lineWithoutTimes = stripTimes(line);
    const direction = extractDirection(line);
    const stopName = buildStopName(lineWithoutTimes, currentRouteName);
    const note = /(변경|방학|시험|운휴|미운행|금요일|막차)/u.test(line)
      ? lineWithoutTimes
      : null;

    for (const departureTime of times) {
      departures.push({
        campus: currentCampus,
        routeName: currentRouteName,
        direction,
        stopName,
        dayType: currentDayType,
        departureTime,
        note,
        sortOrder: departures.length,
      });
    }
  }

  const deduped = dedupeDepartures(departures);
  if (deduped.length === 0) {
    throw new Error(
      `${params.term.academicYear}학년도 ${params.term.termLabel} 셔틀 시간표에서 출발 시각을 찾지 못했습니다.`,
    );
  }

  return deduped;
}
