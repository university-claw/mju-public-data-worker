import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseNoticeDetailHtml } from "../../src/notices/detail-scraper.js";
import type { NoticeListItem } from "../../src/notices/types.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) => path.join(here, "..", "fixtures", name);

const LIST_ITEM: NoticeListItem = {
  sourceId: "general",
  externalId: "230921",
  title: "목록 제목",
  detailUrl: "https://www.mju.ac.kr/bbs/mjukr/141/230921/artclView.do",
  author: "학사지원팀",
  publishedAt: "2026-04-06T15:00:00.000Z",
  publishedAtRaw: "2026.04.07",
};

describe("parseNoticeDetailHtml", () => {
  it("extracts body html/text, attachments, and inline images", async () => {
    const html = await fs.readFile(fixture("notice-detail.html"), "utf-8");
    const detail = parseNoticeDetailHtml(html, LIST_ITEM);

    expect(detail.title).toBe("2026학년도 1학기 수강정정 안내");
    expect(detail.bodyHtml).toContain("수강정정 일정을 안내드립니다.");
    expect(detail.bodyText).toContain("첨부파일을 확인하시기 바랍니다.");
    expect(detail.contentHash).toMatch(/^[a-f0-9]{64}$/);

    expect(detail.attachments).toEqual([
      {
        fileName: "수강정정 안내문.pdf",
        downloadUrl: "https://www.mju.ac.kr/common/attach/guide.pdf",
        sortOrder: 0,
      },
      {
        fileName: "학사일정.xlsx",
        downloadUrl: "https://www.mju.ac.kr/files/calendar.xlsx",
        sortOrder: 1,
      },
    ]);

    expect(detail.images).toEqual([
      {
        imageUrl: "https://www.mju.ac.kr/images/notice/banner.png",
        altText: "수강정정 안내 배너",
        sortOrder: 0,
      },
      {
        imageUrl: "https://www.mju.ac.kr/images/card-news.png",
        sortOrder: 1,
      },
    ]);
  });

  it("throws when the detail body root is missing", () => {
    expect(() => parseNoticeDetailHtml("<html><body>broken</body></html>", LIST_ITEM)).toThrow(
      /\.artclView/,
    );
  });
});
