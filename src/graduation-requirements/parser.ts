import type {
  GraduationRequirementCourseGroupInput,
  GraduationRequirementRuleInput,
  GraduationRequirementSourceKind,
  GraduationRequirementSourceInput,
} from "./types.js";

export interface ParseGraduationRequirementOptions {
  defaultDepartment?: string;
  defaultAdmissionYear?: number;
  defaultSourceUrl?: string;
  defaultSourceTitle?: string;
}

export function parseGraduationRequirementJson(
  rawJson: string,
  options: ParseGraduationRequirementOptions = {},
): GraduationRequirementSourceInput {
  const parsed: unknown = JSON.parse(rawJson);
  if (!isRecord(parsed)) {
    throw new Error("graduation requirement import JSON must be an object");
  }

  const rulesValue = parsed.rules ?? parsed.requirements;
  if (!Array.isArray(rulesValue)) {
    throw new Error("graduation requirement import JSON must contain rules[]");
  }

  const department = parseRequiredString(
    parsed.department ?? options.defaultDepartment,
    "department",
  );
  const admissionYear = parseRequiredYear(
    parsed.admissionYear ?? parsed.admission_year ?? options.defaultAdmissionYear,
  );
  const sourceUrl = parseRequiredString(
    parsed.sourceUrl ?? parsed.source_url ?? options.defaultSourceUrl,
    "sourceUrl",
  );
  const sourceTitle = parseRequiredString(
    parsed.sourceTitle ?? parsed.source_title ?? options.defaultSourceTitle,
    "sourceTitle",
  );

  return {
    department,
    admissionYear,
    sourceKind: normalizeSourceKind(parsed.sourceKind ?? parsed.source_kind),
    sourceTitle,
    sourceUrl,
    sourcePublishedAt: normalizeOptionalString(
      parsed.sourcePublishedAt ?? parsed.source_published_at,
    ),
    rawPayload: parsed,
    rules: rulesValue.map((rule, index) => normalizeRule(rule, index)),
  };
}

function normalizeSourceKind(value: unknown): GraduationRequirementSourceKind {
  return value === "official_notice" ||
    value === "official_handbook" ||
    value === "department_page"
    ? value
    : "msi_graduation";
}

function normalizeRule(value: unknown, index: number): GraduationRequirementRuleInput {
  if (!isRecord(value)) {
    throw new Error(`rules[${index}] must be an object`);
  }

  const requirementKey = parseRequiredString(
    value.requirementKey ?? value.requirement_key ?? value.key,
    `rules[${index}].requirementKey`,
  );
  const label = parseRequiredString(value.label ?? value.name, `rules[${index}].label`);
  const category = parseRequiredString(
    value.category ?? value.categoryLabel ?? value.category_label,
    `rules[${index}].category`,
  );
  const status = value.status === "unprovided" ? "unprovided" : "confirmed";

  return {
    requirementKey,
    label,
    category,
    requiredCredits: normalizeOptionalNumber(
      value.requiredCredits ?? value.required_credits,
    ),
    requiredCourseCodes: stringArray(value.requiredCourseCodes ?? value.required_course_codes),
    requiredCourseTitles: stringArray(value.requiredCourseTitles ?? value.required_course_titles),
    courseGroups: normalizeCourseGroups(value.courseGroups ?? value.course_groups),
    programTrack: normalizeOptionalString(
      value.programTrack ?? value.program_track ?? value.track,
    ),
    minCourses: normalizeOptionalInteger(value.minCourses ?? value.min_courses),
    appliesTo: normalizeOptionalRecord(value.appliesTo ?? value.applies_to),
    status,
    note: normalizeOptionalString(value.note),
  };
}

function normalizeCourseGroups(value: unknown): GraduationRequirementCourseGroupInput[] {
  if (!Array.isArray(value)) return [];
  return value.map((item, index) => normalizeCourseGroup(item, index));
}

function normalizeCourseGroup(value: unknown, index: number): GraduationRequirementCourseGroupInput {
  if (!isRecord(value)) {
    throw new Error(`courseGroups[${index}] must be an object`);
  }
  const label = parseRequiredString(
    value.label ?? value.name,
    `courseGroups[${index}].label`,
  );
  return {
    groupKey: normalizeOptionalString(value.groupKey ?? value.group_key ?? value.key),
    label,
    requiredCredits: normalizeOptionalNumber(value.requiredCredits ?? value.required_credits),
    minCourses: normalizeOptionalInteger(value.minCourses ?? value.min_courses),
    requiredCourseCodes: stringArray(value.requiredCourseCodes ?? value.required_course_codes),
    requiredCourseTitles: stringArray(value.requiredCourseTitles ?? value.required_course_titles),
    groupType: normalizeOptionalString(value.groupType ?? value.group_type),
    alternativeGroup: normalizeOptionalString(value.alternativeGroup ?? value.alternative_group),
    appliesTo: normalizeOptionalRecord(value.appliesTo ?? value.applies_to),
    note: normalizeOptionalString(value.note),
  };
}

function parseRequiredYear(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 2000 || parsed > 2100) {
    throw new Error(`admissionYear must be a four digit year, received: ${String(value)}`);
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

function normalizeOptionalNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeOptionalInteger(value: unknown): number | null {
  const parsed = normalizeOptionalNumber(value);
  return parsed != null && Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function normalizeOptionalString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const normalized = String(value).replace(/\s+/gu, " ").trim();
  return normalized || null;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value
        .map((item) => normalizeOptionalString(item))
        .filter((item): item is string => Boolean(item))
    : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeOptionalRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}
