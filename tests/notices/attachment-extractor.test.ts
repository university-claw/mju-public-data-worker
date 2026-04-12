import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import JSZip from "jszip";
import { afterEach, describe, expect, it } from "vitest";
import {
  detectNoticeAttachmentExtractorType,
  extractNoticeAttachmentText,
} from "../../src/notices/attachment-extractor.js";

const createdDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    createdDirectories.splice(0).map((directory) =>
      fs.rm(directory, { recursive: true, force: true }),
    ),
  );
});

async function createTemporaryFile(fileName: string, buffer: Buffer): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "notice-extractor-"));
  createdDirectories.push(directory);
  const absolutePath = path.join(directory, fileName);
  await fs.writeFile(absolutePath, buffer);
  return absolutePath;
}

async function createDocxBuffer(): Promise<Buffer> {
  const archive = new JSZip();
  archive.file(
    "word/document.xml",
    `
      <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
        <w:body>
          <w:p><w:r><w:t>첫째 줄</w:t></w:r></w:p>
          <w:p><w:r><w:t>둘째 줄</w:t></w:r></w:p>
        </w:body>
      </w:document>
    `,
  );
  return Buffer.from(await archive.generateAsync({ type: "nodebuffer" }));
}

async function createHwpxBuffer(): Promise<Buffer> {
  const archive = new JSZip();
  archive.file(
    "Contents/section0.xml",
    `
      <hp:section xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph">
        <hp:p>
          <hp:run><hp:t>첫 문단</hp:t></hp:run>
        </hp:p>
        <hp:p>
          <hp:run><hp:t>둘째 문단</hp:t></hp:run>
        </hp:p>
      </hp:section>
    `,
  );
  return Buffer.from(await archive.generateAsync({ type: "nodebuffer" }));
}

function createPdfBuffer(text: string): Buffer {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${[
      "BT",
      "/F1 18 Tf",
      "40 100 Td",
      `(${text.replace(/[()\\]/g, "\\$&")}) Tj`,
      "ET",
      "",
    ].join("\n").length} >>\nstream\n${[
      "BT",
      "/F1 18 Tf",
      "40 100 Td",
      `(${text.replace(/[()\\]/g, "\\$&")}) Tj`,
      "ET",
      "",
    ].join("\n")}endstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];

  let pdf = "%PDF-1.4\n";
  const offsets = [0];

  for (let index = 0; index < objects.length; index += 1) {
    offsets.push(Buffer.byteLength(pdf, "utf8"));
    pdf += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`;
  }

  const xrefOffset = Buffer.byteLength(pdf, "utf8");
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += "0000000000 65535 f \n";
  for (let index = 1; index < offsets.length; index += 1) {
    pdf += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(pdf, "utf8");
}

describe("notice attachment extractor", () => {
  it("detects supported extractor types from file name and content type", () => {
    expect(
      detectNoticeAttachmentExtractorType({
        id: 1,
        fileName: "안내문.pdf",
        downloadUrl: "https://example.com/guide.pdf",
        storageKey: "notices/general/1/attachments/00.pdf",
        contentType: "application/pdf",
        downloadStatus: "succeeded",
      }),
    ).toBe("pdf");

    expect(
      detectNoticeAttachmentExtractorType({
        id: 2,
        fileName: "양식.docx",
        downloadUrl: "https://example.com/form.docx",
        storageKey: "notices/general/1/attachments/01.docx",
        contentType:
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        downloadStatus: "succeeded",
      }),
    ).toBe("docx");

    expect(
      detectNoticeAttachmentExtractorType({
        id: 3,
        fileName: "규정.hwpx",
        downloadUrl: "https://example.com/rule.hwpx",
        storageKey: "notices/general/1/attachments/02.hwpx",
        contentType: "application/hwp+zip",
        downloadStatus: "succeeded",
      }),
    ).toBe("hwpx");

    expect(
      detectNoticeAttachmentExtractorType({
        id: 4,
        fileName: "포스터.png",
        downloadUrl: "https://example.com/poster.png",
        storageKey: "notices/general/1/attachments/03.png",
        contentType: "image/png",
        downloadStatus: "succeeded",
      }),
    ).toBeNull();
  });

  it("extracts normalized text from a docx archive", async () => {
    const absolutePath = await createTemporaryFile(
      "sample.docx",
      await createDocxBuffer(),
    );

    const extraction = await extractNoticeAttachmentText({
      id: 10,
      fileName: "sample.docx",
      downloadUrl: "https://example.com/sample.docx",
      storageKey: "notices/general/1/attachments/00.docx",
      contentType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      downloadStatus: "succeeded",
      absolutePath,
    });

    expect(extraction?.extractorType).toBe("docx");
    expect(extraction?.extractedText).toBe("첫째 줄\n둘째 줄");
    expect(extraction?.extractedCharCount).toBe("첫째 줄\n둘째 줄".length);
  });

  it("extracts normalized text from a pdf document", async () => {
    const absolutePath = await createTemporaryFile(
      "sample.pdf",
      createPdfBuffer("Hello PDF"),
    );

    const extraction = await extractNoticeAttachmentText({
      id: 12,
      fileName: "sample.pdf",
      downloadUrl: "https://example.com/sample.pdf",
      storageKey: "notices/general/1/attachments/02.pdf",
      contentType: "application/pdf",
      downloadStatus: "succeeded",
      absolutePath,
    });

    expect(extraction?.extractorType).toBe("pdf");
    expect(extraction?.extractedText).toContain("Hello PDF");
  });

  it("extracts normalized text from a hwpx archive", async () => {
    const absolutePath = await createTemporaryFile(
      "sample.hwpx",
      await createHwpxBuffer(),
    );

    const extraction = await extractNoticeAttachmentText({
      id: 11,
      fileName: "sample.hwpx",
      downloadUrl: "https://example.com/sample.hwpx",
      storageKey: "notices/general/1/attachments/01.hwpx",
      contentType: "application/hwp+zip",
      downloadStatus: "succeeded",
      absolutePath,
    });

    expect(extraction?.extractorType).toBe("hwpx");
    expect(extraction?.extractedText).toBe("첫 문단\n둘째 문단");
    expect(extraction?.extractedCharCount).toBe("첫 문단\n둘째 문단".length);
  });
});
