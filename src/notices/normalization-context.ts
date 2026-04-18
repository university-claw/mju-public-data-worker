import { load as loadHtml } from "cheerio";
import type {
  NoticeNormalizationContext,
  NoticeNormalizationContextAttachment,
  NoticeNormalizationContextBodyLink,
  NoticeNormalizationContextImage,
  NoticeNormalizationContextOptions,
  NoticeNormalizationContextTextBlock,
  NoticeNormalizationSourceAttachment,
  NoticeNormalizationSourceBundle,
  NoticeNormalizationSourceImage,
} from "./types.js";

export const DEFAULT_NOTICE_NORMALIZATION_MAX_BODY_CHARS = 16_000;
export const DEFAULT_NOTICE_NORMALIZATION_MAX_BODY_HTML_CHARS = 8_000;
export const DEFAULT_NOTICE_NORMALIZATION_MAX_ATTACHMENT_CHARS = 12_000;
export const DEFAULT_NOTICE_NORMALIZATION_MAX_IMAGE_CHARS = 8_000;
export const DEFAULT_NOTICE_NORMALIZATION_MAX_ATTACHMENT_COUNT = 8;
export const DEFAULT_NOTICE_NORMALIZATION_MAX_IMAGE_COUNT = 8;
export const DEFAULT_NOTICE_NORMALIZATION_MAX_BODY_LINK_COUNT = 12;
export const DEFAULT_NOTICE_NORMALIZATION_MAX_TOTAL_CHARS = 48_000;
export const DEFAULT_NOTICE_NORMALIZATION_RESERVED_ATTACHMENT_CHARS = 4_000;
export const DEFAULT_NOTICE_NORMALIZATION_RESERVED_IMAGE_CHARS = 3_000;

const BEGIN_SOURCE_BLOCK = "<<<BEGIN_NOTICE_SOURCE_TEXT>>>";
const END_SOURCE_BLOCK = "<<<END_NOTICE_SOURCE_TEXT>>>";

