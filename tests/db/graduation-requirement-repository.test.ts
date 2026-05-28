import { describe, expect, it, vi } from "vitest";
import { GraduationRequirementRepository } from "../../src/db/graduation-requirement-repository.js";

describe("graduation requirement repository", () => {
  it("upserts an official source and replaces normalized rules in one transaction", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ rows: [{ id: 91 }] })
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined);
    const release = vi.fn();
    const pool = {
      connect: vi.fn(async () => ({
        query,
        release,
      })),
    } as unknown as ConstructorParameters<typeof GraduationRequirementRepository>[0];
    const repository = new GraduationRequirementRepository(pool, "public_data");

    const result = await repository.replaceSource({
      department: "컴퓨터공학과",
      admissionYear: 2022,
      sourceKind: "msi_graduation",
      sourceTitle: "MSI 졸업사정 조회",
      sourceUrl: "mju-msi://graduation/computer-engineering/2022",
      sourcePublishedAt: null,
      rawPayload: {
        department: "컴퓨터공학과",
        requiredCredits: { major: 66, liberal: 30 },
      },
      rules: [
        {
          requirementKey: "major-credit",
          label: "전공 학점",
          category: "major",
          requiredCredits: 66,
          requiredCourseCodes: [],
          requiredCourseTitles: [],
          courseGroups: [
            {
              groupKey: "major-basic",
              label: "전공기초",
              minCourses: 1,
              requiredCourseTitles: ["자료구조"],
            },
          ],
          programTrack: "비인증",
          minCourses: 1,
          appliesTo: { admissionYearFrom: 2018 },
          status: "confirmed",
          note: null,
        },
      ],
    });

    expect(result).toEqual({
      sourceId: 91,
      department: "컴퓨터공학과",
      admissionYear: 2022,
      ruleCount: 1,
    });
    expect(String(query.mock.calls[0]?.[0])).toContain("BEGIN");
    expect(String(query.mock.calls[1]?.[0])).toContain(
      "INSERT INTO public_data.graduation_requirement_sources",
    );
    expect(String(query.mock.calls[1]?.[0])).toContain(
      "ON CONFLICT (department, admission_year, source_url) DO UPDATE",
    );
    expect(query.mock.calls[1]?.[1]).toEqual([
      "컴퓨터공학과",
      2022,
      "msi_graduation",
      "MSI 졸업사정 조회",
      "mju-msi://graduation/computer-engineering/2022",
      null,
      expect.any(String),
      JSON.stringify({
        department: "컴퓨터공학과",
        requiredCredits: { major: 66, liberal: 30 },
      }),
    ]);
    expect(String(query.mock.calls[2]?.[0])).toContain(
      "DELETE FROM public_data.graduation_requirement_rules",
    );
    expect(query.mock.calls[2]?.[1]).toEqual([91]);
    expect(String(query.mock.calls[3]?.[0])).toContain(
      "INSERT INTO public_data.graduation_requirement_rules",
    );
    expect(query.mock.calls[3]?.[1]).toEqual([
      91,
      "컴퓨터공학과",
      2022,
      "major-credit",
      "전공 학점",
      "major",
      66,
      JSON.stringify([]),
      JSON.stringify([]),
      JSON.stringify([
        {
          groupKey: "major-basic",
          label: "전공기초",
          minCourses: 1,
          requiredCourseTitles: ["자료구조"],
        },
      ]),
      "비인증",
      1,
      JSON.stringify({ admissionYearFrom: 2018 }),
      "confirmed",
      null,
    ]);
    expect(String(query.mock.calls[4]?.[0])).toContain("COMMIT");
    expect(release).toHaveBeenCalledTimes(1);
  });
});
