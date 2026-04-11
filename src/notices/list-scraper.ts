import { load as loadHtml } from "cheerio";
import { fetchHtml } from "../http/client.js";
import { parseKoreanDateToIso } from "../shared/date.js";
import { collapseWhitespace } from "../shared/text.js";
import type { NoticeListItem, NoticeSource } from "./types.js";

function extractExternalIdFromOnclick(onclick?: string): string | undefined {
  if (!onclick) {
    return undefined;
  }

  const match =
    /jf_viewArtcl\s*\(\s*['"][^'"]+['"]\s*,\s*['"](\d+)['"]\s*,\s*['"](\d+)['"]/.exec(
      onclick,
    );
  return match?.[2];
}

function buildDetailUrlFromOnclick(origin: string, onclick?: string): string | undefined {
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

function extractExternalId(detailUrl: string): string {
  const match = /\/bbs\/[^/]+\/\d+\/(\d+)\/artclView\.do/.exec(detailUrl);
  if (!match) {
    throw new Error(`unable to extract external id from detail url: ${detailUrl}`);
  }

  return match[1]!;
}

function extractCategoryLabel(anchorText: string, strongText: string): string | undefined {
  const normalizedAnchor = collapseWhitespace(anchorText);
  if (!normalizedAnchor || normalizedAnchor === strongText) {
    return undefined;
  }

  const label = normalizedAnchor.replace(strongText, "").replace(/\[|\]/g, " ");
  const collapsed = collapseWhitespace(label);
  return collapsed || undefined;
}

function parseLeadingBracketCategory(title: string): string | undefined {
  const match = /^\[([^\]]+)\]/.exec(title);
  return match?.[1]?.trim();
}

function parseHtmlListItems(
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
    const detailUrl = href
      ? new URL(href, origin).toString()
      : buildDetailUrlFromOnclick(origin, onclick);
    if (!detailUrl) {
      continue;
    }

    const publishedAtRaw = collapseWhitespace($(tds[3]).text());
    const author = collapseWhitespace($(tds[2]).text()) || undefined;
    const categoryLabel = extractCategoryLabel(anchor.text(), title);

    const item: NoticeListItem = {
      sourceId: source.id,
      externalId:
        extractExternalIdFromOnclick(onclick) ?? extractExternalId(detailUrl),
      title,
      detailUrl,
      publishedAt: parseKoreanDateToIso(publishedAtRaw),
      publishedAtRaw,
    };

    if (categoryLabel) {
      item.categoryLabel = categoryLabel;
    }

    if (author) {
      item.author = author;
    }

    items.push(item);
  }

  return items;
}

function parseRssUrl(html: string, origin: string): string | undefined {
  const $ = loadHtml(html);
  const rssAnchor = $("a")
    .toArray()
    .map((element) => $(element))
    .find((anchor) => collapseWhitespace(anchor.text()) === "RSS 2.0");

  const href = rssAnchor?.attr("href");
  return href ? new URL(href, origin).toString() : undefined;
}

function parseRssItems(
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

function dedupeItems(items: NoticeListItem[]): NoticeListItem[] {
  const deduped = new Map<string, NoticeListItem>();

  for (const item of items) {
    if (!deduped.has(item.externalId)) {
      deduped.set(item.externalId, item);
    }
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