export function createNoticeNormalizationContext(
  bundle: NoticeNormalizationSourceBundle,
  options: NoticeNormalizationContextOptions = {},
): NoticeNormalizationContext {
  const maxBodyChars =
    options.maxBodyChars ?? DEFAULT_NOTICE_NORMALIZATION_MAX_BODY_CHARS;
  const maxBodyHtmlChars =
    options.maxBodyHtmlChars ?? DEFAULT_NOTICE_NORMALIZATION_MAX_BODY_HTML_CHARS;
  const maxAttachmentChars =
    options.maxAttachmentChars ?? DEFAULT_NOTICE_NORMALIZATION_MAX_ATTACHMENT_CHARS;
  const maxImageChars =
    options.maxImageChars ?? DEFAULT_NOTICE_NORMALIZATION_MAX_IMAGE_CHARS;
  const maxAttachmentCount =
    options.maxAttachmentCount ?? DEFAULT_NOTICE_NORMALIZATION_MAX_ATTACHMENT_COUNT;
  const maxImageCount =
    options.maxImageCount ?? DEFAULT_NOTICE_NORMALIZATION_MAX_IMAGE_COUNT;
  const maxBodyLinkCount =
    options.maxBodyLinkCount ?? DEFAULT_NOTICE_NORMALIZATION_MAX_BODY_LINK_COUNT;

  let remainingBudget =
    options.maxTotalChars ?? DEFAULT_NOTICE_NORMALIZATION_MAX_TOTAL_CHARS;
  const selectedAttachments = prioritizeAttachments(bundle.attachments).slice(
    0,
    maxAttachmentCount,
  );
  const selectedImages = prioritizeImages(bundle.images).slice(0, maxImageCount);
  const reservedAssetBudget = calculateReservedAssetBudget({
    attachments: selectedAttachments,
    images: selectedImages,
    maxAttachmentChars,
    maxImageChars,
    maxTotalChars: remainingBudget,
  });
  let bodyBudgetRemaining = Math.max(0, remainingBudget - reservedAssetBudget);

  const bodyTextBlock = toTextBlock(
    bundle.notice.bodyText,
    Math.min(maxBodyChars, bodyBudgetRemaining),
  );
  bodyBudgetRemaining = Math.max(
    0,
    bodyBudgetRemaining - bodyTextBlock.includedCharCount,
  );

  const bodyHtmlBlock = toTextBlock(
    bundle.notice.bodyHtml,
    Math.min(maxBodyHtmlChars, bodyBudgetRemaining),
  );
  remainingBudget = Math.max(
    0,
    remainingBudget -
      bodyTextBlock.includedCharCount -
      bodyHtmlBlock.includedCharCount,
  );

  const bodyLinks = extractBodyLinks(bundle.notice.bodyHtml, maxBodyLinkCount);

  const attachments = selectedAttachments.map((attachment) => {
    const textBudget = Math.min(maxAttachmentChars, remainingBudget);
    const context = toAttachmentContext(attachment, textBudget);
    remainingBudget = Math.max(
      0,
      remainingBudget - (context.textBlock?.includedCharCount ?? 0),
    );
    return context;
  });

  const images = selectedImages.map((image) => {
    const textBudget = Math.min(maxImageChars, remainingBudget);
    const context = toImageContext(image, textBudget);
    remainingBudget = Math.max(
      0,
      remainingBudget - (context.textBlock?.includedCharCount ?? 0),
    );
    return context;
  });

  const attachmentTextAvailableCount = bundle.attachments.filter((attachment) =>
    hasMeaningfulText(attachment.extractedText)
  ).length;
  const imageTextAvailableCount = bundle.images.filter((image) =>
    hasMeaningfulText(image.ocrText)
  ).length;

  const context: NoticeNormalizationContext = {
    source: bundle.source,
    notice: bundle.notice,
    bodyTextBlock,
    bodyHtmlBlock,
    bodyLinks,
    attachments,
    images,
    stats: {
      attachmentCount: bundle.attachments.length,
      attachmentTextAvailableCount,
      attachmentTextMissingCount:
        bundle.attachments.length - attachmentTextAvailableCount,
      attachmentOmittedCount: Math.max(
        0,
        bundle.attachments.length - selectedAttachments.length,
      ),
      imageCount: bundle.images.length,
      imageTextAvailableCount,
      imageTextMissingCount: bundle.images.length - imageTextAvailableCount,
      imageOmittedCount: Math.max(0, bundle.images.length - selectedImages.length),
    },
    promptInput: "",
  };

  return {
    ...context,
    promptInput: renderNoticeNormalizationContextPrompt(context),
  };
}

