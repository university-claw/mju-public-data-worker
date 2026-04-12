import fs from "node:fs/promises";
import JSZip from "jszip";
import { PDFParse } from "pdf-parse";
import { sha256 } from "../shared/hash.js";
import type {
  NoticeAttachmentExtractorType,
  StoredNoticeAttachment,
} from "./types.js";

const MAX_ATTACHMENT_SIZE_BYTES = 15 * 1024 * 1024;
const MAX_EXTRACTED_TEXT_CHAR_COUNT = 200_000;

export interface ExtractableNoticeAttachment extends StoredNoticeAttachment {
  absolutePath: string;
}

export interface NoticeAttachmentExtractionResult {
  extractorType: NoticeAttachmentExtractorType;
  extractedText: string;
  textSha256: string;
  extractedCharCount: number;
}

const DOCX_CONTENT_TYPES = new Set([
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

const HWPX_CONTENT_TYPES = new Set([
  "application/hwp+zip",
  "application/x-hwp+zip",
  "application/vnd.hancom.hwp+zip",
]);

function extensionFromAttachment(attachment: StoredNoticeAttachment): string {
  const matched = attachment.fileName.toLowerCase().match(/(\.[a-z0-9]+)$/i);
  return matched?.[1] ?? "";
}

export function detectNoticeAttachmentExtractorType(
  attachment: StoredNoticeAttachment,
): NoticeAttachmentExtractorType | null {
  const extension = extensionFromAttachment(attachment);
  const contentType = attachment.contentType?.trim().toLowerCase() ?? "";

  if (extension === ".pdf" || contentType === "application/pdf") {
    return "pdf";
  }

  if (extension === ".docx" || DOCX_CONTENT_TYPES.has(contentType)) {
    return "docx";
  }

  if (extension === ".hwpx" || HWPX_CONTENT_TYPES.has(contentType)) {
    return "hwpx";
  }

  return null;
}

function decodeXmlEntities(input: string): string {
  return input
    .replace(/&#x([0-9a-f]+);/gi, (_, raw) =>
      String.fromCodePoint(Number.parseInt(raw, 16)),
    )
    .replace(/&#([0-9]+);/g, (_, raw) =>
      String.fromCodePoint(Number.parseInt(raw, 10)),
    )
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function normalizeExtractedText(input: string): string {
  return input
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.replace(/\t+/g, " ").replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n")
    .trim();
}

function xmlToPlainText(xml: string): string {
  const blockSeparated = xml
    .replace(/<w:tab[^>]*\/>/gi, "\t")
    .replace(/<hp:tab[^>]*\/>/gi, "\t")
    .replace(/<w:br[^>]*\/>/gi, "\n")
    .replace(/<w:cr[^>]*\/>/gi, "\n")
    .replace(/<hp:lineBreak[^>]*\/>/gi, "\n")
    .replace(/<\/w:tc>/gi, "\t")
    .replace(/<\/hp:td>/gi, "\t")
    .replace(/<\/w:tr>/gi, "\n")
    .replace(/<\/hp:tr>/gi, "\n")
    .replace(/<\/w:p>/gi, "\n")
    .replace(/<\/hp:p>/gi, "\n")
    .replace(/<\/text:p>/gi, "\n")
    .replace(/<[^>]+>/g, "");

  return normalizeExtractedText(decodeXmlEntities(blockSeparated));
}

async function extractTextFromZipEntries(
  buffer: Buffer,
  entryMatcher: (entryName: string) => boolean,
): Promise<string> {
  const archive = await JSZip.loadAsync(buffer);
  const entryNames = Object.keys(archive.files)
    .filter((entryName) => entryMatcher(entryName))
    .sort();

  const collectedSections: string[] = [];

  for (const entryName of entryNames) {
    const file = archive.file(entryName);
    if (!file) {
      continue;
    }

    const xml = await file.async("string");
    const plainText = xmlToPlainText(xml);
    if (plainText) {
      collectedSections.push(plainText);
    }
  }

  return normalizeExtractedText(collectedSections.join("\n\n"));
}

async function extractPdfText(attachment: ExtractableNoticeAttachment): Promise<string> {
  const buffer = await fs.readFile(attachment.absolutePath);
  const parser = new PDFParse({ data: buffer });

  try {
    const result = await parser.getText();
    return normalizeExtractedText(result.text ?? "");
  } finally {
    await parser.destroy();
  }
}

async function extractDocxText(attachment: ExtractableNoticeAttachment): Promise<string> {
  const buffer = await fs.readFile(attachment.absolutePath);
  return extractTextFromZipEntries(
    buffer,
    (entryName) =>
      /^word\/(document|header\d+|footer\d+)\.xml$/i.test(entryName),
  );
}

async function extractHwpxText(attachment: ExtractableNoticeAttachment): Promise<string> {
  const buffer = await fs.readFile(attachment.absolutePath);
  return extractTextFromZipEntries(
    buffer,
    (entryName) =>
      /^Contents\/(header|section\d+)\.xml$/i.test(entryName),
  );
}

/**
 * 첫 첨부 추출 슬라이스에서는 PDF / DOCX / HWPX만 지원하고, 실제 텍스트 추출은
 * "지원 포맷 라우팅 -> 파일 읽기 -> 공통 정규화" 세 단계로 통일한다. 이렇게 해 두면
 * 다음 슬라이스에서 이미지 OCR이나 HWP 전용 파서를 붙일 때도 registry만 확장하면 된다.
 */
export async function extractNoticeAttachmentText(
  attachment: ExtractableNoticeAttachment,
): Promise<NoticeAttachmentExtractionResult | null> {
  const extractorType = detectNoticeAttachmentExtractorType(attachment);
  if (!extractorType) {
    return null;
  }

  const stats = await fs.stat(attachment.absolutePath);
  if (stats.size > MAX_ATTACHMENT_SIZE_BYTES) {
    throw new Error(
      `attachment is too large for the current extraction slice: ${attachment.fileName}`,
    );
  }

  const extractedText = extractorType === "pdf"
    ? await extractPdfText(attachment)
    : extractorType === "docx"
      ? await extractDocxText(attachment)
      : await extractHwpxText(attachment);

  if (!extractedText) {
    throw new Error(
      `no extractable text found for supported attachment: ${attachment.fileName}`,
    );
  }

  const extractedCharCount = extractedText.length;
  const boundedText = extractedText.slice(0, MAX_EXTRACTED_TEXT_CHAR_COUNT);

  return {
    extractorType,
    extractedText: boundedText,
    textSha256: sha256(boundedText),
    extractedCharCount,
  };
}
