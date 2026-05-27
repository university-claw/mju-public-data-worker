import type { CourseCatalogMeeting } from "./types.js";
import { containsSensitiveText, sanitizeWarning } from "./privacy.js";

type RawMeetingSlot = string | Record<string, unknown>;

const DAY_ALIASES: Array<{ pattern: RegExp; dayOfWeek: number; dayLabel: string }> = [
  { pattern: /^(mon|monday|월)$/iu, dayOfWeek: 1, dayLabel: "Mon" },
  { pattern: /^(tue|tues|tuesday|화)$/iu, dayOfWeek: 2, dayLabel: "Tue" },
  { pattern: /^(wed|wednesday|수)$/iu, dayOfWeek: 3, dayLabel: "Wed" },
  { pattern: /^(thu|thur|thurs|thursday|목)$/iu, dayOfWeek: 4, dayLabel: "Thu" },
  { pattern: /^(fri|friday|금)$/iu, dayOfWeek: 5, dayLabel: "Fri" },
  { pattern: /^(sat|saturday|토)$/iu, dayOfWeek: 6, dayLabel: "Sat" },
  { pattern: /^(sun|sunday|일)$/iu, dayOfWeek: 7, dayLabel: "Sun" },
];

const TIME_RANGE_PATTERN =
  /(?<start>\d{1,2})(?::(?<startMinute>\d{2}))?\s*(?:-|~|–|—)\s*(?<end>\d{1,2})(?::(?<endMinute>\d{2}))?/u;

export function normalizeMeetingSlots(rawMeetingValue: unknown): CourseCatalogMeeting[] {
  const slots = normalizeRawSlots(rawMeetingValue);
  if (slots.length === 0) {
    return [];
  }

  return slots.flatMap((slot) =>
    typeof slot === "string"
      ? normalizeMeetingSlot(slot)
      : normalizeMeetingObject(slot),
  );
}

export function normalizeMeetingSlot(rawTimeRange: string): CourseCatalogMeeting[] {
  const normalized = rawTimeRange.replace(/\s+/gu, " ").trim();
  if (!normalized) {
    return [];
  }
  if (containsSensitiveText(normalized)) {
    return [
      {
        rawTimeRange: "[redacted sensitive meeting slot]",
        parseStatus: "unparsed",
        warning: sanitizeWarning(normalized),
      },
    ];
  }

  const timeMatch = normalized.match(TIME_RANGE_PATTERN);
  const timeRange = timeMatch?.groups
    ? {
        startTime: normalizeTime(
          timeMatch.groups.start,
          timeMatch.groups.startMinute,
        ),
        endTime: normalizeTime(timeMatch.groups.end, timeMatch.groups.endMinute),
      }
    : null;
  const dayPart = timeMatch
    ? normalized.slice(0, timeMatch.index).replace(/[()[\],]/gu, " ").trim()
    : normalized;
  const dayTokens = dayPart
    .split(/[/,\s]+/u)
    .map((token) => token.trim())
    .filter(Boolean);
  const parsedDays = dayTokens
    .map(parseDayToken)
    .filter((day): day is { dayOfWeek: number; dayLabel: string } => Boolean(day));

  if (parsedDays.length === 0 && timeRange) {
    return [
      {
        rawTimeRange: normalized,
        startTime: timeRange.startTime,
        endTime: timeRange.endTime,
        parseStatus: "partial",
        warning: sanitizeWarning("meeting day could not be parsed"),
      },
    ];
  }

  if (parsedDays.length > 0 && timeRange) {
    return parsedDays.map((day) => ({
      rawTimeRange: normalized,
      dayOfWeek: day.dayOfWeek,
      dayLabel: day.dayLabel,
      startTime: timeRange.startTime,
      endTime: timeRange.endTime,
      parseStatus: "parsed",
      warning: null,
    }));
  }

  if (parsedDays.length > 0) {
    return parsedDays.map((day) => ({
      rawTimeRange: normalized,
      dayOfWeek: day.dayOfWeek,
      dayLabel: day.dayLabel,
      parseStatus: "partial",
      warning: sanitizeWarning("meeting time could not be parsed"),
    }));
  }

  return [
    {
      rawTimeRange: normalized,
      parseStatus: "unparsed",
      warning: sanitizeWarning("meeting slot could not be parsed"),
    },
  ];
}

