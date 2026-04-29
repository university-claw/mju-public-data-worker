import type {
  NoticeDetailsJsonb,
  NoticeReadModel,
  NoticeReadModelUpsertInput,
} from "./types.js";
import type { NoticeRepository } from "../db/notice-repository.js";
import {
  runNoticeNormalization,
  type NoticeNormalizationRuntimeResult,
} from "./normalization-runtime.js";

type NoticeNormalizationRunnerRepository = Pick<
  NoticeRepository,
  | "getNormalizationSourceBundle"
  | "getReadModelByNoticeItemId"
  | "upsertReadModel"
  | "updateNoticeNormalizationState"
>;

export interface NoticeNormalizationRunner {
  normalizeNotice(noticeItemId: number): Promise<NoticeNormalizationRunnerResult>;
}

export interface NoticeNormalizationRunnerResult {
  noticeItemId: number;
  status: "succeeded" | "failed" | "skipped";
  normalizedAt: string | null;
  normalizedConfidence: number | null;
  errorMessage?: string;
  persistedFailureState?: boolean;
}

interface CreateNoticeNormalizationRunnerOptions {
  repository: NoticeNormalizationRunnerRepository;
  apiKey?: string;
  model: string;
  maxOutputTokens?: number;
  enabled?: boolean;
  runNormalization?: typeof runNoticeNormalization;
  now?: () => Date;
}

export function createNoticeNormalizationRunner(
  options: CreateNoticeNormalizationRunnerOptions,
): NoticeNormalizationRunner {
  const enabled = options.enabled ?? Boolean(options.apiKey);
  if (enabled && !options.apiKey) {
    throw new Error(
      "createNoticeNormalizationRunner requires apiKey when enabled=true",
    );
  }

  const runNormalization = options.runNormalization ?? runNoticeNormalization;
  const now = options.now ?? (() => new Date());

  return {
    async normalizeNotice(
      noticeItemId: number,
    ): Promise<NoticeNormalizationRunnerResult> {
      if (!enabled || !options.apiKey) {
        return {
          noticeItemId,
          status: "skipped",
          normalizedAt: null,
          normalizedConfidence: null,
        };
      }

      const normalizedAt = now().toISOString();

      try {
        const bundle = await options.repository.getNormalizationSourceBundle(
          noticeItemId,
        );
        const runtimeResult = await runNormalization({
          apiKey: options.apiKey,
          model: options.model,
          bundle,
          ...(options.maxOutputTokens
            ? { maxOutputTokens: options.maxOutputTokens }
            : {}),
        });
        const normalizedConfidence = estimateNormalizedConfidence(
          runtimeResult,
        );
        await options.repository.upsertReadModel(
          buildSucceededReadModelInput({
            noticeItemId,
            runtimeResult,
            normalizedAt,
            normalizedConfidence,
          }),
        );
        await options.repository.updateNoticeNormalizationState({
          noticeItemId,
          status: "succeeded",
          normalizedAt,
          errorMessage: null,
        });

        return {
          noticeItemId,
          status: "succeeded",
          normalizedAt,
          normalizedConfidence,
        };
      } catch (error) {
        const errorMessage = truncateNormalizationError(error);

        try {
          await options.repository.updateNoticeNormalizationState({
            noticeItemId,
            status: "failed",
            normalizedAt,
            errorMessage,
          });
          const persistedFailureState = await persistFailedReadModel({
            repository: options.repository,
            noticeItemId,
            normalizedAt,
            errorMessage,
          });
          return {
            noticeItemId,
            status: "failed",
            normalizedAt,
            normalizedConfidence: null,
            errorMessage,
            persistedFailureState,
          };
        } catch (persistError) {
          const persistMessage = truncateNormalizationError(persistError);
          return {
            noticeItemId,
            status: "failed",
            normalizedAt,
            normalizedConfidence: null,
            errorMessage: `${errorMessage} (failed to persist notice_read_models failure: ${persistMessage})`,
            persistedFailureState: false,
          };
        }
      }
    },
  };
}

function buildSucceededReadModelInput(params: {
  noticeItemId: number;
  runtimeResult: NoticeNormalizationRuntimeResult;
  normalizedAt: string;
  normalizedConfidence: number;
}): NoticeReadModelUpsertInput {
  const output = params.runtimeResult.parsedOutput;

  return {
    noticeItemId: params.noticeItemId,
    noticeKind: output.notice_kind,
    issuerName: normalizeNullableString(output.issuer_name),
    issuerScope: output.issuer_scope,
    targetCampuses: normalizeStringArray(output.target_campuses),
    targetAudiences: normalizeStringArray(output.target_audiences),
    targetProgramLevels: normalizeStringArray(output.target_program_levels),
    targetDepartments: normalizeStringArray(output.target_departments),
    targetGradeYears: normalizeNumberArray(output.target_grade_years),
    primaryTimeKind: output.primary_time_kind,
    primaryStartAt: normalizeNullableString(output.primary_start_at),
    primaryEndAt: normalizeNullableString(output.primary_end_at),
    primaryDeadlineAt: normalizeNullableString(output.primary_deadline_at),
    hasDeadline: output.has_deadline,
    actionRequired: output.action_required,
    actionKind: output.action_kind,
    primaryActionChannel: output.primary_action_channel,
    primaryActionUrl: normalizeNullableString(output.primary_action_url),
    primaryLocation: normalizeNullableString(output.primary_location),
    participationMode: output.participation_mode,
    hasBenefit: output.has_benefit,
    benefitKind: output.benefit_kind,
    benefitAmountKrw: output.benefit_amount_krw,
    selectionCount: output.selection_count,
    summary: normalizeNullableString(output.summary),
    detailsJsonb: output.details_jsonb,
    normalizedConfidence: params.normalizedConfidence,
    normalizedAt: params.normalizedAt,
    normalizationStatus: "succeeded",
    normalizationErrorMessage: null,
  };
}

