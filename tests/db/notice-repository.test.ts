import { describe, expect, it, vi } from "vitest";
import { NoticeRepository } from "../../src/db/notice-repository.js";

describe("notice repository", () => {
  it("updates attachment download metadata by notice item and url", async () => {
    const pool = {
      query: vi.fn(async () => ({ rows: [] })),
    } as unknown as ConstructorParameters<typeof NoticeRepository>[0];
    const repository = new NoticeRepository(pool, "public_data");

    await repository.updateAttachmentProcessing(5, "https://example.com/file.hwp", {
      storageProvider: "local",
      storageKey: "notices/general/231000/attachments/00-file.hwp",
      contentType: "application/x-hwp",
      sizeBytes: 1234,
      sha256: "abc",
      downloadedAt: "2026-04-12T07:00:00.000Z",
      downloadStatus: "succeeded",
      errorMessage: null,
    });

    const [sql, values] = vi.mocked(pool.query).mock.calls[0]!;
    expect(String(sql)).toContain("UPDATE public_data.notice_attachments");
    expect(String(sql)).toContain("download_status");
    expect(values).toEqual([
      5,
      "https://example.com/file.hwp",
      "local",
      "notices/general/231000/attachments/00-file.hwp",
      "application/x-hwp",
      1234,
      "abc",
      "2026-04-12T07:00:00.000Z",
      "succeeded",
      null,
    ]);
  });

  it("updates image download failure metadata without storage details", async () => {
    const pool = {
      query: vi.fn(async () => ({ rows: [] })),
    } as unknown as ConstructorParameters<typeof NoticeRepository>[0];
    const repository = new NoticeRepository(pool, "public_data");

    await repository.updateImageProcessing(9, "https://example.com/image.png", {
      downloadStatus: "failed",
      errorMessage: "timeout",
    });

    const [sql, values] = vi.mocked(pool.query).mock.calls[0]!;
    expect(String(sql)).toContain("UPDATE public_data.notice_images");
    expect(String(sql)).toContain("COALESCE($3, storage_provider)");
    expect(values).toEqual([
      9,
      "https://example.com/image.png",
      null,
      null,
      null,
      null,
      null,
      null,
      "failed",
      "timeout",
    ]);
  });

  it("lists stored attachments in sort order for extraction", async () => {
    const pool = {
      query: vi.fn(async () => ({
        rows: [
          {
            id: 7,
            file_name: "안내문.pdf",
            download_url: "https://example.com/guide.pdf",
            storage_key: "notices/general/231000/attachments/00.pdf",
            content_type: "application/pdf",
            sha256: "file-hash",
            download_status: "succeeded",
            existing_extraction_status: "succeeded",
            existing_attachment_sha256: "file-hash",
          },
        ],
      })),
    } as unknown as ConstructorParameters<typeof NoticeRepository>[0];
    const repository = new NoticeRepository(pool, "public_data");

    const attachments = await repository.listStoredAttachmentsForNotice(11);

    expect(attachments).toEqual([
      {
        id: 7,
        fileName: "안내문.pdf",
        downloadUrl: "https://example.com/guide.pdf",
        storageKey: "notices/general/231000/attachments/00.pdf",
        contentType: "application/pdf",
        sha256: "file-hash",
        downloadStatus: "succeeded",
        existingExtractionStatus: "succeeded",
        existingAttachmentSha256: "file-hash",
      },
    ]);
    expect(String(vi.mocked(pool.query).mock.calls[0]![0])).toContain(
      "SELECT",
    );
  });

  it("upserts attachment extraction results", async () => {
    const pool = {
      query: vi.fn(async () => ({ rows: [] })),
    } as unknown as ConstructorParameters<typeof NoticeRepository>[0];
    const repository = new NoticeRepository(pool, "public_data");

    await repository.upsertAttachmentExtraction(7, {
      attachmentSha256: "file-hash",
      extractorType: "pdf",
      extractionStatus: "succeeded",
      extractedText: "본문",
      textSha256: "abc",
      extractedCharCount: 2,
      extractedAt: "2026-04-12T07:00:00.000Z",
      errorMessage: null,
    });

    const [sql, values] = vi.mocked(pool.query).mock.calls[0]!;
    expect(String(sql)).toContain(
      "INSERT INTO public_data.notice_attachment_extractions",
    );
    expect(values).toEqual([
      7,
      "file-hash",
      "pdf",
      "succeeded",
      "본문",
      "abc",
      2,
      "2026-04-12T07:00:00.000Z",
      null,
    ]);
  });

  it("lists stored images in sort order for ocr", async () => {
    const pool = {
      query: vi.fn(async () => ({
        rows: [
          {
            id: 9,
            image_url: "https://example.com/poster.png",
            alt_text: "포스터",
            storage_key: "notices/general/231000/images/00.png",
            content_type: "image/png",
            sha256: "image-hash",
            download_status: "succeeded",
            existing_ocr_status: "succeeded",
            existing_image_sha256: "image-hash",
            existing_ocr_language: "kor+eng",
          },
        ],
      })),
    } as unknown as ConstructorParameters<typeof NoticeRepository>[0];
    const repository = new NoticeRepository(pool, "public_data");

    const images = await repository.listStoredImagesForNotice(11);

    expect(images).toEqual([
      {
        id: 9,
        imageUrl: "https://example.com/poster.png",
        altText: "포스터",
        storageKey: "notices/general/231000/images/00.png",
        contentType: "image/png",
        sha256: "image-hash",
        downloadStatus: "succeeded",
        existingOcrStatus: "succeeded",
        existingImageSha256: "image-hash",
        existingOcrLanguage: "kor+eng",
      },
    ]);
    expect(String(vi.mocked(pool.query).mock.calls[0]![0])).toContain("SELECT");
  });

  it("upserts image ocr results", async () => {
    const pool = {
      query: vi.fn(async () => ({ rows: [] })),
    } as unknown as ConstructorParameters<typeof NoticeRepository>[0];
    const repository = new NoticeRepository(pool, "public_data");

    await repository.upsertImageOcr(9, {
      imageSha256: "image-hash",
      ocrStatus: "succeeded",
      ocrText: "장학 포스터",
      textSha256: "ocr-hash",
      ocrConfidence: 88.76,
      ocrLanguage: "kor+eng",
      ocrExtractedAt: "2026-04-12T07:00:00.000Z",
      errorMessage: null,
    });

    const [sql, values] = vi.mocked(pool.query).mock.calls[0]!;
    expect(String(sql)).toContain(
      "INSERT INTO public_data.notice_image_ocr_results",
    );
    expect(values).toEqual([
      9,
      "image-hash",
      "succeeded",
      "장학 포스터",
      "ocr-hash",
      88.76,
      "kor+eng",
      "2026-04-12T07:00:00.000Z",
      null,
    ]);
  });

  it("upserts notice read model rows by deriving source metadata from the notice item", async () => {
    const pool = {
      query: vi.fn(async () => ({
        rows: [{ id: 101 }],
      })),
    } as unknown as ConstructorParameters<typeof NoticeRepository>[0];
    const repository = new NoticeRepository(pool, "public_data");

    await repository.upsertReadModel({
      noticeItemId: 184,
      noticeKind: "scholarship",
      issuerName: "광진복지재단",
      issuerScope: "external",
      targetCampuses: ["humanities"],
      targetAudiences: ["student"],
      targetProgramLevels: ["undergraduate", "graduate"],
      targetDepartments: [],
      targetGradeYears: [],
      primaryTimeKind: "application_period",
      primaryStartAt: "2026-03-12T00:00:00+09:00",
      primaryEndAt: "2026-03-26T18:00:00+09:00",
      primaryDeadlineAt: "2026-03-26T18:00:00+09:00",
      hasDeadline: true,
      actionRequired: true,
      actionKind: "apply",
      primaryActionChannel: "email",
      primaryActionUrl: null,
      primaryLocation: null,
      participationMode: "online",
      hasBenefit: true,
      benefitKind: "scholarship",
      benefitAmountKrw: 2500000,
      selectionCount: null,
      summary: "장학 공지 요약",
      detailsJsonb: {
        eligibility: {
          income_requirement: "기준 중위소득 100% 이하",
        },
      },
      normalizedConfidence: 0.84,
      normalizedAt: "2026-04-18T16:10:00+09:00",
      normalizationStatus: "succeeded",
      normalizationErrorMessage: null,
    });

    const [sql, values] = vi.mocked(pool.query).mock.calls[0]!;
    expect(String(sql)).toContain("INSERT INTO public_data.notice_read_models");
    expect(String(sql)).toContain("FROM public_data.notice_items ni");
    expect(String(sql)).toContain("ON CONFLICT (notice_item_id) DO UPDATE");
    expect(values).toEqual([
      184,
      "scholarship",
      "광진복지재단",
      "external",
      ["humanities"],
      ["student"],
      ["undergraduate", "graduate"],
      [],
      [],
      "application_period",
      "2026-03-12T00:00:00+09:00",
      "2026-03-26T18:00:00+09:00",
      "2026-03-26T18:00:00+09:00",
      true,
      true,
      "apply",
      "email",
      null,
      null,
      "online",
      true,
      "scholarship",
      2500000,
      null,
      "장학 공지 요약",
      JSON.stringify({
        eligibility: {
          income_requirement: "기준 중위소득 100% 이하",
        },
      }),
      0.84,
      "2026-04-18T16:10:00+09:00",
      "succeeded",
      null,
    ]);
  });

  it("throws when notice read model upsert targets a missing notice item", async () => {
    const pool = {
      query: vi.fn(async () => ({
        rows: [],
      })),
    } as unknown as ConstructorParameters<typeof NoticeRepository>[0];
    const repository = new NoticeRepository(pool, "public_data");

    await expect(
      repository.upsertReadModel({
        noticeItemId: 999,
        noticeKind: null,
        issuerName: null,
        issuerScope: null,
        targetCampuses: [],
        targetAudiences: [],
        targetProgramLevels: [],
        targetDepartments: [],
        targetGradeYears: [],
        primaryTimeKind: null,
        primaryStartAt: null,
        primaryEndAt: null,
        primaryDeadlineAt: null,
        hasDeadline: false,
        actionRequired: false,
        actionKind: null,
        primaryActionChannel: null,
        primaryActionUrl: null,
        primaryLocation: null,
        participationMode: null,
        hasBenefit: false,
        benefitKind: null,
        benefitAmountKrw: null,
        selectionCount: null,
        summary: null,
        detailsJsonb: null,
        normalizedConfidence: 0,
        normalizedAt: "2026-04-18T16:10:00+09:00",
        normalizationStatus: "failed",
        normalizationErrorMessage: "missing notice",
      }),
    ).rejects.toThrow(
      "notice item 999 was not found for read model upsert",
    );
  });

  it("maps stored notice read model rows back into the repository type", async () => {
    const pool = {
      query: vi.fn(async () => ({
        rows: [
          {
            id: 101,
            notice_item_id: 184,
            source_id: "scholarship",
            external_id: "230100",
            notice_kind: "scholarship",
            issuer_name: "광진복지재단",
            issuer_scope: "external",
            target_campuses: ["humanities"],
            target_audiences: ["student"],
            target_program_levels: ["undergraduate", "graduate"],
            target_departments: [],
            target_grade_years: ["2", "3"],
            primary_time_kind: "application_period",
            primary_start_at: "2026-03-12T00:00:00+09:00",
            primary_end_at: "2026-03-26T18:00:00+09:00",
            primary_deadline_at: "2026-03-26T18:00:00+09:00",
            has_deadline: true,
            action_required: true,
            action_kind: "apply",
            primary_action_channel: "email",
            primary_action_url: null,
            primary_location: null,
            participation_mode: "online",
            has_benefit: true,
            benefit_kind: "scholarship",
            benefit_amount_krw: 2500000,
            selection_count: null,
            summary: "장학 공지 요약",
            details_jsonb: {
              eligibility: {
                income_requirement: "기준 중위소득 100% 이하",
              },
            },
            normalized_confidence: 0.84,
            normalized_at: "2026-04-18T16:10:00+09:00",
            normalization_status: "succeeded",
            normalization_error_message: null,
            created_at: "2026-04-18T16:10:01+09:00",
            updated_at: "2026-04-18T16:10:01+09:00",
          },
        ],
      })),
    } as unknown as ConstructorParameters<typeof NoticeRepository>[0];
    const repository = new NoticeRepository(pool, "public_data");

    const row = await repository.getReadModelByNoticeItemId(184);

    expect(row).toEqual({
      id: 101,
      noticeItemId: 184,
      sourceId: "scholarship",
      externalId: "230100",
      noticeKind: "scholarship",
      issuerName: "광진복지재단",
      issuerScope: "external",
      targetCampuses: ["humanities"],
      targetAudiences: ["student"],
      targetProgramLevels: ["undergraduate", "graduate"],
      targetDepartments: [],
      targetGradeYears: [2, 3],
      primaryTimeKind: "application_period",
      primaryStartAt: "2026-03-12T00:00:00+09:00",
      primaryEndAt: "2026-03-26T18:00:00+09:00",
      primaryDeadlineAt: "2026-03-26T18:00:00+09:00",
      hasDeadline: true,
      actionRequired: true,
      actionKind: "apply",
      primaryActionChannel: "email",
      primaryActionUrl: null,
      primaryLocation: null,
      participationMode: "online",
      hasBenefit: true,
      benefitKind: "scholarship",
      benefitAmountKrw: 2500000,
      selectionCount: null,
      summary: "장학 공지 요약",
      detailsJsonb: {
        eligibility: {
          income_requirement: "기준 중위소득 100% 이하",
        },
      },
      normalizedConfidence: 0.84,
      normalizedAt: "2026-04-18T16:10:00+09:00",
      normalizationStatus: "succeeded",
      normalizationErrorMessage: null,
      createdAt: "2026-04-18T16:10:01+09:00",
      updatedAt: "2026-04-18T16:10:01+09:00",
    });
  });

  it("builds a normalization source bundle from notice body, attachment extraction, and image OCR rows", async () => {
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({
          rows: [
            {
              notice_item_id: 184,
              source_id: "scholarship",
              source_name: "장학공지",
              source_description: "장학/학자금 공지",
              source_list_url: "https://example.com/scholarship",
              external_id: "230100",
              title: "테스트 장학 공지",
              category_label: null,
              detail_url: "https://example.com/notices/230100",
              list_url: "https://example.com/scholarship",
              author: "학생지원팀",
              published_at: "2026-04-18T09:00:00+09:00",
              published_at_raw: "2026.04.18",
              body_text: "본문 핵심 내용",
              body_html: "<p>본문 <a href=\"https://example.com/apply\">지원 링크</a></p>",
              content_hash: "abc123",
              attachments_count: 1,
              images_count: 1,
              first_seen_at: "2026-04-18T09:05:00+09:00",
              last_seen_at: "2026-04-18T09:05:00+09:00",
              last_scraped_at: "2026-04-18T09:05:00+09:00",
            },
          ],
        })
        .mockResolvedValueOnce({
          rows: [
            {
              attachment_id: 77,
              file_name: "안내문.pdf",
              download_url: "https://example.com/guide.pdf",
              sort_order: 0,
              storage_key: "notices/scholarship/230100/attachments/00.pdf",
              content_type: "application/pdf",
              download_status: "succeeded",
              extraction_status: "succeeded",
              extractor_type: "pdf",
              extracted_text: "첨부 추출 텍스트",
              extracted_char_count: 9,
              extracted_at: "2026-04-18T09:06:00+09:00",
              error_message: null,
            },
          ],
        })
        .mockResolvedValueOnce({
          rows: [
            {
              image_id: 91,
              image_url: "https://example.com/poster.png",
              alt_text: "포스터",
              sort_order: 0,
              storage_key: "notices/scholarship/230100/images/00.png",
              content_type: "image/png",
              download_status: "succeeded",
              ocr_status: "succeeded",
              ocr_text: "포스터 OCR 텍스트",
              ocr_confidence: "88.20",
              ocr_language: "kor+eng",
              ocr_extracted_at: "2026-04-18T09:07:00+09:00",
              error_message: null,
            },
          ],
        }),
    } as unknown as ConstructorParameters<typeof NoticeRepository>[0];
    const repository = new NoticeRepository(pool, "public_data");

    const bundle = await repository.getNormalizationSourceBundle(184);

    expect(bundle).toEqual({
      source: {
        id: "scholarship",
        name: "장학공지",
        description: "장학/학자금 공지",
        listUrl: "https://example.com/scholarship",
      },
      notice: {
        noticeItemId: 184,
        sourceId: "scholarship",
        externalId: "230100",
        title: "테스트 장학 공지",
        categoryLabel: null,
        detailUrl: "https://example.com/notices/230100",
        listUrl: "https://example.com/scholarship",
        author: "학생지원팀",
        publishedAt: "2026-04-18T09:00:00+09:00",
        publishedAtRaw: "2026.04.18",
        bodyText: "본문 핵심 내용",
        bodyHtml: "<p>본문 <a href=\"https://example.com/apply\">지원 링크</a></p>",
        contentHash: "abc123",
        attachmentsCount: 1,
        imagesCount: 1,
        firstSeenAt: "2026-04-18T09:05:00+09:00",
        lastSeenAt: "2026-04-18T09:05:00+09:00",
        lastScrapedAt: "2026-04-18T09:05:00+09:00",
      },
      attachments: [
        {
          attachmentId: 77,
          fileName: "안내문.pdf",
          downloadUrl: "https://example.com/guide.pdf",
          sortOrder: 0,
          storageKey: "notices/scholarship/230100/attachments/00.pdf",
          contentType: "application/pdf",
          downloadStatus: "succeeded",
          extractionStatus: "succeeded",
          extractorType: "pdf",
          extractedText: "첨부 추출 텍스트",
          extractedCharCount: 9,
          extractedAt: "2026-04-18T09:06:00+09:00",
          errorMessage: null,
        },
      ],
      images: [
        {
          imageId: 91,
          imageUrl: "https://example.com/poster.png",
          altText: "포스터",
          sortOrder: 0,
          storageKey: "notices/scholarship/230100/images/00.png",
          contentType: "image/png",
          downloadStatus: "succeeded",
          ocrStatus: "succeeded",
          ocrText: "포스터 OCR 텍스트",
          ocrConfidence: 88.2,
          ocrLanguage: "kor+eng",
          ocrExtractedAt: "2026-04-18T09:07:00+09:00",
          errorMessage: null,
        },
      ],
    });
  });
});
