import { load as loadHtml } from "cheerio";
import { fetchHtml } from "../http/client.js";
import { sha256 } from "../shared/hash.js";
import { collapseWhitespace } from "../shared/text.js";
import type {
  NoticeAssetImage,
  NoticeAttachment,
  NoticeDetail,
  NoticeListItem,
} from "./types.js";

function parseAttachments(
  html: ReturnType<typeof loadHtml>,
  origin: string,
): NoticeAttachment[] {
  const attachments: NoticeAttachment[] = [];

  html(".artclForm.attfile a").each((index, element) => {
    const anchor = html(element);
    const href = anchor.attr("href");
    if (!href) {
      return;
    }

    const fileName = collapseWhitespace(anchor.text());
    if (!fileName) {
      return;
    }

    attachments.push({
      fileName,
      downloadUrl: new URL(href, origin).toString(),
      sortOrder: index,
    });
  });

  return attachments;
}

function parseImages(
  html: ReturnType<typeof loadHtml>,
  origin: string,
): NoticeAssetImage[] {
  const images: NoticeAssetImage[] = [];

  html(".artclView img").each((index, element) => {
    const image = html(element);
    const src = image.attr("src");
    if (!src) {
      return;
    }

    const parsedImage: NoticeAssetImage = {
      imageUrl: new URL(src, origin).toString(),
      sortOrder: index,
    };

    const altText = collapseWhitespace(image.attr("alt") ?? "");
    if (altText) {
      parsedImage.altText = altText;
    }

    images.push(parsedImage);
  });

  return images;
}

export async function scrapeNoticeDetail(item: NoticeListItem): Promise<NoticeDetail> {
  const htmlText = await fetchHtml(item.detailUrl);
  const $ = loadHtml(htmlText);
  const origin = new URL(item.detailUrl).origin;
  const bodyRoot = $(".artclView").first();

  if (!bodyRoot.length) {
    throw new Error(`detail body root ".artclView" was not found: ${item.detailUrl}`);
  }

  const detailTitle = collapseWhitespace($(".artclViewTitle").first().text());
  const bodyHtml = bodyRoot.html()?.trim() ?? "";
  const bodyText = collapseWhitespace(bodyRoot.text());
  const attachments = parseAttachments($, origin);
  const images = parseImages($, origin);

  return {
    ...item,
    title: detailTitle || item.title,
    bodyHtml,
    bodyText,
    contentHash: sha256(bodyHtml),
    attachments,
    images,
  };
}