async function persistFailedReadModel(params: {
  repository: NoticeNormalizationRunnerRepository;
  noticeItemId: number;
  normalizedAt: string;
  errorMessage: string;
}): Promise<boolean> {
  const existing = await params.repository.getReadModelByNoticeItemId(
    params.noticeItemId,
  );
  if (!existing) {
    return false;
  }

  await params.repository.upsertReadModel(
    buildFailedReadModelInput({
      noticeItemId: params.noticeItemId,
      existing,
      normalizedAt: params.normalizedAt,
      errorMessage: params.errorMessage,
    }),
  );
  return true;
}

function buildFailedReadModelInput(params: {
  noticeItemId: number;
  existing: NoticeReadModel;
  normalizedAt: string;
  errorMessage: string;
}): NoticeReadModelUpsertInput {
  return {
    noticeItemId: params.noticeItemId,
    noticeKind: params.existing.noticeKind ?? null,
    issuerName: params.existing.issuerName ?? null,
    issuerScope: params.existing.issuerScope ?? null,
    targetCampuses: [...params.existing.targetCampuses],
    targetAudiences: [...params.existing.targetAudiences],
    targetProgramLevels: [...params.existing.targetProgramLevels],
    targetDepartments: [...params.existing.targetDepartments],
    targetGradeYears: [...params.existing.targetGradeYears],
    primaryTimeKind: params.existing.primaryTimeKind ?? null,
    primaryStartAt: params.existing.primaryStartAt ?? null,
    primaryEndAt: params.existing.primaryEndAt ?? null,
    primaryDeadlineAt: params.existing.primaryDeadlineAt ?? null,
    hasDeadline: params.existing.hasDeadline,
    actionRequired: params.existing.actionRequired,
    actionKind: params.existing.actionKind ?? null,
    primaryActionChannel: params.existing.primaryActionChannel ?? null,
    primaryActionUrl: params.existing.primaryActionUrl ?? null,
    primaryLocation: params.existing.primaryLocation ?? null,
    participationMode: params.existing.participationMode ?? null,
    hasBenefit: params.existing.hasBenefit,
    benefitKind: params.existing.benefitKind ?? null,
    benefitAmountKrw: params.existing.benefitAmountKrw ?? null,
    selectionCount: params.existing.selectionCount ?? null,
    summary: params.existing.summary ?? null,
    detailsJsonb: params.existing.detailsJsonb ?? null,
    normalizedConfidence: params.existing.normalizedConfidence,
    normalizedAt: params.normalizedAt,
    normalizationStatus: "failed",
    normalizationErrorMessage: params.errorMessage,
  };
}

function estimateNormalizedConfidence(
  runtimeResult: NoticeNormalizationRuntimeResult,
): number {
  const bundle = runtimeResult.context;
  const output = runtimeResult.parsedOutput;
  const nonNullDetailSectionCount = output.details_jsonb
    ? Object.values(output.details_jsonb).filter((value) => value !== null).length
    : 0;
  const attachmentTextAvailableCount = bundle.attachments.filter((attachment) =>
    Boolean(attachment.textBlock?.text?.trim())
  ).length;
  const imageTextAvailableCount = bundle.images.filter((image) =>
    Boolean(image.textBlock?.text?.trim())
  ).length;

  let score = 0.35;
  if (bundle.bodyTextBlock.text?.trim()) {
    score += 0.2;
  }
  score += Math.min(0.15, attachmentTextAvailableCount * 0.05);
  score += Math.min(0.1, imageTextAvailableCount * 0.04);
  if (output.notice_kind) {
    score += 0.05;
  }
  if (output.summary) {
    score += 0.05;
  }
  if (output.has_deadline === Boolean(output.primary_deadline_at)) {
    score += 0.05;
  } else {
    score -= 0.08;
  }
  if (
    !output.action_required ||
    output.action_kind !== null ||
    output.primary_action_channel !== null ||
    output.primary_action_url !== null
  ) {
    score += 0.05;
  }
  if (output.primary_action_url) {
    score += 0.03;
  }
  score += Math.min(0.07, nonNullDetailSectionCount * 0.01);
  if (runtimeResult.primaryActionUrlResolution.decision === "cleared_generic_root") {
    score -= 0.03;
  }
  if (
    runtimeResult.primaryActionUrlResolution.decision === "cleared_unrecognized_url"
  ) {
    score -= 0.05;
  }

  return clampRounded(score, 0.1, 0.97);
}

function normalizeNullableString(value: string | null): string | null {
  if (value === null) {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeStringArray(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function normalizeNumberArray(values: readonly number[]): number[] {
  return [...new Set(values.filter((value) => Number.isInteger(value)))].sort(
    (left, right) => left - right,
  );
}

function clampRounded(value: number, min: number, max: number): number {
  return Number(Math.min(max, Math.max(min, value)).toFixed(2));
}

function truncateNormalizationError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return raw.length > 1_000 ? `${raw.slice(0, 997)}...` : raw;
}
