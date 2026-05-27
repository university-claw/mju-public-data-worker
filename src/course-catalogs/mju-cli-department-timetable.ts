import { normalizeMeetingSlots } from "./meeting-normalizer.js";
import type {
  CourseCatalogEntryInput,
  CourseCatalogSnapshotInput,
} from "./types.js";

interface MjuCliDepartmentMeeting {
  dayOfWeek?: unknown;
  dayLabel?: unknown;
  timeRange?: unknown;
  startTime?: unknown;
  endTime?: unknown;
  location?: unknown;
}

interface MjuCliDepartmentEntry {
  gradeLevel?: unknown;
  courseTitle?: unknown;
  credit?: unknown;
  hours?: unknown;
  npType?: unknown;
  professor?: unknown;
  section?: unknown;
  capacity?: unknown;
  rawTimeRange?: unknown;
  note?: unknown;
  curiNum?: unknown;
  courseCls?: unknown;
  meetings?: unknown;
}

interface MjuCliDepartmentTimetableResult {
  year?: unknown;
  termCode?: unknown;
  termLabel?: unknown;
  termOptions?: unknown;
  campusDiv?: unknown;
  campusLabel?: unknown;
  campusOptions?: unknown;
  departmentCode?: unknown;
  departmentLabel?: unknown;
  departmentOptions?: unknown;
  page?: unknown;
  pageCount?: unknown;
  resultCount?: unknown;
  entries?: unknown;
}

export interface MjuCliDepartmentTimetableCatalogOptions {
  year: number;
  termCode: string;
  termLabel: string;
  category?: string;
  categoryLabel?: string;
}

export function courseCatalogFromMjuCliDepartmentTimetable(
  value: unknown,
  options: MjuCliDepartmentTimetableCatalogOptions,
): CourseCatalogSnapshotInput {
  if (!isRecord(value)) {
    throw new Error("mju CLI department timetable output must be an object");
  }

  const timetable = value as MjuCliDepartmentTimetableResult;
  if (!Array.isArray(timetable.entries)) {
    throw new Error("mju CLI department timetable output must contain entries[]");
  }

  const year = normalizeYear(timetable.year) ?? options.year;
  const termCode = normalizeString(timetable.termCode) ?? options.termCode;
  const termLabel = normalizeString(timetable.termLabel) ?? options.termLabel;
  const departmentCode = normalizeString(timetable.departmentCode);
  const departmentLabel = normalizeString(timetable.departmentLabel);
  const campusDiv = normalizeString(timetable.campusDiv);
  const campusLabel = normalizeString(timetable.campusLabel);
  const defaultCategory = defaultDepartmentCategory(departmentCode, departmentLabel);

  return {
    year,
    termCode,
    termLabel,
    sourceKind: "mju_cli_msi_department_timetable",
    metadata: {
      source: "mju-cli msi department-timetable",
      sourceUrl: "https://msi.mju.ac.kr/servlet/su/sue/Sue00Svl06viewTimetable",
      departmentCode,
      departmentLabel,
      campusDiv,
      campusLabel,
      termOptions: normalizeOptions(timetable.termOptions),
      campusOptions: normalizeOptions(timetable.campusOptions),
      departmentOptions: normalizeOptions(timetable.departmentOptions),
      page: normalizeInteger(timetable.page),
      pageCount: normalizeInteger(timetable.pageCount),
      rawEntryCount: timetable.entries.length,
      resultCount: normalizeInteger(timetable.resultCount),
    },
    entries: timetable.entries.map((entry, index) =>
      departmentEntryToCatalogEntry(entry, {
        year,
        termCode,
        termLabel,
        index,
        category: options.category ?? defaultCategory.category,
        categoryLabel: options.categoryLabel ?? defaultCategory.categoryLabel,
        department: departmentLabel,
        campus: campusLabel,
      }),
    ),
  };
}

