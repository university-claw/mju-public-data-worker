import { describe, expect, it, vi } from "vitest";
import { CourseCatalogRepository } from "../../src/db/course-catalog-repository.js";

describe("course catalog repository", () => {
  it("upserts a snapshot and replaces entries in a single transaction", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ rows: [{ id: 77 }] })
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined);
    const release = vi.fn();
    const pool = {
      connect: vi.fn(async () => ({
        query,
        release,
      })),
    } as unknown as ConstructorParameters<typeof CourseCatalogRepository>[0];
    const repository = new CourseCatalogRepository(pool, "public_data");

    const result = await repository.replaceSnapshot({
      year: 2026,
      termCode: "10",
      termLabel: "Spring",
      sourceKind: "json_import",
      metadata: {
        source: "admin-fixture",
        cookie: "must-not-store",
      },
      entries: [
        {
          year: 2026,
          termCode: "10",
          termLabel: "Spring",
          category: "unknown",
          categoryLabel: "unknown",
          courseCode: "HAA01123",
          curriculumNumber: null,
          courseTitle: "Operating Systems",
          gradeLevel: "3학년",
          section: "001",
          professor: "Kim",
          credit: 3,
          department: "Computer Engineering",
          campus: "Seoul",
          meetings: [
            {
              rawTimeRange: "Mon 09:00-10:15",
              dayOfWeek: 1,
              dayLabel: "Mon",
              startTime: "09:00",
              endTime: "10:15",
              parseStatus: "parsed",
              warning: null,
            },
          ],
        },
      ],
    });

    expect(result).toEqual({
      snapshotId: 77,
      year: 2026,
      termCode: "10",
      entryCount: 1,
    });
    expect(String(query.mock.calls[0]?.[0])).toContain("BEGIN");
    expect(String(query.mock.calls[1]?.[0])).toContain(
      "INSERT INTO public_data.course_catalog_snapshots",
    );
    expect(String(query.mock.calls[1]?.[0])).toContain(
      "ON CONFLICT (year, term_code, snapshot_key) DO UPDATE",
    );
    expect(query.mock.calls[1]?.[1]).toEqual([
      2026,
      "10",
      "Spring",
      "json_import",
      expect.stringMatching(/^json_import:[a-f0-9]{24}$/),
      JSON.stringify({ source: "admin-fixture" }),
      expect.any(String),
      1,
    ]);
    expect(String(query.mock.calls[2]?.[0])).toContain(
      "DELETE FROM public_data.course_catalog_entries",
    );
    expect(query.mock.calls[2]?.[1]).toEqual([77]);
    expect(String(query.mock.calls[3]?.[0])).toContain(
      "INSERT INTO public_data.course_catalog_entries",
    );
    expect(query.mock.calls[3]?.[1]).toEqual([
      77,
      2026,
      "10",
      "Spring",
      "unknown",
      "unknown",
      "HAA01123",
      null,
      "Operating Systems",
      "3학년",
      "001",
      "Kim",
      3,
      "Computer Engineering",
      "Seoul",
      JSON.stringify([
        {
          rawTimeRange: "Mon 09:00-10:15",
          dayOfWeek: 1,
          dayLabel: "Mon",
          startTime: "09:00",
          endTime: "10:15",
          parseStatus: "parsed",
          warning: null,
        },
      ]),
    ]);
    expect(String(query.mock.calls[4]?.[0])).toContain(
      "UPDATE public_data.course_catalog_snapshots",
    );
    expect(String(query.mock.calls[5]?.[0])).toContain("COMMIT");
    expect(release).toHaveBeenCalledTimes(1);
  });
});
