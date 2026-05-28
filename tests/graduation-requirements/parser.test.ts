import { describe, expect, it } from "vitest";
import { parseGraduationRequirementJson } from "../../src/graduation-requirements/parser.js";

describe("parseGraduationRequirementJson", () => {
  it("normalizes one official graduation requirement JSON payload", () => {
    const parsed = parseGraduationRequirementJson(JSON.stringify({
      department: "Computer Engineering",
      admissionYear: "2025",
      sourceKind: "department_page",
      sourceTitle: "Official computer engineering graduation guide",
      sourceUrl: "https://www.mju.ac.kr/mjukr/808/subview.do",
      sourcePublishedAt: "2026-05-01T00:00:00.000Z",
      rules: [
        {
          requirement_key: "major-required",
          name: "Major required courses",
          category_label: "major",
          required_credits: "6",
          required_course_codes: ["CSE401", null, ""],
          required_course_titles: ["Capstone Design 1", "Capstone Design 2"],
          program_track: "engineering",
          min_courses: 2,
          applies_to: {
            admissionYearFrom: 2025,
            studentType: "domestic",
          },
          course_groups: [
            {
              key: "capstone-sequence",
              label: "Capstone sequence",
              min_courses: 2,
              required_course_titles: ["Capstone Design 1", "Capstone Design 2"],
              group_type: "required",
              applies_to: {
                graduationTermFrom: "2027-08",
              },
              note: "Official source confirmed.",
            },
          ],
        },
      ],
    }));

    expect(parsed).toMatchObject({
      department: "Computer Engineering",
      admissionYear: 2025,
      sourceKind: "department_page",
      sourceTitle: "Official computer engineering graduation guide",
      sourceUrl: "https://www.mju.ac.kr/mjukr/808/subview.do",
      sourcePublishedAt: "2026-05-01T00:00:00.000Z",
      rules: [
        {
          requirementKey: "major-required",
          label: "Major required courses",
          category: "major",
          requiredCredits: 6,
          requiredCourseCodes: ["CSE401"],
          requiredCourseTitles: ["Capstone Design 1", "Capstone Design 2"],
          programTrack: "engineering",
          minCourses: 2,
          appliesTo: {
            admissionYearFrom: 2025,
            studentType: "domestic",
          },
          status: "confirmed",
          courseGroups: [
            {
              groupKey: "capstone-sequence",
              label: "Capstone sequence",
              minCourses: 2,
              requiredCourseTitles: ["Capstone Design 1", "Capstone Design 2"],
              groupType: "required",
              appliesTo: {
                graduationTermFrom: "2027-08",
              },
              note: "Official source confirmed.",
            },
          ],
        },
      ],
    });
    expect(parsed.rawPayload).toMatchObject({
      sourceTitle: "Official computer engineering graduation guide",
    });
  });

  it("uses CLI defaults and preserves unprovided official-source gaps", () => {
    const parsed = parseGraduationRequirementJson(JSON.stringify({
      requirements: [
        {
          key: "official-detail-unavailable",
          label: "Official detail unavailable",
          category: "major",
          status: "unprovided",
          note: "The official page does not publish course-level detail yet.",
        },
      ],
    }), {
      defaultDepartment: "Electronic Engineering",
      defaultAdmissionYear: 2024,
      defaultSourceTitle: "Official department page",
      defaultSourceUrl: "https://www.mju.ac.kr/mjukr/752/subview.do",
    });

    expect(parsed.department).toBe("Electronic Engineering");
    expect(parsed.admissionYear).toBe(2024);
    expect(parsed.sourceKind).toBe("msi_graduation");
    expect(parsed.rules[0]).toMatchObject({
      requirementKey: "official-detail-unavailable",
      status: "unprovided",
      requiredCredits: null,
      minCourses: null,
      appliesTo: {},
    });
  });

  it("rejects malformed requirement imports before touching the database", () => {
    expect(() => parseGraduationRequirementJson("[]")).toThrow(
      "graduation requirement import JSON must be an object",
    );
    expect(() => parseGraduationRequirementJson(JSON.stringify({
      department: "Computer Engineering",
      admissionYear: 2025,
      sourceTitle: "Official guide",
      sourceUrl: "https://www.mju.ac.kr/mjukr/808/subview.do",
    }))).toThrow("graduation requirement import JSON must contain rules[]");
    expect(() => parseGraduationRequirementJson(JSON.stringify({
      department: "Computer Engineering",
      admissionYear: 2025,
      sourceTitle: "Official guide",
      sourceUrl: "https://www.mju.ac.kr/mjukr/808/subview.do",
      rules: [{}],
    }))).toThrow("rules[0].requirementKey is required");
  });
});
