import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { loadConfig } from "../../src/config/env.js";
import { createPool } from "../../src/db/client.js";
import { runMigrations } from "../../src/db/migrator.js";
import { CafeteriaRepository } from "../../src/db/cafeteria-repository.js";

describe("cafeteria repository integration", () => {
  let pool: Pool;
  let schema: string;
  let repository: CafeteriaRepository;

  beforeAll(async () => {
    const config = loadConfig();
    schema = config.pgSchema;
    pool = createPool(config);
    repository = new CafeteriaRepository(pool, schema);
    await runMigrations(pool, schema);
  });

  afterAll(async () => {
    await pool.end();
  });

  it("stores official page provenance rows and resolved selection rows against postgres", async () => {
    const sourceId = `test_cafeteria_source_${Date.now()}`;

    await repository.ensureInstagramSources([
      {
        id: sourceId,
        name: "테스트 식당",
        description: "integration test cafeteria source",
        profileUrl: "https://www.instagram.com/test_cafeteria_source/",
        instagramUsername: "test_cafeteria_source",
        menuImageGroup: "test-cafeteria-group",
        supportsWeekendMenu: false,
      },
    ]);

    try {
      await repository.ensureOfficialPageSources([
        {
          sourceId,
          pageKey: `mjukr-test-${Date.now()}`,
          pageUrl: "https://mjedu.mju.ac.kr/mjukr/999/subview.do",
          viewActionPath: "/diet/mjukr/999/view.do",
          name: "테스트 공식 페이지",
        },
      ]);

      const documentId = await repository.upsertOfficialMenuDocument({
        sourceId,
        weekStartDate: "2026-04-20",
        rawHtml: "<html><body>integration test cafeteria snapshot</body></html>",
        contentHash: `hash-${Date.now()}`,
        fetchedAt: "2026-04-20T10:00:00+09:00",
        status: "succeeded",
        errorMessage: null,
        documentScope: "weekday",
        serviceStartDate: "2026-04-20",
        serviceEndDate: "2026-04-24",
        breakfastAvailable: true,
        lunchAvailable: true,
        dinnerAvailable: false,
        normalizedAt: "2026-04-20T10:01:00+09:00",
      });

      await repository.replaceOfficialMenuEntries({
        sourceDocumentId: documentId,
        sourceId,
        entries: [
          {
            serviceDate: "2026-04-20",
            mealType: "breakfast",
            isClosed: false,
            menuText: "참치김치볶음밥",
            menuItems: ["참치김치볶음밥"],
            confidence: 0.99,
          },
          {
            serviceDate: "2026-04-20",
            mealType: "lunch",
            isClosed: false,
            menuText: "눈꽃치즈닭갈비덮밥",
            menuItems: ["눈꽃치즈닭갈비덮밥"],
            confidence: 0.98,
          },
        ],
      });

      const officialEntries = await pool.query<{
        id: number;
        source_id: string;
        service_date: string;
        meal_type: string;
        menu_text: string;
      }>(
        `
          SELECT id, source_id, service_date::text, meal_type, menu_text
          FROM ${schema}.cafeteria_official_menu_entries
          WHERE source_id = $1
          ORDER BY service_date, meal_type
        `,
        [sourceId],
      );

      expect(officialEntries.rowCount).toBe(2);
      expect(officialEntries.rows[0]).toMatchObject({
        source_id: sourceId,
        service_date: "2026-04-20",
        meal_type: "breakfast",
        menu_text: "참치김치볶음밥",
      });

      await repository.upsertResolvedMenuEntry({
        sourceId,
        serviceDate: "2026-04-20",
        mealType: "breakfast",
        selectedSourceKind: "official_page",
        isClosed: false,
        menuText: "참치김치볶음밥",
        menuItems: ["참치김치볶음밥"],
        selectedAt: "2026-04-20T10:03:00+09:00",
      });

      const resolved = await pool.query<{
        source_id: string;
        service_date: string;
        meal_type: string;
        selected_source_kind: string;
        menu_text: string;
      }>(
        `
          SELECT
            source_id,
            service_date::text,
            meal_type,
            selected_source_kind,
            menu_text
          FROM ${schema}.cafeteria_resolved_menu_entries
          WHERE source_id = $1
            AND service_date = $2
            AND meal_type = $3
        `,
        [sourceId, "2026-04-20", "breakfast"],
      );

      expect(resolved.rowCount).toBe(1);
      expect(resolved.rows[0]).toMatchObject({
        source_id: sourceId,
        service_date: "2026-04-20",
        meal_type: "breakfast",
        selected_source_kind: "official_page",
        menu_text: "참치김치볶음밥",
      });

      await repository.replaceOfficialMenuEntries({
        sourceDocumentId: documentId,
        sourceId,
        entries: [
          {
            serviceDate: "2026-04-20",
            mealType: "breakfast",
            isClosed: false,
            menuText: "참치김치볶음밥 수정본",
            menuItems: ["참치김치볶음밥 수정본"],
            confidence: 0.99,
          },
          {
            serviceDate: "2026-04-20",
            mealType: "lunch",
            isClosed: false,
            menuText: "눈꽃치즈닭갈비덮밥 수정본",
            menuItems: ["눈꽃치즈닭갈비덮밥 수정본"],
            confidence: 0.98,
          },
        ],
      });

      const refreshedResolved = await pool.query<{ menu_text: string }>(
        `
          SELECT menu_text
          FROM ${schema}.cafeteria_resolved_menu_entries
          WHERE source_id = $1
            AND service_date = $2
            AND meal_type = $3
        `,
        [sourceId, "2026-04-20", "breakfast"],
      );

      expect(refreshedResolved.rowCount).toBe(1);
      expect(refreshedResolved.rows[0]!.menu_text).toBe("참치김치볶음밥 수정본");
    } finally {
      await pool.query(
        `DELETE FROM ${schema}.cafeteria_resolved_menu_entries WHERE source_id = $1`,
        [sourceId],
      );
      await pool.query(
        `DELETE FROM ${schema}.cafeteria_official_page_sources WHERE source_id = $1`,
        [sourceId],
      );
      await pool.query(
        `DELETE FROM ${schema}.cafeteria_instagram_sources WHERE id = $1`,
        [sourceId],
      );
    }
  });

  it("derives an instagram menu document range from normalized entries when document metadata is null", async () => {
    const sourceId = `test_cafeteria_range_${Date.now()}`;

    await repository.ensureInstagramSources([
      {
        id: sourceId,
        name: "테스트 식당 범위",
        description: "integration test cafeteria range source",
        profileUrl: "https://www.instagram.com/test_cafeteria_range/",
        instagramUsername: "test_cafeteria_range",
        menuImageGroup: "test-cafeteria-range-group",
        supportsWeekendMenu: false,
      },
    ]);

    try {
      const postResult = await repository.upsertInstagramPost(
        {
          sourceId,
          postCode: `range-post-${Date.now()}`,
          profileUrl: "https://www.instagram.com/test_cafeteria_range/",
          permalink: "https://www.instagram.com/p/test-cafeteria-range/",
          caption: "테스트 식단표",
          postedAt: "2026-04-12T09:00:00+09:00",
          postedAtEpoch: 1_776_006_000,
          imageUrl: "https://example.com/cafeteria-range.jpg",
          rawItem: { id: "range-post" },
        },
        "2026-04-12T09:05:00+09:00",
      );

      const documentResult = await pool.query<{ id: number }>(
        `
          INSERT INTO ${schema}.cafeteria_menu_documents (
            source_post_id,
            source_id,
            document_type,
            detection_method,
            document_scope,
            service_start_date,
            service_end_date,
            breakfast_available,
            lunch_available,
            dinner_available,
            normalization_status,
            normalized_entry_count,
            normalized_at
          )
          VALUES (
            $1,
            $2,
            'menu_sheet',
            'rule_based',
            'weekday',
            NULL,
            NULL,
            true,
            true,
            false,
            'succeeded',
            2,
            '2026-04-12T09:10:00+09:00'
          )
          RETURNING id
        `,
        [postResult.cafeteriaInstagramPostId, sourceId],
      );
      const sourceDocumentId = Number(documentResult.rows[0]!.id);

      await pool.query(
        `
          INSERT INTO ${schema}.cafeteria_menu_entries (
            source_document_id,
            source_post_id,
            source_id,
            service_date,
            meal_type,
            is_closed,
            menu_text,
            menu_items,
            normalization_confidence,
            normalization_method
          )
          VALUES
            ($1, $2, $3, '2026-04-14', 'breakfast', false, '김치볶음밥', '["김치볶음밥"]'::jsonb, 0.95, 'cell_ocr'),
            ($1, $2, $3, '2026-04-18', 'lunch', false, '닭갈비덮밥', '["닭갈비덮밥"]'::jsonb, 0.94, 'cell_ocr')
        `,
        [sourceDocumentId, postResult.cafeteriaInstagramPostId, sourceId],
      );

      const existingRange = await repository.getExistingMenuDocumentRangeForSourcePost(
        postResult.cafeteriaInstagramPostId,
      );

      expect(existingRange).toEqual({
        sourceId,
        serviceStartDate: "2026-04-14",
        serviceEndDate: "2026-04-18",
      });
    } finally {
      await pool.query(
        `DELETE FROM ${schema}.cafeteria_instagram_posts WHERE source_id = $1`,
        [sourceId],
      );
      await pool.query(
        `DELETE FROM ${schema}.cafeteria_instagram_sources WHERE id = $1`,
        [sourceId],
      );
    }
  });

});
