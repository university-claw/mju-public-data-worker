import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  OcrRecognizer,
  runExternalOcrCommand,
} from "../../src/cafeterias/ocr-recognizer.js";

const temporaryDirectories = new Set<string>();

async function makeTempDirectory(): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "cafeteria-ocr-command-"));
  temporaryDirectories.add(directory);
  return directory;
}

function quotePath(filePath: string): string {
  return `"${filePath.replace(/"/g, '\\"')}"`;
}

afterEach(async () => {
  await Promise.all(
    [...temporaryDirectories].map(async (directory) => {
      temporaryDirectories.delete(directory);
      await fs.rm(directory, { recursive: true, force: true });
    }),
  );
});

describe("external OCR command", () => {
  it("quotes image paths and normalizes zero-to-one confidence", async () => {
    const directory = await makeTempDirectory();
    const imagePath = path.join(directory, "menu image.png");
    const candidatePath = path.join(directory, "candidate.cjs");
    await fs.writeFile(imagePath, "fake image");
    await fs.writeFile(candidatePath, `
const imagePath = process.argv[2];
if (!imagePath.endsWith('menu image.png')) {
  throw new Error('unexpected image path: ' + imagePath);
}
console.log(JSON.stringify({
  text: '\\uba85\\uc9c0\\ub300 \\ud559\\uc2dd',
  confidence: 0.875,
}));
`);

    const result = await runExternalOcrCommand(
      `node ${quotePath(candidatePath)} {image}`,
      imagePath,
    );

    expect(result.text).toBe("명지대 학식");
    expect(result.confidence).toBe(87.5);
    expect(result.command).toContain('"');
  });

  it("keeps external OCR text boxes when the candidate returns coordinates", async () => {
    const directory = await makeTempDirectory();
    const imagePath = path.join(directory, "menu.png");
    const candidatePath = path.join(directory, "candidate.cjs");
    await fs.writeFile(imagePath, "fake image");
    await fs.writeFile(candidatePath, `
console.log(JSON.stringify({
  text: '\\uc624\\ucf54\\ub178\\ubbf8\\uc628\\ub354\\uae4c\\uc2a4',
  confidence: 95.12,
  blocks: [{
    text: '\\uc624\\ucf54\\ub178\\ubbf8\\uc628\\ub354\\uae4c\\uc2a4',
    confidence: 0.9512,
    box: [10, 20, 110, 40],
  }],
}));
`);

    const result = await runExternalOcrCommand(
      `node ${quotePath(candidatePath)} {image}`,
      imagePath,
    );

    expect(result.blocks).toEqual([
      {
        text: "오코노미온더까스",
        confidence: 95.12,
        box: { x1: 10, y1: 20, x2: 110, y2: 40 },
      },
    ]);
  });

  it("uses the external command for buffer OCR through a temporary image file", async () => {
    const directory = await makeTempDirectory();
    const candidatePath = path.join(directory, "candidate.cjs");
    await fs.writeFile(candidatePath, `
const fs = require('node:fs');
const imagePath = process.argv[2];
if (!fs.existsSync(imagePath)) {
  throw new Error('image path was not written');
}
console.log(JSON.stringify({
  text: '\\uc810\\uc2ec\\n\\uc81c\\uc721\\ubcf6\\uc74c',
  confidence: 92.34,
}));
`);

    const recognizer = new OcrRecognizer(
      ["kor", "eng"],
      path.join(directory, "cache"),
      { externalCommand: `node ${quotePath(candidatePath)} {image}` },
    );

    await expect(recognizer.recognizeBuffer(Buffer.from("fake image"))).resolves.toEqual({
      text: "점심\n제육볶음",
      confidence: 92.34,
    });
    await recognizer.terminate();
  });
});
