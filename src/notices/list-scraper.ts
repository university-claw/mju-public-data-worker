import { load as loadHtml } from "cheerio";
import { fetchHtml } from "../http/client.js";
import { parseKoreanDateToIso } from "../shared/date.js";
import { collapseWhitespace } from "../shared/text.js";
import type { NoticeListItem, NoticeSource } from "./types.js";

const ALLOWED_CATEGORY_LABELS = new Set([
  "학사",
  "행정",
  "장학",
  "행사",
  "취업",
  "진로",
  "창업",
  "채용",
  "모집",
  "국제",
  "학생",
]);

export function extractExternalIdFromOnclick(onclick?: string): string | undefined {
  if (!onclick) {
    return undefined;
  }

  const match =
    /jf_viewArtcl\s*\(\s*['"][^'"]+['"]\s*,\s*['"](\d+)['"]\s*,\s*['"](\d+)['"]/.exec(
      onclick,
    );
  return match?.[2];
}

export function buildDetailUrlFromOnclick(
  origin: string,
  onclick?: string,
): string | undefined {
  if (!onclick) {
    return undefined;
  }

  const match =
    /jf_viewArtcl\s*\(\s*['"]([^'"]+)['"]\s*,\s*['"](\d+)['"]\s*,\s*['"](\d+)['"]/.exec(
      onclick,
    );
  if (!match) {
    return undefined;
  }

  const siteId = match[1];
  const boardId = match[2];
  const articleId = match[3];
  return `${origin}/bbs/${siteId}/${boardId}/${articleId}/artclView.do`;
}

/**
 * 명지대 게시판은 `href="#" + onclick` 조합을 자주 사용한다. 단순히 href가
 * 존재한다는 이유만으로 우선하면 `https://.../#`를 상세 URL로 잘못 저장하므로,
 * 실제 이동 가능한 href인지 먼저 판별한 뒤 아니면 onclick fallback으로 넘긴다.
 */
function resolveDetailUrl(
  origin: string,
  href: string | undefined,
  onclick: string | undefined,
): string | undefined {
  const normalizedHref = href?.trim();
  const isPlaceholderHref =
    !normalizedHref ||
    normalizedHref === "#" ||
    normalizedHref.toLowerCase().startsWith("javascript:");

  if (!isPlaceholderHref) {
    return new URL(normalizedHref, origin).toString();
  }

  return buildDetailUrlFromOnclick(origin, onclick);
}

export function extractExternalId(detailUrl: string): string {
  const match = /\/bbs\/[^/]+\/\d+\/(\d+)\/artclView\.do/.exec(detailUrl);
  if (!match) {
    throw new Error(`unable to extract external id from detail url: ${detailUrl}`);
  }

  return match[1]!;
}

/**
 * RSS 제목 앞의 대괄호 접두사 중에서도, 실제 분류 의미가 있는 값만
 * category_label로 남긴다. 부서명·캠퍼스명·사업단명처럼 제목 꾸밈 역할만 하는
 * 긴 접두사는 버려서 `category_label`이 진짜 분류 필드에 가깝게 유지되도록 한다.
 */
export function parseLeadingBracketCategory(title: string): string | undefined {
  const match = /^\[([^\]]+)\]/.exec(title);
  const candidate = match?.[1]?.trim();
  if (!candidate) {
    return undefined;
  }

  return ALLOWED_CATEGORY_LABELS.has(candidate) ? candidate : undefined;
}

/**
 * 목록 HTML에는 제목 옆에 `새글` 같은 상태 배지가 같이 렌더링되지만, 이 값은
 * 분류 라벨이 아니라 화면 표시용 상태다. 따라서 HTML 파싱 단계에서는
 * category_label을 만들지 않고, RSS 제목의 `[학사]` 같은 분류 정보만 별도로
 * 병합해서 보존한다.
 */
function mergeListItem(
  existing: NoticeListItem,
  incoming: NoticeListItem,
): NoticeListItem {
  const merged: NoticeListItem = {
    ...existing,
  };

  const mergedCategoryLabel = existing.categoryLabel ?? incoming.categoryLabel;
  if (mergedCategoryLabel) {
    merged.categoryLabel = mergedCategoryLabel;
  }

  const mergedAuthor = existing.author ?? incoming.author;
  if (mergedAuthor) {
    merged.author = mergedAuthor;
  }

  return merged;
}

/**
 * HTML 목록 파서는 네트워크 없이도 충분히 검증 가능하므로 export해서 fixture
 * 기반 회귀 테스트를 걸어둔다. CMS 마크업이 조금만 바뀌어도 가장 먼저 깨지는
 * 지점이기 때문에, worker 안정성에서 가장 중요한 순수 함수 중 하나다.
 */
export function parseHtmlListItems(
  html: string,
  source: NoticeSource,
  origin: string,
): NoticeListItem[] {
  const $ = loadHtml(html);
  const rows = $("table.artclTable tbody tr").toArray();

  if (rows.length === 0) {
    throw new Error(
      `no rows matched table.artclTable tbody tr for source "${source.id}"`,
    );
  }

  const items: NoticeListItem[] = [];

  for (const row of rows) {
    const tds = $(row).find("td").toArray();
    if (tds.length < 4) {
      continue;
    }

    const titleCell = $(tds[1]);
    const anchor = titleCell.find("a").first();
    if (!anchor.length) {
      continue;
    }

    const strongTitle = collapseWhitespace(anchor.find("strong").first().text());
    const title = strongTitle || collapseWhitespace(anchor.text());
    if (!title) {
      continue;
    }

    const href = anchor.attr("href");
    const onclick = anchor.attr("onclick");
    const detailUrl = resolveDetailUrl(origin, href, onclick);
    if (!detailUrl) {
      continue;
    }

    const publishedAtRaw = collapseWhitespace($(tds[3]).text());
    const author = collapseWhitespace($(tds[2]).text()) || undefined;

    const item: NoticeListItem = {
      sourceId: source.id,
      externalId:
        extractExternalIdFromOnclick(onclick) ?? extractExternalId(detailUrl),
      title,
      detailUrl,
      publishedAt: parseKoreanDateToIso(publishedAtRaw),
      publishedAtRaw,
    };

    if (author) {
      item.author = author;
    }

    items.push(item);
  }

  return items;
}

export function parseRssUrl(html: string, origin: string): string | undefined {
  const $ = loadHtml(html);
  const rssAnchor = $("a")
    .toArray()
    .map((element) => $(element))
    .find((anchor) => collapseWhitespace(anchor.text()) === "RSS 2.0");

  const href = rssAnchor?.attr("href");
  return href ? new URL(href, origin).toString() : undefined;
}

export function parseRssItems(
  rssXml: string,
  source: NoticeSource,
  origin: string,
): NoticeListItem[] {
  const $ = loadHtml(rssXml, { xmlMode: true });
  const items: NoticeListItem[] = [];

  $("item").each((_, element) => {
    const entry = $(element);
    const title = collapseWhitespace(entry.find("title").first().text());
    const linkText = collapseWhitespace(entry.find("link").first().text());
    const pubDateRaw = collapseWhitespace(entry.find("pubDate").first().text());
    const author = collapseWhitespace(entry.find("author").first().text()) || undefined;
    if (!title || !linkText || !pubDateRaw) {
      return;
    }

    const detailUrl = new URL(linkText, origin).toString();
    const item: NoticeListItem = {
      sourceId: source.id,
      externalId: extractExternalId(detailUrl),
      title,
      detailUrl,
      publishedAt: parseKoreanDateToIso(pubDateRaw),
      publishedAtRaw: pubDateRaw,
    };

    const categoryLabel = parseLeadingBracketCategory(title);
    if (categoryLabel) {
      item.categoryLabel = categoryLabel;
    }

    if (author) {
      item.author = author;
    }

    items.push(item);
  });

  return items;
}

export function dedupeItems(items: NoticeListItem[]): NoticeListItem[] {
  const deduped = new Map<string, NoticeListItem>();

  for (const item of items) {
    const existing = deduped.get(item.externalId);
    if (!existing) {
      deduped.set(item.externalId, item);
      continue;
    }

    deduped.set(item.externalId, mergeListItem(existing, item));
  }

  return [...deduped.values()];
}

export async function scrapeNoticeList(
  source: NoticeSource,
  limit: number,
): Promise<NoticeListItem[]> {
  const origin = new URL(source.listUrl).origin;
  const html = await fetchHtml(source.listUrl);
  const htmlItems = parseHtmlListItems(html, source, origin);
  let mergedItems = dedupeItems(htmlItems);

  if (mergedItems.length < limit) {
    const rssUrl = parseRssUrl(html, origin);
    if (rssUrl) {
      const rssXml = await fetchHtml(rssUrl);
      const rssItems = parseRssItems(rssXml, source, origin);
      mergedItems = dedupeItems([...mergedItems, ...rssItems]);
    }
  }

  const sliced = mergedItems.slice(0, limit);
  if (sliced.length === 0) {
    throw new Error(`parsed 0 notice items for source "${source.id}"`);
  }

  return sliced;
}
