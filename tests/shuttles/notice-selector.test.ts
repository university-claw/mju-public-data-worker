import { describe, expect, it } from "vitest";
import {
  resolveCurrentAcademicTerm,
  selectCurrentSemesterShuttleNotice,
} from "../../src/shuttles/notice-selector.js";
import type { NoticeListItem } from "../../src/notices/types.js";

function notice(partial: Partial<NoticeListItem> & { title: string }): NoticeListItem {
  return {
    sourceId: "general",
    externalId: partial.externalId ?? partial.title,
    title: partial.title,
    detailUrl: partial.detailUrl ?? "https://www.mju.ac.kr/bbs/mjukr/141/1/artclView.do",
    publishedAt: partial.publishedAt ?? "2026-03-02T00:00:00.000Z",
    publishedAtRaw: partial.publishedAtRaw ?? "2026.03.02",
  };
}

describe("shuttle notice selector", () => {
  it("resolves the current academic term from the collection date", () => {
    expect(resolveCurrentAcademicTerm(new Date("2026-05-20T00:00:00+09:00"))).toEqual({
      academicYear: 2026,
      termLabel: "1학기",
    });
    expect(resolveCurrentAcademicTerm(new Date("2026-01-20T00:00:00+09:00"))).toEqual({
      academicYear: 2025,
      termLabel: "2학기",
    });
  });

  it("selects the current semester shuttle notice from search results", () => {
    const selected = selectCurrentSemesterShuttleNotice(
      [
        notice({
          externalId: "old",
          title: "2025학년도 2학기 셔틀버스 운행 안내",
          publishedAt: "2025-09-01T00:00:00.000Z",
        }),
        notice({
          externalId: "current",
          title: "2026학년도 1학기 학기 중 통학·셔틀버스 운행 안내",
          publishedAt: "2026-03-03T00:00:00.000Z",
        }),
        notice({
          externalId: "other",
          title: "학생식당 운영시간 안내",
          publishedAt: "2026-03-04T00:00:00.000Z",
        }),
      ],
      new Date("2026-05-01T00:00:00+09:00"),
    );

    expect(selected?.externalId).toBe("current");
  });
});
