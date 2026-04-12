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

  it("creates or refreshes a menu document only for menu_sheet posts", async () => {
    const { pool, query, release } = createConnectedPoolMock();
    const repository = new CafeteriaRepository(pool, "public_data");

    await repository.syncInstagramPostClassification(7, {
      postKind: "menu_sheet",
      confidence: 0.95,
      reason: "matched menu keyword: 식단표",
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

  it("removes an existing menu document when the post becomes non-menu", async () => {
    const { pool, query, release } = createConnectedPoolMock();
    const repository = new CafeteriaRepository(pool, "public_data");

    await repository.syncInstagramPostClassification(9, {
      postKind: "non_menu",
      confidence: 0.82,
      reason: "matched non-menu keyword: 운영시간 확장 안내",
    });

    expect(query.mock.calls).toHaveLength(4);
    expect(String(query.mock.calls[2]![0])).toContain(
      "DELETE FROM public_data.cafeteria_menu_documents",
    );
    expect(String(query.mock.calls[3]![0])).toContain("COMMIT");
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("removes any existing menu document when the post remains unknown", async () => {
    const { pool, query, release } = createConnectedPoolMock();
    const repository = new CafeteriaRepository(pool, "public_data");

    await repository.syncInstagramPostClassification(11, {
      postKind: "unknown",
      confidence: 0.4,
      reason: "no strong menu or non-menu signal detected",
    });

    expect(query.mock.calls).toHaveLength(4);
    expect(String(query.mock.calls[2]![0])).toContain(
      "DELETE FROM public_data.cafeteria_menu_documents",
    );
    expect(String(query.mock.calls[3]![0])).toContain("COMMIT");
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
        confidence: 0.95,
        reason: "matched menu keyword: 식단표",
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
        confidence: 0.95,
        reason: "matched menu keyword: 식단표",
      }),
    ).rejects.toThrow(
      "menu_sheet classification requires structured menu document metadata",
    );

    expect(connect).not.toHaveBeenCalled();
  });
});
