import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { loadConfig } from "../../src/config/env.js";
import { createPool } from "../../src/db/client.js";
import { runMigrations } from "../../src/db/migrator.js";
import { NoticeRepository } from "../../src/db/notice-repository.js";

describe("notice repository integration", () => {
  let pool: Pool;
  let schema: string;
  let repository: NoticeRepository;

  beforeAll(async () => {
    const config = loadConfig();
    schema = config.pgSchema;
    pool = createPool(config);
    repository = new NoticeRepository(pool, schema);
    await runMigrations(pool, schema);
  });

  afterAll(async () => {
    await pool.end();
  });

  it("upserts and reads a notice read model against postgres", async () => {
    const sourceId = `test_notice_source_${Date.now()}`;
    const externalId = `test-${Date.now()}`;
    const detailUrl = `https://example.com/notices/${externalId}`;
    const listUrl = "https://example.com/notices";

    const sourceInsert = await pool.query(
      `
        INSERT INTO ${schema}.notice_sources (
          id,
          name,
          description,
          list_url,
          active
        )
        VALUES ($1, $2, $3, $4, true)
      `,
      [sourceId, "테스트 공지", "integration test source", listUrl],
    );
    expect(sourceInsert.rowCount).toBe(1);

    const noticeInsert = await pool.query<{ id: number }>(
      `
        INSERT INTO ${schema}.notice_items (
          source_id,
          external_id,
          title,
          detail_url,
          list_url,
          published_at,
          published_at_raw
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING id
      `,
      [
        sourceId,
        externalId,
        "테스트 장학 공지",
        detailUrl,
        listUrl,
        "2026-04-18T09:00:00+09:00",
        "2026.04.18",
      ],
    );
    const noticeItemId = Number(noticeInsert.rows[0]!.id);

    try {
      await repository.upsertReadModel({
        noticeItemId,
        noticeKind: "scholarship",
        issuerName: "테스트 장학재단",
        issuerScope: "external",
        targetCampuses: ["humanities"],
        targetAudiences: ["student"],
        targetProgramLevels: ["undergraduate"],
        targetDepartments: ["computer_science"],
        targetGradeYears: [3, 4],
        primaryTimeKind: "application_period",
        primaryStartAt: "2026-04-18T09:00:00+09:00",
        primaryEndAt: "2026-04-25T18:00:00+09:00",
        primaryDeadlineAt: "2026-04-25T18:00:00+09:00",
        hasDeadline: true,
        actionRequired: true,
        actionKind: "apply",
        primaryActionChannel: "email",
        primaryActionUrl: "https://example.com/apply",
        primaryLocation: null,
        participationMode: "online",
        hasBenefit: true,
        benefitKind: "scholarship",
        benefitAmountKrw: 1500000,
        selectionCount: 10,
        summary: "테스트 장학 공지 요약",
        detailsJsonb: {
          required_documents: ["신청서", "성적증명서"],
        },
        normalizedConfidence: 0.91,
        normalizedAt: "2026-04-18T12:00:00+09:00",
        normalizationStatus: "succeeded",
        normalizationErrorMessage: null,
      });

      await repository.upsertReadModel({
        noticeItemId,
        noticeKind: "scholarship",
        issuerName: "테스트 장학재단",
        issuerScope: "external",
        targetCampuses: ["humanities", "natural"],
        targetAudiences: ["student"],
        targetProgramLevels: ["undergraduate"],
        targetDepartments: ["computer_science"],
        targetGradeYears: [3, 4],
        primaryTimeKind: "application_period",
        primaryStartAt: "2026-04-18T09:00:00+09:00",
        primaryEndAt: "2026-04-25T18:00:00+09:00",
        primaryDeadlineAt: "2026-04-25T18:00:00+09:00",
        hasDeadline: true,
        actionRequired: true,
        actionKind: "apply",
        primaryActionChannel: "email",
        primaryActionUrl: "https://example.com/apply",
        primaryLocation: null,
        participationMode: "online",
        hasBenefit: true,
        benefitKind: "scholarship",
        benefitAmountKrw: 1500000,
        selectionCount: 12,
        summary: "업데이트된 테스트 장학 공지 요약",
        detailsJsonb: {
          required_documents: ["신청서", "성적증명서", "재학증명서"],
        },
        normalizedConfidence: 0.93,
        normalizedAt: "2026-04-18T13:00:00+09:00",
        normalizationStatus: "succeeded",
        normalizationErrorMessage: null,
      });

      const stored = await repository.getReadModelByNoticeItemId(noticeItemId);

      expect(stored).not.toBeNull();
      expect(stored).toMatchObject({
        noticeItemId,
        sourceId,
        externalId,
        noticeKind: "scholarship",
        targetCampuses: ["humanities", "natural"],
        targetGradeYears: [3, 4],
        selectionCount: 12,
        summary: "업데이트된 테스트 장학 공지 요약",
        normalizedConfidence: 0.93,
        normalizationStatus: "succeeded",
      });
      expect(stored?.detailsJsonb).toEqual({
        required_documents: ["신청서", "성적증명서", "재학증명서"],
      });
    } finally {
      await pool.query(
        `DELETE FROM ${schema}.notice_items WHERE id = $1`,
        [noticeItemId],
      );
      await pool.query(
        `DELETE FROM ${schema}.notice_sources WHERE id = $1`,
        [sourceId],
      );
    }
  });
});