export function renderNoticeNormalizationContextPrompt(
  context: Omit<NoticeNormalizationContext, "promptInput">,
): string {
  const lines: string[] = [];

  lines.push("[NOTICE SOURCE]");
  lines.push(`source_id: ${context.source.id}`);
  lines.push(`source_name: ${context.source.name}`);
  lines.push(`source_description: ${context.source.description}`);
  lines.push(`source_list_url: ${context.source.listUrl}`);
  lines.push("");

  lines.push("[NOTICE CORE]");
  lines.push(`notice_item_id: ${context.notice.noticeItemId}`);
  lines.push(`external_id: ${context.notice.externalId}`);
  lines.push(`title: ${context.notice.title}`);
  lines.push(`category_label: ${context.notice.categoryLabel ?? "(none)"}`);
  lines.push(`detail_url: ${context.notice.detailUrl}`);
  lines.push(`list_url: ${context.notice.listUrl}`);
  lines.push(`author: ${context.notice.author ?? "(none)"}`);
  lines.push(`published_at: ${context.notice.publishedAt}`);
  lines.push(`published_at_raw: ${context.notice.publishedAtRaw}`);
  lines.push(`attachments_count: ${context.notice.attachmentsCount}`);
  lines.push(`images_count: ${context.notice.imagesCount}`);
  lines.push(`content_hash: ${context.notice.contentHash ?? "(none)"}`);
  lines.push(`first_seen_at: ${context.notice.firstSeenAt}`);
  lines.push(`last_seen_at: ${context.notice.lastSeenAt}`);
  lines.push(`last_scraped_at: ${context.notice.lastScrapedAt}`);
  lines.push("");

  lines.push("[NOTICE BODY TEXT]");
  appendTextBlock(lines, context.bodyTextBlock);
  lines.push("");

  lines.push("[NOTICE BODY LINKS]");
  if (context.bodyLinks.length === 0) {
    lines.push("(no links extracted from body HTML)");
  } else {
    for (const [index, link] of context.bodyLinks.entries()) {
      lines.push(`- link_${index + 1}_href: ${link.href}`);
      lines.push(`  link_${index + 1}_text: ${link.text ?? "(none)"}`);
    }
  }
  lines.push("");

  lines.push("[NOTICE BODY HTML EXCERPT]");
  appendTextBlock(lines, context.bodyHtmlBlock);
  lines.push("");

  lines.push("[ATTACHMENT EXTRACTIONS]");
  if (context.attachments.length === 0) {
    lines.push(
      context.stats.attachmentCount === 0
        ? "(no attachments)"
        : "(no attachments selected for prompt input)",
    );
  } else {
    for (const attachment of context.attachments) {
      appendAttachment(lines, attachment);
    }
  }
  lines.push("");

  lines.push("[NOTICE IMAGE OCR]");
  if (context.images.length === 0) {
    lines.push(
      context.stats.imageCount === 0
        ? "(no notice images)"
        : "(no notice images selected for prompt input)",
    );
  } else {
    for (const image of context.images) {
      appendImage(lines, image);
    }
  }
  lines.push("");

  lines.push("[CONTEXT SUMMARY]");
  lines.push(`attachment_count: ${context.stats.attachmentCount}`);
  lines.push(
    `attachment_text_available_count: ${context.stats.attachmentTextAvailableCount}`,
  );
  lines.push(
    `attachment_text_missing_count: ${context.stats.attachmentTextMissingCount}`,
  );
  lines.push(`attachment_omitted_count: ${context.stats.attachmentOmittedCount}`);
  lines.push(`image_count: ${context.stats.imageCount}`);
  lines.push(`image_text_available_count: ${context.stats.imageTextAvailableCount}`);
  lines.push(`image_text_missing_count: ${context.stats.imageTextMissingCount}`);
  lines.push(`image_omitted_count: ${context.stats.imageOmittedCount}`);

  return lines.join("\n").trim();
}

function prioritizeAttachments(
  attachments: readonly NoticeNormalizationSourceAttachment[],
): NoticeNormalizationSourceAttachment[] {
  return [...attachments].sort((left, right) => {
    const leftScore = hasMeaningfulText(left.extractedText) ? 0 : 1;
    const rightScore = hasMeaningfulText(right.extractedText) ? 0 : 1;
    if (leftScore !== rightScore) {
      return leftScore - rightScore;
    }

    return left.sortOrder - right.sortOrder;
  });
}

function prioritizeImages(
  images: readonly NoticeNormalizationSourceImage[],
): NoticeNormalizationSourceImage[] {
  return [...images].sort((left, right) => {
    const leftScore = hasMeaningfulText(left.ocrText) ? 0 : 1;
    const rightScore = hasMeaningfulText(right.ocrText) ? 0 : 1;
    if (leftScore !== rightScore) {
      return leftScore - rightScore;
    }

    return left.sortOrder - right.sortOrder;
  });
}

function calculateReservedAssetBudget(params: {
  attachments: readonly NoticeNormalizationSourceAttachment[];
  images: readonly NoticeNormalizationSourceImage[];
  maxAttachmentChars: number;
  maxImageChars: number;
  maxTotalChars: number;
}): number {
  const desiredAttachmentReserve = params.attachments.filter((attachment) =>
    hasMeaningfulText(attachment.extractedText)
  ).length *
    Math.min(
      params.maxAttachmentChars,
      DEFAULT_NOTICE_NORMALIZATION_RESERVED_ATTACHMENT_CHARS,
    );
  const desiredImageReserve = params.images.filter((image) =>
    hasMeaningfulText(image.ocrText)
  ).length *
    Math.min(params.maxImageChars, DEFAULT_NOTICE_NORMALIZATION_RESERVED_IMAGE_CHARS);

  return Math.min(
    Math.floor(params.maxTotalChars / 2),
    desiredAttachmentReserve + desiredImageReserve,
  );
}

