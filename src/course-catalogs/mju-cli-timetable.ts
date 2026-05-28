import { normalizeMeetingSlots } from "./meeting-normalizer.js";
import type {
  CourseCatalogEntryInput,
  CourseCatalogMeeting,
  CourseCatalogSnapshotInput,
} from "./types.js";

interface MjuCliTimetableEntry {
  courseTitle?: unknown;
  courseCode?: unknown;
  curiNum?: unknown;
  courseCls?: unknown;
  courseClass?: unknown;
  professor?: unknown;
  location?: unknown;
  timeRange?: unknown;
  dayOfWeek?: unknown;
  dayLabel?: unknown;
}

interface MjuCliTimetableResult {
  year?: unknown;
  termCode?: unknown;
  termLabel?: unknown;
  entries?: unknown;
}

export interface MjuCliTimetableCatalogOptions {
  year: number;
  termCode: string;
  termLabel: string;
  category?: string;
  categoryLabel?: string;
}

export function courseCatalogFromMjuCliTimetable(
  value: unknown,
  options: MjuCliTimetableCatalogOptions,
): CourseCatalogSnapshotInput {
  if (!isRecord(value)) {
    throw new Error("mju CLI timetable output must be an object");
  }

  const timetable = value as MjuCliTimetableResult;
  if (!Array.isArray(timetable.entries)) {
    throw new Error("mju CLI timetable output must contain entries[]");
  }

  const year = normalizeYear(timetable.year) ?? options.year;
  const termCode = normalizeString(timetable.termCode) ?? options.termCode;
  const termLabel = normalizeString(timetable.termLabel) ?? options.termLabel;

  const entries = mergeTimetableEntries(
    timetable.entries.map((entry, index) =>
      timetableEntryToCatalogEntry(entry, {
        year,
        termCode,
        termLabel,
        index,
        category: options.category ?? "unknown",
        categoryLabel: options.categoryLabel ?? "MSI 시간표",
      }),
    ),
  );

  return {
    year,
    termCode,
    termLabel,
    sourceKind: "mju_cli_msi_timetable",
    metadata: {
      source: "mju-cli msi timetable",
      limitation: "student timetable snapshot, not full offered-course catalog",
      rawEntryCount: timetable.entries.length,
    },
    entries,
  };
}

function mergeTimetableEntries(
  entries: CourseCatalogEntryInput[],
): CourseCatalogEntryInput[] {
  const byCourse = new Map<string, CourseCatalogEntryInput>();

  for (const entry of entries) {
    const key = timetableCourseKey(entry);
    const existing = byCourse.get(key);
    if (!existing) {
      byCourse.set(key, { ...entry, meetings: [...entry.meetings] });
      continue;
    }

    existing.meetings = mergeMeetings(existing.meetings, entry.meetings);
  }

  return [...byCourse.values()];
}

function timetableCourseKey(entry: CourseCatalogEntryInput): string {
  return [
    entry.courseCode ?? "",
    entry.curriculumNumber ?? "",
    entry.courseTitle,
    entry.section ?? "",
    entry.professor ?? "",
    entry.category,
  ].join("\u001f");
}

function mergeMeetings(
  current: CourseCatalogMeeting[],
  incoming: CourseCatalogMeeting[],
): CourseCatalogMeeting[] {
  const seen = new Set(current.map(timetableMeetingKey));
  const merged = [...current];

  for (const meeting of incoming) {
    const key = timetableMeetingKey(meeting);
    if (!seen.has(key)) {
      seen.add(key);
      merged.push(meeting);
    }
  }

  return merged;
}

function timetableMeetingKey(meeting: CourseCatalogMeeting): string {
  return [
    meeting.rawTimeRange,
    meeting.dayOfWeek ?? "",
    meeting.dayLabel ?? "",
    meeting.startTime ?? "",
    meeting.endTime ?? "",
  ].join("\u001f");
}

function timetableEntryToCatalogEntry(
  value: unknown,
  context: {
    year: number;
    termCode: string;
    termLabel: string;
    index: number;
    category: string;
    categoryLabel: string;
  },
): CourseCatalogEntryInput {
  if (!isRecord(value)) {
    throw new Error(`mju CLI timetable entry ${context.index} must be an object`);
  }

  const entry = value as MjuCliTimetableEntry;
  const courseTitle = normalizeString(entry.courseTitle);
  if (!courseTitle) {
    throw new Error(`mju CLI timetable entry ${context.index} is missing courseTitle`);
  }

  const courseCode = normalizeString(entry.courseCode ?? entry.curiNum);
  const section = normalizeString(entry.courseCls ?? entry.courseClass);

  return {
    year: context.year,
    termCode: context.termCode,
    termLabel: context.termLabel,
    category: context.category,
    categoryLabel: context.categoryLabel,
    courseCode,
    curriculumNumber: normalizeString(entry.curiNum),
    courseTitle,
    section,
    professor: normalizeString(entry.professor),
    credit: null,
    department: null,
    campus: null,
    meetings: normalizeMeetingSlots([
      {
        rawTimeRange: buildRawMeetingRange(entry),
        dayOfWeek: normalizeInteger(entry.dayOfWeek),
        dayLabel: normalizeString(entry.dayLabel),
        ...parseTimeRange(entry.timeRange),
      },
    ]),
  };
}

function buildRawMeetingRange(entry: MjuCliTimetableEntry): string {
  return [
    normalizeString(entry.dayLabel) ?? normalizeString(entry.dayOfWeek),
    normalizeString(entry.timeRange),
    normalizeString(entry.location),
  ].filter(Boolean).join(" ");
}

function parseTimeRange(value: unknown): { startTime?: string; endTime?: string } {
  const normalized = normalizeString(value);
  if (!normalized) {
    return {};
  }

  const match = /(\d{1,2})(?::?(\d{2}))?\s*(?:-|~|–|—|∼)\s*(\d{1,2})(?::?(\d{2}))?/u.exec(normalized);
  if (!match) {
    return {};
  }

  return {
    startTime: normalizeClock(match[1]!, match[2]),
    endTime: normalizeClock(match[3]!, match[4]),
  };
}

function normalizeClock(hour: string, minute: string | undefined): string {
  return `${String(Number(hour)).padStart(2, "0")}:${minute ?? "00"}`;
}

function normalizeYear(value: unknown): number | undefined {
  const parsed = normalizeInteger(value);
  return parsed && parsed >= 2000 && parsed <= 2100 ? parsed : undefined;
}

function normalizeInteger(value: unknown): number | undefined {
  if (value === null || value === undefined || value === "") {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : undefined;
}

function normalizeString(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  const normalized = String(value).replace(/\s+/gu, " ").trim();
  return normalized.length > 0 ? normalized : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
