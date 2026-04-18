import { describe, expect, it } from "vitest";
import {
  NOTICE_DETAILS_JSONB_TOP_LEVEL_KEYS,
  NOTICE_READ_MODEL_ACTION_CHANNELS,
  NOTICE_READ_MODEL_ACTION_KINDS,
  NOTICE_READ_MODEL_BENEFIT_KINDS,
  NOTICE_READ_MODEL_ISSUER_SCOPES,
  NOTICE_READ_MODEL_NOTICE_KINDS,
  NOTICE_READ_MODEL_PARTICIPATION_MODES,
  NOTICE_READ_MODEL_PRIMARY_TIME_KINDS,
} from "../../src/notices/types.js";
import {
  noticeDetailsJsonbStructuredOutputFieldNames,
  noticeDetailsJsonbStructuredSchema,
  noticeNormalizationPipelineManagedFields,
  noticeNormalizationStructuredOutputFieldNames,
  noticeNormalizationStructuredOutputSchema,
  noticeNormalizationStructuredOutputSchemaName,
} from "../../src/notices/normalization-output-schema.js";

describe("notice normalization structured output schema", () => {
  it("uses the expected schema name", () => {
    expect(noticeNormalizationStructuredOutputSchemaName).toBe(
      "notice_normalization_output",
    );
  });

  it("fixes details_jsonb top-level keys to the documented set", () => {
    expect(noticeDetailsJsonbStructuredOutputFieldNames).toEqual(
      [...NOTICE_DETAILS_JSONB_TOP_LEVEL_KEYS],
    );
    expect(noticeDetailsJsonbStructuredSchema).toMatchObject({
      type: "object",
      additionalProperties: false,
    });
  });

  it("keeps only top-level keys fixed while leaving nested sections flexible", () => {
    const properties = noticeDetailsJsonbStructuredSchema.properties as Record<
      string,
      Record<string, unknown>
    >;

    expect(properties.eligibility).toMatchObject({
      type: "object",
      additionalProperties: true,
    });
    expect(properties.required_documents).toMatchObject({
      type: "array",
    });
    expect(properties.resource_links).toMatchObject({
      type: "array",
    });
    expect(properties.extra).toMatchObject({
      type: "object",
      additionalProperties: true,
    });
  });

  it("exposes only model-generated facts and excludes pipeline-managed metadata", () => {
    expect(noticeNormalizationStructuredOutputFieldNames).toEqual([
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
    ]);

    for (const fieldName of noticeNormalizationPipelineManagedFields) {
      expect(noticeNormalizationStructuredOutputFieldNames).not.toContain(
        fieldName,
      );
    }
  });

  it("requires a complete facts payload with nullable fields instead of omitting keys", () => {
    expect(noticeNormalizationStructuredOutputSchema.required).toEqual(
      noticeNormalizationStructuredOutputFieldNames,
    );
    expect(noticeNormalizationStructuredOutputSchema).toMatchObject({
      type: "object",
      additionalProperties: false,
    });
  });

  it("keeps enum-constrained fields aligned with the notice read model domain values", () => {
    const properties = noticeNormalizationStructuredOutputSchema.properties as Record<
      string,
      Record<string, unknown>
    >;

    expect(properties.notice_kind.anyOf).toContainEqual({
      type: "string",
      enum: [...NOTICE_READ_MODEL_NOTICE_KINDS],
    });
    expect(properties.issuer_scope.anyOf).toContainEqual({
      type: "string",
      enum: [...NOTICE_READ_MODEL_ISSUER_SCOPES],
    });
    expect(properties.primary_time_kind.anyOf).toContainEqual({
      type: "string",
      enum: [...NOTICE_READ_MODEL_PRIMARY_TIME_KINDS],
    });
    expect(properties.action_kind.anyOf).toContainEqual({
      type: "string",
      enum: [...NOTICE_READ_MODEL_ACTION_KINDS],
    });
    expect(properties.primary_action_channel.anyOf).toContainEqual({
      type: "string",
      enum: [...NOTICE_READ_MODEL_ACTION_CHANNELS],
    });
    expect(properties.participation_mode.anyOf).toContainEqual({
      type: "string",
      enum: [...NOTICE_READ_MODEL_PARTICIPATION_MODES],
    });
    expect(properties.benefit_kind.anyOf).toContainEqual({
      type: "string",
      enum: [...NOTICE_READ_MODEL_BENEFIT_KINDS],
    });
  });

  it("models details_jsonb as an optional object value rather than a free-form sibling payload", () => {
    const properties = noticeNormalizationStructuredOutputSchema.properties as Record<
      string,
      { anyOf?: unknown[] }
    >;

    expect(properties.details_jsonb.anyOf).toEqual([
      noticeDetailsJsonbStructuredSchema,
      { type: "null" },
    ]);
  });
});
