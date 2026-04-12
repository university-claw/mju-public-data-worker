import { describe, expect, it } from "vitest";
import { classifyCafeteriaInstagramPost } from "../../src/cafeterias/post-classifier.js";

describe("cafeteria post classifier", () => {
  it("classifies clear menu sheet posts from caption keywords", () => {
    const result = classifyCafeteriaInstagramPost({
      id: 1,
      sourceId: "student-hall",
      caption: "학관 다음 주 식단 가져왔어요 #식단나왔어요",
      ocrText: null,
    });

    expect(result).toMatchObject({
      postKind: "menu_sheet",
    });
    expect(result.reason).toMatch(/menu keyword/);
  });

  it("classifies menu sheet posts from OCR structure even without explicit caption keyword", () => {
    const result = classifyCafeteriaInstagramPost({
      id: 2,
      sourceId: "bangmok",
      caption: "다음 주도 맛있게 준비했어요",
      ocrText:
        "주간 안내 2026.04.13-04.17 월 화 수 목 금 점심 석식 고구마치즈돈까스 육개장",
    });

    expect(result).toMatchObject({
      postKind: "menu_sheet",
    });
    expect(result.reason).toMatch(/date range and weekday\/meal structure/);
  });

  it("classifies operating-hours announcements as non-menu", () => {
    const result = classifyCafeteriaInstagramPost({
      id: 3,
      sourceId: "myeongjin",
      caption: "명진당 백반집 운영시간 확장 안내입니다",
      ocrText: "운영시간 확장안내 월~목요일 14:15 금요일 14:00",
    });

    expect(result).toMatchObject({
      postKind: "non_menu",
    });
    expect(result.reason).toMatch(/non-menu keyword/);
  });

  it("keeps ambiguous posts as unknown", () => {
    const result = classifyCafeteriaInstagramPost({
      id: 4,
      sourceId: "myeongjin",
      caption: "새 공지 올렸어요",
      ocrText: null,
    });

    expect(result).toEqual({
      postKind: "unknown",
      confidence: 0.4,
      reason: "no strong menu or non-menu signal detected",
    });
  });
});