function normalizeMeetingObject(value: Record<string, unknown>): CourseCatalogMeeting[] {
  const rawTimeRange = normalizeOptionalString(
    value.rawTimeRange ?? value.rawTime ?? value.timeRange ?? value.time,
  ) ?? buildRawMeetingRange(value);
  const location = normalizeOptionalString(value.location);
  if (containsSensitiveText(rawTimeRange)) {
    return normalizeMeetingSlot(rawTimeRange);
  }

  const day = normalizeDay(value.dayOfWeek ?? value.weekday ?? value.day ?? value.dayLabel ?? rawTimeRange);
  const startTime = normalizeClockString(value.startTime ?? value.start);
  const endTime = normalizeClockString(value.endTime ?? value.end);
  if (day && startTime && endTime) {
    return [{
      rawTimeRange,
      dayOfWeek: day.dayOfWeek,
      dayLabel: normalizeOptionalString(value.dayLabel) ?? day.dayLabel,
      startTime,
      endTime,
      location,
      parseStatus: normalizeParseStatus(value.parseStatus, "parsed"),
      warning: sanitizeWarning(normalizeOptionalString(value.warning)),
    }];
  }

  if (rawTimeRange) {
    return normalizeMeetingSlot(rawTimeRange);
  }

  return [];
}

function normalizeRawSlots(value: unknown): RawMeetingSlot[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => normalizeRawSlots(item));
  }

  if (isRecord(value)) {
    return [value];
  }

  if (typeof value !== "string") {
    return [];
  }

  return value
    .split(/\r?\n|;/u)
    .map((slot) => slot.trim())
    .filter(Boolean);
}

function parseDayToken(token: string):
  | { dayOfWeek: number; dayLabel: string }
  | null {
  const normalized = token.replace(/[().]/gu, "").trim();
  const matched = DAY_ALIASES.find((alias) => alias.pattern.test(normalized));
  if (!matched) {
    return null;
  }

  return {
    dayOfWeek: matched.dayOfWeek,
    dayLabel: matched.dayLabel,
  };
}

function normalizeTime(hour: string | undefined, minute: string | undefined): string {
  const normalizedHour = String(Number(hour)).padStart(2, "0");
  return `${normalizedHour}:${minute ?? "00"}`;
}

function normalizeClockString(value: unknown): string | null {
  const normalized = normalizeOptionalString(value);
  if (!normalized) return null;
  const match = normalized.match(/^(\d{1,2})(?::(\d{2}))?$/u);
  if (!match) return null;
  return normalizeTime(match[1], match[2]);
}

function normalizeDay(value: unknown): { dayOfWeek: number; dayLabel: string } | null {
  if (typeof value === "number" && value >= 1 && value <= 7) {
    return { dayOfWeek: value, dayLabel: dayLabelFromNumber(value) };
  }

  const normalized = normalizeOptionalString(value);
  if (!normalized) return null;
  for (const token of normalized.split(/[/,\s]+/u)) {
    const parsed = parseDayToken(token);
    if (parsed) return parsed;
  }
  return null;
}

function dayLabelFromNumber(value: number): string {
  return DAY_ALIASES.find((alias) => alias.dayOfWeek === value)?.dayLabel ?? "";
}

function normalizeParseStatus(
  value: unknown,
  fallback: CourseCatalogMeeting["parseStatus"],
): CourseCatalogMeeting["parseStatus"] {
  return value === "parsed" || value === "partial" || value === "unparsed"
    ? value
    : fallback;
}

function buildRawMeetingRange(value: Record<string, unknown>): string {
  const day = normalizeOptionalString(value.dayLabel ?? value.weekday ?? value.day);
  const start = normalizeOptionalString(value.startTime ?? value.start);
  const end = normalizeOptionalString(value.endTime ?? value.end);
  return [day, start && end ? `${start}-${end}` : null].filter(Boolean).join(" ");
}

function normalizeOptionalString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const normalized = String(value).replace(/\s+/gu, " ").trim();
  return normalized.length > 0 ? normalized : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
