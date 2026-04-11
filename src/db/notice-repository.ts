import type { Pool, PoolClient } from "pg";
import type {
  NoticeAssetImage,
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
      await this.replaceAttachments(client, upsertResult.noticeItemId, input.attachments);
      await this.replaceImages(client, upsertResult.noticeItemId, input.images);
      await client.query("COMMIT");
      return upsertResult;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
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
    };
  }

  private async replaceAttachments(
    client: PoolClient,
    noticeItemId: number,
    attachments: NoticeAttachment[],
  ): Promise<void> {
    await client.query(
      `DELETE FROM ${this.schema}.notice_attachments WHERE notice_item_id = $1`,
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
        `,
        [
          noticeItemId,
          attachment.fileName,
          attachment.downloadUrl,
          attachment.sortOrder,
        ],
      );
    }
  }

  private async replaceImages(
    client: PoolClient,
    noticeItemId: number,
    images: NoticeAssetImage[],
  ): Promise<void> {
    await client.query(
      `DELETE FROM ${this.schema}.notice_images WHERE notice_item_id = $1`,
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
        `,
        [
          noticeItemId,
          image.imageUrl,
          image.altText ?? null,
          image.sortOrder,
        ],
      );
    }
  }
}
