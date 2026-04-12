import { describe, expect, it } from "vitest";
import { structureCafeteriaMenuDocument } from "../../src/cafeterias/menu-document-structurer.js";
import type { CafeteriaInstagramSource } from "../../src/cafeterias/types.js";

const STUDENT_HALL: CafeteriaInstagramSource = {
  id: "student-hall",
  name: "학생회관",
  description: "학생회관",
  profileUrl: "https://www.instagram.com/mjhs_yongin/",
  instagramUsername: "mjhs_yongin",
  menuImageGroup: "student-hall-myeongjin",
  supportsWeekendMenu: true,
};

const BOKJI: CafeteriaInstagramSource = {
  id: "bokji",
  name: "복지동",
  description: "복지동",
  profileUrl: "https://www.instagram.com/mj_bokji_foodist/",
  instagramUsername: "mj_bokji_foodist",
  menuImageGroup: "bokji-bangmok",
  supportsWeekendMenu: false,
};

describe("cafeteria menu document structurer", () => {
  it("structures student-hall weekday sheets with breakfast and lunch availability", () => {
    const result = structureCafeteriaMenuDocument(STUDENT_HALL, {
      id: 1,
      sourceId: "student-hall",
      postedAt: "2026-04-12T06:20:08.000Z",
      caption: "학관 다음 주 식단 가져왔어요 #식단나왔어요",
      ocrText:
        "학생회관 주중식단표 04.13-04.17 조식 : 8시~9시 중식 : 11시00분~14시00분",
    });

    expect(result).toEqual({
      documentScope: "weekday",
      scopeConfidence: 0.98,
      scopeReason: "matched explicit weekday keyword",
      serviceStartDate: "2026-04-13",
      serviceEndDate: "2026-04-17",
      breakfastAvailable: true,
      lunchAvailable: true,
      dinnerAvailable: false,
    });
  });

  it("structures student-hall weekend sheets as lunch only", () => {
    const result = structureCafeteriaMenuDocument(STUDENT_HALL, {
      id: 2,
      sourceId: "student-hall",
      postedAt: "2026-04-10T22:32:05.000Z",
      caption: "주말꺼 올려요",
      ocrText:
        "04.11-04.12 학생회관 1층 식당 주말 중식 운영시간 : 11:00 ~ 14:00 / 6,000원",
    });

    expect(result).toEqual({
      documentScope: "weekend",
      scopeConfidence: 0.98,
      scopeReason: "matched explicit weekend keyword",
      serviceStartDate: "2026-04-11",
      serviceEndDate: "2026-04-12",
      breakfastAvailable: false,
      lunchAvailable: true,
      dinnerAvailable: false,
    });
  });

  it("falls back to weekday scope for weekday-only cafeterias and keeps lunch/dinner", () => {
    const result = structureCafeteriaMenuDocument(BOKJI, {
      id: 3,
      sourceId: "bokji",
      postedAt: "2026-04-06T00:28:33.000Z",
      caption: "4/6 (월) ~ 4/10(금) 주간 메뉴표입니다.",
      ocrText:
        "2026.4.6-4.10 운영시간 중식 11:30~13:30 석식 17:00~18:30",
    });

    expect(result).toEqual({
      documentScope: "weekday",
      scopeConfidence: 0.94,
      scopeReason: "date range 2026-04-06~2026-04-10 maps to Monday-Friday",
      serviceStartDate: "2026-04-06",
      serviceEndDate: "2026-04-10",
      breakfastAvailable: false,
      lunchAvailable: true,
      dinnerAvailable: true,
    });
  });

  it("parses caption ranges that include weekday parentheses", () => {
    const result = structureCafeteriaMenuDocument(BOKJI, {
      id: 4,
      sourceId: "bokji",
      postedAt: "2026-03-22T12:00:00.000Z",
      caption: "3/23(월) ~ 3/27(금) 주간 메뉴표입니다.",
      ocrText: "중식 11:30~13:30 석식 17:00~18:30",
    });

    expect(result.serviceStartDate).toBe("2026-03-23");
    expect(result.serviceEndDate).toBe("2026-03-27");
    expect(result.documentScope).toBe("weekday");
  });

  it("treats end-day-only Korean ranges as the next month when needed", () => {
    const result = structureCafeteriaMenuDocument(BOKJI, {
      id: 5,
      sourceId: "bokji",
      postedAt: "2026-03-29T12:00:00.000Z",
      caption: "3월 30일~ 3일 주간식단표",
      ocrText: "중식 11:30~13:30 석식 17:00~18:30",
    });

    expect(result.serviceStartDate).toBe("2026-03-30");
    expect(result.serviceEndDate).toBe("2026-04-03");
    expect(result.documentScope).toBe("weekday");
  });

  it("defaults student-hall menu sheets without weekend signals to weekday", () => {
    const result = structureCafeteriaMenuDocument(STUDENT_HALL, {
      id: 6,
      sourceId: "student-hall",
      postedAt: "2026-04-05T12:00:00.000Z",
      caption: "다음 주 메뉴 가져왔어요",
      ocrText: "조식 : 8시~9시 중식 : 11시00분~14시00분",
    });

    expect(result).toMatchObject({
      documentScope: "weekday",
      scopeConfidence: 0.72,
      breakfastAvailable: true,
      lunchAvailable: true,
      dinnerAvailable: false,
    });
  });

  it("derives the base year in Asia/Seoul for year-boundary posts", () => {
    const result = structureCafeteriaMenuDocument(BOKJI, {
      id: 7,
      sourceId: "bokji",
      postedAt: "2026-12-31T15:10:00.000Z",
      caption: "1/2(토) ~ 1/6(수) 주간 메뉴표입니다.",
      ocrText: "중식 11:30~13:30 석식 17:00~18:30",
    });

    expect(result.serviceStartDate).toBe("2027-01-02");
    expect(result.serviceEndDate).toBe("2027-01-06");
  });
});
