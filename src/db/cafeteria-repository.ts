import type { Pool, PoolClient } from "pg";
import type {
  CafeteriaOfficialMenuDocumentInput,
  CafeteriaOfficialMenuDocumentStatus,
  CafeteriaOfficialMenuEntryInput,
  CafeteriaOfficialPageSource,
  CafeteriaMenuNormalizationContext,
  CafeteriaMenuNormalizationResult,
  CafeteriaMenuDocumentStructureResult,
  CafeteriaInstagramProcessingUpdate,
  CafeteriaInstagramPost,
  CafeteriaInstagramPostSnapshot,
  CafeteriaInstagramSource,
  CafeteriaInstagramUpsertResult,
  CafeteriaPostClassificationResult,
  CafeteriaResolvedMenuEntryInput,
} from "../cafeterias/types.js";

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

  async ensureOfficialPageSources(
    sources: CafeteriaOfficialPageSource[],
  ): Promise<void> {
    for (const source of sources) {
      await this.pool.query(
        `
          INSERT INTO ${this.schema}.cafeteria_official_page_sources (
            source_id,
            page_key,
            page_url,
            view_action_path,
            name,
            active,
            updated_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, now())
          ON CONFLICT (source_id) DO UPDATE
          SET
            page_key = EXCLUDED.page_key,
            page_url = EXCLUDED.page_url,
            view_action_path = EXCLUDED.view_action_path,
            name = EXCLUDED.name,
            active = EXCLUDED.active,
            updated_at = now()
        `,
        [
          source.sourceId,
          source.pageKey,
          source.pageUrl,
          source.viewActionPath,
          source.name,
          source.active ?? true,
        ],
      );
    }
  }

  async getOfficialMenuDocumentSummary(
    sourceId: string,
    weekStartDate: string,
  ): Promise<{
    sourceDocumentId: number;
    status: CafeteriaOfficialMenuDocumentStatus;
  } | null> {
    const result = await this.pool.query<{
      id: number;
      status: CafeteriaOfficialMenuDocumentStatus;
    }>(
      `
        SELECT id, status
        FROM ${this.schema}.cafeteria_official_menu_documents
        WHERE source_id = $1
          AND week_start_date = $2
      `,
      [sourceId, weekStartDate],
    );

    const row = result.rows[0];
    if (!row) {
      return null;
    }

    return {
      sourceDocumentId: Number(row.id),
      status: row.status,
    };
  }

  async listInstagramMenuEntryCandidates(
    sourceId: string,
    startDate: string,
    endDate: string,
  ): Promise<
    Array<{
      entryId: number;
      sourceId: string;
      serviceDate: string;
      mealType: "breakfast" | "lunch" | "dinner";
      isClosed: boolean;
      menuText: string;
      menuItems: string[];
    }>
  > {
    const result = await this.pool.query<{
      entry_id: number;
      source_id: string;
      service_date: string;
      meal_type: "breakfast" | "lunch" | "dinner";
      is_closed: boolean;
      menu_text: string;
      menu_items: unknown;
    }>(
      `
        SELECT DISTINCT ON (entry.service_date, entry.meal_type)
          entry.id AS entry_id,
          entry.source_id,
          entry.service_date::text,
          entry.meal_type,
          entry.is_closed,
          entry.menu_text,
          entry.menu_items
        FROM ${this.schema}.cafeteria_menu_entries AS entry
        INNER JOIN ${this.schema}.cafeteria_menu_documents AS document
          ON document.id = entry.source_document_id
        WHERE entry.source_id = $1
          AND entry.service_date BETWEEN $2::date AND $3::date
        ORDER BY
          entry.service_date,
          entry.meal_type,
          COALESCE(document.normalized_at, document.updated_at, document.created_at) DESC,
          entry.id DESC
      `,
      [sourceId, startDate, endDate],
    );

    return result.rows.map((row) => ({
      entryId: Number(row.entry_id),
      sourceId: row.source_id,
      serviceDate: row.service_date,
      mealType: row.meal_type,
      isClosed: row.is_closed,
      menuText: row.menu_text,
      menuItems: normalizeJsonStringArray(row.menu_items),
    }));
  }

  async listOfficialMenuEntryCandidates(
    sourceId: string,
    startDate: string,
    endDate: string,
  ): Promise<
    Array<{
      entryId: number;
      sourceId: string;
      serviceDate: string;
      mealType: "breakfast" | "lunch" | "dinner";
      isClosed: boolean;
      menuText: string;
      menuItems: string[];
    }>
  > {
    const result = await this.pool.query<{
      entry_id: number;
      source_id: string;
      service_date: string;
      meal_type: "breakfast" | "lunch" | "dinner";
      is_closed: boolean;
      menu_text: string;
      menu_items: unknown;
    }>(
      `
        SELECT DISTINCT ON (entry.service_date, entry.meal_type)
          entry.id AS entry_id,
          entry.source_id,
          entry.service_date::text,
          entry.meal_type,
          entry.is_closed,
          entry.menu_text,
          entry.menu_items
        FROM ${this.schema}.cafeteria_official_menu_entries AS entry
        INNER JOIN ${this.schema}.cafeteria_official_menu_documents AS document
          ON document.id = entry.source_document_id
        WHERE entry.source_id = $1
          AND entry.service_date BETWEEN $2::date AND $3::date
        ORDER BY
          entry.service_date,
          entry.meal_type,
          COALESCE(document.normalized_at, document.fetched_at, document.updated_at, document.created_at) DESC,
          entry.id DESC
      `,
      [sourceId, startDate, endDate],
    );

    return result.rows.map((row) => ({
      entryId: Number(row.entry_id),
      sourceId: row.source_id,
      serviceDate: row.service_date,
      mealType: row.meal_type,
      isClosed: row.is_closed,
      menuText: row.menu_text,
      menuItems: normalizeJsonStringArray(row.menu_items),
    }));
  }

  async listResolvedMenuEntryKeys(
    sourceId: string,
    startDate: string,
    endDate: string,
  ): Promise<Array<{ serviceDate: string; mealType: "breakfast" | "lunch" | "dinner" }>> {
    const result = await this.pool.query<{
      service_date: string;
      meal_type: "breakfast" | "lunch" | "dinner";
    }>(
      `
        SELECT service_date::text, meal_type
        FROM ${this.schema}.cafeteria_resolved_menu_entries
        WHERE source_id = $1
          AND service_date BETWEEN $2::date AND $3::date
        ORDER BY service_date, meal_type
      `,
      [sourceId, startDate, endDate],
    );

    return result.rows.map((row) => ({
      serviceDate: row.service_date,
      mealType: row.meal_type,
    }));
  }

  async deleteResolvedMenuEntry(
    sourceId: string,
    serviceDate: string,
    mealType: "breakfast" | "lunch" | "dinner",
  ): Promise<void> {
    await this.pool.query(
      `
        DELETE FROM ${this.schema}.cafeteria_resolved_menu_entries
        WHERE source_id = $1
          AND service_date = $2
          AND meal_type = $3
      `,
      [sourceId, serviceDate, mealType],
    );
  }

  async syncResolvedMenuEntriesForDateRange(params: {
    sourceId: string;
    startDate: string;
    endDate: string;
    entries: CafeteriaResolvedMenuEntryInput[];
  }): Promise<{ upsertedCount: number; deletedCount: number }> {
    const client = await this.pool.connect();

    try {
      await client.query("BEGIN");
      const existingKeysResult = await client.query<{
        service_date: string;
        meal_type: "breakfast" | "lunch" | "dinner";
      }>(
        `
          SELECT service_date::text, meal_type
          FROM ${this.schema}.cafeteria_resolved_menu_entries
          WHERE source_id = $1
            AND service_date BETWEEN $2::date AND $3::date
        `,
        [params.sourceId, params.startDate, params.endDate],
      );
      const winnerKeys = new Set(
        params.entries.map((entry) => `${entry.serviceDate}:${entry.mealType}`),
      );
      let deletedCount = 0;

      for (const row of existingKeysResult.rows) {
        const entryKey = `${row.service_date}:${row.meal_type}`;
        if (winnerKeys.has(entryKey)) {
          continue;
        }

        await client.query(
          `
            DELETE FROM ${this.schema}.cafeteria_resolved_menu_entries
            WHERE source_id = $1
              AND service_date = $2
              AND meal_type = $3
          `,
          [params.sourceId, row.service_date, row.meal_type],
        );
        deletedCount += 1;
      }

      for (const entry of params.entries) {
        await this.upsertResolvedMenuEntryWithClient(client, entry);
      }

      await client.query("COMMIT");
      return {
        upsertedCount: params.entries.length,
        deletedCount,
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async upsertOfficialMenuDocument(
    input: CafeteriaOfficialMenuDocumentInput,
  ): Promise<number> {
    return this.upsertOfficialMenuDocumentWithClient(this.pool, input);
  }

  async syncOfficialMenuDocument(params: {
    document: CafeteriaOfficialMenuDocumentInput;
    entries: CafeteriaOfficialMenuEntryInput[];
    normalizationMethod?: string;
  }): Promise<{ sourceDocumentId: number; storedEntryCount: number }> {
    const client = await this.pool.connect();

    try {
      await client.query("BEGIN");
      const sourceDocumentId = await this.upsertOfficialMenuDocumentWithClient(
        client,
        params.document,
      );
      const replaceParams: Parameters<
        typeof this.replaceOfficialMenuEntriesWithClient
      >[1] = {
        sourceDocumentId,
        sourceId: params.document.sourceId,
        entries: params.entries,
        ...(params.normalizationMethod
          ? { normalizationMethod: params.normalizationMethod }
          : {}),
      };
      await this.replaceOfficialMenuEntriesWithClient(client, replaceParams);
      await client.query("COMMIT");

      return {
        sourceDocumentId,
        storedEntryCount: params.entries.length,
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  private async upsertOfficialMenuDocumentWithClient(
    client: Pick<Pool, "query"> | PoolClient,
    input: CafeteriaOfficialMenuDocumentInput,
  ): Promise<number> {
    const result = await client.query<{ id: number }>(
      `
        INSERT INTO ${this.schema}.cafeteria_official_menu_documents (
          source_id,
          week_start_date,
          raw_html,
          content_hash,
          fetched_at,
          status,
          error_message,
          document_scope,
          service_start_date,
          service_end_date,
          breakfast_available,
          lunch_available,
          dinner_available,
          normalized_at,
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
          now()
        )
        ON CONFLICT (source_id, week_start_date) DO UPDATE
        SET
          raw_html = EXCLUDED.raw_html,
          content_hash = EXCLUDED.content_hash,
          fetched_at = EXCLUDED.fetched_at,
          status = EXCLUDED.status,
          error_message = EXCLUDED.error_message,
          document_scope = EXCLUDED.document_scope,
          service_start_date = EXCLUDED.service_start_date,
          service_end_date = EXCLUDED.service_end_date,
          breakfast_available = EXCLUDED.breakfast_available,
          lunch_available = EXCLUDED.lunch_available,
          dinner_available = EXCLUDED.dinner_available,
          normalized_at = EXCLUDED.normalized_at,
          updated_at = now()
        RETURNING id
      `,
      [
        input.sourceId,
        input.weekStartDate,
        input.rawHtml,
        input.contentHash,
        input.fetchedAt,
        input.status,
        input.errorMessage ?? null,
        input.documentScope,
        input.serviceStartDate ?? null,
        input.serviceEndDate ?? null,
        input.breakfastAvailable,
        input.lunchAvailable,
        input.dinnerAvailable,
        input.normalizedAt ?? null,
      ],
    );

    return Number(result.rows[0]!.id);
  }

  async deleteOfficialMenuDocument(sourceDocumentId: number): Promise<void> {
    await this.pool.query(
      `
        DELETE FROM ${this.schema}.cafeteria_official_menu_documents
        WHERE id = $1
      `,
      [sourceDocumentId],
    );
  }

  async replaceOfficialMenuEntries(params: {
    sourceDocumentId: number;
    sourceId: string;
    entries: CafeteriaOfficialMenuEntryInput[];
    normalizationMethod?: string;
  }): Promise<void> {
    const client = await this.pool.connect();

    try {
      await client.query("BEGIN");
      await this.replaceOfficialMenuEntriesWithClient(client, params);

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  private async replaceOfficialMenuEntriesWithClient(
    client: PoolClient,
    params: {
      sourceDocumentId: number;
      sourceId: string;
      entries: CafeteriaOfficialMenuEntryInput[];
      normalizationMethod?: string;
    },
  ): Promise<void> {
    const documentResult = await client.query<{
      source_id: string;
      week_start_date: string;
      document_scope: string;
      service_start_date: string | null;
      service_end_date: string | null;
    }>(
      `
        SELECT
          source_id,
          week_start_date::text,
          document_scope,
          service_start_date::text,
          service_end_date::text
        FROM ${this.schema}.cafeteria_official_menu_documents
        WHERE id = $1
      `,
      [params.sourceDocumentId],
    );

    if (documentResult.rowCount === 0) {
      throw new Error(
        `official menu document ${params.sourceDocumentId} does not exist`,
      );
    }

    if (documentResult.rows[0]!.source_id !== params.sourceId) {
      throw new Error(
        `official menu document ${params.sourceDocumentId} does not belong to source ${params.sourceId}`,
      );
    }

    const incomingKeys = new Set(
      params.entries.map((entry) => `${entry.serviceDate}:${entry.mealType}`),
    );
    const existingResolvedKeysResult = await client.query<{
      service_date: string;
      meal_type: string;
    }>(
      `
        SELECT resolved.service_date::text, resolved.meal_type
        FROM ${this.schema}.cafeteria_resolved_menu_entries AS resolved
        WHERE resolved.source_id = $1
          AND resolved.selected_source_kind = 'official_page'
          AND resolved.service_date BETWEEN $2::date AND ($2::date + INTERVAL '6 days')::date
          AND (
            $3 = 'unknown'
            OR (
              $3 = 'weekday'
              AND EXTRACT(ISODOW FROM resolved.service_date) BETWEEN 1 AND 5
            )
            OR (
              $3 = 'weekend'
              AND EXTRACT(ISODOW FROM resolved.service_date) IN (6, 7)
            )
          )
      `,
      [
        params.sourceId,
        documentResult.rows[0]!.week_start_date,
        documentResult.rows[0]!.document_scope,
      ],
    );

    for (const row of existingResolvedKeysResult.rows) {
      const entryKey = `${row.service_date}:${row.meal_type}`;
      if (incomingKeys.has(entryKey)) {
        continue;
      }

      await client.query(
        `
          DELETE FROM ${this.schema}.cafeteria_resolved_menu_entries
          WHERE source_id = $1
            AND service_date = $2
            AND meal_type = $3
            AND selected_source_kind = 'official_page'
        `,
        [params.sourceId, row.service_date, row.meal_type],
      );
    }

    await client.query(
      `
        DELETE FROM ${this.schema}.cafeteria_official_menu_entries
        WHERE source_document_id = $1
      `,
      [params.sourceDocumentId],
    );

    for (const entry of params.entries) {
      await client.query<{ id: number }>(
        `
          INSERT INTO ${this.schema}.cafeteria_official_menu_entries (
            source_document_id,
            source_id,
            service_date,
            meal_type,
            is_closed,
            menu_text,
            menu_items,
            parse_confidence,
            normalization_method,
            updated_at
          )
          VALUES (
            $1,
            $2,
            $3,
            $4,
            $5,
            $6,
            $7::jsonb,
            $8,
            $9,
            now()
          )
          RETURNING id
        `,
        [
          params.sourceDocumentId,
          params.sourceId,
          entry.serviceDate,
          entry.mealType,
          entry.isClosed,
          entry.menuText,
          JSON.stringify(entry.menuItems),
          entry.confidence ?? null,
          params.normalizationMethod ?? "html_table",
        ],
      );

      await client.query(
        `
          UPDATE ${this.schema}.cafeteria_resolved_menu_entries
          SET
            is_closed = $1,
            menu_text = $2,
            menu_items = $3::jsonb,
            updated_at = now()
          WHERE source_id = $4
            AND service_date = $5
            AND meal_type = $6
            AND selected_source_kind = 'official_page'
        `,
        [
          entry.isClosed,
          entry.menuText,
          JSON.stringify(entry.menuItems),
          params.sourceId,
          entry.serviceDate,
          entry.mealType,
        ],
      );
    }
  }

  async upsertResolvedMenuEntry(
    input: CafeteriaResolvedMenuEntryInput,
  ): Promise<void> {
    await this.upsertResolvedMenuEntryWithClient(this.pool, input);
  }

  private async upsertResolvedMenuEntryWithClient(
    client: Pick<Pool, "query"> | PoolClient,
    input: CafeteriaResolvedMenuEntryInput,
  ): Promise<void> {
    await client.query(
      `
        INSERT INTO ${this.schema}.cafeteria_resolved_menu_entries (
          source_id,
          service_date,
          meal_type,
          selected_source_kind,
          is_closed,
          menu_text,
          menu_items,
          selected_at,
          updated_at
        )
        VALUES (
          $1,
          $2,
          $3,
          $4,
          $5,
          $6,
          $7::jsonb,
          coalesce($8, now()),
          now()
        )
        ON CONFLICT (source_id, service_date, meal_type) DO UPDATE
        SET
          selected_source_kind = EXCLUDED.selected_source_kind,
          is_closed = EXCLUDED.is_closed,
          menu_text = EXCLUDED.menu_text,
          menu_items = EXCLUDED.menu_items,
          selected_at = EXCLUDED.selected_at,
          updated_at = now()
      `,
      [
        input.sourceId,
        input.serviceDate,
        input.mealType,
        input.selectedSourceKind,
        input.isClosed,
        input.menuText,
        JSON.stringify(input.menuItems),
        input.selectedAt ?? null,
      ],
    );
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
    const result = await this.pool.query<{
      id: number;
      inserted: boolean;
      image_storage_provider: string | null;
      image_storage_key: string | null;
      image_sha256: string | null;
      image_perceptual_hash: string | null;
      ocr_status: string | null;
    }>(
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
        RETURNING
          id,
          (xmax = 0) AS inserted,
          image_storage_provider,
          image_storage_key,
          image_sha256,
          image_perceptual_hash,
          ocr_status
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
      imageStorageProvider: result.rows[0]!.image_storage_provider,
      imageStorageKey: result.rows[0]!.image_storage_key,
      imageSha256: result.rows[0]!.image_sha256,
      imagePerceptualHash: result.rows[0]!.image_perceptual_hash,
      ocrStatus:
        (result.rows[0]!.ocr_status as CafeteriaInstagramUpsertResult["ocrStatus"]) ??
        null,
    };
  }

  async updateInstagramPostProcessing(
    postId: number,
    update: CafeteriaInstagramProcessingUpdate,
  ): Promise<void> {
    const assignments: string[] = [];
    const values: Array<string | number | null> = [postId];
    let parameterIndex = 2;

    const appendAssignment = (
      columnName: string,
      value: string | number | null,
    ) => {
      assignments.push(`${columnName} = $${parameterIndex}`);
      values.push(value);
      parameterIndex += 1;
    };

    if ("imageStorageProvider" in update) {
      appendAssignment("image_storage_provider", update.imageStorageProvider ?? null);
    }
    if ("imageStorageKey" in update) {
      appendAssignment("image_storage_key", update.imageStorageKey ?? null);
    }
    if ("imageContentType" in update) {
      appendAssignment("image_content_type", update.imageContentType ?? null);
    }
    if ("imageSizeBytes" in update) {
      appendAssignment("image_size_bytes", update.imageSizeBytes ?? null);
    }
    if ("imageSha256" in update) {
      appendAssignment("image_sha256", update.imageSha256 ?? null);
    }
    if ("imagePerceptualHash" in update) {
      appendAssignment("image_perceptual_hash", update.imagePerceptualHash ?? null);
    }
    if ("imageDownloadedAt" in update) {
      appendAssignment("image_downloaded_at", update.imageDownloadedAt ?? null);
    }

    appendAssignment("ocr_status", update.ocrStatus);

    if ("ocrText" in update) {
      appendAssignment("ocr_text", update.ocrText ?? null);
    }
    if ("ocrConfidence" in update) {
      appendAssignment("ocr_confidence", update.ocrConfidence ?? null);
    }
    if ("ocrLanguage" in update) {
      appendAssignment("ocr_language", update.ocrLanguage ?? null);
    }
    if ("ocrExtractedAt" in update) {
      appendAssignment("ocr_extracted_at", update.ocrExtractedAt ?? null);
    }
    if ("ocrErrorMessage" in update) {
      appendAssignment("ocr_error_message", update.ocrErrorMessage ?? null);
    }

    await this.pool.query(
      `
        UPDATE ${this.schema}.cafeteria_instagram_posts
        SET
          ${assignments.join(",\n          ")},
          updated_at = now()
        WHERE id = $1
      `,
      values,
    );
  }

  async getInstagramPostSnapshot(
    postId: number,
  ): Promise<CafeteriaInstagramPostSnapshot> {
    const result = await this.pool.query<{
      id: number;
      source_id: string;
      posted_at: string;
      caption: string | null;
      ocr_text: string | null;
      image_perceptual_hash: string | null;
    }>(
      `
        SELECT
          id,
          source_id,
          posted_at,
          caption,
          ocr_text,
          image_perceptual_hash
        FROM ${this.schema}.cafeteria_instagram_posts
        WHERE id = $1
      `,
      [postId],
    );

    const row = result.rows[0];
    if (!row) {
      throw new Error(`cafeteria instagram post not found: ${postId}`);
    }

    return {
      id: Number(row.id),
      sourceId: row.source_id,
      postedAt: row.posted_at,
      caption: row.caption,
      ocrText: row.ocr_text,
      imagePerceptualHash: row.image_perceptual_hash,
    };
  }

  async listMenuSheetReferenceHashes(
    menuImageGroup: string,
    excludePostId?: number,
  ): Promise<string[]> {
    const values: Array<string | number> = [menuImageGroup];
    let excludeClause = "";

    if (excludePostId) {
      values.push(excludePostId);
      excludeClause = "AND p.id <> $2";
    }

    const result = await this.pool.query<{
      image_perceptual_hash: string;
    }>(
      `
        SELECT DISTINCT p.image_perceptual_hash
        FROM ${this.schema}.cafeteria_instagram_posts p
        INNER JOIN ${this.schema}.cafeteria_instagram_sources s
          ON s.id = p.source_id
        INNER JOIN ${this.schema}.cafeteria_menu_documents d
          ON d.source_post_id = p.id
        WHERE s.menu_image_group = $1
          AND p.post_kind = 'menu_sheet'
          AND p.image_perceptual_hash IS NOT NULL
          AND p.ocr_status = 'succeeded'
          AND coalesce(p.post_kind_score, 0) >= 8
          AND d.service_start_date IS NOT NULL
          ${excludeClause}
      `,
      values,
    );

    return result.rows.map((row) => row.image_perceptual_hash);
  }

  async listExistingInstagramPostCodes(
    sourceId: string,
    postCodes: string[],
  ): Promise<string[]> {
    if (postCodes.length === 0) {
      return [];
    }

    const result = await this.pool.query<{
      instagram_post_code: string;
    }>(
      `
        SELECT instagram_post_code
        FROM ${this.schema}.cafeteria_instagram_posts
        WHERE source_id = $1
          AND instagram_post_code = ANY($2::text[])
      `,
      [sourceId, postCodes],
    );

    return result.rows.map((row) => row.instagram_post_code);
  }

  async syncInstagramPostClassification(
    postId: number,
    classification: CafeteriaPostClassificationResult,
    documentStructure?: CafeteriaMenuDocumentStructureResult,
  ): Promise<void> {
    if (classification.postKind === "menu_sheet" && !documentStructure) {
      throw new Error(
        "menu_sheet classification requires structured menu document metadata",
      );
    }

    const client = await this.pool.connect();

    try {
      await client.query("BEGIN");
      await client.query(
        `
          UPDATE ${this.schema}.cafeteria_instagram_posts
          SET
            post_kind = $2,
            post_kind_confidence = $3,
            post_kind_score = $4,
            post_kind_reason = $5,
            post_kind_signals = $6,
            classified_at = now(),
            updated_at = now()
          WHERE id = $1
        `,
        [
          postId,
          classification.postKind,
          classification.confidence,
          classification.score,
          classification.reason,
          classification.signals,
        ],
      );

      if (classification.postKind === "menu_sheet") {
        await client.query(
          `
            INSERT INTO ${this.schema}.cafeteria_menu_documents (
              source_post_id,
              source_id,
              document_type,
              detection_method,
              document_scope,
              scope_confidence,
              scope_reason,
              service_start_date,
              service_end_date,
              breakfast_available,
              lunch_available,
              dinner_available,
              structured_at,
              updated_at
            )
            SELECT
              id,
              source_id,
              'menu_sheet',
              'rule_based',
              $2,
              $3,
              $4,
              $5,
              $6,
              $7,
              $8,
              $9,
              now(),
              now()
            FROM ${this.schema}.cafeteria_instagram_posts
            WHERE id = $1
            ON CONFLICT (source_post_id) DO UPDATE
            SET
              source_id = EXCLUDED.source_id,
              document_type = EXCLUDED.document_type,
              detection_method = EXCLUDED.detection_method,
              normalization_status = 'pending',
              normalization_confidence = null,
              normalization_reason = null,
              normalization_error_message = null,
              document_scope = EXCLUDED.document_scope,
              scope_confidence = EXCLUDED.scope_confidence,
              scope_reason = EXCLUDED.scope_reason,
              service_start_date = EXCLUDED.service_start_date,
              service_end_date = EXCLUDED.service_end_date,
              breakfast_available = EXCLUDED.breakfast_available,
              lunch_available = EXCLUDED.lunch_available,
              dinner_available = EXCLUDED.dinner_available,
              structured_at = EXCLUDED.structured_at,
              updated_at = now()
          `,
          [
            postId,
            documentStructure?.documentScope ?? "unknown",
            documentStructure?.scopeConfidence ?? null,
            documentStructure?.scopeReason ?? null,
            documentStructure?.serviceStartDate ?? null,
            documentStructure?.serviceEndDate ?? null,
            documentStructure?.breakfastAvailable ?? false,
            documentStructure?.lunchAvailable ?? false,
            documentStructure?.dinnerAvailable ?? false,
          ],
        );
      } else if (shouldDeleteExistingMenuDocument(classification)) {
        await client.query(
          `
            DELETE FROM ${this.schema}.cafeteria_menu_documents
            WHERE source_post_id = $1
          `,
          [postId],
        );
      }

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async getMenuNormalizationContext(
    postId: number,
  ): Promise<CafeteriaMenuNormalizationContext> {
    const result = await this.pool.query<{
      source_document_id: number;
      source_post_id: number;
      source_id: string;
      source_name: string;
      source_description: string;
      profile_url: string;
      instagram_username: string;
      menu_image_group: string;
      supports_weekend_menu: boolean;
      image_storage_key: string | null;
      document_scope: "weekday" | "weekend" | "unknown";
      service_start_date: string | null;
      service_end_date: string | null;
      breakfast_available: boolean;
      lunch_available: boolean;
      dinner_available: boolean;
    }>(
      `
        SELECT
          d.id AS source_document_id,
          p.id AS source_post_id,
          s.id AS source_id,
          s.name AS source_name,
          s.description AS source_description,
          s.profile_url,
          s.instagram_username,
          s.menu_image_group,
          s.supports_weekend_menu,
          p.image_storage_key,
          d.document_scope,
          d.service_start_date::text,
          d.service_end_date::text,
          d.breakfast_available,
          d.lunch_available,
          d.dinner_available
        FROM ${this.schema}.cafeteria_menu_documents d
        INNER JOIN ${this.schema}.cafeteria_instagram_posts p
          ON p.id = d.source_post_id
        INNER JOIN ${this.schema}.cafeteria_instagram_sources s
          ON s.id = d.source_id
        WHERE p.id = $1
      `,
      [postId],
    );

    const row = result.rows[0];
    if (!row) {
      throw new Error(`cafeteria menu document not found for source post: ${postId}`);
    }

    if (!row.image_storage_key) {
      throw new Error(
        `cafeteria menu document is missing image_storage_key for source post: ${postId}`,
      );
    }

    return {
      sourceDocumentId: Number(row.source_document_id),
      sourcePostId: Number(row.source_post_id),
      source: {
        id: row.source_id,
        name: row.source_name,
        description: row.source_description,
        profileUrl: row.profile_url,
        instagramUsername: row.instagram_username,
        menuImageGroup: row.menu_image_group,
        supportsWeekendMenu: row.supports_weekend_menu,
      },
      imageStorageKey: row.image_storage_key,
      documentScope: row.document_scope,
      serviceStartDate: row.service_start_date,
      serviceEndDate: row.service_end_date,
      breakfastAvailable: row.breakfast_available,
      lunchAvailable: row.lunch_available,
      dinnerAvailable: row.dinner_available,
    };
  }

  async getExistingMenuDocumentRangeForSourcePost(
    postId: number,
  ): Promise<{
    sourceId: string;
    serviceStartDate: string | null;
    serviceEndDate: string | null;
  } | null> {
    const result = await this.pool.query<{
      source_id: string;
      service_start_date: string | null;
      service_end_date: string | null;
    }>(
      `
        SELECT
          document.source_id,
          COALESCE(
            document.service_start_date::text,
            MIN(entry.service_date)::text
          ) AS service_start_date,
          COALESCE(
            document.service_end_date::text,
            MAX(entry.service_date)::text
          ) AS service_end_date
        FROM ${this.schema}.cafeteria_menu_documents AS document
        LEFT JOIN ${this.schema}.cafeteria_menu_entries AS entry
          ON entry.source_document_id = document.id
        WHERE document.source_post_id = $1
        GROUP BY
          document.id,
          document.source_id,
          document.service_start_date,
          document.service_end_date
      `,
      [postId],
    );

    const row = result.rows[0];
    if (!row) {
      return null;
    }

    return {
      sourceId: row.source_id,
      serviceStartDate: row.service_start_date,
      serviceEndDate: row.service_end_date,
    };
  }

  async syncMenuNormalization(
    context: CafeteriaMenuNormalizationContext,
    result: CafeteriaMenuNormalizationResult,
  ): Promise<void> {
    const client = await this.pool.connect();

    try {
      await client.query("BEGIN");
      const existingResult = await client.query<{
        count: number;
      }>(
        `
          SELECT count(*)::int AS count
          FROM ${this.schema}.cafeteria_menu_entries
          WHERE source_document_id = $1
        `,
        [context.sourceDocumentId],
      );
      const existingEntryCount = Number(existingResult.rows[0]?.count ?? 0);
      const shouldReplaceEntries =
        result.status === "succeeded" ||
        (result.status === "partial" && existingEntryCount === 0);
      const activeEntryCount = shouldReplaceEntries
        ? result.entries.length
        : existingEntryCount;
      const normalizedReason =
        shouldReplaceEntries || existingEntryCount === 0
          ? result.reason
          : `${result.reason} (preserved ${existingEntryCount} existing entries)`;

      await client.query(
        `
          UPDATE ${this.schema}.cafeteria_menu_documents
          SET
            normalization_status = $2,
            normalization_confidence = $3,
            normalization_reason = $4,
            normalized_entry_count = $5,
            normalized_at = now(),
            normalization_error_message = $6,
            updated_at = now()
          WHERE id = $1
        `,
        [
          context.sourceDocumentId,
          result.status,
          result.confidence,
          normalizedReason,
          activeEntryCount,
          result.errorMessage ?? null,
        ],
      );

      if (shouldReplaceEntries) {
        const incomingKeys = new Set(
          result.entries.map((entry) => `${entry.serviceDate}:${entry.mealType}`),
        );
        const affectedStartDate =
          context.serviceStartDate ?? result.entries[0]?.serviceDate ?? null;
        const affectedEndDate =
          context.serviceEndDate
          ?? result.entries[result.entries.length - 1]?.serviceDate
          ?? affectedStartDate;

        if (affectedStartDate && affectedEndDate) {
          const existingResolvedKeysResult = await client.query<{
            service_date: string;
            meal_type: string;
          }>(
            `
              SELECT resolved.service_date::text, resolved.meal_type
              FROM ${this.schema}.cafeteria_resolved_menu_entries AS resolved
              WHERE resolved.source_id = $1
                AND resolved.selected_source_kind = 'instagram_ocr'
                AND resolved.service_date BETWEEN $3::date AND $4::date
                AND (
                  $2 = 'unknown'
                  OR (
                    $2 = 'weekday'
                    AND EXTRACT(ISODOW FROM resolved.service_date) BETWEEN 1 AND 5
                  )
                  OR (
                    $2 = 'weekend'
                    AND EXTRACT(ISODOW FROM resolved.service_date) IN (6, 7)
                  )
                )
            `,
            [
              context.source.id,
              context.documentScope,
              affectedStartDate,
              affectedEndDate,
            ],
          );

          for (const row of existingResolvedKeysResult.rows) {
            const entryKey = `${row.service_date}:${row.meal_type}`;
            if (incomingKeys.has(entryKey)) {
              continue;
            }

            await client.query(
              `
                DELETE FROM ${this.schema}.cafeteria_resolved_menu_entries
                WHERE source_id = $1
                  AND service_date = $2
                  AND meal_type = $3
                  AND selected_source_kind = 'instagram_ocr'
              `,
              [context.source.id, row.service_date, row.meal_type],
            );
          }
        } else {
          const existingDocumentKeysResult = await client.query<{
            service_date: string;
            meal_type: string;
          }>(
            `
              SELECT service_date::text, meal_type
              FROM ${this.schema}.cafeteria_menu_entries
              WHERE source_document_id = $1
            `,
            [context.sourceDocumentId],
          );

          for (const row of existingDocumentKeysResult.rows) {
            await client.query(
              `
                DELETE FROM ${this.schema}.cafeteria_resolved_menu_entries
                WHERE source_id = $1
                  AND service_date = $2
                  AND meal_type = $3
                  AND selected_source_kind = 'instagram_ocr'
              `,
              [context.source.id, row.service_date, row.meal_type],
            );
          }
        }

        await client.query(
          `
            DELETE FROM ${this.schema}.cafeteria_menu_entries
            WHERE source_document_id = $1
          `,
          [context.sourceDocumentId],
        );

        for (const entry of result.entries) {
          await client.query<{ id: number }>(
            `
              INSERT INTO ${this.schema}.cafeteria_menu_entries (
                source_document_id,
                source_post_id,
                source_id,
                service_date,
                meal_type,
                is_closed,
                menu_text,
                menu_items,
                normalization_confidence,
                normalization_method,
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
                $8::jsonb,
                $9,
                'cell_ocr',
                now()
              )
              RETURNING id
            `,
            [
              context.sourceDocumentId,
              context.sourcePostId,
              context.source.id,
              entry.serviceDate,
              entry.mealType,
              entry.isClosed,
              entry.menuText,
              JSON.stringify(entry.menuItems),
              entry.confidence,
            ],
          );

          await client.query(
            `
              UPDATE ${this.schema}.cafeteria_resolved_menu_entries
              SET
                is_closed = $1,
                menu_text = $2,
                menu_items = $3::jsonb,
                updated_at = now()
              WHERE source_id = $4
                AND service_date = $5
                AND meal_type = $6
                AND selected_source_kind = 'instagram_ocr'
            `,
            [
              entry.isClosed,
              entry.menuText,
              JSON.stringify(entry.menuItems),
              context.source.id,
              entry.serviceDate,
              entry.mealType,
            ],
          );
        }
      }

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}

function shouldDeleteExistingMenuDocument(
  classification: CafeteriaPostClassificationResult,
): boolean {
  /**
   * 이번 감지기는 "식단표가 아닌 것 같다"와 "확실히 식단표가 아니다"를 모두
   * ignored로 모은다. 그래서 애매한 ignored 한 번만으로 기존 menu document를
   * 지워버리면 OCR 흔들림에 너무 취약해진다. 강한 ignored 신호가 명시적으로
   * 잡힌 경우에만 기존 문서를 제거하고, 그 외 ignored는 보류 상태로 둔다.
   */
  return (
    classification.postKind === "ignored" &&
    classification.score <= 0 &&
    classification.signals.some((signal) => signal.startsWith("ignored-hint("))
  );
}

function normalizeJsonStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}
