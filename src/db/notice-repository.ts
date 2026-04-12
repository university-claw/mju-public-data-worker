import type { Pool, PoolClient } from "pg";
import type {
  NoticeAssetImage,
  NoticeAssetProcessingUpdate,
  NoticeAttachment,
  NoticeDetail,
  NoticeSource,
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
          error_message = $7
        WHERE id = $1
      `,
      [
        scrapeRunId,
        status,
        totalScrapedCount,
        totalProcessedCount,
        totalInsertedCount,
        totalUpdatedCount,
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
          error_message
        )
        VALUES ($1, $2, $3, $4, now(), $5, $6, $6, $7, $8, $9)
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
