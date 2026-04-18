export interface NoticeNormalizationEvalSample {
  sourceId: string;
  externalId: string;
  label: string;
  shape: "body_only" | "attachment_only" | "image_only" | "mixed";
  reason: string;
}

export const NOTICE_NORMALIZATION_TUNING_SET: readonly NoticeNormalizationEvalSample[] = [
  {
    sourceId: "career",
    externalId: "230907",
    label: "career:230907",
    shape: "body_only",
    reason: "본문 중심 특강 모집형",
  },
  {
    sourceId: "career",
    externalId: "230983",
    label: "career:230983",
    shape: "mixed",
    reason: "본문+포스터 혼합 외부 교육형",
  },
  {
    sourceId: "career",
    externalId: "231010",
    label: "career:231010",
    shape: "image_only",
    reason: "포스터/OCR 중심 모집형",
  },
  {
    sourceId: "general",
    externalId: "230921",
    label: "general:230921",
    shape: "mixed",
    reason: "첨부 비중이 큰 채용/초빙형",
  },
  {
    sourceId: "general",
    externalId: "230815",
    label: "general:230815",
    shape: "attachment_only",
    reason: "공모전 첨부 중심형",
  },
  {
    sourceId: "general",
    externalId: "230856",
    label: "general:230856",
    shape: "body_only",
    reason: "시스템 안내형",
  },
  {
    sourceId: "scholarship",
    externalId: "230182",
    label: "scholarship:230182",
    shape: "attachment_only",
    reason: "장학생 선발 첨부 중심형",
  },
  {
    sourceId: "scholarship",
    externalId: "230984",
    label: "scholarship:230984",
    shape: "mixed",
    reason: "본문 없이 첨부/포스터가 핵심인 혼합형",
  },
  {
    sourceId: "scholarship",
    externalId: "229895",
    label: "scholarship:229895",
    shape: "mixed",
    reason: "해외교환 장학생 선발형",
  },
  {
    sourceId: "event",
    externalId: "230718",
    label: "event:230718",
    shape: "mixed",
    reason: "행사형 대표 사례",
  },
] as const;

export const NOTICE_NORMALIZATION_HOLDOUT_SET: readonly NoticeNormalizationEvalSample[] = [
  {
    sourceId: "career",
    externalId: "230884",
    label: "career:230884",
    shape: "image_only",
    reason: "설명회형 포스터 검증",
  },
  {
    sourceId: "career",
    externalId: "230858",
    label: "career:230858",
    shape: "attachment_only",
    reason: "첨부 기반 모집형 검증",
  },
  {
    sourceId: "general",
    externalId: "230945",
    label: "general:230945",
    shape: "image_only",
    reason: "진단검사 참여 포스터형",
  },
  {
    sourceId: "general",
    externalId: "230903",
    label: "general:230903",
    shape: "image_only",
    reason: "행사 포스터형 검증",
  },
  {
    sourceId: "general",
    externalId: "230830",
    label: "general:230830",
    shape: "mixed",
    reason: "공모전 혼합형 검증",
  },
  {
    sourceId: "general",
    externalId: "230747",
    label: "general:230747",
    shape: "body_only",
    reason: "훈련/소집 안내형 검증",
  },
  {
    sourceId: "scholarship",
    externalId: "230148",
    label: "scholarship:230148",
    shape: "body_only",
    reason: "선발결과/조회 안내형",
  },
  {
    sourceId: "scholarship",
    externalId: "230723",
    label: "scholarship:230723",
    shape: "mixed",
    reason: "장학사업 공고형",
  },
  {
    sourceId: "scholarship",
    externalId: "230100",
    label: "scholarship:230100",
    shape: "mixed",
    reason: "장학사업형 복합 구조",
  },
  {
    sourceId: "scholarship",
    externalId: "229819",
    label: "scholarship:229819",
    shape: "image_only",
    reason: "장학생 모집 포스터형",
  },
] as const;

export type NoticeNormalizationEvalDatasetName = "tuning" | "holdout";

export function getNoticeNormalizationEvalDataset(
  datasetName: NoticeNormalizationEvalDatasetName,
): readonly NoticeNormalizationEvalSample[] {
  switch (datasetName) {
    case "tuning":
      return NOTICE_NORMALIZATION_TUNING_SET;
    case "holdout":
      return NOTICE_NORMALIZATION_HOLDOUT_SET;
  }
}
