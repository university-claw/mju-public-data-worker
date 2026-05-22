import { describe, expect, it } from "vitest";
import { normalizeShuttleTimetableText } from "../../src/shuttles/timetable-normalizer.js";

describe("shuttle timetable normalizer", () => {
  it("normalizes body and attachment text into departure rows", () => {
    const rows = normalizeShuttleTimetableText({
      title: "2026학년도 1학기 학기 중 통학·셔틀버스 운행 안내",
      bodyText: "자연캠퍼스 셔틀 노선: 명지대역 -> 자연캠퍼스",
      attachmentTexts: [
        [
          "평일",
          "명지대역 출발 08:30 09:00 17:40",
          "자연캠퍼스 출발 18:10 18:40",
          "토요일 명지대역 출발 09:10",
        ].join("\n"),
      ],
      term: {
        academicYear: 2026,
        termLabel: "1학기",
      },
    });

    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          campus: "자연",
          stopName: "명지대역",
          dayType: "weekday",
          departureTime: "08:30",
        }),
        expect.objectContaining({
          campus: "자연",
          stopName: "자연캠퍼스",
          dayType: "weekday",
          departureTime: "18:40",
        }),
        expect.objectContaining({
          campus: "자연",
          stopName: "명지대역",
          dayType: "saturday",
          departureTime: "09:10",
        }),
      ]),
    );
  });

  it("throws when no departure time is extractable", () => {
    expect(() =>
      normalizeShuttleTimetableText({
        title: "셔틀버스 운행 안내",
        bodyText: "자세한 사항은 학생지원팀에 문의 바랍니다.",
        attachmentTexts: [],
        term: {
          academicYear: 2026,
          termLabel: "1학기",
        },
      }),
    ).toThrow("출발 시각을 찾지 못했습니다");
  });
});
