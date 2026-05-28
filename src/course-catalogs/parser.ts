import { load as loadHtml } from "cheerio";
import type {
  CourseCatalogEntryInput,
  CourseCatalogSnapshotInput,
} from "./types.js";
import { normalizeMeetingSlots } from "./meeting-normalizer.js";
import { sanitizeMetadata } from "./privacy.js";

interface ParseCourseCatalogOptions {
  sourceKind?: CourseCatalogSnapshotInput["sourceKind"];
  defaultYear?: number;
  defaultTermCode?: string;
  defaultTermLabel?: string;
}

const UNKNOWN_CATEGORY = "unknown";

export function parseCourseCatalogJson(
  rawJson: string,
  options: ParseCourseCatalogOptions = {},
): CourseCatalogSnapshotInput {
  const parsed: unknown = JSON.parse(rawJson);
  if (Array.isArray(parsed)) {
    throw new Error("course catalog import JSON must be an object; use parseCourseCatalogJsonSnapshots for arrays");
  }
  return parseCourseCatalogJsonValue(parsed, options);
}

export function parseCourseCatalogJsonSnapshots(
  rawJson: string,
  options: ParseCourseCatalogOptions = {},
): CourseCatalogSnapshotInput[] {
  const parsed: unknown = JSON.parse(rawJson);
  const values = Array.isArray(parsed) ? parsed : [parsed];
  if (values.length === 0) {
    throw new Error("course catalog import JSON array must contain at least one snapshot");
  }
  return values.map((value) => parseCourseCatalogJsonValue(value, options));
}

function parseCourseCatalogJsonValue(
  value: unknown,
  options: ParseCourseCatalogOptions,
): CourseCatalogSnapshotInput {
  if (!isRecord(value)) {
    throw new Error("course catalog import JSON must be an object");
  }

  const entriesValue = value.entries;
  if (!Array.isArray(entriesValue)) {
    throw new Error("course catalog import JSON must contain entries[]");
  }

  const year = parseRequiredYear(value.year ?? options.defaultYear);
  const termCode = parseRequiredString(
    value.termCode ?? value.term_code ?? options.defaultTermCode,
    "termCode",
  );
  const termLabel = parseRequiredString(
    value.termLabel ?? value.term_label ?? options.defaultTermLabel,
    "termLabel",
  );
  const sourceKind = parseSourceKind(value.sourceKind ?? value.source_kind)
    ?? options.sourceKind
    ?? "json_import";

  return {
    year,
    termCode,
    termLabel,
    sourceKind,
    metadata: sanitizeMetadata(value.metadata),
    entries: entriesValue.map((entry, index) =>
      normalizeCourseCatalogEntry(entry, {
        year,
        termCode,
        termLabel,
        index,
      }),
    ),
  };
}

export function parseCourseCatalogHtml(
  html: string,
  options: ParseCourseCatalogOptions,
): CourseCatalogSnapshotInput {
  const year = parseRequiredYear(options.defaultYear);
  const termCode = parseRequiredString(options.defaultTermCode, "termCode");
  const termLabel = parseRequiredString(options.defaultTermLabel, "termLabel");
  const $ = loadHtml(html);
  const table = $("table").first();
  if (table.length === 0) {
    throw new Error("course catalog HTML import does not contain a table");
  }

  const headerCells = table
    .find("tr")
    .first()
    .children("th,td")
    .toArray()
    .map((cell) => normalizeHeader($(cell).text()));
  const rows = table.find("tr").slice(1).toArray();
  const entries: CourseCatalogEntryInput[] = [];

  for (const [index, row] of rows.entries()) {
    const cells = $(row).children("th,td").toArray();
    if (cells.length === 0) {
      continue;
    }

    const rawEntry: Record<string, unknown> = {};
    cells.forEach((cell, cellIndex) => {
      const header = headerCells[cellIndex];
      if (!header) {
        return;
      }

      rawEntry[header] = normalizeWhitespace($(cell).text());
    });

    entries.push(
      normalizeCourseCatalogEntry(rawEntry, {
        year,
        termCode,
        termLabel,
        index,
      }),
    );
  }

  return {
    year,
    termCode,
    termLabel,
    sourceKind: options.sourceKind ?? "html_import",
    metadata: {},
    entries,
  };
}

