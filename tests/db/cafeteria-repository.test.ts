import { describe, expect, it, vi } from "vitest";
import { CafeteriaRepository } from "../../src/db/cafeteria-repository.js";

describe("cafeteria repository", () => {
  function createConnectedPoolMock() {
    const query = vi.fn(async () => ({ rows: [] }));
    const release = vi.fn();
    const connect = vi.fn(async () => ({
      query,
      release,
    }));

    return {
      pool: {
        query,
        connect,
      } as unknown as ConstructorParameters<typeof CafeteriaRepository>[0],
      query,
      connect,
      release,
    };
  }

  it("does not clear stored image metadata when only OCR fields are updated", async () => {
    const pool = {
      query: vi.fn(async () => ({ rows: [] })),
    } as unknown as ConstructorParameters<typeof CafeteriaRepository>[0];
    const repository = new CafeteriaRepository(pool, "public_data");

    await repository.updateInstagramPostProcessing(42, {
      ocrStatus: "skipped",
      ocrText: null,
      ocrConfidence: null,
      ocrLanguage: null,
      ocrExtractedAt: null,
      ocrErrorMessage: "image url missing",
    });

    const [sql, values] = vi.mocked(pool.query).mock.calls[0]!;
    expect(String(sql)).not.toContain("image_storage_provider");
    expect(String(sql)).not.toContain("image_storage_key");
    expect(String(sql)).toContain("ocr_status");
    expect(values).toEqual([
      42,
      "skipped",
      null,
      null,
      null,
      null,
      "image url missing",
    ]);
  });

  it("upserts official page source metadata by source_id", async () => {
    const pool = {
      query: vi.fn(async () => ({ rows: [] })),
    } as unknown as ConstructorParameters<typeof CafeteriaRepository>[0];
    const repository = new CafeteriaRepository(pool, "public_data");

    await repository.ensureOfficialPageSources([
      {
        sourceId: "student-hall",
        pageKey: "mjukr-486",
        pageUrl: "https://mjedu.mju.ac.kr/mjukr/486/subview.do",
        viewActionPath: "/diet/mjukr/5/view.do",
        name: "학생회관 공식 페이지",
      },
    ]);

    const [sql, values] = vi.mocked(pool.query).mock.calls[0]!;
    expect(String(sql)).toContain(
      "INSERT INTO public_data.cafeteria_official_page_sources",
    );
    expect(String(sql)).toContain("ON CONFLICT (source_id) DO UPDATE");
    expect(values).toEqual([
      "student-hall",
      "mjukr-486",
      "https://mjedu.mju.ac.kr/mjukr/486/subview.do",
      "/diet/mjukr/5/view.do",
      "학생회관 공식 페이지",
      true,
    ]);
  });

  it("upserts an official menu document by source and week", async () => {
    const pool = {
      query: vi.fn(async () => ({ rows: [{ id: 31 }] })),
    } as unknown as ConstructorParameters<typeof CafeteriaRepository>[0];
    const repository = new CafeteriaRepository(pool, "public_data");

    const documentId = await repository.upsertOfficialMenuDocument({
      sourceId: "student-hall",
      weekStartDate: "2026-04-20",
      rawHtml: "<html>학생회관 식단표</html>",
      contentHash: "official-hash-123",
      fetchedAt: "2026-04-20T10:01:00+09:00",
      status: "succeeded",
      errorMessage: null,
      documentScope: "weekday",
      serviceStartDate: "2026-04-20",
      serviceEndDate: "2026-04-24",
      breakfastAvailable: true,
      lunchAvailable: true,
      dinnerAvailable: false,
      normalizedAt: "2026-04-20T10:02:00+09:00",
    });

    expect(documentId).toBe(31);
    const [sql, values] = vi.mocked(pool.query).mock.calls[0]!;
    expect(String(sql)).toContain(
      "INSERT INTO public_data.cafeteria_official_menu_documents",
    );
    expect(String(sql)).toContain("ON CONFLICT (source_id, week_start_date) DO UPDATE");
    expect(values).toEqual([
      "student-hall",
      "2026-04-20",
      "<html>학생회관 식단표</html>",
      "official-hash-123",
      "2026-04-20T10:01:00+09:00",
      "succeeded",
      null,
      "weekday",
      "2026-04-20",
      "2026-04-24",
      true,
      true,
      false,
      "2026-04-20T10:02:00+09:00",
    ]);
  });

  it("creates or refreshes a menu document only for menu_sheet posts", async () => {
    const { pool, query, release } = createConnectedPoolMock();
    const repository = new CafeteriaRepository(pool, "public_data");

    await repository.syncInstagramPostClassification(7, {
      postKind: "menu_sheet",
      score: 8,
      confidence: 0.95,
      reason: "caption-keyword:strong(식단표), date-range",
      signals: ["caption-keyword:strong(식단표)", "date-range"],
    }, {
      documentScope: "weekday",
      scopeConfidence: 0.94,
      scopeReason: "date range 2026-04-06~2026-04-10 maps to Monday-Friday",
      serviceStartDate: "2026-04-06",
      serviceEndDate: "2026-04-10",
      breakfastAvailable: false,
      lunchAvailable: true,
      dinnerAvailable: true,
    });

    expect(query.mock.calls).toHaveLength(4);
    expect(String(query.mock.calls[0]![0])).toContain("BEGIN");
    expect(String(query.mock.calls[1]![0])).toContain(
      "UPDATE public_data.cafeteria_instagram_posts",
    );
    expect(query.mock.calls[1]![1]).toEqual([
      7,
      "menu_sheet",
      0.95,
      8,
      "caption-keyword:strong(식단표), date-range",
      ["caption-keyword:strong(식단표)", "date-range"],
    ]);
    expect(String(query.mock.calls[2]![0])).toContain(
      "INSERT INTO public_data.cafeteria_menu_documents",
    );
    expect(query.mock.calls[2]![1]).toEqual([
      7,
      "weekday",
      0.94,
      "date range 2026-04-06~2026-04-10 maps to Monday-Friday",
      "2026-04-06",
      "2026-04-10",
      false,
      true,
      true,
    ]);
    expect(String(query.mock.calls[3]![0])).toContain("COMMIT");
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("removes an existing menu document only when ignored classification has a strong ignore hint", async () => {
    const { pool, query, release } = createConnectedPoolMock();
    const repository = new CafeteriaRepository(pool, "public_data");

    await repository.syncInstagramPostClassification(9, {
      postKind: "ignored",
      score: -2,
      confidence: 0.62,
      reason: "ignored-hint(운영시간 안내)",
      signals: ["ignored-hint(운영시간 안내)"],
    });

    expect(query.mock.calls).toHaveLength(4);
    expect(String(query.mock.calls[2]![0])).toContain(
      "DELETE FROM public_data.cafeteria_menu_documents",
    );
    expect(String(query.mock.calls[3]![0])).toContain("COMMIT");
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("keeps an existing menu document when ignored classification is only low-confidence", async () => {
    const { pool, query, release } = createConnectedPoolMock();
    const repository = new CafeteriaRepository(pool, "public_data");

    await repository.syncInstagramPostClassification(10, {
      postKind: "ignored",
      score: 4,
      confidence: 0.45,
      reason: "caption-keyword:medium(다음 주 식단), image-phash:medium(0.078)",
      signals: [
        "caption-keyword:medium(다음 주 식단)",
        "image-phash:medium(0.078)",
      ],
    });

    expect(query.mock.calls).toHaveLength(3);
    expect(String(query.mock.calls[2]![0])).toContain("COMMIT");
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("rolls back the transaction when document synchronization fails", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockRejectedValueOnce(new Error("document sync failed"))
      .mockResolvedValueOnce({ rows: [] });
    const release = vi.fn();
    const connect = vi.fn(async () => ({
      query,
      release,
    }));
    const pool = {
      query: vi.fn(async () => ({ rows: [] })),
      connect,
    } as unknown as ConstructorParameters<typeof CafeteriaRepository>[0];
    const repository = new CafeteriaRepository(pool, "public_data");

    await expect(
      repository.syncInstagramPostClassification(12, {
        postKind: "menu_sheet",
        score: 8,
        confidence: 0.95,
        reason: "caption-keyword:strong(식단표), date-range",
        signals: ["caption-keyword:strong(식단표)", "date-range"],
      }, {
        documentScope: "weekday",
        scopeConfidence: 0.94,
        scopeReason: "date range 2026-04-06~2026-04-10 maps to Monday-Friday",
        serviceStartDate: "2026-04-06",
        serviceEndDate: "2026-04-10",
        breakfastAvailable: false,
        lunchAvailable: true,
        dinnerAvailable: true,
      }),
    ).rejects.toThrow("document sync failed");

    expect(String(query.mock.calls[3]![0])).toContain("ROLLBACK");
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("rejects menu_sheet classifications that are missing document structure", async () => {
    const { pool, connect } = createConnectedPoolMock();
    const repository = new CafeteriaRepository(pool, "public_data");

    await expect(
      repository.syncInstagramPostClassification(13, {
        postKind: "menu_sheet",
        score: 8,
        confidence: 0.95,
        reason: "caption-keyword:strong(식단표), date-range",
        signals: ["caption-keyword:strong(식단표)", "date-range"],
      }),
    ).rejects.toThrow(
      "menu_sheet classification requires structured menu document metadata",
    );

    expect(connect).not.toHaveBeenCalled();
  });

  it("only uses high-confidence structured menu sheets as perceptual hash references", async () => {
    const pool = {
      query: vi.fn(async () => ({
        rows: [{ image_perceptual_hash: "1010" }],
      })),
    } as unknown as ConstructorParameters<typeof CafeteriaRepository>[0];
    const repository = new CafeteriaRepository(pool, "public_data");

    const hashes = await repository.listMenuSheetReferenceHashes(
      "student-hall-myeongjin",
      99,
    );

    expect(hashes).toEqual(["1010"]);
    const [sql, values] = vi.mocked(pool.query).mock.calls[0]!;
    expect(String(sql)).toContain("p.ocr_status = 'succeeded'");
    expect(String(sql)).toContain("coalesce(p.post_kind_score, 0) >= 8");
    expect(String(sql)).toContain("d.service_start_date IS NOT NULL");
    expect(values).toEqual(["student-hall-myeongjin", 99]);
  });

  it("returns a normalization context that includes document, source, and storage metadata", async () => {
    const pool = {
      query: vi.fn(async () => ({
        rows: [
          {
            source_document_id: 5,
            source_post_id: 9,
            source_id: "student-hall",
            source_name: "학생회관",
            source_description: "학생회관 식당",
            profile_url: "https://www.instagram.com/mjhs_yongin/",
            instagram_username: "mjhs_yongin",
            menu_image_group: "student-hall-myeongjin",
            supports_weekend_menu: true,
            image_storage_key: "cafeterias/student-hall/ABC/original.jpg",
            document_scope: "weekday",
            service_start_date: "2026-04-13",
            service_end_date: "2026-04-17",
            breakfast_available: true,
            lunch_available: true,
            dinner_available: false,
          },
        ],
      })),
    } as unknown as ConstructorParameters<typeof CafeteriaRepository>[0];
    const repository = new CafeteriaRepository(pool, "public_data");

    const context = await repository.getMenuNormalizationContext(9);

    expect(context).toEqual({
      sourceDocumentId: 5,
      sourcePostId: 9,
      source: {
        id: "student-hall",
        name: "학생회관",
        description: "학생회관 식당",
        profileUrl: "https://www.instagram.com/mjhs_yongin/",
        instagramUsername: "mjhs_yongin",
        menuImageGroup: "student-hall-myeongjin",
        supportsWeekendMenu: true,
      },
      imageStorageKey: "cafeterias/student-hall/ABC/original.jpg",
      documentScope: "weekday",
      serviceStartDate: "2026-04-13",
      serviceEndDate: "2026-04-17",
      breakfastAvailable: true,
      lunchAvailable: true,
      dinnerAvailable: false,
    });
  });

  it("replaces normalized menu entries and updates document normalization state together", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ rows: [{ count: 0 }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ rows: [{ id: 1201 }] })
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ rows: [{ id: 1202 }] })
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined);
    const release = vi.fn();
    const pool = {
      connect: vi.fn(async () => ({
        query,
        release,
      })),
    } as unknown as ConstructorParameters<typeof CafeteriaRepository>[0];
    const repository = new CafeteriaRepository(pool, "public_data");

    await repository.syncMenuNormalization(
      {
        sourceDocumentId: 11,
        sourcePostId: 12,
        source: {
          id: "student-hall",
          name: "학생회관",
          description: "학생회관 식당",
          profileUrl: "https://www.instagram.com/mjhs_yongin/",
          instagramUsername: "mjhs_yongin",
          menuImageGroup: "student-hall-myeongjin",
          supportsWeekendMenu: true,
        },
        imageStorageKey: "cafeterias/student-hall/ABC/original.jpg",
        documentScope: "weekday",
        serviceStartDate: "2026-04-13",
        serviceEndDate: "2026-04-17",
        breakfastAvailable: true,
        lunchAvailable: true,
        dinnerAvailable: false,
      },
      {
        status: "partial",
        confidence: 0.74,
        reason: "normalized 2/10 menu entries",
        errorMessage: "one dinner cell was empty",
        entries: [
          {
            serviceDate: "2026-04-13",
            mealType: "breakfast",
            isClosed: false,
            menuText: "삼계탕",
            menuItems: ["삼계탕"],
            confidence: 0.81,
          },
          {
            serviceDate: "2026-04-13",
            mealType: "lunch",
            isClosed: true,
            menuText: "미운영",
            menuItems: ["미운영"],
            confidence: 1,
          },
        ],
      },
    );

    expect(query.mock.calls).toHaveLength(10);
    expect(String(query.mock.calls[0]![0])).toContain("BEGIN");
    expect(String(query.mock.calls[1]![0])).toContain(
      "SELECT count(*)::int AS count",
    );
    expect(String(query.mock.calls[2]![0])).toContain(
      "UPDATE public_data.cafeteria_menu_documents",
    );
    expect(String(query.mock.calls[3]![0])).toContain(
      "SELECT resolved.service_date::text, resolved.meal_type",
    );
    expect(query.mock.calls[3]![1]).toEqual([
      "student-hall",
      "weekday",
      "2026-04-13",
      "2026-04-17",
    ]);
    expect(query.mock.calls[2]![1]).toEqual([
      11,
      "partial",
      0.74,
      "normalized 2/10 menu entries",
      2,
      "one dinner cell was empty",
    ]);
    expect(String(query.mock.calls[4]![0])).toContain(
      "DELETE FROM public_data.cafeteria_menu_entries",
    );
    expect(String(query.mock.calls[5]![0])).toContain(
      "INSERT INTO public_data.cafeteria_menu_entries",
    );
    expect(query.mock.calls[5]![1]).toEqual([
      11,
      12,
      "student-hall",
      "2026-04-13",
      "breakfast",
      false,
      "삼계탕",
      JSON.stringify(["삼계탕"]),
      0.81,
    ]);
    expect(String(query.mock.calls[6]![0])).toContain(
      "UPDATE public_data.cafeteria_resolved_menu_entries",
    );
    expect(query.mock.calls[6]![1]).toEqual([
      false,
      "삼계탕",
      JSON.stringify(["삼계탕"]),
      "student-hall",
      "2026-04-13",
      "breakfast",
    ]);
    expect(query.mock.calls[7]![1]).toEqual([
      11,
      12,
      "student-hall",
      "2026-04-13",
      "lunch",
      true,
      "미운영",
      JSON.stringify(["미운영"]),
      1,
    ]);
    expect(String(query.mock.calls[8]![0])).toContain(
      "UPDATE public_data.cafeteria_resolved_menu_entries",
    );
    expect(query.mock.calls[8]![1]).toEqual([
      true,
      "미운영",
      JSON.stringify(["미운영"]),
      "student-hall",
      "2026-04-13",
      "lunch",
    ]);
    expect(String(query.mock.calls[9]![0])).toContain("COMMIT");
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("replaces official menu entries for a document in a single transaction", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({
        rowCount: 1,
        rows: [
          {
            source_id: "bokji",
            week_start_date: "2026-04-20",
            document_scope: "weekday",
            service_start_date: "2026-04-20",
            service_end_date: "2026-04-24",
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ rows: [{ id: 910 }] })
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ rows: [{ id: 911 }] })
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined);
    const release = vi.fn();
    const pool = {
      connect: vi.fn(async () => ({
        query,
        release,
      })),
    } as unknown as ConstructorParameters<typeof CafeteriaRepository>[0];
    const repository = new CafeteriaRepository(pool, "public_data");

    await repository.replaceOfficialMenuEntries({
      sourceDocumentId: 401,
      sourceId: "bokji",
      entries: [
        {
          serviceDate: "2026-04-20",
          mealType: "lunch",
          isClosed: false,
          menuText: "잔치국수 백미밥",
          menuItems: ["잔치국수", "백미밥"],
          confidence: 0.98,
        },
        {
          serviceDate: "2026-04-20",
          mealType: "dinner",
          isClosed: false,
          menuText: "뼈없는감자탕 백미밥",
          menuItems: ["뼈없는감자탕", "백미밥"],
          confidence: 0.97,
        },
      ],
    });

    expect(query.mock.calls).toHaveLength(9);
    expect(String(query.mock.calls[0]![0])).toContain("BEGIN");
    expect(String(query.mock.calls[1]![0])).toContain(
      "service_start_date::text",
    );
    expect(query.mock.calls[1]![1]).toEqual([401]);
    expect(String(query.mock.calls[2]![0])).toContain(
      "SELECT resolved.service_date::text, resolved.meal_type",
    );
    expect(query.mock.calls[2]![1]).toEqual([
      "bokji",
      "2026-04-20",
      "weekday",
    ]);
    expect(String(query.mock.calls[3]![0])).toContain(
      "DELETE FROM public_data.cafeteria_official_menu_entries",
    );
    expect(query.mock.calls[3]![1]).toEqual([401]);
    expect(String(query.mock.calls[4]![0])).toContain(
      "INSERT INTO public_data.cafeteria_official_menu_entries",
    );
    expect(query.mock.calls[4]![1]).toEqual([
      401,
      "bokji",
      "2026-04-20",
      "lunch",
      false,
      "잔치국수 백미밥",
      JSON.stringify(["잔치국수", "백미밥"]),
      0.98,
      "html_table",
    ]);
    expect(String(query.mock.calls[5]![0])).toContain(
      "UPDATE public_data.cafeteria_resolved_menu_entries",
    );
    expect(query.mock.calls[5]![1]).toEqual([
      false,
      "잔치국수 백미밥",
      JSON.stringify(["잔치국수", "백미밥"]),
      "bokji",
      "2026-04-20",
      "lunch",
    ]);
    expect(query.mock.calls[6]![1]).toEqual([
      401,
      "bokji",
      "2026-04-20",
      "dinner",
      false,
      "뼈없는감자탕 백미밥",
      JSON.stringify(["뼈없는감자탕", "백미밥"]),
      0.97,
      "html_table",
    ]);
    expect(String(query.mock.calls[7]![0])).toContain(
      "UPDATE public_data.cafeteria_resolved_menu_entries",
    );
    expect(query.mock.calls[7]![1]).toEqual([
      false,
      "뼈없는감자탕 백미밥",
      JSON.stringify(["뼈없는감자탕", "백미밥"]),
      "bokji",
      "2026-04-20",
      "dinner",
    ]);
    expect(String(query.mock.calls[8]![0])).toContain("COMMIT");
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("rolls back when official menu document source does not match", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({
        rowCount: 1,
        rows: [{ source_id: "student-hall" }],
      })
      .mockResolvedValueOnce(undefined);
    const release = vi.fn();
    const pool = {
      connect: vi.fn(async () => ({
        query,
        release,
      })),
    } as unknown as ConstructorParameters<typeof CafeteriaRepository>[0];
    const repository = new CafeteriaRepository(pool, "public_data");

    await expect(
      repository.replaceOfficialMenuEntries({
        sourceDocumentId: 401,
        sourceId: "bokji",
        entries: [],
      }),
    ).rejects.toThrow(
      "official menu document 401 does not belong to source bokji",
    );

    expect(String(query.mock.calls[0]![0])).toContain("BEGIN");
    expect(String(query.mock.calls[1]![0])).toContain("service_start_date::text");
    expect(String(query.mock.calls[2]![0])).toContain("ROLLBACK");
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("deletes stale official resolved rows when a refreshed official document no longer contains that key", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({
        rowCount: 1,
        rows: [
          {
            source_id: "bokji",
            week_start_date: "2026-04-20",
            document_scope: "weekday",
            service_start_date: "2026-04-20",
            service_end_date: "2026-04-24",
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [{ service_date: "2026-04-21", meal_type: "dinner" }],
      })
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ rows: [{ id: 920 }] })
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined);
    const release = vi.fn();
    const pool = {
      connect: vi.fn(async () => ({
        query,
        release,
      })),
    } as unknown as ConstructorParameters<typeof CafeteriaRepository>[0];
    const repository = new CafeteriaRepository(pool, "public_data");

    await repository.replaceOfficialMenuEntries({
      sourceDocumentId: 402,
      sourceId: "bokji",
      entries: [
        {
          serviceDate: "2026-04-20",
          mealType: "lunch",
          isClosed: false,
          menuText: "잔치국수 백미밥",
          menuItems: ["잔치국수", "백미밥"],
          confidence: 0.98,
        },
      ],
    });

    expect(String(query.mock.calls[3]![0])).toContain(
      "DELETE FROM public_data.cafeteria_resolved_menu_entries",
    );
    expect(query.mock.calls[3]![1]).toEqual([
      "bokji",
      "2026-04-21",
      "dinner",
    ]);
    expect(String(query.mock.calls[7]![0])).toContain("COMMIT");
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("falls back to existing official document keys when service range and incoming entries are empty", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({
        rowCount: 1,
        rows: [
          {
            source_id: "bokji",
            week_start_date: "2026-04-20",
            document_scope: "weekday",
            service_start_date: null,
            service_end_date: null,
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [{ service_date: "2026-04-21", meal_type: "dinner" }],
      })
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined);
    const release = vi.fn();
    const pool = {
      connect: vi.fn(async () => ({
        query,
        release,
      })),
    } as unknown as ConstructorParameters<typeof CafeteriaRepository>[0];
    const repository = new CafeteriaRepository(pool, "public_data");

    await repository.replaceOfficialMenuEntries({
      sourceDocumentId: 403,
      sourceId: "bokji",
      entries: [],
    });

    expect(String(query.mock.calls[2]![0])).toContain(
      "FROM public_data.cafeteria_resolved_menu_entries",
    );
    expect(query.mock.calls[2]![1]).toEqual([
      "bokji",
      "2026-04-20",
      "weekday",
    ]);
    expect(String(query.mock.calls[3]![0])).toContain(
      "DELETE FROM public_data.cafeteria_resolved_menu_entries",
    );
    expect(query.mock.calls[3]![1]).toEqual([
      "bokji",
      "2026-04-21",
      "dinner",
    ]);
    expect(String(query.mock.calls[5]![0])).toContain("COMMIT");
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("preserves previously stored menu rows when a later normalization run fails", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ count: 5 }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    const release = vi.fn();
    const connect = vi.fn(async () => ({
      query,
      release,
    }));
    const pool = {
      query: vi.fn(async () => ({ rows: [] })),
      connect,
    } as unknown as ConstructorParameters<typeof CafeteriaRepository>[0];
    const repository = new CafeteriaRepository(pool, "public_data");

    await repository.syncMenuNormalization(
      {
        sourceDocumentId: 11,
        sourcePostId: 12,
        source: {
          id: "student-hall",
          name: "학생회관",
          description: "학생회관 식당",
          profileUrl: "https://www.instagram.com/mjhs_yongin/",
          instagramUsername: "mjhs_yongin",
          menuImageGroup: "student-hall-myeongjin",
          supportsWeekendMenu: true,
        },
        imageStorageKey: "cafeterias/student-hall/ABC/original.jpg",
        documentScope: "weekday",
        serviceStartDate: "2026-04-13",
        serviceEndDate: "2026-04-17",
        breakfastAvailable: true,
        lunchAvailable: true,
        dinnerAvailable: false,
      },
      {
        status: "failed",
        confidence: 0.1,
        reason: "unexpected error while normalizing cafeteria menu document",
        errorMessage: "ocr crop failed",
        entries: [],
      },
    );

    expect(query.mock.calls).toHaveLength(4);
    expect(String(query.mock.calls[2]![0])).toContain(
      "UPDATE public_data.cafeteria_menu_documents",
    );
    expect(query.mock.calls[2]![1]).toEqual([
      11,
      "failed",
      0.1,
      "unexpected error while normalizing cafeteria menu document (preserved 5 existing entries)",
      5,
      "ocr crop failed",
    ]);
    expect(String(query.mock.calls[3]![0])).toContain("COMMIT");
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("deletes stale instagram resolved rows when a refreshed OCR result no longer contains that key", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ rows: [{ count: 1 }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [{ service_date: "2026-04-14", meal_type: "dinner" }],
      })
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ rows: [{ id: 1301 }] })
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined);
    const release = vi.fn();
    const pool = {
      connect: vi.fn(async () => ({
        query,
        release,
      })),
    } as unknown as ConstructorParameters<typeof CafeteriaRepository>[0];
    const repository = new CafeteriaRepository(pool, "public_data");

    await repository.syncMenuNormalization(
      {
        sourceDocumentId: 11,
        sourcePostId: 12,
        source: {
          id: "student-hall",
          name: "학생회관",
          description: "학생회관 식당",
          profileUrl: "https://www.instagram.com/mjhs_yongin/",
          instagramUsername: "mjhs_yongin",
          menuImageGroup: "student-hall-myeongjin",
          supportsWeekendMenu: true,
        },
        imageStorageKey: "cafeterias/student-hall/ABC/original.jpg",
        documentScope: "weekday",
        serviceStartDate: "2026-04-13",
        serviceEndDate: "2026-04-17",
        breakfastAvailable: true,
        lunchAvailable: true,
        dinnerAvailable: false,
      },
      {
        status: "succeeded",
        confidence: 0.91,
        reason: "normalized 1/1 menu entries",
        errorMessage: null,
        entries: [
          {
            serviceDate: "2026-04-13",
            mealType: "breakfast",
            isClosed: false,
            menuText: "삼계탕",
            menuItems: ["삼계탕"],
            confidence: 0.81,
          },
        ],
      },
    );

    expect(String(query.mock.calls[4]![0])).toContain(
      "DELETE FROM public_data.cafeteria_resolved_menu_entries",
    );
    expect(query.mock.calls[4]![1]).toEqual([
      "student-hall",
      "2026-04-14",
      "dinner",
    ]);
    expect(String(query.mock.calls[8]![0])).toContain("COMMIT");
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("falls back to existing instagram document keys when service range and incoming entries are empty", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ rows: [{ count: 1 }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [{ service_date: "2026-04-14", meal_type: "dinner" }],
      })
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined);
    const release = vi.fn();
    const pool = {
      connect: vi.fn(async () => ({
        query,
        release,
      })),
    } as unknown as ConstructorParameters<typeof CafeteriaRepository>[0];
    const repository = new CafeteriaRepository(pool, "public_data");

    await repository.syncMenuNormalization(
      {
        sourceDocumentId: 11,
        sourcePostId: 12,
        source: {
          id: "student-hall",
          name: "학생회관",
          description: "학생회관 식당",
          profileUrl: "https://www.instagram.com/mjhs_yongin/",
          instagramUsername: "mjhs_yongin",
          menuImageGroup: "student-hall-myeongjin",
          supportsWeekendMenu: true,
        },
        imageStorageKey: "cafeterias/student-hall/ABC/original.jpg",
        documentScope: "weekday",
        serviceStartDate: null,
        serviceEndDate: null,
        breakfastAvailable: true,
        lunchAvailable: true,
        dinnerAvailable: false,
      },
      {
        status: "succeeded",
        confidence: 0.5,
        reason: "no active entries remained after refresh",
        errorMessage: null,
        entries: [],
      },
    );

    expect(String(query.mock.calls[3]![0])).toContain(
      "FROM public_data.cafeteria_menu_entries",
    );
    expect(query.mock.calls[3]![1]).toEqual([11]);
    expect(String(query.mock.calls[4]![0])).toContain(
      "DELETE FROM public_data.cafeteria_resolved_menu_entries",
    );
    expect(query.mock.calls[4]![1]).toEqual([
      "student-hall",
      "2026-04-14",
      "dinner",
    ]);
    expect(String(query.mock.calls[6]![0])).toContain("COMMIT");
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("upserts a resolved menu entry keyed by source/date/meal type", async () => {
    const pool = {
      query: vi.fn().mockResolvedValueOnce({ rows: [] }),
    } as unknown as ConstructorParameters<typeof CafeteriaRepository>[0];
    const repository = new CafeteriaRepository(pool, "public_data");

    await repository.upsertResolvedMenuEntry({
      sourceId: "student-hall",
      serviceDate: "2026-04-20",
      mealType: "breakfast",
      selectedSourceKind: "official_page",
      isClosed: false,
      menuText: "참치김치볶음밥",
      menuItems: ["참치김치볶음밥"],
      selectedAt: "2026-04-20T10:05:00+09:00",
    });

    expect(vi.mocked(pool.query).mock.calls).toHaveLength(1);
    const [sql, values] = vi.mocked(pool.query).mock.calls[0]!;
    expect(String(sql)).toContain(
      "INSERT INTO public_data.cafeteria_resolved_menu_entries",
    );
    expect(String(sql)).toContain(
      "ON CONFLICT (source_id, service_date, meal_type) DO UPDATE",
    );
    expect(values).toEqual([
      "student-hall",
      "2026-04-20",
      "breakfast",
      "official_page",
      false,
      "참치김치볶음밥",
      JSON.stringify(["참치김치볶음밥"]),
      "2026-04-20T10:05:00+09:00",
    ]);
  });

  it("refreshes resolved menu rows for a date range in a single transaction", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({
        rows: [{ service_date: "2026-04-21", meal_type: "dinner" }],
      })
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 811 }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce(undefined);
    const release = vi.fn();
    const pool = {
      connect: vi.fn(async () => ({
        query,
        release,
      })),
    } as unknown as ConstructorParameters<typeof CafeteriaRepository>[0];
    const repository = new CafeteriaRepository(pool, "public_data");

    const result = await repository.syncResolvedMenuEntriesForDateRange({
      sourceId: "student-hall",
      startDate: "2026-04-20",
      endDate: "2026-04-24",
      entries: [
        {
          sourceId: "student-hall",
          serviceDate: "2026-04-20",
          mealType: "breakfast",
          selectedSourceKind: "official_page",
          isClosed: false,
          menuText: "참치김치볶음밥",
          menuItems: ["참치김치볶음밥"],
          selectedAt: "2026-04-20T10:05:00+09:00",
        },
      ],
    });

    expect(result).toEqual({
      upsertedCount: 1,
      deletedCount: 1,
    });
    expect(String(query.mock.calls[0]![0])).toContain("BEGIN");
    expect(String(query.mock.calls[1]![0])).toContain(
      "FROM public_data.cafeteria_resolved_menu_entries",
    );
    expect(query.mock.calls[1]![1]).toEqual([
      "student-hall",
      "2026-04-20",
      "2026-04-24",
    ]);
    expect(String(query.mock.calls[2]![0])).toContain(
      "DELETE FROM public_data.cafeteria_resolved_menu_entries",
    );
    expect(query.mock.calls[2]![1]).toEqual([
      "student-hall",
      "2026-04-21",
      "dinner",
    ]);
    expect(String(query.mock.calls[3]![0])).toContain(
      "INSERT INTO public_data.cafeteria_resolved_menu_entries",
    );
    expect(String(query.mock.calls[4]![0])).toContain("COMMIT");
    expect(release).toHaveBeenCalledTimes(1);
  });
});
