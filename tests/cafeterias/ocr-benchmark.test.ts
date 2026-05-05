import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  countBrokenKoreanSuspects,
  discoverLocalSamples,
  parseCafeteriaOcrBenchmarkArgs,
  renderBenchmarkMarkdown,
  runCafeteriaOcrBenchmark,
} from "../../src/cafeterias/ocr-benchmark.js";

const temporaryDirectories = new Set<string>();

async function makeTempDirectory(): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "cafeteria-ocr-benchmark-"));
  temporaryDirectories.add(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    [...temporaryDirectories].map(async (directory) => {
      temporaryDirectories.delete(directory);
      await fs.rm(directory, { recursive: true, force: true });
    }),
  );
});

describe("cafeteria OCR benchmark", () => {
  it("parses CLI options with conservative defaults", () => {
    expect(parseCafeteriaOcrBenchmarkArgs([
      "--input-dir",
      "samples",
      "--collect-instagram",
      "--limit-per-source=2",
      "--candidate-command",
      "python candidate.py --image {image}",
      "--ocr-languages=kor+eng",
    ])).toEqual(expect.objectContaining({
      inputDirs: ["samples"],
      collectInstagram: true,
      limitPerSource: 2,
      candidateCommand: "python candidate.py --image {image}",
      ocrLanguages: ["kor", "eng"],
    }));
  });

  it("discovers local image samples recursively", async () => {
    const directory = await makeTempDirectory();
    const nested = path.join(directory, "nested");
    await fs.mkdir(nested);
    await fs.writeFile(path.join(directory, "menu.jpg"), "fake");
    await fs.writeFile(path.join(nested, "menu.webp"), "fake");
    await fs.writeFile(path.join(nested, "notes.txt"), "ignore");

    await expect(discoverLocalSamples([directory])).resolves.toEqual([
      expect.objectContaining({ sampleId: "menu", imagePath: path.join(directory, "menu.jpg") }),
      expect.objectContaining({ sampleId: "menu", imagePath: path.join(nested, "menu.webp") }),
    ]);
  });

  it("counts OCR text that is likely broken Korean", () => {
    expect(countBrokenKoreanSuspects("정상 한글")).toBe(0);
    expect(countBrokenKoreanSuspects("?? 메뉴 �")).toBeGreaterThan(0);
  });

  it("writes benchmark artifacts using an injected recognizer", async () => {
    const directory = await makeTempDirectory();
    const imagePath = path.join(directory, "menu.png");
    await fs.writeFile(imagePath, "fake");
    const outputDir = path.join(directory, "out");
    const recognizer = {
      recognize: vi.fn(async () => ({
        text: "월요일 점심\n김치찌개",
        confidence: 91.2,
      })),
      terminate: vi.fn(async () => undefined),
    };

    const result = await runCafeteriaOcrBenchmark({
      samples: [{ sampleId: "manual-menu", imagePath }],
      outputDir,
      cacheDir: path.join(directory, "cache"),
      ocrLanguages: ["kor", "eng"],
      collectionErrors: [],
      recognizer,
    });

    expect(result.rows).toHaveLength(1);
    expect(recognizer.recognize).toHaveBeenCalledWith(imagePath);
    await expect(fs.access(path.join(outputDir, "sample-manifest.json"))).resolves.toBeUndefined();
    await expect(fs.access(path.join(outputDir, "benchmark-results.json"))).resolves.toBeUndefined();
    await expect(fs.access(path.join(outputDir, "benchmark-report.md"))).resolves.toBeUndefined();
  });

  it("renders an empty report with collection blocker guidance", () => {
    const report = renderBenchmarkMarkdown({
      generatedAt: "2026-05-05T00:00:00.000Z",
      samples: [],
      rows: [],
      collectionErrors: ["student-hall: 401 Unauthorized"],
    });

    expect(report).toContain("student-hall: 401 Unauthorized");
    expect(report).toContain("--input-dir");
  });
});
