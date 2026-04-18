export interface NoticeSource {
  id: string;
  name: string;
  description: string;
  listUrl: string;
}

export interface NoticeListItem {
  sourceId: string;
  categoryLabel?: string;
  externalId: string;
  title: string;
  detailUrl: string;
  author?: string;
  publishedAt: string;
  publishedAtRaw: string;
}

export interface NoticeAttachment {
  fileName: string;
  downloadUrl: string;
  sortOrder: number;
}

export interface NoticeAssetImage {
  imageUrl: string;
  altText?: string;
  sortOrder: number;
}

export type NoticeAssetDownloadStatus = "pending" | "succeeded" | "failed";

export type NoticeAttachmentExtractionStatus =
  | "pending"
  | "succeeded"
  | "failed"
  | "unsupported";

export type NoticeAttachmentExtractorType = "pdf" | "docx" | "hwpx";
export type NoticeImageOcrStatus =
  | "pending"
  | "succeeded"
  | "failed"
  | "unsupported";
export type NoticeReadModelNormalizationStatus =
  | "succeeded"
  | "failed";
export type NoticeReadModelNoticeKind =
  | "announcement"
  | "scholarship"
  | "recruitment"
  | "event"
  | "survey"
  | "system_notice"
  | "application"
  | "contest"
  | "result"
  | "other";
export type NoticeReadModelIssuerScope = "internal" | "external";
export type NoticeReadModelPrimaryTimeKind =
  | "application_period"
  | "event_period"
  | "operation_period"
  | "response_deadline"
  | "announcement_period"
  | "other";
export type NoticeReadModelActionKind =
  | "apply"
  | "register"
  | "participate"
  | "respond"
  | "check"
  | "support"
  | "other";
export type NoticeReadModelActionChannel =
  | "web_form"
  | "system"
  | "email"
  | "in_person"
  | "onsite"
  | "phone"
  | "other";
export type NoticeReadModelParticipationMode =
  | "online"
  | "offline"
  | "hybrid"
  | "remote"
  | "onsite"
  | "other";
export type NoticeReadModelBenefitKind =
  | "scholarship"
  | "grant"
  | "tuition"
  | "interest_support"
  | "prize"
  | "free_issue"
  | "coupon"
  | "other";

export type NoticeReadModelJsonPrimitive = string | number | boolean | null;
export interface NoticeReadModelJsonObject {
  [key: string]: NoticeReadModelJsonValue;
}
export type NoticeReadModelJsonValue =
  | NoticeReadModelJsonPrimitive
  | NoticeReadModelJsonObject
  | NoticeReadModelJsonValue[];

export interface NoticeAssetProcessingUpdate {
  storageProvider?: "local" | null;
  storageKey?: string | null;
  contentType?: string | null;
  sizeBytes?: number | null;
  sha256?: string | null;
  downloadedAt?: string | null;
  downloadStatus: NoticeAssetDownloadStatus;
  errorMessage?: string | null;
}

export interface NoticeAttachmentExtractionUpdate {
  attachmentSha256?: string | null;
  extractorType?: NoticeAttachmentExtractorType | null;
  extractionStatus: NoticeAttachmentExtractionStatus;
  extractedText?: string | null;
  textSha256?: string | null;
  extractedCharCount?: number | null;
  extractedAt?: string | null;
  errorMessage?: string | null;
}

export interface NoticeImageOcrUpdate {
  imageSha256?: string | null;
  ocrStatus: NoticeImageOcrStatus;
  ocrText?: string | null;
  textSha256?: string | null;
  ocrConfidence?: number | null;
  ocrLanguage?: string | null;
  ocrExtractedAt?: string | null;
  errorMessage?: string | null;
}

export interface StoredNoticeAttachment {
  id: number;
  fileName: string;
  downloadUrl: string;
  storageKey?: string | null;
  contentType?: string | null;
  sha256?: string | null;
  downloadStatus: NoticeAssetDownloadStatus;
  existingExtractionStatus?: NoticeAttachmentExtractionStatus | null;
  existingAttachmentSha256?: string | null;
}

export interface StoredNoticeImage {
  id: number;
  imageUrl: string;
  altText?: string | null;
  storageKey?: string | null;
  contentType?: string | null;
  sha256?: string | null;
  downloadStatus: NoticeAssetDownloadStatus;
  existingOcrStatus?: NoticeImageOcrStatus | null;
  existingImageSha256?: string | null;
  existingOcrLanguage?: string | null;
}

export interface NoticeDetail extends NoticeListItem {
  bodyHtml: string;
  bodyText: string;
  contentHash: string;
  attachments: NoticeAttachment[];
  images: NoticeAssetImage[];
}

export interface NoticeReadModelUpsertInput {
  noticeItemId: number;
  noticeKind?: NoticeReadModelNoticeKind | null;
  issuerName?: string | null;
  issuerScope?: NoticeReadModelIssuerScope | null;
  targetCampuses: readonly string[];
  targetAudiences: readonly string[];
  targetProgramLevels: readonly string[];
  targetDepartments: readonly string[];
  targetGradeYears: readonly number[];
  primaryTimeKind?: NoticeReadModelPrimaryTimeKind | null;
  primaryStartAt?: string | null;
  primaryEndAt?: string | null;
  primaryDeadlineAt?: string | null;
  hasDeadline: boolean;
  actionRequired: boolean;
  actionKind?: NoticeReadModelActionKind | null;
  primaryActionChannel?: NoticeReadModelActionChannel | null;
  primaryActionUrl?: string | null;
  primaryLocation?: string | null;
  participationMode?: NoticeReadModelParticipationMode | null;
  hasBenefit: boolean;
  benefitKind?: NoticeReadModelBenefitKind | null;
  benefitAmountKrw?: number | null;
  selectionCount?: number | null;
  summary?: string | null;
  detailsJsonb: NoticeReadModelJsonValue | null;
  normalizedConfidence: number;
  normalizedAt: string;
  normalizationStatus: NoticeReadModelNormalizationStatus;
  normalizationErrorMessage?: string | null;
}

export interface NoticeReadModel extends NoticeReadModelUpsertInput {
  id: number;
  sourceId: string;
  externalId: string;
  createdAt: string;
  updatedAt: string;
}
