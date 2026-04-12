import { describe, expect, it } from "vitest";
import { classifyCafeteriaInstagramPost } from "../../src/cafeterias/post-classifier.js";
import type {
  CafeteriaInstagramPostSnapshot,
  CafeteriaInstagramSource,
} from "../../src/cafeterias/types.js";

const STUDENT_HALL_SOURCE: CafeteriaInstagramSource = {
  id: "student-hall",
  name: "학생회관",
  description: "학생회관",
  profileUrl: "https://www.instagram.com/mjhs_yongin/",
  instagramUsername: "mjhs_yongin",
  menuImageGroup: "student-hall-myeongjin",
  supportsWeekendMenu: true,
};

const MYEONGJIN_SOURCE: CafeteriaInstagramSource = {
  id: "myeongjin",
  name: "명진당",
  description: "명진당",
  profileUrl: "https://www.instagram.com/mju_lounge/",
  instagramUsername: "mju_lounge",
  menuImageGroup: "student-hall-myeongjin",
  supportsWeekendMenu: false,
};

function makeSnapshot(
  overrides: Partial<CafeteriaInstagramPostSnapshot> = {},
): CafeteriaInstagramPostSnapshot {
  return {
    id: 1,
    sourceId: "student-hall",
    postedAt: "2026-04-12T06:20:08.000Z",
    caption: null,
    ocrText: null,
    imagePerceptualHash: null,
    ...overrides,
  };
}

describe("cafeteria post classifier", () => {
  it("keeps strong caption-only posts ignored until structural evidence exists", () => {
    const result = classifyCafeteriaInstagramPost({
      source: STUDENT_HALL_SOURCE,
      snapshot: makeSnapshot({
        caption:
          "학관 다음 주 식단 가져왔어요! #식단나왔어요📣",
      }),
      referenceHashes: [],
    });

    expect(result.postKind).toBe("ignored");
    expect(result.score).toBeGreaterThanOrEqual(5);
    expect(result.signals).toContainEqual(
      expect.stringContaining("caption-keyword:strong"),
    );
    expect(result.signals).not.toContain("structural-evidence");
  });

  it("classifies OCR-heavy menu sheets from structure and meal signals", () => {
    const result = classifyCafeteriaInstagramPost({
      source: STUDENT_HALL_SOURCE,
      snapshot: makeSnapshot({
        caption: "다음 주도 맛있게 준비했어요",
        ocrText:
          "학생회관 주중식단표\n04.13-04.17\n월 화 수 목 금\n천원의 아침밥\n중식\n석식\n돈까스\n육개장\n김치볶음밥\n카레라이스\n참치김치찌개\n우삼겹덮밥",
      }),
      referenceHashes: [],
    });

    expect(result.postKind).toBe("menu_sheet");
    expect(result.signals).toEqual(
      expect.arrayContaining([
        expect.stringContaining("date-range"),
        expect.stringContaining("weekday-columns"),
        expect.stringContaining("meal-signals"),
      ]),
    );
  });

  it("uses same-group perceptual hash similarity as a supporting signal when structural evidence also exists", () => {
    const referenceHash =
      "1101010000000000101010000000000000000000000000000000000000000000";
    const result = classifyCafeteriaInstagramPost({
      source: MYEONGJIN_SOURCE,
      snapshot: makeSnapshot({
        sourceId: "myeongjin",
        caption: "다음 주 식단 가져왔어요",
        ocrText: "04.13-04.17 월 화 수 목 금 점심",
        imagePerceptualHash:
          "1101010000000000101010000000000000000000000000000000000000000000",
      }),
      referenceHashes: [referenceHash],
    });

    expect(result.postKind).toBe("menu_sheet");
    expect(result.signals).toContainEqual(
      expect.stringContaining("image-phash:strong"),
    );
  });

  it("keeps caption plus image similarity posts ignored without structural evidence", () => {
    const referenceHash =
      "1101010000000000101010000000000000000000000000000000000000000000";
    const result = classifyCafeteriaInstagramPost({
      source: MYEONGJIN_SOURCE,
      snapshot: makeSnapshot({
        sourceId: "myeongjin",
        caption: "다음 주 식단 가져왔어요",
        imagePerceptualHash:
          "1101010000000000101010000000000000000000000000000000000000000000",
      }),
      referenceHashes: [referenceHash],
    });

    expect(result.postKind).toBe("ignored");
    expect(result.signals).not.toContain("structural-evidence");
  });

  it("ignores operating-hours announcements even when the same group has menu references", () => {
    const result = classifyCafeteriaInstagramPost({
      source: MYEONGJIN_SOURCE,
      snapshot: makeSnapshot({
        sourceId: "myeongjin",
        caption: "명진당 백반집 운영시간 확장 안내입니다",
        ocrText: "운영시간 확장안내 월~목요일 14:15 금요일 14:00",
        imagePerceptualHash:
          "1101010000000000101010000000000000000000000000000000000000000011",
      }),
      referenceHashes: [
        "1101010000000000101010000000000000000000000000000000000000000000",
      ],
    });

    expect(result.postKind).toBe("ignored");
    expect(result.signals).toContainEqual(
      expect.stringContaining("ignored-hint"),
    );
  });

  it("penalizes weekend hints on cafeteria sources that do not serve weekend menus", () => {
    const result = classifyCafeteriaInstagramPost({
      source: MYEONGJIN_SOURCE,
      snapshot: makeSnapshot({
        sourceId: "myeongjin",
        caption: "주말 중식 운영시간 안내",
        ocrText: "04.11-04.12 토 일 주말 점심",
      }),
      referenceHashes: [],
    });

    expect(result.postKind).toBe("ignored");
    expect(result.signals).toContain("weekend-signal-on-weekday-only-source");
  });
});
