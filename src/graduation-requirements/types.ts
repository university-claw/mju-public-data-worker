export type GraduationRequirementSourceKind =
  | "official_notice"
  | "official_handbook"
  | "msi_graduation"
  | "department_page";

export type GraduationRequirementRuleStatus = "confirmed" | "unprovided";

export interface GraduationRequirementCourseGroupInput {
  groupKey?: string | null;
  label: string;
  requiredCredits?: number | null;
  minCourses?: number | null;
  requiredCourseCodes?: string[];
  requiredCourseTitles?: string[];
  groupType?: string | null;
  alternativeGroup?: string | null;
  appliesTo?: Record<string, unknown>;
  note?: string | null;
}

export interface GraduationRequirementRuleInput {
  requirementKey: string;
  label: string;
  category: string;
  requiredCredits?: number | null;
  requiredCourseCodes?: string[];
  requiredCourseTitles?: string[];
  courseGroups?: GraduationRequirementCourseGroupInput[];
  programTrack?: string | null;
  minCourses?: number | null;
  appliesTo?: Record<string, unknown>;
  status: GraduationRequirementRuleStatus;
  note?: string | null;
}

export interface GraduationRequirementSourceInput {
  department: string;
  admissionYear: number;
  sourceKind: GraduationRequirementSourceKind;
  sourceTitle: string;
  sourceUrl: string;
  sourcePublishedAt?: string | null;
  rawPayload: Record<string, unknown>;
  rules: GraduationRequirementRuleInput[];
}

export interface GraduationRequirementImportResult {
  sourceId: number;
  department: string;
  admissionYear: number;
  ruleCount: number;
}