export function normalizeCourseCatalogEntry(
  value: unknown,
  context: {
    year: number;
    termCode: string;
    termLabel: string;
    index: number;
  },
): CourseCatalogEntryInput {
  if (!isRecord(value)) {
    throw new Error(`course catalog entry ${context.index} must be an object`);
  }

  const courseTitle = parseRequiredString(
    pick(value, "courseTitle", "course_title", "title", "교과목명", "과목명"),
    `entries[${context.index}].courseTitle`,
  );
  const category = normalizeOptionalString(
    pick(value, "category", "categoryCode", "category_code", "이수구분"),
  ) ?? UNKNOWN_CATEGORY;
  const categoryLabel = normalizeOptionalString(
    pick(value, "categoryLabel", "category_label", "categoryName", "이수구분명"),
  ) ?? category;

  return {
    year: context.year,
    termCode: context.termCode,
    termLabel: context.termLabel,
    category,
    categoryLabel,
    courseCode: normalizeOptionalString(
      pick(value, "courseCode", "course_code", "학수번호"),
    ),
    curriculumNumber: normalizeOptionalString(
      pick(value, "curriculumNumber", "curriculum_number", "교과목번호"),
    ),
    courseTitle,
    gradeLevel: normalizeOptionalString(
      pick(value, "gradeLevel", "grade_level", "grade", "학년"),
    ),
    section: normalizeOptionalString(pick(value, "section", "분반")),
    professor: normalizeOptionalString(pick(value, "professor", "instructor", "교수")),
    credit: normalizeOptionalNumber(pick(value, "credit", "credits", "학점")),
    department: normalizeOptionalString(pick(value, "department", "학과")),
    campus: normalizeOptionalString(pick(value, "campus", "캠퍼스")),
    meetings: normalizeMeetingSlots(
      pick(value, "meetings", "meeting", "time", "times", "강의시간"),
    ),
  };
}

function normalizeHeader(value: string): string {
  const normalized = normalizeWhitespace(value).toLowerCase();
  const aliases: Record<string, string> = {
    category: "category",
    "category code": "category",
    "category label": "categoryLabel",
    "course code": "courseCode",
    "curriculum number": "curriculumNumber",
    title: "courseTitle",
    "course title": "courseTitle",
    "grade level": "gradeLevel",
    grade: "gradeLevel",
    section: "section",
    professor: "professor",
    instructor: "professor",
    credit: "credit",
    credits: "credit",
    department: "department",
    campus: "campus",
    meetings: "meetings",
    time: "meetings",
    이수구분: "category",
    이수구분명: "categoryLabel",
    학수번호: "courseCode",
    교과목번호: "curriculumNumber",
    교과목명: "courseTitle",
    과목명: "courseTitle",
    학년: "gradeLevel",
    분반: "section",
    교수: "professor",
    학점: "credit",
    학과: "department",
    캠퍼스: "campus",
    강의시간: "meetings",
  };

  return aliases[normalized] ?? normalized;
}

function pick(value: Record<string, unknown>, ...keys: string[]): unknown {
  for (const key of keys) {
    if (key in value) {
      return value[key];
    }
  }

  return undefined;
}

function parseRequiredYear(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 2000 || parsed > 2100) {
    throw new Error(`year must be a four digit year, received: ${String(value)}`);
  }

  return parsed;
}

function parseRequiredString(value: unknown, name: string): string {
  const normalized = normalizeOptionalString(value);
  if (!normalized) {
    throw new Error(`${name} is required`);
  }

  return normalized;
}

function parseSourceKind(
  value: unknown,
): CourseCatalogSnapshotInput["sourceKind"] | null {
  const normalized = normalizeOptionalString(value);
  if (
    normalized === "json_import" ||
    normalized === "html_import" ||
    normalized === "fixture_import" ||
    normalized === "mju_cli_msi_timetable" ||
    normalized === "mju_cli_msi_department_timetable"
  ) {
    return normalized;
  }
  return null;
}

function normalizeOptionalString(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  const normalized = normalizeWhitespace(String(value));
  return normalized.length > 0 ? normalized : null;
}

function normalizeOptionalNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
