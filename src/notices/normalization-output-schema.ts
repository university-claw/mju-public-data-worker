import {
  NOTICE_DETAILS_JSONB_TOP_LEVEL_KEYS,
  NOTICE_READ_MODEL_ACTION_CHANNELS,
  NOTICE_READ_MODEL_ACTION_KINDS,
  NOTICE_READ_MODEL_BENEFIT_KINDS,
  NOTICE_READ_MODEL_ISSUER_SCOPES,
  NOTICE_READ_MODEL_NOTICE_KINDS,
  NOTICE_READ_MODEL_PARTICIPATION_MODES,
  NOTICE_READ_MODEL_PRIMARY_TIME_KINDS,
} from "./types.js";

type JsonSchema = Record<string, unknown>;

function nullableStringSchema(description: string): JsonSchema {
  return {
    type: ["string", "null"],
    description,
  };
}

function nullableIntegerSchema(description: string): JsonSchema {
  return {
    type: ["integer", "null"],
    description,
  };
}

function nullableSchema(schema: JsonSchema, description: string): JsonSchema {
  return {
    anyOf: [schema, { type: "null" }],
    description,
  };
}

function nullableEnumSchema(
  values: readonly string[],
  description: string,
): JsonSchema {
  return {
    anyOf: [
      {
        type: "string",
        enum: [...values],
      },
      {
        type: "null",
      },
    ],
    description,
  };
}

function stringArraySchema(description: string): JsonSchema {
  return {
    type: "array",
    items: {
      type: "string",
    },
    description,
  };
}

const detailEntrySchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    title: {
      type: ["string", "null"],
      description: "짧은 소제목 또는 항목명",
    },
    content: {
      type: "string",
      description: "항목의 구체적 설명",
    },
  },
  required: ["title", "content"],
};

const detailEntryArraySchema = (description: string): JsonSchema => ({
  type: "array",
  items: detailEntrySchema,
  description,
});

const resourceLinkSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    label: {
      type: ["string", "null"],
      description: "링크 설명 또는 제목",
    },
    url: {
      type: "string",
      description: "실제 링크 URL",
    },
    purpose: {
      type: ["string", "null"],
      description: "신청, 안내, 매뉴얼, 참고자료 등 링크 용도",
    },
  },
  required: ["label", "url", "purpose"],
};

const resourceLinkArraySchema = (description: string): JsonSchema => ({
  type: "array",
  items: resourceLinkSchema,
  description,
});

const contactItemSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    label: {
      type: ["string", "null"],
      description: "담당 부서 또는 담당자명",
    },
    value: {
      type: "string",
      description: "연락처 값",
    },
    channel: {
      type: ["string", "null"],
      description: "email, phone, website 등 연락 수단 종류",
    },
  },
  required: ["label", "value", "channel"],
};

const contactItemArraySchema = (description: string): JsonSchema => ({
  type: "array",
  items: contactItemSchema,
  description,
});

const stringArraySchemaWithDescription = (description: string): JsonSchema => ({
  type: "array",
  items: {
    type: "string",
  },
  description,
});

export const noticeDetailsJsonbStructuredSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    eligibility: nullableSchema(
      detailEntryArraySchema("세부 자격요건, 우대조건, 제외조건"),
      "세부 자격요건, 우대조건, 제외조건",
    ),
    required_documents: nullableSchema(
      detailEntryArraySchema("제출 서류 상세 목록"),
      "제출 서류 상세 목록",
    ),
    application_process: nullableSchema(
      detailEntryArraySchema("신청/접수/참여/제출 절차와 방법"),
      "신청/접수/참여/제출 절차와 방법",
    ),
    schedule_details: nullableSchema(
      detailEntryArraySchema(
        "대표 시간축 외 추가 일정, 세부 마일스톤, 세션별 일정",
      ),
      "대표 시간축 외 추가 일정, 세부 마일스톤, 세션별 일정",
    ),
    benefit_details: nullableSchema(
      detailEntryArraySchema("대표 금액 외 혜택 상세, 지급 방식/기간/구성"),
      "대표 금액 외 혜택 상세, 지급 방식/기간/구성",
    ),
    selection_details: nullableSchema(
      detailEntryArraySchema(
        "선발 절차, 심사 단계, 평가 기준, 합격 발표 관련 정보",
      ),
      "선발 절차, 심사 단계, 평가 기준, 합격 발표 관련 정보",
    ),
    content_details: nullableSchema(
      detailEntryArraySchema(
        "행사/교육/공모전/채용/운영 변경 등 공지 본체의 세부 내용",
      ),
      "행사/교육/공모전/채용/운영 변경 등 공지 본체의 세부 내용",
    ),
    resource_links: nullableSchema(
      resourceLinkArraySchema("문의처 외 신청/안내/매뉴얼/참고 링크"),
      "문의처 외 신청/안내/매뉴얼/참고 링크",
    ),
    contact: nullableSchema(
      contactItemArraySchema("문의처, 담당자, 연락 방법"),
      "문의처, 담당자, 연락 방법",
    ),
    important_notes: nullableSchema(
      stringArraySchemaWithDescription(
        "유의사항, 참여/수혜 유지 조건, 운영상 주의사항",
      ),
      "유의사항, 참여/수혜 유지 조건, 운영상 주의사항",
    ),
    extra: nullableSchema(
      detailEntryArraySchema("위 key로 깔끔하게 들어가지 않는 중요 상세"),
      "위 key로 깔끔하게 들어가지 않는 중요 상세",
    ),
  },
  required: [
    "eligibility",
    "required_documents",
    "application_process",
    "schedule_details",
    "benefit_details",
    "selection_details",
    "content_details",
    "resource_links",
    "contact",
    "important_notes",
    "extra",
  ],
};

export const noticeNormalizationStructuredOutputSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    notice_kind: nullableEnumSchema(
      NOTICE_READ_MODEL_NOTICE_KINDS,
      "공지 종류의 대표값",
    ),
    issuer_name: nullableStringSchema("공지 발신 주체명"),
    issuer_scope: nullableEnumSchema(
      NOTICE_READ_MODEL_ISSUER_SCOPES,
      "공지 발신 주체 범위",
    ),
    target_campuses: stringArraySchema("대상 캠퍼스 목록"),
    target_audiences: stringArraySchema("대상 집단 목록"),
    target_program_levels: stringArraySchema("대상 과정 목록"),
    target_departments: stringArraySchema("대상 학과/전공 목록"),
    target_grade_years: {
      type: "array",
      items: {
        type: "integer",
      },
      description: "대상 학년 목록",
    },
    primary_time_kind: nullableEnumSchema(
      NOTICE_READ_MODEL_PRIMARY_TIME_KINDS,
      "대표 시간축 종류",
    ),
    primary_start_at: nullableStringSchema("대표 시작 시각"),
    primary_end_at: nullableStringSchema("대표 종료 시각"),
    primary_deadline_at: nullableStringSchema("대표 마감 시각"),
    has_deadline: {
      type: "boolean",
      description: "명시적 마감 존재 여부",
    },
    action_required: {
      type: "boolean",
      description: "사용자 행동 필요 여부",
    },
    action_kind: nullableEnumSchema(
      NOTICE_READ_MODEL_ACTION_KINDS,
      "대표 행동 유형",
    ),
    primary_action_channel: nullableEnumSchema(
      NOTICE_READ_MODEL_ACTION_CHANNELS,
      "대표 행동 채널",
    ),
    primary_action_url: nullableStringSchema("대표 행동 URL"),
    primary_location: nullableStringSchema("대표 장소"),
    participation_mode: nullableEnumSchema(
      NOTICE_READ_MODEL_PARTICIPATION_MODES,
      "참여 방식",
    ),
    has_benefit: {
      type: "boolean",
      description: "혜택 존재 여부",
    },
    benefit_kind: nullableEnumSchema(
      NOTICE_READ_MODEL_BENEFIT_KINDS,
      "대표 혜택 종류",
    ),
    benefit_amount_krw: nullableIntegerSchema("대표 금액(원)"),
    selection_count: nullableIntegerSchema("대표 선발 인원"),
    summary: nullableStringSchema("서비스용 짧은 요약"),
    details_jsonb: {
      anyOf: [
        noticeDetailsJsonbStructuredSchema,
        {
          type: "null",
        },
      ],
      description:
        "normalized facts에 올리지 않은 중요 상세를 담는 JSONB 계층",
    },
  },
  required: [
    "notice_kind",
    "issuer_name",
    "issuer_scope",
    "target_campuses",
    "target_audiences",
    "target_program_levels",
    "target_departments",
    "target_grade_years",
    "primary_time_kind",
    "primary_start_at",
    "primary_end_at",
    "primary_deadline_at",
    "has_deadline",
    "action_required",
    "action_kind",
    "primary_action_channel",
    "primary_action_url",
    "primary_location",
    "participation_mode",
    "has_benefit",
    "benefit_kind",
    "benefit_amount_krw",
    "selection_count",
    "summary",
    "details_jsonb",
  ],
};

export const noticeNormalizationStructuredOutputSchemaName =
  "notice_normalization_output";

export const noticeNormalizationPipelineManagedFields = [
  "notice_item_id",
  "source_id",
  "external_id",
  "normalized_confidence",
  "normalized_at",
  "normalization_status",
  "normalization_error_message",
] as const;

export const noticeNormalizationStructuredOutputFieldNames = Object.keys(
  noticeNormalizationStructuredOutputSchema.properties as Record<string, unknown>,
);

export const noticeDetailsJsonbStructuredOutputFieldNames = [
  ...NOTICE_DETAILS_JSONB_TOP_LEVEL_KEYS,
];
