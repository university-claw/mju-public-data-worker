import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  dedupeItems,
  parseHtmlListItems,
  parseRssItems,
  parseRssUrl,
  scrapeNoticeList,
} from "../../src/notices/list-scraper.js";
import type { NoticeSource } from "../../src/notices/types.js";
import { fetchHtml } from "../../src/http/client.js";

vi.mock("../../src/http/client.js", () => ({
  fetchHtml: vi.fn(),
}));

const fetchHtmlMock = vi.mocked(fetchHtml);
const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) => path.join(here, "..", "fixtures", name);

const SOURCE: NoticeSource = {
  id: "general",
  name: "일반공지",
  description: "명지대학교 일반공지 게시판",
  listUrl: "https://www.mju.ac.kr/mjukr/255/subview.do",
};

describe("list-scraper pure parsers", () => {
  it("extracts four rows from the html fixture", async () => {
    const html = await fs.readFile(fixture("board-list.html"), "utf-8");
    const items = parseHtmlListItems(html, SOURCE, "https://www.mju.ac.kr");

    expect(items).toHaveLength(4);
    expect(items[0]).toMatchObject({
      sourceId: "general",
      externalId: "230921",
      title: "2026학년도 1학기 수강정정 안내",
      author: "학사지원팀",
      detailUrl: "https://www.mju.ac.kr/bbs/mjukr/141/230921/artclView.do",
      publishedAt: "2026-04-06T15:00:00.000Z",
    });

    expect(items[2]).toMatchObject({
      externalId: "230919",
      detailUrl: "https://www.mju.ac.kr/bbs/mjukr/141/230919/artclView.do",
      title: "2026학년도 학위수여식 안내",
      publishedAt: "2026-04-02T15:00:00.000Z",
    });

    expect(items[3]?.publishedAt).toBe("2026-04-01T00:30:00.000Z");
  });

  it("throws when the expected table selector is missing", async () => {
    const html = await fs.readFile(fixture("no-table.html"), "utf-8");
    expect(() => parseHtmlListItems(html, SOURCE, "https://www.mju.ac.kr")).toThrow(
      /no rows matched/,
    );
  });

  it("returns an empty list when rows exist but no usable notice cells are present", async () => {
    const html = await fs.readFile(fixture("empty-board.html"), "utf-8");
    expect(() => parseHtmlListItems(html, SOURCE, "https://www.mju.ac.kr")).not.toThrow();

    const items = parseHtmlListItems(html, SOURCE, "https://www.mju.ac.kr");
    expect(items).toHaveLength(0);
  });

  it("finds an RSS link from a list page", async () => {
    const html = await fs.readFile(fixture("board-list-with-rss.html"), "utf-8");
    expect(parseRssUrl(html, "https://www.mju.ac.kr")).toBe(
      "https://www.mju.ac.kr/rssBoard/255/list.rss",
    );
  });

  it("does not store the 새글 status badge as a category label", () => {
    const html = `
      <table class="artclTable">
        <tbody>
          <tr>
            <td>1</td>
            <td class="td-subject">
              <a href="#" onclick="jf_viewArtcl('mjukr','141','230921','t');return false;">
                <strong>2026학년도 1학기 수강정정 안내</strong>
                <span class="newArtcl">새글</span>
              </a>
            </td>
            <td>학사지원팀</td>
            <td>2026.04.07</td>
            <td></td>
            <td>10</td>
          </tr>
        </tbody>
      </table>
    `;

    const items = parseHtmlListItems(html, SOURCE, "https://www.mju.ac.kr");
    expect(items[0]?.categoryLabel).toBeUndefined();
  });

  it("treats javascript placeholder href as non-navigable and falls back to onclick", () => {
    const html = `
      <table class="artclTable">
        <tbody>
          <tr>
            <td>1</td>
            <td class="td-subject">
              <a href="javascript:void(0)" onclick="jf_viewArtcl('mjukr','141','230915','t');return false;">
                javascript placeholder test
              </a>
            </td>
            <td>학생지원팀</td>
            <td>2026.03.28</td>
            <td></td>
            <td>10</td>
          </tr>
        </tbody>
      </table>
    `;

    const items = parseHtmlListItems(html, SOURCE, "https://www.mju.ac.kr");
    expect(items[0]).toMatchObject({
      externalId: "230915",
      detailUrl: "https://www.mju.ac.kr/bbs/mjukr/141/230915/artclView.do",
    });
  });

  it("parses RSS items and keeps bracket categories", async () => {
    const xml = await fs.readFile(fixture("notice-rss.xml"), "utf-8");
    const items = parseRssItems(xml, SOURCE, "https://www.mju.ac.kr");

    expect(items).toHaveLength(3);
    expect(items[0]).toMatchObject({
      externalId: "230921",
      title: "2026학년도 1학기 수강정정 안내",
      categoryLabel: "학사",
      author: "학사지원팀",
      publishedAt: "2026-04-07T00:00:00.000Z",
    });
    expect(items[2]).toMatchObject({
      externalId: "230916",
      categoryLabel: "행정",
      author: "학생지원팀",
    });
  });

  it("ignores bracket prefixes that are not classification labels", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
      <rss version="2.0">
        <channel>
          <item>
            <title>[장애학생지원센터] 제 46회 장애인의 날 기념 행사 안내</title>
            <link>https://www.mju.ac.kr/bbs/mjukr/141/230925/artclView.do</link>
            <pubDate>Fri, 10 Apr 2026 09:00:00 +0900</pubDate>
            <author>학생지원팀</author>
          </item>
        </channel>
      </rss>`;

    const items = parseRssItems(xml, SOURCE, "https://www.mju.ac.kr");
    expect(items[0]?.title).toBe("[장애학생지원센터] 제 46회 장애인의 날 기념 행사 안내");
    expect(items[0]?.categoryLabel).toBeUndefined();
  });

  it("deduplicates merged list items by external id", async () => {
    const html = await fs.readFile(fixture("board-list.html"), "utf-8");
    const xml = await fs.readFile(fixture("notice-rss.xml"), "utf-8");
    const htmlItems = parseHtmlListItems(html, SOURCE, "https://www.mju.ac.kr");
    const rssItems = parseRssItems(xml, SOURCE, "https://www.mju.ac.kr");

    const deduped = dedupeItems([...htmlItems, ...rssItems]);
    expect(deduped).toHaveLength(6);
    expect(deduped.filter((item) => item.externalId === "230921")).toHaveLength(1);
    expect(deduped.find((item) => item.externalId === "230921")?.categoryLabel).toBe(
      "학사",
    );
  });

  it("keeps the same canonical title even if RSS arrives before HTML", async () => {
    const html = await fs.readFile(fixture("board-list.html"), "utf-8");
    const xml = await fs.readFile(fixture("notice-rss.xml"), "utf-8");
    const htmlItems = parseHtmlListItems(html, SOURCE, "https://www.mju.ac.kr");
    const rssItems = parseRssItems(xml, SOURCE, "https://www.mju.ac.kr");

    const deduped = dedupeItems([...rssItems, ...htmlItems]);
    expect(deduped.find((item) => item.externalId === "230921")).toMatchObject({
      title: "2026학년도 1학기 수강정정 안내",
      categoryLabel: "학사",
    });
  });
});

describe("scrapeNoticeList", () => {
  beforeEach(() => {
    fetchHtmlMock.mockReset();
  });

  it("returns only html items when the limit is already satisfied", async () => {
    const html = await fs.readFile(fixture("board-list.html"), "utf-8");
    fetchHtmlMock.mockResolvedValueOnce(html);

    const items = await scrapeNoticeList(SOURCE, 2);

    expect(items).toHaveLength(2);
    expect(fetchHtmlMock).toHaveBeenCalledTimes(1);
  });

  it("uses RSS as a fallback when the html page has fewer rows than requested", async () => {
    const html = await fs.readFile(fixture("board-list-with-rss.html"), "utf-8");
    const xml = await fs.readFile(fixture("notice-rss.xml"), "utf-8");
    fetchHtmlMock.mockResolvedValueOnce(html).mockResolvedValueOnce(xml);

    const items = await scrapeNoticeList(SOURCE, 6);

    expect(items).toHaveLength(6);
    expect(items.at(-1)?.externalId).toBe("230916");
    expect(items.find((item) => item.externalId === "230921")?.categoryLabel).toBe(
      "학사",
    );
    expect(fetchHtmlMock).toHaveBeenCalledTimes(2);
  });

  it("throws when no usable items survive and there is no RSS fallback", async () => {
    const html = await fs.readFile(fixture("empty-board.html"), "utf-8");
    fetchHtmlMock.mockResolvedValueOnce(html);

    await expect(scrapeNoticeList(SOURCE, 1)).rejects.toThrow(/parsed 0 notice items/);
    expect(fetchHtmlMock).toHaveBeenCalledTimes(1);
  });
});
