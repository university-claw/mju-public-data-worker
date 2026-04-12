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

export function parseAttachments(
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

export function parseImages(
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

/**
 * 상세 HTML 파서는 네트워크와 분리해 두면 첨부/이미지/본문 추출 회귀를 빠르게
 * 확인할 수 있다. 실제 사이트 마크업이 조금 바뀌었을 때 어떤 셀렉터가 깨졌는지
 * 테스트로 바로 드러나게 하는 용도다.
 */
export function parseNoticeDetailHtml(
  htmlText: string,
  item: NoticeListItem,
): NoticeDetail {
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

export async function scrapeNoticeDetail(item: NoticeListItem): Promise<NoticeDetail> {
  const htmlText = await fetchHtml(item.detailUrl);
  return parseNoticeDetailHtml(htmlText, item);
}
