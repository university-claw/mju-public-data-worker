import type { Pool } from "pg";
import type {
  CafeteriaInstagramPost,
  CafeteriaInstagramSource,
} from "../cafeterias/types.js";

export interface CafeteriaInstagramUpsertResult {
  cafeteriaInstagramPostId: number;
  wasInserted: boolean;
}

export class CafeteriaRepository {
  constructor(
    private readonly pool: Pool,
    private readonly schema: string,
  ) {}

  async ensureInstagramSources(
    sources: CafeteriaInstagramSource[],
  ): Promise<void> {
    for (const source of sources) {
      await this.pool.query(
        `
          INSERT INTO ${this.schema}.cafeteria_instagram_sources (
            id,
            name,
            description,
            profile_url,
            instagram_username,
            menu_image_group,
            supports_weekend_menu,
            active,
            updated_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, true, now())
          ON CONFLICT (id) DO UPDATE
          SET
            name = EXCLUDED.name,
            description = EXCLUDED.description,
            profile_url = EXCLUDED.profile_url,
            instagram_username = EXCLUDED.instagram_username,
            menu_image_group = EXCLUDED.menu_image_group,
            supports_weekend_menu = EXCLUDED.supports_weekend_menu,
            active = true,
            updated_at = now()
        `,
        [
          source.id,
          source.name,
          source.description,
          source.profileUrl,
          source.instagramUsername,
          source.menuImageGroup,
          source.supportsWeekendMenu,
        ],
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

  async recordInstagramSourceRun(params: {
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
        INSERT INTO ${this.schema}.cafeteria_instagram_scrape_run_sources (
          scrape_run_id,
          source_id,
          status,
          started_at,
          finished_at,
          scraped_count,
          processed_count,
          inserted_count,
          updated_count,
          error_message
        )
        VALUES ($1, $2, $3, $4, now(), $5, $6, $7, $8, $9)
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

  /**
   * 1차 학식 슬라이스의 목표는 OCR 전 단계까지의 raw 적재다. 그래서 지금은
   * 게시물 1건을 그대로 upsert해서, 이후 OCR/정규화 슬라이스가 DB의 raw JSON과
   * permalink, imageUrl만 보고도 다시 출발할 수 있게 해 둔다.
   */
  async upsertInstagramPost(
    post: CafeteriaInstagramPost,
    fetchedAt: string,
  ): Promise<CafeteriaInstagramUpsertResult> {
    const result = await this.pool.query<{ id: number; inserted: boolean }>(
      `
        INSERT INTO ${this.schema}.cafeteria_instagram_posts (
          source_id,
          instagram_post_code,
          profile_url,
          permalink,
          caption,
          posted_at,
          posted_at_epoch,
          image_url,
          raw_item_json,
          first_seen_at,
          last_seen_at,
          last_scraped_at,
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
          $10,
          $10,
          now()
        )
        ON CONFLICT (source_id, instagram_post_code) DO UPDATE
        SET
          profile_url = EXCLUDED.profile_url,
          permalink = EXCLUDED.permalink,
          caption = EXCLUDED.caption,
          posted_at = EXCLUDED.posted_at,
          posted_at_epoch = EXCLUDED.posted_at_epoch,
          image_url = EXCLUDED.image_url,
          raw_item_json = EXCLUDED.raw_item_json,
          last_seen_at = EXCLUDED.last_seen_at,
          last_scraped_at = EXCLUDED.last_scraped_at,
          updated_at = now()
        RETURNING id, (xmax = 0) AS inserted
      `,
      [
        post.sourceId,
        post.postCode,
        post.profileUrl,
        post.permalink,
        post.caption ?? null,
        post.postedAt,
        post.postedAtEpoch,
        post.imageUrl ?? null,
        post.rawItem,
        fetchedAt,
      ],
    );

    return {
      cafeteriaInstagramPostId: Number(result.rows[0]!.id),
      wasInserted: result.rows[0]!.inserted,
    };
  }
}
