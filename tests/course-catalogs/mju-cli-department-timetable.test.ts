import { describe, expect, it } from "vitest";
import { courseCatalogFromMjuCliDepartmentTimetable } from "../../src/course-catalogs/mju-cli-department-timetable.js";

describe("mju CLI department timetable catalog adapter", () => {
  it("converts MSI department timetable rows into a course catalog snapshot", () => {
    const snapshot = courseCatalogFromMjuCliDepartmentTimetable(
      {
        year: 2026,
        termCode: "10",
        termLabel: "1학기",
        campusDiv: "",
        campusLabel: "전체",
        departmentCode: "15611",
        departmentLabel: "15611 컴퓨터정보통신공학부 컴퓨터공학전공",
        resultCount: 27,
        entries: [
          {
            gradeLevel: "3학년",
            courseTitle: "기계학습",
            credit: 3,
            professor: "현상원",
            section: "0727",
            curiNum: "JEJ01472",
            meetings: [
              {
                dayOfWeek: 1,
                dayLabel: "월",
                timeRange: "13:00~14:50",
                startTime: "13:00",
                endTime: "14:50",
                location: "Y5445",
              },
              {
                dayOfWeek: 3,
                dayLabel: "수",
                timeRange: "13:00~13:50",
                startTime: "13:00",
                endTime: "13:50",
                location: "Y5445",
              },
            ],
          },
        ],
      },
      {
        year: 2026,
        termCode: "10",
        termLabel: "1학기",
      },
    );

    expect(snapshot).toMatchObject({
      year: 2026,
      termCode: "10",
      termLabel: "1학기",
      sourceKind: "mju_cli_msi_department_timetable",
      metadata: {
        source: "mju-cli msi department-timetable",
        departmentCode: "15611",
        resultCount: 27,
      },
    });
    expect(snapshot.entries).toHaveLength(1);
    expect(snapshot.entries[0]).toMatchObject({
      category: "major",
      categoryLabel: "전공",
      courseCode: "JEJ01472",
      curriculumNumber: "JEJ01472",
      courseTitle: "기계학습",
      gradeLevel: "3학년",
      section: "0727",
      professor: "현상원",
      credit: 3,
      department: "15611 컴퓨터정보통신공학부 컴퓨터공학전공",
      campus: "전체",
    });
    expect(snapshot.entries[0]?.meetings).toEqual([
      {
        rawTimeRange: "월 13:00~14:50 (Y5445)",
        dayOfWeek: 1,
        dayLabel: "월",
        startTime: "13:00",
        endTime: "14:50",
        location: "Y5445",
        parseStatus: "parsed",
        warning: null,
      },
      {
        rawTimeRange: "수 13:00~13:50 (Y5445)",
        dayOfWeek: 3,
        dayLabel: "수",
        startTime: "13:00",
        endTime: "13:50",
        location: "Y5445",
        parseStatus: "parsed",
        warning: null,
      },
    ]);
  });

  it("classifies liberal arts department rows into Korean subcategories", () => {
    const snapshot = courseCatalogFromMjuCliDepartmentTimetable(
      {
        year: 2026,
        termCode: "10",
        termLabel: "1학기",
        campusDiv: "",
        campusLabel: "전체",
        departmentCode: "10000",
        departmentLabel: "10000 자연캠퍼스 교양",
        entries: [
          {
            gradeLevel: "전학년",
            courseTitle: "성서와인간이해",
            credit: 2,
            professor: "김진옥",
            section: "0001",
            curiNum: "KMA00101",
            meetings: [
              {
                dayOfWeek: 1,
                dayLabel: "월",
                timeRange: "09:00~10:50",
                startTime: "09:00",
                endTime: "10:50",
                location: "Y2529",
              },
            ],
          },
          {
            gradeLevel: "전학년",
            courseTitle: "현대사회와문학",
            credit: 3,
            professor: "이교수",
            section: "0002",
            curiNum: "KMB01234",
            meetings: [],
          },
        ],
      },
      {
        year: 2026,
        termCode: "10",
        termLabel: "1학기",
      },
    );

    expect(snapshot.entries.map((entry) => ({
      category: entry.category,
      categoryLabel: entry.categoryLabel,
      courseCode: entry.courseCode,
    }))).toEqual([
      {
        category: "elective",
        categoryLabel: "공통교양",
        courseCode: "KMA00101",
      },
      {
        category: "elective",
        categoryLabel: "핵심교양",
        courseCode: "KMB01234",
      },
    ]);
  });
});
