import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { loadConfig } from "../../src/config/env.js";
import { createPool } from "../../src/db/client.js";
import { runMigrations } from "../../src/db/migrator.js";
import { NoticeRepository } from "../../src/db/notice-repository.js";
import { createNoticeNormalizationContext } from "../../src/notices/normalization-context.js";

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

  it("fetches a normalization source bundle and renders prompt input against postgres", async () => {
    const sourceId = `test_notice_source_ctx_${Date.now()}`;
    const externalId = `ctx-${Date.now()}`;
    const detailUrl = `https://example.com/notices/${externalId}`;
    const listUrl = "https://example.com/notices";
    const client = await pool.connect();

    try {
      await client.query("BEGIN");
      await client.query(
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

      const noticeInsert = await client.query<{ id: number }>(
        `
          INSERT INTO ${schema}.notice_items (
            source_id,
            external_id,
            title,
            detail_url,
            list_url,
            author,
            published_at,
            published_at_raw,
            body_text,
            body_html
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
          RETURNING id
        `,
        [
          sourceId,
          externalId,
          "테스트 컨텍스트 공지",
          detailUrl,
          listUrl,
          "학생지원팀",
          "2026-04-18T09:00:00+09:00",
          "2026.04.18",
          "본문 핵심 내용",
          "<p>본문 <a href=\"https://example.com/apply\">지원 링크</a></p>",
        ],
      );
      const noticeItemId = Number(noticeInsert.rows[0]!.id);

      const attachmentInsert = await client.query<{ id: number }>(
        `
          INSERT INTO ${schema}.notice_attachments (
            notice_item_id,
            file_name,
            download_url,
            sort_order
          )
          VALUES ($1, $2, $3, $4)
          RETURNING id
        `,
        [
          noticeItemId,
          "안내문.pdf",
          "https://example.com/guide.pdf",
          0,
        ],
      );
      const attachmentId = Number(attachmentInsert.rows[0]!.id);

      await client.query(
        `
          UPDATE ${schema}.notice_attachments
          SET
            storage_key = $2,
            content_type = $3,
            download_status = 'succeeded'
          WHERE id = $1
        `,
        [
          attachmentId,
          "notices/general/test/attachments/00.pdf",
          "application/pdf",
        ],
      );

      await client.query(
        `
          INSERT INTO ${schema}.notice_attachment_extractions (
            attachment_id,
            extractor_type,
            extraction_status,
            extracted_text,
            extracted_char_count,
            extracted_at
          )
          VALUES ($1, 'pdf', 'succeeded', $2, $3, $4)
        `,
        [
          attachmentId,
          "첨부 추출 텍스트",
          "첨부 추출 텍스트".length,
          "2026-04-18T09:06:00+09:00",
        ],
      );

      const imageInsert = await client.query<{ id: number }>(
        `
          INSERT INTO ${schema}.notice_images (
            notice_item_id,
            image_url,
            alt_text,
            sort_order
          )
          VALUES ($1, $2, $3, $4)
          RETURNING id
        `,
        [
          noticeItemId,
          "https://example.com/poster.png",
          "포스터",
          0,
        ],
      );
      const imageId = Number(imageInsert.rows[0]!.id);

      await client.query(
        `
          UPDATE ${schema}.notice_images
          SET
            storage_key = $2,
            content_type = $3,
            download_status = 'succeeded'
          WHERE id = $1
        `,
        [
          imageId,
          "notices/general/test/images/00.png",
          "image/png",
        ],
      );

      await client.query(
        `
          INSERT INTO ${schema}.notice_image_ocr_results (
            image_id,
            ocr_status,
            ocr_text,
            ocr_confidence,
            ocr_language,
            ocr_extracted_at
          )
          VALUES ($1, 'succeeded', $2, $3, $4, $5)
        `,
        [
          imageId,
          "이미지 OCR 텍스트",
          87.5,
          "kor+eng",
          "2026-04-18T09:07:00+09:00",
        ],
      );

      const bundle = await repository.getNormalizationSourceBundleWithClient(
        client,
        noticeItemId,
      );
      const context = createNoticeNormalizationContext(bundle);

      expect(bundle.notice.title).toBe("테스트 컨텍스트 공지");
      expect(bundle.notice.bodyHtml).toContain("https://example.com/apply");
      expect(bundle.attachments).toHaveLength(1);
      expect(bundle.images).toHaveLength(1);
      expect(context.promptInput).toContain("첨부 추출 텍스트");
      expect(context.promptInput).toContain("이미지 OCR 텍스트");
      expect(context.promptInput).toContain("본문 핵심 내용");
      expect(context.promptInput).toContain("https://example.com/apply");
    } finally {
      try {
        await client.query("ROLLBACK");
      } catch {
        // no-op
      }
      client.release();
    }
  });
});