function extractBodyLinks(
  bodyHtml: string | null | undefined,
  maxBodyLinkCount: number,
): NoticeNormalizationContextBodyLink[] {
  if (!bodyHtml) {
    return [];
  }

  const $ = loadHtml(bodyHtml);
  const links: NoticeNormalizationContextBodyLink[] = [];
  const seen = new Set<string>();

  $("a[href]").each((_, element) => {
    if (links.length >= maxBodyLinkCount) {
      return false;
    }

    const href = $(element).attr("href")?.trim();
    const text = $(element).text().trim() || null;
    if (!href) {
      return;
    }

    const dedupeKey = `${href}::${text ?? ""}`;
    if (seen.has(dedupeKey)) {
      return;
    }

    seen.add(dedupeKey);
    links.push({
      href,
      ...(text !== null ? { text } : {}),
    });
  });

  return links;
}

function toAttachmentContext(
  attachment: NoticeNormalizationSourceAttachment,
  maxChars: number,
): NoticeNormalizationContextAttachment {
  return {
    attachmentId: attachment.attachmentId,
    fileName: attachment.fileName,
    downloadUrl: attachment.downloadUrl,
    sortOrder: attachment.sortOrder,
    ...(attachment.storageKey !== undefined
      ? { storageKey: attachment.storageKey }
      : {}),
    ...(attachment.contentType !== undefined
      ? { contentType: attachment.contentType }
      : {}),
    downloadStatus: attachment.downloadStatus,
    extractionStatus: attachment.extractionStatus,
    ...(attachment.extractorType !== undefined
      ? { extractorType: attachment.extractorType }
      : {}),
    ...(attachment.extractedAt !== undefined
      ? { extractedAt: attachment.extractedAt }
      : {}),
    ...(attachment.errorMessage !== undefined
      ? { errorMessage: attachment.errorMessage }
      : {}),
    textBlock: toTextBlock(attachment.extractedText, maxChars),
  };
}

function toImageContext(
  image: NoticeNormalizationSourceImage,
  maxChars: number,
): NoticeNormalizationContextImage {
  return {
    imageId: image.imageId,
    imageUrl: image.imageUrl,
    ...(image.altText !== undefined ? { altText: image.altText } : {}),
    sortOrder: image.sortOrder,
    ...(image.storageKey !== undefined ? { storageKey: image.storageKey } : {}),
    ...(image.contentType !== undefined ? { contentType: image.contentType } : {}),
    downloadStatus: image.downloadStatus,
    ocrStatus: image.ocrStatus,
    ...(image.ocrConfidence !== undefined
      ? { ocrConfidence: image.ocrConfidence }
      : {}),
    ...(image.ocrLanguage !== undefined ? { ocrLanguage: image.ocrLanguage } : {}),
    ...(image.ocrExtractedAt !== undefined
      ? { ocrExtractedAt: image.ocrExtractedAt }
      : {}),
    ...(image.errorMessage !== undefined ? { errorMessage: image.errorMessage } : {}),
    textBlock: toTextBlock(image.ocrText, maxChars),
  };
}

function toTextBlock(
  rawText: string | null | undefined,
  maxChars: number,
): NoticeNormalizationContextTextBlock {
  const normalized = normalizeText(rawText);

  if (!normalized) {
    return {
      text: null,
      originalCharCount: 0,
      includedCharCount: 0,
      truncated: false,
    };
  }

  const originalCharCount = normalized.length;
  if (maxChars <= 0) {
    return {
      text: null,
      originalCharCount,
      includedCharCount: 0,
      truncated: true,
    };
  }

  if (normalized.length <= maxChars) {
    return {
      text: normalized,
      originalCharCount,
      includedCharCount: normalized.length,
      truncated: false,
    };
  }

  const clipped = normalized.slice(0, maxChars).trimEnd();
  const remainingCharCount = originalCharCount - clipped.length;
  const text = `${clipped}\n\n[TRUNCATED ${remainingCharCount} chars]`;

  return {
    text,
    originalCharCount,
    includedCharCount: clipped.length,
    truncated: true,
  };
}

