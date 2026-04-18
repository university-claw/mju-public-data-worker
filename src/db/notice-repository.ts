import type { Pool, PoolClient } from "pg";
import type {
  NoticeAssetImage,
  NoticeAssetProcessingUpdate,
  NoticeAttachmentExtractionUpdate,
  NoticeImageOcrUpdate,
  NoticeAttachment,
  NoticeDetail,
  NoticeReadModel,
  NoticeReadModelJsonValue,
  NoticeReadModelNormalizationStatus,
  NoticeReadModelUpsertInput,
  NoticeSource,
  StoredNoticeAttachment,
  StoredNoticeImage,
} from "../notices/types.js";

export interface NoticeUpsertInput extends NoticeDetail {
  sourceId: string;
  listUrl: string;
  fetchedAt: string;
}

export interface NoticeUpsertResult {
  noticeItemId: number;
  wasInserted: boolean;
  obsoleteStorageKeys: string[];
}

type NoticeQueryExecutor = Pick<Pool, "query">;

export class NoticeRepository {
  constructor(
    private readonly pool: Pool,
    private readonly schema: string,
  ) {}

  async ensureSources(sources: NoticeSource[]): Promise<void> {
    for (const source of sources) {
      await this.pool.query(
        `
          INSERT INTO ${this.schema}.notice_sources (
            id,
            name,
            description,
            list_url,
            active,
            updated_at
          )
          VALUES ($1, $2, $3, $4, true, now())
          ON CONFLICT (id) DO UPDATE
          SET
            name = EXCLUDED.name,
            description = EXCLUDED.description,
            list_url = EXCLUDED.list_url,
            active = true,
            updated_at = now()
        `,
        [source.id, source.name, source.description, source.listUrl],
      );
    }
  }

  async createScrapeRun(workerName: string, triggerReason: string): Promise<number> {
    const result = await this.pool.query<{ id: number }>(
      `
        INSERT INTO ${this.schema}.scrape_runs (
          worker_name,
          trigger_reason,
          status,
          started_at
        )
        VALUES ($1, $2, 'running', now())
        RETURNING id
      `,
      [workerName, triggerReason],
    );

    return Number(result.rows[0]!.id);
  }

  async finishScrapeRun(
    scrapeRunId: number,
    status: "success" | "failed",
    totalScrapedCount: number,
    totalProcessedCount: number,
    totalInsertedCount: number,
    totalUpdatedCount: number,
    totalAttachmentExtractionSucceededCount: number,
    totalAttachmentExtractionUnsupportedCount: number,
    totalAttachmentExtractionFailedCount: number,
    totalNoticeImageOcrSucceededCount: number,
    totalNoticeImageOcrUnsupportedCount: number,
    totalNoticeImageOcrFailedCount: number,
    errorMessage?: string,
  ): Promise<void> {
    await this.pool.query(
      `
        UPDATE ${this.schema}.scrape_runs
        SET
          status = $2,
          finished_at = now(),
          total_scraped_count = $3,
          total_upserted_count = $4,
          total_processed_count = $4,
          total_inserted_count = $5,
          total_updated_count = $6,
          total_attachment_extraction_succeeded_count = $7,
          total_attachment_extraction_unsupported_count = $8,
          total_attachment_extraction_failed_count = $9,
          total_notice_image_ocr_succeeded_count = $10,
          total_notice_image_ocr_unsupported_count = $11,
          total_notice_image_ocr_failed_count = $12,
          error_message = $13
        WHERE id = $1
      `,
      [
        scrapeRunId,
        status,
        totalScrapedCount,
        totalProcessedCount,
        totalInsertedCount,
        totalUpdatedCount,
        totalAttachmentExtractionSucceededCount,
        totalAttachmentExtractionUnsupportedCount,
        totalAttachmentExtractionFailedCount,
        totalNoticeImageOcrSucceededCount,
        totalNoticeImageOcrUnsupportedCount,
        totalNoticeImageOcrFailedCount,
        errorMessage ?? null,
      ],
    );
  }

