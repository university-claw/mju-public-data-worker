import { describe, expect, it, vi } from "vitest";
import { CafeteriaRepository } from "../../src/db/cafeteria-repository.js";

describe("cafeteria repository", () => {
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
});
