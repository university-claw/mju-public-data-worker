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

      const snapshot = await repository.createOfficialPageSnapshot({
        sourceId,
        weekStartDate: "2026-04-20",
        weekScope: "current",
        snapshotHash: `hash-${Date.now()}`,
        rawHtml: "<html><body>integration test cafeteria snapshot</body></html>",
        fetchedAt: "2026-04-20T10:00:00+09:00",
        status: "succeeded",
      });

      const documentId = await repository.upsertOfficialMenuDocument({
        sourceSnapshotId: snapshot.sourceSnapshotId,
        sourceId,
        weekStartDate: "2026-04-20",
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

      const selectedOfficialEntryId = Number(
        officialEntries.rows.find((row) => row.meal_type === "breakfast")!.id,
      );

      await repository.upsertResolvedMenuEntry({
        sourceId,
        serviceDate: "2026-04-20",
        mealType: "breakfast",
        selectedSourceKind: "official_page",
        selectedOfficialEntryId,
        isClosed: false,
        menuText: "참치김치볶음밥",
        menuItems: ["참치김치볶음밥"],
        selectionReason: "official page row is more authoritative than OCR",
        selectedAt: "2026-04-20T10:03:00+09:00",
      });

      const resolved = await pool.query<{
        source_id: string;
        service_date: string;
        meal_type: string;
        selected_source_kind: string;
        selected_official_entry_id: number | null;
        menu_text: string;
      }>(
        `
          SELECT
            source_id,
            service_date::text,
            meal_type,
            selected_source_kind,
            selected_official_entry_id,
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
      expect(Number(resolved.rows[0]!.selected_official_entry_id)).toBe(
        selectedOfficialEntryId,
      );
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
});