function departmentEntryToCatalogEntry(
  value: unknown,
  context: {
    year: number;
    termCode: string;
    termLabel: string;
    index: number;
    category: string;
    categoryLabel: string;
    department: string | null;
    campus: string | null;
  },
): CourseCatalogEntryInput {
  if (!isRecord(value)) {
    throw new Error(`mju CLI department timetable entry ${context.index} must be an object`);
  }

  const entry = value as MjuCliDepartmentEntry;
  const courseTitle = normalizeString(entry.courseTitle);
  if (!courseTitle) {
    throw new Error(
      `mju CLI department timetable entry ${context.index} is missing courseTitle`,
    );
  }

  const curiNum = normalizeString(entry.curiNum);
  const section = normalizeString(entry.section ?? entry.courseCls);
  const categoryLabel = entryCategoryLabel(context.category, context.categoryLabel, curiNum);

  return {
    year: context.year,
    termCode: context.termCode,
    termLabel: context.termLabel,
    category: context.category,
    categoryLabel,
    courseCode: curiNum,
    curriculumNumber: curiNum,
    courseTitle,
    gradeLevel: normalizeString(entry.gradeLevel),
    section,
    professor: normalizeString(entry.professor),
    credit: normalizeNumber(entry.credit),
    department: context.department,
    campus: context.campus,
    meetings: normalizeMeetingSlots(normalizeDepartmentMeetings(entry)),
  };
}

function defaultDepartmentCategory(
  departmentCode: string | null,
  departmentLabel: string | null,
): { category: string; categoryLabel: string } {
  if (departmentCode === "10000" || departmentCode === "20000" || /교양/u.test(departmentLabel ?? "")) {
    return { category: "elective", categoryLabel: "교양" };
  }
  return { category: "major", categoryLabel: "전공" };
}

function entryCategoryLabel(
  category: string,
  categoryLabel: string,
  courseCode: string | null,
): string {
  if (category !== "elective" || !/교양|elective|liberal/i.test(categoryLabel)) {
    return categoryLabel;
  }
  return liberalCourseCategoryLabel(courseCode) ?? categoryLabel;
}

function liberalCourseCategoryLabel(courseCode: string | null): string | null {
  const prefix = courseCode?.replace(/[0-9].*$/u, "").toUpperCase();
  if (!prefix) return null;
  if (prefix === "KMA") return "공통교양";
  if (["KMB", "KMC", "KMK", "KML"].includes(prefix)) return "핵심교양";
  if (["KME", "KMI", "KMN"].includes(prefix)) return "학문기초교양";
  if (prefix === "KMP") return "외국어";
  if (prefix === "TAA") return "교직";
  return "일반교양";
}

function normalizeDepartmentMeetings(entry: MjuCliDepartmentEntry): unknown[] {
  const meetings = Array.isArray(entry.meetings) ? entry.meetings : [];
  if (meetings.length > 0) {
    return meetings
      .filter(isRecord)
      .map((meeting) => normalizeDepartmentMeeting(meeting));
  }

  const rawTimeRange = normalizeString(entry.rawTimeRange);
  return rawTimeRange ? [rawTimeRange] : [];
}

function normalizeDepartmentMeeting(
  meeting: Record<string, unknown>,
): Record<string, unknown> {
  const dayLabel = normalizeString(meeting.dayLabel);
  const timeRange = normalizeString(meeting.timeRange);
  const location = normalizeString(meeting.location);
  return {
    rawTimeRange: [dayLabel, timeRange, location ? `(${location})` : null]
      .filter(Boolean)
      .join(" "),
    dayOfWeek: normalizeInteger(meeting.dayOfWeek),
    dayLabel,
    startTime: normalizeString(meeting.startTime),
    endTime: normalizeString(meeting.endTime),
    location,
  };
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

function normalizeNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeString(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  const normalized = String(value).replace(/\s+/gu, " ").trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeOptions(value: unknown): Array<{
  code: string;
  label: string;
  selected: boolean;
}> {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter(isRecord)
    .map((option) => {
      const code = normalizeString(option.code) ?? "";
      const label = normalizeString(option.label) ?? "";
      return {
        code,
        label,
        selected: option.selected === true,
      };
    })
    .filter((option) => option.code || option.label);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