  async recordSourceRun(params: {
    scrapeRunId: number;
    sourceId: string;
    status: "success" | "failed";
    scrapedCount: number;
    processedCount: number;
    insertedCount: number;
    updatedCount: number;
    attachmentExtractionSucceededCount: number;
    attachmentExtractionUnsupportedCount: number;
    attachmentExtractionFailedCount: number;
    noticeImageOcrSucceededCount: number;
    noticeImageOcrUnsupportedCount: number;
    noticeImageOcrFailedCount: number;
    startedAt: string;
    errorMessage?: string;
  }): Promise<void> {
    await this.pool.query(
      `
        INSERT INTO ${this.schema}.scrape_run_sources (
          scrape_run_id,
          source_id,
          status,
          started_at,
          finished_at,
          scraped_count,
          upserted_count,
          processed_count,
          inserted_count,
          updated_count,
          attachment_extraction_succeeded_count,
          attachment_extraction_unsupported_count,
          attachment_extraction_failed_count,
          notice_image_ocr_succeeded_count,
          notice_image_ocr_unsupported_count,
          notice_image_ocr_failed_count,
          error_message
        )
        VALUES ($1, $2, $3, $4, now(), $5, $6, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
      `,
      [
        params.scrapeRunId,
        params.sourceId,
        params.status,
        params.startedAt,
        params.scrapedCount,
        params.processedCount,
        params.insertedCount,
        params.updatedCount,
        params.attachmentExtractionSucceededCount,
        params.attachmentExtractionUnsupportedCount,
        params.attachmentExtractionFailedCount,
        params.noticeImageOcrSucceededCount,
        params.noticeImageOcrUnsupportedCount,
        params.noticeImageOcrFailedCount,
        params.errorMessage ?? null,
      ],
    );
  }

