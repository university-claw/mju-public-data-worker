export type CourseCatalogMeetingParseStatus =
  | "parsed"
  | "partial"
  | "unparsed";

export interface CourseCatalogMeeting {
  rawTimeRange: string;
  dayOfWeek?: number | null;
  dayLabel?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  location?: string | null;
  parseStatus: CourseCatalogMeetingParseStatus;
  warning?: string | null;
}

export interface CourseCatalogEntryInput {
  year: number;
  termCode: string;
  termLabel: string;
  category: string;
  categoryLabel: string;
  courseCode?: string | null;
  curriculumNumber?: string | null;
  courseTitle: string;
  gradeLevel?: string | null;
  section?: string | null;
  professor?: string | null;
  credit?: number | null;
  department?: string | null;
  campus?: string | null;
  meetings: CourseCatalogMeeting[];
}

export interface CourseCatalogSnapshotInput {
  year: number;
  termCode: string;
  termLabel: string;
  sourceKind:
    | "json_import"
    | "html_import"
    | "fixture_import"
    | "mju_cli_msi_timetable"
    | "mju_cli_msi_department_timetable";
  metadata: Record<string, unknown>;
  entries: CourseCatalogEntryInput[];
}

export interface CourseCatalogCollectionResult {
  snapshotId: number;
  year: number;
  termCode: string;
  entryCount: number;
}
