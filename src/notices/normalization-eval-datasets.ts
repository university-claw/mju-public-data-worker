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

export const NOTICE_NORMALIZATION_VALIDATION_V2_SET: readonly NoticeNormalizationEvalSample[] = [
  {
    sourceId: "career",
    externalId: "230967",
    label: "career:230967",
    shape: "mixed",
    reason: "외부 육성사업 멘티 모집 혼합형",
  },
  {
    sourceId: "career",
    externalId: "230923",
    label: "career:230923",
    shape: "mixed",
    reason: "명시적 마감이 있는 모집형",
  },
  {
    sourceId: "career",
    externalId: "230882",
    label: "career:230882",
    shape: "image_only",
    reason: "수요조사형 포스터/OCR 중심",
  },
  {
    sourceId: "career",
    externalId: "230863",
    label: "career:230863",
    shape: "image_only",
    reason: "졸업생 취업조사 안내 포스터형",
  },
  {
    sourceId: "general",
    externalId: "231000",
    label: "general:231000",
    shape: "attachment_only",
    reason: "첨부 중심 채용 공고형",
  },
  {
    sourceId: "general",
    externalId: "230925",
    label: "general:230925",
    shape: "image_only",
    reason: "행사 안내 포스터형",
  },
  {
    sourceId: "general",
    externalId: "230869",
    label: "general:230869",
    shape: "mixed",
    reason: "선발시험 대비반 모집 혼합형",
  },
  {
    sourceId: "general",
    externalId: "230874",
    label: "general:230874",
    shape: "image_only",
    reason: "멘토 모집 안내 포스터형",
  },
  {
    sourceId: "general",
    externalId: "230904",
    label: "general:230904",
    shape: "image_only",
    reason: "해외취업설명회 일반공지 포스터형",
  },
  {
    sourceId: "scholarship",
    externalId: "230938",
    label: "scholarship:230938",
    shape: "image_only",
    reason: "채무지원 안내 포스터형",
  },
  {
    sourceId: "scholarship",
    externalId: "230580",
    label: "scholarship:230580",
    shape: "mixed",
    reason: "장학금 첨부 중심 복합형",
  },
  {
    sourceId: "scholarship",
    externalId: "230321",
    label: "scholarship:230321",
    shape: "mixed",
    reason: "장학생 선발 복합형",
  },
  {
    sourceId: "scholarship",
    externalId: "230187",
    label: "scholarship:230187",
    shape: "mixed",
    reason: "가구원 동의 안내 첨부+이미지형",
  },
  {
    sourceId: "scholarship",
    externalId: "229764",
    label: "scholarship:229764",
    shape: "attachment_only",
    reason: "교외근로 장학생 모집 첨부 중심형",
  },
] as const;

export const NOTICE_NORMALIZATION_REGRESSION_SET: readonly NoticeNormalizationEvalSample[] = [
  {
    sourceId: "career",
    externalId: "230983",
    label: "career:230983",
    shape: "mixed",
    reason: "benefit_kind/target 분류 회귀 확인",
  },
  {
    sourceId: "career",
    externalId: "231010",
    label: "career:231010",
    shape: "image_only",
    reason: "primary_action_url 회귀 확인",
  },
  {
    sourceId: "general",
    externalId: "230921",
    label: "general:230921",
    shape: "mixed",
    reason: "채용/초빙형 facts 대표값 회귀 확인",
  },
  {
    sourceId: "general",
    externalId: "230945",
    label: "general:230945",
    shape: "image_only",
    reason: "action_required / notice_kind 회귀 확인",
  },
  {
    sourceId: "scholarship",
    externalId: "230100",
    label: "scholarship:230100",
    shape: "mixed",
    reason: "benefit_kind / deadline / action channel 회귀 확인",
  },
  {
    sourceId: "event",
    externalId: "230718",
    label: "event:230718",
    shape: "mixed",
    reason: "유일한 event source 회귀 확인",
  },
] as const;

export type NoticeNormalizationEvalDatasetName =
  | "tuning"
  | "holdout"
  | "validation_v2"
  | "regression";

export function getNoticeNormalizationEvalDataset(
  datasetName: NoticeNormalizationEvalDatasetName,
): readonly NoticeNormalizationEvalSample[] {
  switch (datasetName) {
    case "tuning":
      return NOTICE_NORMALIZATION_TUNING_SET;
    case "holdout":
      return NOTICE_NORMALIZATION_HOLDOUT_SET;
    case "validation_v2":
      return NOTICE_NORMALIZATION_VALIDATION_V2_SET;
    case "regression":
      return NOTICE_NORMALIZATION_REGRESSION_SET;
  }
}
