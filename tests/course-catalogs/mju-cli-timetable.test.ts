import { describe, expect, it } from "vitest";
import { courseCatalogFromMjuCliTimetable } from "../../src/course-catalogs/mju-cli-timetable.js";

describe("mju CLI timetable catalog adapter", () => {
  it("converts authenticated MSI timetable output into a catalog snapshot", () => {
    const snapshot = courseCatalogFromMjuCliTimetable(
      {
        year: 2026,
        termCode: "10",
        termLabel: "1학기",
        entries: [
          {
            courseTitle: "자료구조",
            curiNum: "CSE201",
            courseCls: "001",
            professor: "김교수",
            location: "S1350",
            dayOfWeek: 1,
            dayLabel: "월",
            timeRange: "09:00~10:50",
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
      sourceKind: "mju_cli_msi_timetable",
      metadata: {
        source: "mju-cli msi timetable",
      },
    });
    expect(snapshot.entries).toHaveLength(1);
    expect(snapshot.entries[0]).toMatchObject({
      category: "unknown",
      categoryLabel: "MSI 시간표",
      courseCode: "CSE201",
      curriculumNumber: "CSE201",
      courseTitle: "자료구조",
      section: "001",
      professor: "김교수",
    });
    expect(snapshot.entries[0]?.meetings[0]).toMatchObject({
      rawTimeRange: "월 09:00~10:50 S1350",
      dayOfWeek: 1,
      startTime: "09:00",
      endTime: "10:50",
      parseStatus: "parsed",
    });
  });

  it("falls back to explicit term metadata when CLI output omits it", () => {
    const snapshot = courseCatalogFromMjuCliTimetable(
      {
        entries: [
          {
            courseTitle: "Operating Systems",
            dayOfWeek: 3,
            timeRange: "1300-1450",
          },
        ],
      },
      {
        year: 2027,
        termCode: "20",
        termLabel: "2학기",
        category: "major",
        categoryLabel: "전공",
      },
    );

    expect(snapshot.year).toBe(2027);
    expect(snapshot.termCode).toBe("20");
    expect(snapshot.termLabel).toBe("2학기");
    expect(snapshot.entries[0]).toMatchObject({
      category: "major",
      categoryLabel: "전공",
      courseTitle: "Operating Systems",
    });
  });

  it("merges multiple timetable rows for the same course into meetings", () => {
    const snapshot = courseCatalogFromMjuCliTimetable(
      {
        year: 2026,
        termCode: "10",
        termLabel: "1학기",
        entries: [
          {
            courseTitle: "Computer Architecture",
            curiNum: "CSE301",
            courseCls: "001",
            professor: "Prof A",
            dayOfWeek: 2,
            dayLabel: "화",
            timeRange: "15:00~16:50",
          },
          {
            courseTitle: "Computer Architecture",
            curiNum: "CSE301",
            courseCls: "001",
            professor: "Prof A",
            dayOfWeek: 4,
            dayLabel: "목",
            timeRange: "15:00~15:50",
          },
        ],
      },
      {
        year: 2026,
        termCode: "10",
        termLabel: "1학기",
      },
    );

    expect(snapshot.entries).toHaveLength(1);
    expect(snapshot.metadata.rawEntryCount).toBe(2);
    expect(snapshot.entries[0]?.meetings).toHaveLength(2);
    expect(snapshot.entries[0]?.meetings.map((meeting) => meeting.dayOfWeek)).toEqual([
      2,
      4,
    ]);
  });
});
