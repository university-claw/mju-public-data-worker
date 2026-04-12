export interface CafeteriaInstagramSource {
  id: string;
  name: string;
  description: string;
  profileUrl: string;
  instagramUsername: string;
  menuImageGroup: string;
  supportsWeekendMenu: boolean;
}

export interface CafeteriaInstagramPost {
  sourceId: string;
  postCode: string;
  profileUrl: string;
  permalink: string;
  caption?: string;
  postedAt: string;
  postedAtEpoch: number;
  imageUrl?: string;
  rawItem: unknown;
}

export type CafeteriaInstagramPostKind =
  | "menu_sheet"
  | "non_menu"
  | "unknown";

export type CafeteriaMenuDocumentScope =
  | "weekday"
  | "weekend"
  | "unknown";

export type CafeteriaInstagramOcrStatus =
  | "pending"
  | "succeeded"
  | "failed"
  | "skipped";

export interface CafeteriaInstagramUpsertResult {
  cafeteriaInstagramPostId: number;
  wasInserted: boolean;
  imageStorageProvider?: string | null;
  imageStorageKey?: string | null;
  imageSha256?: string | null;
  ocrStatus?: CafeteriaInstagramOcrStatus | null;
}

export interface CafeteriaInstagramPostSnapshot {
  id: number;
  sourceId: string;
  postedAt: string;
  caption?: string | null;
  ocrText?: string | null;
}

export interface CafeteriaInstagramProcessingUpdate {
  imageStorageProvider?: string | null;
  imageStorageKey?: string | null;
  imageContentType?: string | null;
  imageSizeBytes?: number | null;
  imageSha256?: string | null;
  imageDownloadedAt?: string | null;
  ocrStatus: CafeteriaInstagramOcrStatus;
  ocrText?: string | null;
  ocrConfidence?: number | null;
  ocrLanguage?: string | null;
  ocrExtractedAt?: string | null;
  ocrErrorMessage?: string | null;
}

export interface CafeteriaPostClassificationResult {
  postKind: CafeteriaInstagramPostKind;
  confidence: number;
  reason: string;
}

export interface CafeteriaMenuDocumentStructureResult {
  documentScope: CafeteriaMenuDocumentScope;
  scopeConfidence: number;
  scopeReason: string;
  serviceStartDate?: string | null;
  serviceEndDate?: string | null;
  breakfastAvailable: boolean;
  lunchAvailable: boolean;
  dinnerAvailable: boolean;
}
