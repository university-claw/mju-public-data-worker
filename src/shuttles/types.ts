export type ShuttleDayType =
  | "weekday"
  | "saturday"
  | "sunday"
  | "holiday"
  | "daily";

export interface CurrentAcademicTerm {
  academicYear: number;
  termLabel: "1학기" | "2학기";
}

export interface ShuttleNoticeCandidate {
  sourceId: string;
  externalId: string;
  title: string;
  detailUrl: string;
  publishedAt: string;
  publishedAtRaw: string;
  score: number;
}

export interface ShuttleDepartureInput {
  campus?: string | null;
  routeName: string;
  direction?: string | null;
  stopName: string;
  dayType: ShuttleDayType;
  departureTime: string;
  note?: string | null;
  sortOrder: number;
}

export interface ShuttleTimetableInput {
  sourceId: string;
  sourceExternalId: string;
  sourceTitle: string;
  sourceUrl: string;
  sourcePublishedAt: string;
  academicYear: number;
  termLabel: string;
  departures: ShuttleDepartureInput[];
  normalizedAt: string;
}

export interface ShuttleTimetableFailureInput {
  sourceId: string;
  sourceExternalId: string;
  sourceTitle: string;
  sourceUrl: string;
  sourcePublishedAt: string;
  academicYear: number;
  termLabel: string;
  errorMessage: string;
}

export interface ShuttleCollectorResult {
  status: "success" | "failed";
  sourceId: string;
  selectedNoticeExternalId: string;
  selectedNoticeTitle: string;
  academicYear: number;
  termLabel: string;
  attachmentTextCount: number;
  departureCount: number;
  timetableVersionId?: number;
  errorMessage?: string;
}