function normalizeText(rawText: string | null | undefined): string | null {
  if (!rawText) {
    return null;
  }

  const normalized = rawText
    .replace(/\r\n?/g, "\n")
    .replace(/\u0000/g, "")
    .trim();

  return normalized.length > 0 ? normalized : null;
}

function appendTextBlock(
  lines: string[],
  block: NoticeNormalizationContextTextBlock,
): void {
  lines.push(`original_char_count: ${block.originalCharCount}`);
  lines.push(`included_char_count: ${block.includedCharCount}`);
  lines.push(`truncated: ${block.truncated ? "true" : "false"}`);
  lines.push("text:");
  if (!block.text) {
    lines.push("(no text)");
    return;
  }

  lines.push(BEGIN_SOURCE_BLOCK);
  lines.push(escapePromptFenceTokens(block.text));
  lines.push(END_SOURCE_BLOCK);
}

function appendAttachment(
  lines: string[],
  attachment: NoticeNormalizationContextAttachment,
): void {
  lines.push(
    `## attachment sort_order=${attachment.sortOrder} id=${attachment.attachmentId}`,
  );
  lines.push(`file_name: ${attachment.fileName}`);
  lines.push(`download_url: ${attachment.downloadUrl}`);
  lines.push(`storage_key: ${attachment.storageKey ?? "(none)"}`);
  lines.push(`content_type: ${attachment.contentType ?? "(none)"}`);
  lines.push(`download_status: ${attachment.downloadStatus}`);
  lines.push(`extraction_status: ${attachment.extractionStatus}`);
  lines.push(`extractor_type: ${attachment.extractorType ?? "(none)"}`);
  lines.push(`extracted_at: ${attachment.extractedAt ?? "(none)"}`);
  lines.push(`error_message: ${attachment.errorMessage ?? "(none)"}`);
  lines.push("text:");
  appendTextBlock(
    lines,
    attachment.textBlock ?? {
      text: null,
      originalCharCount: 0,
      includedCharCount: 0,
      truncated: false,
    },
  );
  lines.push("");
}

function appendImage(
  lines: string[],
  image: NoticeNormalizationContextImage,
): void {
  lines.push(`## image sort_order=${image.sortOrder} id=${image.imageId}`);
  lines.push(`image_url: ${image.imageUrl}`);
  lines.push(`alt_text: ${image.altText ?? "(none)"}`);
  lines.push(`storage_key: ${image.storageKey ?? "(none)"}`);
  lines.push(`content_type: ${image.contentType ?? "(none)"}`);
  lines.push(`download_status: ${image.downloadStatus}`);
  lines.push(`ocr_status: ${image.ocrStatus}`);
  lines.push(`ocr_confidence: ${image.ocrConfidence ?? "(none)"}`);
  lines.push(`ocr_language: ${image.ocrLanguage ?? "(none)"}`);
  lines.push(`ocr_extracted_at: ${image.ocrExtractedAt ?? "(none)"}`);
  lines.push(`error_message: ${image.errorMessage ?? "(none)"}`);
  lines.push("text:");
  appendTextBlock(
    lines,
    image.textBlock ?? {
      text: null,
      originalCharCount: 0,
      includedCharCount: 0,
      truncated: false,
    },
  );
  lines.push("");
}

function escapePromptFenceTokens(text: string): string {
  return text
    .replaceAll(BEGIN_SOURCE_BLOCK, "[BEGIN_NOTICE_SOURCE_TEXT]")
    .replaceAll(END_SOURCE_BLOCK, "[END_NOTICE_SOURCE_TEXT]");
}

function hasMeaningfulText(text: string | null | undefined): boolean {
  return Boolean(text?.trim());
}
