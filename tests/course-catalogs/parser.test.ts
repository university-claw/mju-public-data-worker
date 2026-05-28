import { describe, expect, it } from "vitest";
import { normalizeMeetingSlot } from "../../src/course-catalogs/meeting-normalizer.js";
import {
  parseCourseCatalogHtml,
  parseCourseCatalogJson,
  parseCourseCatalogJsonSnapshots,
} from "../../src/course-catalogs/parser.js";

describe("course catalog parser", () => {
  it("preserves raw meeting ranges and normalizes day and time slots", () => {
    expect(normalizeMeetingSlot("Mon/Wed 09:00-10:15")).toEqual([
      {
        rawTimeRange: "Mon/Wed 09:00-10:15",
        dayOfWeek: 1,
        dayLabel: "Mon",
        startTime: "09:00",
        endTime: "10:15",
        parseStatus: "parsed",
        warning: null,
      },
      {
        rawTimeRange: "Mon/Wed 09:00-10:15",
        dayOfWeek: 3,
        dayLabel: "Wed",
        startTime: "09:00",
        endTime: "10:15",
        parseStatus: "parsed",
        warning: null,
      },
    ]);
  });

  it("keeps partial and unparsed meeting slots explicit", () => {
    expect(normalizeMeetingSlot("09:00-10:15")).toEqual([
      {
        rawTimeRange: "09:00-10:15",
        startTime: "09:00",
        endTime: "10:15",
        parseStatus: "partial",
        warning: "meeting day could not be parsed",
      },
    ]);
    expect(normalizeMeetingSlot("TBA")).toEqual([
      {
        rawTimeRange: "TBA",
        parseStatus: "unparsed",
        warning: "meeting slot could not be parsed",
      },
    ]);
  });

  it("handles missing optional fields and makes unknown category explicit", () => {
    const parsed = parseCourseCatalogJson(
      JSON.stringify({
        year: 2026,
        termCode: "10",
        termLabel: "Spring",
        entries: [
          {
            courseTitle: "Data Structures",
            meetings: "Tue 13:30-14:45",
          },
        ],
      }),
    );

    expect(parsed.entries).toEqual([
      {
        year: 2026,
        termCode: "10",
        termLabel: "Spring",
        category: "unknown",
        categoryLabel: "unknown",
        courseCode: null,
        curriculumNumber: null,
        courseTitle: "Data Structures",
        gradeLevel: null,
        section: null,
        professor: null,
        credit: null,
        department: null,
        campus: null,
        meetings: [
          {
            rawTimeRange: "Tue 13:30-14:45",
            dayOfWeek: 2,
            dayLabel: "Tue",
            startTime: "13:30",
            endTime: "14:45",
            parseStatus: "parsed",
            warning: null,
          },
        ],
      },
    ]);
  });

  it("parses exported course catalog snapshot arrays", () => {
    const snapshots = parseCourseCatalogJsonSnapshots(
      JSON.stringify([
        {
          year: 2026,
          termCode: "10",
          termLabel: "1학기",
          sourceKind: "mju_cli_msi_department_timetable",
          metadata: { departmentCode: "15611" },
          entries: [
            {
              category: "major",
              categoryLabel: "전공",
              courseTitle: "기계학습",
            },
          ],
        },
        {
          year: 2026,
          termCode: "10",
          termLabel: "1학기",
          sourceKind: "mju_cli_msi_department_timetable",
          metadata: { departmentCode: "10000" },
          entries: [
            {
              category: "elective",
              categoryLabel: "공통교양",
              courseTitle: "성서와인간이해",
            },
          ],
        },
      ]),
    );

    expect(snapshots).toHaveLength(2);
    expect(snapshots[0]).toMatchObject({
      sourceKind: "mju_cli_msi_department_timetable",
      metadata: { departmentCode: "15611" },
      entries: [{ courseTitle: "기계학습", categoryLabel: "전공" }],
    });
    expect(snapshots[1]).toMatchObject({
      sourceKind: "mju_cli_msi_department_timetable",
      metadata: { departmentCode: "10000" },
      entries: [{ courseTitle: "성서와인간이해", categoryLabel: "공통교양" }],
    });
  });

  it("preserves normalized meeting objects from JSON imports", () => {
    const parsed = parseCourseCatalogJson(
      JSON.stringify({
        year: 2026,
        termCode: "10",
        termLabel: "Spring",
        entries: [
          {
            category: "major",
            courseTitle: "Civil Procedure",
            meetings: [
              {
                rawTimeRange: "Mon 09:00~10:15",
                dayOfWeek: 1,
                dayLabel: "Mon",
                startTime: "09:00",
                endTime: "10:15",
                location: "Y5441",
                parseStatus: "parsed",
                warning: null,
              },
            ],
          },
        ],
      }),
    );

    expect(parsed.entries[0]?.meetings).toEqual([
      {
        rawTimeRange: "Mon 09:00~10:15",
        dayOfWeek: 1,
        dayLabel: "Mon",
        startTime: "09:00",
        endTime: "10:15",
        location: "Y5441",
        parseStatus: "parsed",
        warning: null,
      },
    ]);
  });

  it("parses MSI-like HTML tables when term metadata is supplied", () => {
    const parsed = parseCourseCatalogHtml(
      `
        <table>
          <tr>
            <th>Category</th>
            <th>Course Code</th>
            <th>Course Title</th>
            <th>Grade Level</th>
            <th>Section</th>
            <th>Professor</th>
            <th>Credit</th>
            <th>Meetings</th>
          </tr>
          <tr>
            <td>major</td>
            <td>HAA01123</td>
            <td>Operating Systems</td>
            <td>3학년</td>
            <td>001</td>
            <td>Kim</td>
            <td>3</td>
            <td>Thu 10:30-11:45</td>
          </tr>
        </table>
      `,
      {
        defaultYear: 2026,
        defaultTermCode: "10",
        defaultTermLabel: "Spring",
      },
    );

    expect(parsed.entries[0]).toMatchObject({
      year: 2026,
      termCode: "10",
      termLabel: "Spring",
      category: "major",
      courseCode: "HAA01123",
      courseTitle: "Operating Systems",
      gradeLevel: "3학년",
      section: "001",
      professor: "Kim",
      credit: 3,
    });
    expect(parsed.entries[0]?.meetings[0]).toMatchObject({
      rawTimeRange: "Thu 10:30-11:45",
      dayOfWeek: 4,
      startTime: "10:30",
      endTime: "11:45",
      parseStatus: "parsed",
    });
  });

  it("does not persist sensitive metadata or warning contents", () => {
    const parsed = parseCourseCatalogJson(
      JSON.stringify({
        year: 2026,
        termCode: "10",
        termLabel: "Spring",
        metadata: {
          source: "fixture",
          cookie: "JSESSIONID=abc",
          ssoSessionId: "secret-session",
          adminAccountId: "admin@example.com",
          nested: {
            token: "bearer abc",
            retained: "ok",
          },
        },
        entries: [
          {
            courseTitle: "Privacy Seminar",
            meetings: "admin session id leaked in raw warning",
          },
        ],
      }),
    );

    expect(parsed.metadata).toEqual({
      source: "fixture",
      nested: {
        retained: "ok",
      },
    });
    expect(parsed.entries[0]?.meetings[0]?.rawTimeRange).toBe(
      "[redacted sensitive meeting slot]",
    );
    expect(parsed.entries[0]?.meetings[0]?.warning).toBe(
      "warning omitted because it contained sensitive source details",
    );
  });
});
