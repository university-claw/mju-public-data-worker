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
  | "ignored";

export type CafeteriaMenuDocumentScope =
  | "weekday"
  | "weekend"
  | "unknown";

export type CafeteriaMenuMealType =
  | "breakfast"
  | "lunch"
  | "dinner";

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
  imagePerceptualHash?: string | null;
  ocrStatus?: CafeteriaInstagramOcrStatus | null;
}

export interface CafeteriaInstagramPostSnapshot {
  id: number;
  sourceId: string;
  postedAt: string;
  caption?: string | null;
  ocrText?: string | null;
  imagePerceptualHash?: string | null;
}

export interface CafeteriaInstagramProcessingUpdate {
  imageStorageProvider?: string | null;
  imageStorageKey?: string | null;
  imageContentType?: string | null;
  imageSizeBytes?: number | null;
  imageSha256?: string | null;
  imagePerceptualHash?: string | null;
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
  score: number;
  confidence: number;
  reason: string;
  signals: string[];
}

export interface CafeteriaMenuSheetDetectionInput {
  source: CafeteriaInstagramSource;
  snapshot: CafeteriaInstagramPostSnapshot;
  referenceHashes: string[];
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

export type CafeteriaMenuNormalizationStatus =
  | "pending"
  | "succeeded"
  | "partial"
  | "failed";

export interface CafeteriaMenuNormalizationContext {
  sourceDocumentId: number;
  sourcePostId: number;
  source: CafeteriaInstagramSource;
  imageStorageKey: string;
  documentScope: CafeteriaMenuDocumentScope;
  serviceStartDate?: string | null;
  serviceEndDate?: string | null;
  breakfastAvailable: boolean;
  lunchAvailable: boolean;
  dinnerAvailable: boolean;
}

export interface CafeteriaNormalizedMenuEntry {
  serviceDate: string;
  mealType: CafeteriaMenuMealType;
  isClosed: boolean;
  menuText: string;
  menuItems: string[];
  confidence: number;
}

export interface CafeteriaMenuNormalizationResult {
  status: CafeteriaMenuNormalizationStatus;
  confidence: number;
  reason: string;
  entries: CafeteriaNormalizedMenuEntry[];
  errorMessage?: string | null;
}

export type CafeteriaOfficialPageWeekScope =
  | "current"
  | "previous"
  | "next";

export type CafeteriaOfficialPageSnapshotStatus =
  | "succeeded"
  | "empty"
  | "failed";

export interface CafeteriaOfficialPageSource {
  sourceId: string;
  pageKey: string;
  pageUrl: string;
  viewActionPath: string;
  name: string;
  active?: boolean;
}

export interface CafeteriaOfficialPageSnapshotInput {
  sourceId: string;
  weekStartDate: string;
  weekScope: CafeteriaOfficialPageWeekScope;
  snapshotHash: string;
  rawHtml: string;
  fetchedAt: string;
  status: CafeteriaOfficialPageSnapshotStatus;
  errorMessage?: string | null;
}

export interface CafeteriaOfficialPageSnapshotResult {
  sourceSnapshotId: number;
}

export interface CafeteriaOfficialMenuDocumentInput {
  sourceSnapshotId: number;
  sourceId: string;
  weekStartDate: string;
  documentScope: CafeteriaMenuDocumentScope;
  serviceStartDate?: string | null;
  serviceEndDate?: string | null;
  breakfastAvailable: boolean;
  lunchAvailable: boolean;
  dinnerAvailable: boolean;
  normalizedAt?: string | null;
}

export interface CafeteriaOfficialMenuEntryInput {
  serviceDate: string;
  mealType: CafeteriaMenuMealType;
  isClosed: boolean;
  menuText: string;
  menuItems: string[];
  confidence?: number | null;
}

export type CafeteriaResolvedMenuSourceKind =
  | "instagram_ocr"
  | "official_page";

export interface CafeteriaResolvedMenuEntryInput {
  sourceId: string;
  serviceDate: string;
  mealType: CafeteriaMenuMealType;
  selectedSourceKind: CafeteriaResolvedMenuSourceKind;
  selectedInstagramEntryId?: number | null;
  selectedOfficialEntryId?: number | null;
  isClosed: boolean;
  menuText: string;
  menuItems: string[];
  selectionReason?: string | null;
  selectedAt?: string | null;
}