  async upsertNotice(input: NoticeUpsertInput): Promise<NoticeUpsertResult> {
    const client = await this.pool.connect();

    try {
      await client.query("BEGIN");
      const upsertResult = await this.upsertNoticeRow(client, input);
      const obsoleteAttachmentKeys = await this.syncAttachments(
        client,
        upsertResult.noticeItemId,
        input.attachments,
      );
      const obsoleteImageKeys = await this.syncImages(
        client,
        upsertResult.noticeItemId,
        input.images,
      );
      await client.query("COMMIT");
      return {
        ...upsertResult,
        obsoleteStorageKeys: [
          ...obsoleteAttachmentKeys,
          ...obsoleteImageKeys,
        ],
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async updateAttachmentProcessing(
    noticeItemId: number,
    downloadUrl: string,
    update: NoticeAssetProcessingUpdate,
  ): Promise<void> {
    await this.pool.query(
      `
        UPDATE ${this.schema}.notice_attachments
        SET
          storage_provider = $3,
          storage_key = $4,
          content_type = $5,
          size_bytes = $6,
          sha256 = $7,
          downloaded_at = $8,
          download_status = $9,
          error_message = $10,
          updated_at = now()
        WHERE notice_item_id = $1
          AND download_url = $2
      `,
      [
        noticeItemId,
        downloadUrl,
        update.storageProvider ?? null,
        update.storageKey ?? null,
        update.contentType ?? null,
        update.sizeBytes ?? null,
        update.sha256 ?? null,
        update.downloadedAt ?? null,
        update.downloadStatus,
        update.errorMessage ?? null,
      ],
    );
  }

  async updateImageProcessing(
    noticeItemId: number,
    imageUrl: string,
    update: NoticeAssetProcessingUpdate,
  ): Promise<void> {
    await this.pool.query(
      `
        UPDATE ${this.schema}.notice_images
        SET
          storage_provider = COALESCE($3, storage_provider),
          storage_key = COALESCE($4, storage_key),
          content_type = COALESCE($5, content_type),
          size_bytes = COALESCE($6, size_bytes),
          sha256 = COALESCE($7, sha256),
          downloaded_at = COALESCE($8, downloaded_at),
          download_status = $9,
          error_message = $10,
          updated_at = now()
        WHERE notice_item_id = $1
          AND image_url = $2
      `,
      [
        noticeItemId,
        imageUrl,
        update.storageProvider ?? null,
        update.storageKey ?? null,
        update.contentType ?? null,
        update.sizeBytes ?? null,
        update.sha256 ?? null,
        update.downloadedAt ?? null,
        update.downloadStatus,
        update.errorMessage ?? null,
      ],
    );
  }

  async listStoredAttachmentsForNotice(
    noticeItemId: number,
  ): Promise<StoredNoticeAttachment[]> {
    const result = await this.pool.query<{
      id: number;
      file_name: string;
      download_url: string;
      storage_key: string | null;
      content_type: string | null;
      sha256: string | null;
      download_status: "pending" | "succeeded" | "failed";
      existing_extraction_status: "pending" | "succeeded" | "failed" | "unsupported" | null;
      existing_attachment_sha256: string | null;
    }>(
      `
        SELECT
          na.id,
          na.file_name,
          na.download_url,
          na.storage_key,
          na.content_type,
          na.sha256,
          na.download_status,
          nae.extraction_status AS existing_extraction_status,
          nae.attachment_sha256 AS existing_attachment_sha256
        FROM ${this.schema}.notice_attachments na
        LEFT JOIN ${this.schema}.notice_attachment_extractions nae
          ON nae.attachment_id = na.id
        WHERE na.notice_item_id = $1
        ORDER BY na.sort_order ASC
      `,
      [noticeItemId],
    );

    return result.rows.map((row) => ({
      id: Number(row.id),
      fileName: row.file_name,
      downloadUrl: row.download_url,
      storageKey: row.storage_key,
      contentType: row.content_type,
      sha256: row.sha256,
      downloadStatus: row.download_status,
      existingExtractionStatus: row.existing_extraction_status,
      existingAttachmentSha256: row.existing_attachment_sha256,
    }));
  }

  async upsertAttachmentExtraction(
    attachmentId: number,
    update: NoticeAttachmentExtractionUpdate,
  ): Promise<void> {
    await this.pool.query(
      `
        INSERT INTO ${this.schema}.notice_attachment_extractions (
          attachment_id,
          attachment_sha256,
          extractor_type,
          extraction_status,
          extracted_text,
          text_sha256,
          extracted_char_count,
          extracted_at,
          error_message
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT (attachment_id) DO UPDATE
        SET
          attachment_sha256 = EXCLUDED.attachment_sha256,
          extractor_type = EXCLUDED.extractor_type,
          extraction_status = EXCLUDED.extraction_status,
          extracted_text = EXCLUDED.extracted_text,
          text_sha256 = EXCLUDED.text_sha256,
          extracted_char_count = EXCLUDED.extracted_char_count,
          extracted_at = EXCLUDED.extracted_at,
          error_message = EXCLUDED.error_message,
          updated_at = now()
      `,
      [
        attachmentId,
        update.attachmentSha256 ?? null,
        update.extractorType ?? null,
        update.extractionStatus,
        update.extractedText ?? null,
        update.textSha256 ?? null,
        update.extractedCharCount ?? null,
        update.extractedAt ?? null,
        update.errorMessage ?? null,
      ],
    );
  }

  async listStoredImagesForNotice(
    noticeItemId: number,
  ): Promise<StoredNoticeImage[]> {
    const result = await this.pool.query<{
      id: number;
      image_url: string;
      alt_text: string | null;
      storage_key: string | null;
      content_type: string | null;
      sha256: string | null;
      download_status: "pending" | "succeeded" | "failed";
      existing_ocr_status: "pending" | "succeeded" | "failed" | "unsupported" | null;
      existing_image_sha256: string | null;
      existing_ocr_language: string | null;
    }>(
      `
        SELECT
          ni.id,
          ni.image_url,
          ni.alt_text,
          ni.storage_key,
          ni.content_type,
          ni.sha256,
          ni.download_status,
          nior.ocr_status AS existing_ocr_status,
          nior.image_sha256 AS existing_image_sha256,
          nior.ocr_language AS existing_ocr_language
        FROM ${this.schema}.notice_images ni
        LEFT JOIN ${this.schema}.notice_image_ocr_results nior
          ON nior.image_id = ni.id
        WHERE ni.notice_item_id = $1
        ORDER BY ni.sort_order ASC
      `,
      [noticeItemId],
    );

    return result.rows.map((row) => ({
      id: Number(row.id),
      imageUrl: row.image_url,
      altText: row.alt_text,
      storageKey: row.storage_key,
      contentType: row.content_type,
      sha256: row.sha256,
      downloadStatus: row.download_status,
      existingOcrStatus: row.existing_ocr_status,
      existingImageSha256: row.existing_image_sha256,
      existingOcrLanguage: row.existing_ocr_language,
    }));
  }

  async upsertImageOcr(
    imageId: number,
    update: NoticeImageOcrUpdate,
  ): Promise<void> {
    await this.pool.query(
      `
        INSERT INTO ${this.schema}.notice_image_ocr_results (
          image_id,
          image_sha256,
          ocr_status,
          ocr_text,
          text_sha256,
          ocr_confidence,
          ocr_language,
          ocr_extracted_at,
          error_message
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT (image_id) DO UPDATE
        SET
          image_sha256 = EXCLUDED.image_sha256,
          ocr_status = EXCLUDED.ocr_status,
          ocr_text = EXCLUDED.ocr_text,
          text_sha256 = EXCLUDED.text_sha256,
          ocr_confidence = EXCLUDED.ocr_confidence,
          ocr_language = EXCLUDED.ocr_language,
          ocr_extracted_at = EXCLUDED.ocr_extracted_at,
          error_message = EXCLUDED.error_message,
          updated_at = now()
      `,
      [
        imageId,
        update.imageSha256 ?? null,
        update.ocrStatus,
        update.ocrText ?? null,
        update.textSha256 ?? null,
        update.ocrConfidence ?? null,
        update.ocrLanguage ?? null,
        update.ocrExtractedAt ?? null,
        update.errorMessage ?? null,
      ],
    );
  }

  async upsertReadModel(input: NoticeReadModelUpsertInput): Promise<void> {
    await this.upsertReadModelWithExecutor(this.pool, input);
  }

  async upsertReadModelWithClient(
    client: PoolClient,
    input: NoticeReadModelUpsertInput,
  ): Promise<void> {
    await this.upsertReadModelWithExecutor(client, input);
  }

  private async upsertReadModelWithExecutor(
    executor: NoticeQueryExecutor,
    input: NoticeReadModelUpsertInput,
  ): Promise<void> {
    const detailsJsonb = input.detailsJsonb === null
      ? null
      : JSON.stringify(input.detailsJsonb);
    const result = await executor.query<{ id: number }>(
      `
        INSERT INTO ${this.schema}.notice_read_models (
          notice_item_id,
          source_id,
          external_id,
          notice_kind,
          issuer_name,
          issuer_scope,
          target_campuses,
          target_audiences,
          target_program_levels,
          target_departments,
          target_grade_years,
          primary_time_kind,
          primary_start_at,
          primary_end_at,
          primary_deadline_at,
          has_deadline,
          action_required,
          action_kind,
          primary_action_channel,
          primary_action_url,
          primary_location,
          participation_mode,
          has_benefit,
          benefit_kind,
          benefit_amount_krw,
          selection_count,
          summary,
          details_jsonb,
          normalized_confidence,
          normalized_at,
          normalization_status,
          normalization_error_message,
          updated_at
        )
        SELECT
          ni.id,
          ni.source_id,
          ni.external_id,
          $2,
          $3,
          $4,
          $5::text[],
          $6::text[],
          $7::text[],
          $8::text[],
          $9::integer[],
          $10,
          $11,
          $12,
          $13,
          $14,
          $15,
          $16,
          $17,
          $18,
          $19,
          $20,
          $21,
          $22,
          $23,
          $24,
          $25,
          $26::jsonb,
          $27,
          $28,
          $29,
          $30,
          now()
        FROM ${this.schema}.notice_items ni
        WHERE ni.id = $1
        ON CONFLICT (notice_item_id) DO UPDATE
        SET
          source_id = EXCLUDED.source_id,
          external_id = EXCLUDED.external_id,
          notice_kind = EXCLUDED.notice_kind,
          issuer_name = EXCLUDED.issuer_name,
          issuer_scope = EXCLUDED.issuer_scope,
          target_campuses = EXCLUDED.target_campuses,
          target_audiences = EXCLUDED.target_audiences,
          target_program_levels = EXCLUDED.target_program_levels,
          target_departments = EXCLUDED.target_departments,
          target_grade_years = EXCLUDED.target_grade_years,
          primary_time_kind = EXCLUDED.primary_time_kind,
          primary_start_at = EXCLUDED.primary_start_at,
          primary_end_at = EXCLUDED.primary_end_at,
          primary_deadline_at = EXCLUDED.primary_deadline_at,
          has_deadline = EXCLUDED.has_deadline,
          action_required = EXCLUDED.action_required,
          action_kind = EXCLUDED.action_kind,
          primary_action_channel = EXCLUDED.primary_action_channel,
          primary_action_url = EXCLUDED.primary_action_url,
          primary_location = EXCLUDED.primary_location,
          participation_mode = EXCLUDED.participation_mode,
          has_benefit = EXCLUDED.has_benefit,
          benefit_kind = EXCLUDED.benefit_kind,
          benefit_amount_krw = EXCLUDED.benefit_amount_krw,
          selection_count = EXCLUDED.selection_count,
          summary = EXCLUDED.summary,
          details_jsonb = EXCLUDED.details_jsonb,
          normalized_confidence = EXCLUDED.normalized_confidence,
          normalized_at = EXCLUDED.normalized_at,
          normalization_status = EXCLUDED.normalization_status,
          normalization_error_message = EXCLUDED.normalization_error_message,
          updated_at = now()
        RETURNING id
      `,
      [
        input.noticeItemId,
        input.noticeKind ?? null,
        input.issuerName ?? null,
        input.issuerScope ?? null,
        [...input.targetCampuses],
        [...input.targetAudiences],
        [...input.targetProgramLevels],
        [...input.targetDepartments],
        [...input.targetGradeYears],
        input.primaryTimeKind ?? null,
        input.primaryStartAt ?? null,
        input.primaryEndAt ?? null,
        input.primaryDeadlineAt ?? null,
        input.hasDeadline,
        input.actionRequired,
        input.actionKind ?? null,
        input.primaryActionChannel ?? null,
        input.primaryActionUrl ?? null,
        input.primaryLocation ?? null,
        input.participationMode ?? null,
        input.hasBenefit,
        input.benefitKind ?? null,
        input.benefitAmountKrw ?? null,
        input.selectionCount ?? null,
        input.summary ?? null,
        detailsJsonb,
        input.normalizedConfidence,
        input.normalizedAt,
        input.normalizationStatus,
        input.normalizationErrorMessage ?? null,
      ],
    );

    if (!result.rows[0]) {
      throw new Error(
        `notice item ${input.noticeItemId} was not found for read model upsert`,
      );
    }
  }

  async getReadModelByNoticeItemId(
    noticeItemId: number,
  ): Promise<NoticeReadModel | null> {
    const result = await this.pool.query<{
      id: number;
      notice_item_id: number;
      source_id: string;
      external_id: string;
      notice_kind: string | null;
      issuer_name: string | null;
      issuer_scope: string | null;
      target_campuses: string[] | null;
      target_audiences: string[] | null;
      target_program_levels: string[] | null;
      target_departments: string[] | null;
      target_grade_years: Array<number | string> | null;
      primary_time_kind: string | null;
      primary_start_at: string | null;
      primary_end_at: string | null;
      primary_deadline_at: string | null;
      has_deadline: boolean;
      action_required: boolean;
      action_kind: string | null;
      primary_action_channel: string | null;
      primary_action_url: string | null;
      primary_location: string | null;
      participation_mode: string | null;
      has_benefit: boolean;
      benefit_kind: string | null;
      benefit_amount_krw: number | null;
      selection_count: number | null;
      summary: string | null;
      details_jsonb: NoticeReadModelJsonValue | null;
      normalized_confidence: number;
      normalized_at: string;
      normalization_status: NoticeReadModelNormalizationStatus;
      normalization_error_message: string | null;
      created_at: string;
      updated_at: string;
    }>(
      `
        SELECT
          id,
          notice_item_id,
          source_id,
          external_id,
          notice_kind,
          issuer_name,
          issuer_scope,
          target_campuses,
          target_audiences,
          target_program_levels,
          target_departments,
          target_grade_years,
          primary_time_kind,
          primary_start_at::text,
          primary_end_at::text,
          primary_deadline_at::text,
          has_deadline,
          action_required,
          action_kind,
          primary_action_channel,
          primary_action_url,
          primary_location,
          participation_mode,
          has_benefit,
          benefit_kind,
          benefit_amount_krw,
          selection_count,
          summary,
          details_jsonb,
          normalized_confidence,
          normalized_at::text,
          normalization_status,
          normalization_error_message,
          created_at::text,
          updated_at::text
        FROM ${this.schema}.notice_read_models
        WHERE notice_item_id = $1
      `,
      [noticeItemId],
    );

    const row = result.rows[0];
    if (!row) {
      return null;
    }

    return {
      id: Number(row.id),
      noticeItemId: Number(row.notice_item_id),
      sourceId: row.source_id,
      externalId: row.external_id,
      noticeKind:
        row.notice_kind as Exclude<NoticeReadModel["noticeKind"], undefined>,
      issuerName: row.issuer_name,
      issuerScope:
        row.issuer_scope as Exclude<NoticeReadModel["issuerScope"], undefined>,
      targetCampuses: row.target_campuses ?? [],
      targetAudiences: row.target_audiences ?? [],
      targetProgramLevels: row.target_program_levels ?? [],
      targetDepartments: row.target_departments ?? [],
      targetGradeYears: (row.target_grade_years ?? []).map((value) =>
        Number(value)
      ),
      primaryTimeKind:
        row.primary_time_kind as Exclude<
          NoticeReadModel["primaryTimeKind"],
          undefined
        >,
      primaryStartAt: row.primary_start_at,
      primaryEndAt: row.primary_end_at,
      primaryDeadlineAt: row.primary_deadline_at,
      hasDeadline: row.has_deadline,
      actionRequired: row.action_required,
      actionKind:
        row.action_kind as Exclude<NoticeReadModel["actionKind"], undefined>,
      primaryActionChannel:
        row.primary_action_channel as Exclude<
          NoticeReadModel["primaryActionChannel"],
          undefined
        >,
      primaryActionUrl: row.primary_action_url,
      primaryLocation: row.primary_location,
      participationMode:
        row.participation_mode as Exclude<
          NoticeReadModel["participationMode"],
          undefined
        >,
      hasBenefit: row.has_benefit,
      benefitKind:
        row.benefit_kind as Exclude<NoticeReadModel["benefitKind"], undefined>,
      benefitAmountKrw: row.benefit_amount_krw,
      selectionCount: row.selection_count,
      summary: row.summary,
      detailsJsonb: row.details_jsonb,
      normalizedConfidence: row.normalized_confidence,
      normalizedAt: row.normalized_at,
      normalizationStatus: row.normalization_status,
      normalizationErrorMessage: row.normalization_error_message,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private async upsertNoticeRow(
    client: PoolClient,
    input: NoticeUpsertInput,
  ): Promise<NoticeUpsertResult> {
    const result = await client.query<{ id: number; inserted: boolean }>(
      `
        INSERT INTO ${this.schema}.notice_items (
          source_id,
          external_id,
          title,
          category_label,
          detail_url,
          list_url,
          author,
          published_at,
          published_at_raw,
          body_html,
          body_text,
          content_hash,
          attachments_count,
          images_count,
          first_seen_at,
          last_seen_at,
          last_scraped_at,
          status,
          updated_at
        )
        VALUES (
          $1,
          $2,
          $3,
          $4,
          $5,
          $6,
          $7,
          $8,
          $9,
          $10,
          $11,
          $12,
          $13,
          $14,
          $15,
          $15,
          $15,
          'active',
          now()
        )
        ON CONFLICT (source_id, external_id) DO UPDATE
        SET
          title = EXCLUDED.title,
          category_label = EXCLUDED.category_label,
          detail_url = EXCLUDED.detail_url,
          list_url = EXCLUDED.list_url,
          author = EXCLUDED.author,
          published_at = EXCLUDED.published_at,
          published_at_raw = EXCLUDED.published_at_raw,
          body_html = EXCLUDED.body_html,
          body_text = EXCLUDED.body_text,
          content_hash = EXCLUDED.content_hash,
          attachments_count = EXCLUDED.attachments_count,
          images_count = EXCLUDED.images_count,
          last_seen_at = EXCLUDED.last_seen_at,
          last_scraped_at = EXCLUDED.last_scraped_at,
          status = 'active',
          updated_at = now()
        RETURNING id, (xmax = 0) AS inserted
      `,
      [
        input.sourceId,
        input.externalId,
        input.title,
        input.categoryLabel ?? null,
        input.detailUrl,
        input.listUrl,
        input.author ?? null,
        input.publishedAt,
        input.publishedAtRaw,
        input.bodyHtml,
        input.bodyText,
        input.contentHash,
        input.attachments.length,
        input.images.length,
        input.fetchedAt,
      ],
    );

    return {
      noticeItemId: Number(result.rows[0]!.id),
      wasInserted: result.rows[0]!.inserted,
      obsoleteStorageKeys: [],
    };
  }

  private async syncAttachments(
    client: PoolClient,
    noticeItemId: number,
    attachments: NoticeAttachment[],
  ): Promise<string[]> {
    const currentUrls = attachments.map((attachment) => attachment.downloadUrl);
    const deletedRows = currentUrls.length
      ? await client.query<{ storage_key: string | null }>(
          `
            DELETE FROM ${this.schema}.notice_attachments
            WHERE notice_item_id = $1
              AND NOT (download_url = ANY($2::text[]))
            RETURNING storage_key
          `,
          [noticeItemId, currentUrls],
        )
      : await client.query<{ storage_key: string | null }>(
          `
            DELETE FROM ${this.schema}.notice_attachments
            WHERE notice_item_id = $1
            RETURNING storage_key
          `,
          [noticeItemId],
        );

    for (const attachment of attachments) {
      await client.query(
        `
          INSERT INTO ${this.schema}.notice_attachments (
            notice_item_id,
            file_name,
            download_url,
            sort_order
          )
          VALUES ($1, $2, $3, $4)
          ON CONFLICT (notice_item_id, download_url) DO UPDATE
          SET
            file_name = EXCLUDED.file_name,
            sort_order = EXCLUDED.sort_order,
            updated_at = now()
        `,
        [
          noticeItemId,
          attachment.fileName,
          attachment.downloadUrl,
          attachment.sortOrder,
        ],
      );
    }

    return deletedRows.rows
      .map((row) => row.storage_key)
      .filter((storageKey): storageKey is string => Boolean(storageKey));
  }

  private async syncImages(
    client: PoolClient,
    noticeItemId: number,
    images: NoticeAssetImage[],
  ): Promise<string[]> {
    const currentUrls = images.map((image) => image.imageUrl);
    const deletedRows = currentUrls.length
      ? await client.query<{ storage_key: string | null }>(
          `
            DELETE FROM ${this.schema}.notice_images
            WHERE notice_item_id = $1
              AND NOT (image_url = ANY($2::text[]))
            RETURNING storage_key
          `,
          [noticeItemId, currentUrls],
        )
      : await client.query<{ storage_key: string | null }>(
          `
            DELETE FROM ${this.schema}.notice_images
            WHERE notice_item_id = $1
            RETURNING storage_key
          `,
          [noticeItemId],
        );

    for (const image of images) {
      await client.query(
        `
          INSERT INTO ${this.schema}.notice_images (
            notice_item_id,
            image_url,
            alt_text,
            sort_order
          )
          VALUES ($1, $2, $3, $4)
          ON CONFLICT (notice_item_id, image_url) DO UPDATE
          SET
            alt_text = EXCLUDED.alt_text,
            sort_order = EXCLUDED.sort_order,
            updated_at = now()
        `,
        [
          noticeItemId,
          image.imageUrl,
          image.altText ?? null,
          image.sortOrder,
        ],
      );
    }

    return deletedRows.rows
      .map((row) => row.storage_key)
      .filter((storageKey): storageKey is string => Boolean(storageKey));
  }
}
