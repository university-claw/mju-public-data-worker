import fs from "node:fs/promises";
import path from "node:path";
import got from "got";
import { CAFETERIA_INSTAGRAM_SOURCES } from "./sources.js";
import { scrapeCafeteriaInstagramPosts } from "./instagram-scraper.js";
import {
  OcrRecognizer,
  runExternalOcrCommand,
  type OcrRecognitionResult,
} from "./ocr-recognizer.js";
import type { CafeteriaInstagramPost, CafeteriaInstagramSource } from "./types.js";

const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp"]);

export interface CafeteriaOcrBenchmarkArgs {
  inputDirs: string[];
  outputDir: string;
  cacheDir: string;
  limitPerSource: number;
  collectInstagram: boolean;
  candidateCommand?: string;
  ocrLanguages: string[];
}

export interface CafeteriaOcrBenchmarkSample {
  sampleId: string;
  sourceId?: string;
  postCode?: string;
  postedAt?: string;
  caption?: string;
  imageUrl?: string;
  imagePath: string;
}

export interface CafeteriaOcrBenchmarkRow {
  sample: CafeteriaOcrBenchmarkSample;
  baseline: OcrRecognitionResult & {
    durationMs: number;
    brokenKoreanSuspectCount: number;
  };
  candidate?: CafeteriaOcrBenchmarkCandidate;
}

export interface CafeteriaOcrBenchmarkResult {
  generatedAt: string;
  samples: CafeteriaOcrBenchmarkSample[];
  rows: CafeteriaOcrBenchmarkRow[];
  collectionErrors: string[];
}

export interface CafeteriaOcrBenchmarkCandidate {
  command: string;
  text: string;
  confidence: number | null;
  rawOutput: string;
  durationMs: number;
  error?: string;
}

function readFlag(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index !== -1) {
    return args[index + 1];
  }

  const equalStyle = args.find((arg) => arg.startsWith(`${flag}=`));
  return equalStyle?.slice(flag.length + 1);
}

function hasFlag(args: string[], flag: string): boolean {
  return args.includes(flag);
}

function readRepeatedFlag(args: string[], flag: string): string[] {
  const values: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === flag) {
      const value = args[index + 1];
      if (value) {
        values.push(value);
      }
      index += 1;
    } else if (arg?.startsWith(`${flag}=`)) {
      values.push(arg.slice(flag.length + 1));
    }
  }

  return values;
}

function parsePositiveInteger(raw: string | undefined, fallback: number): number {
  if (!raw) {
    return fallback;
  }

  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`expected a positive integer, received: ${raw}`);
  }

  return parsed;
}

function parseLanguages(raw: string | undefined): string[] {
  const languages = (raw ?? process.env.OCR_LANGUAGES ?? "kor+eng")
    .split("+")
    .map((language) => language.trim())
    .filter(Boolean);

  return languages.length > 0 ? languages : ["kor", "eng"];
}

export function parseCafeteriaOcrBenchmarkArgs(
  args: string[],
): CafeteriaOcrBenchmarkArgs {
  const candidateCommand = readFlag(args, "--candidate-command");
  return {
    inputDirs: readRepeatedFlag(args, "--input-dir"),
    outputDir:
      readFlag(args, "--output-dir") ??
      path.join("reports", "cafeteria-ocr", new Date().toISOString().replace(/[:.]/g, "-")),
    cacheDir:
      readFlag(args, "--cache-dir") ??
      path.join(".cache", "tesseract"),
    limitPerSource: parsePositiveInteger(readFlag(args, "--limit-per-source"), 3),
    collectInstagram: hasFlag(args, "--collect-instagram"),
    ocrLanguages: parseLanguages(readFlag(args, "--ocr-languages")),
    ...(candidateCommand ? { candidateCommand } : {}),
  };
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function listImageFiles(directory: string): Promise<string[]> {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const results: string[] = [];

  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      results.push(...await listImageFiles(entryPath));
    } else if (IMAGE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
      results.push(entryPath);
    }
  }

  return results.sort();
}

export async function discoverLocalSamples(
  inputDirs: string[],
): Promise<CafeteriaOcrBenchmarkSample[]> {
  const samples: CafeteriaOcrBenchmarkSample[] = [];

  for (const inputDir of inputDirs) {
    if (!await pathExists(inputDir)) {
      throw new Error(`input directory does not exist: ${inputDir}`);
    }

    const imageFiles = await listImageFiles(inputDir);
    for (const imagePath of imageFiles) {
      samples.push({
        sampleId: path.basename(imagePath, path.extname(imagePath)),
        imagePath,
      });
    }
  }

  return samples;
}

function extensionFromContentType(contentType: string | undefined): string {
  if (contentType?.includes("png")) {
    return ".png";
  }
  if (contentType?.includes("webp")) {
    return ".webp";
  }
  return ".jpg";
}

function toSampleId(post: CafeteriaInstagramPost): string {
  return `${post.sourceId}-${post.postCode}`;
}

async function downloadInstagramImage(
  post: CafeteriaInstagramPost,
  outputDir: string,
): Promise<CafeteriaOcrBenchmarkSample | null> {
  if (!post.imageUrl) {
    return null;
  }

  const response = await got(post.imageUrl, {
    responseType: "buffer",
    timeout: { request: 20_000 },
    retry: { limit: 1 },
  });
  const extension = extensionFromContentType(response.headers["content-type"]);
  const sourceDir = path.join(outputDir, "samples", post.sourceId);
  await fs.mkdir(sourceDir, { recursive: true });
  const imagePath = path.join(sourceDir, `${post.postCode}${extension}`);
  await fs.writeFile(imagePath, response.body);

  return {
    sampleId: toSampleId(post),
    sourceId: post.sourceId,
    postCode: post.postCode,
    postedAt: post.postedAt,
    imageUrl: post.imageUrl,
    imagePath,
    ...(post.caption ? { caption: post.caption } : {}),
  };
}

export async function collectInstagramSamples(params: {
  outputDir: string;
  limitPerSource: number;
  sources?: CafeteriaInstagramSource[];
}): Promise<{
  samples: CafeteriaOcrBenchmarkSample[];
  errors: string[];
}> {
  const samples: CafeteriaOcrBenchmarkSample[] = [];
  const errors: string[] = [];
  const sources = params.sources ?? CAFETERIA_INSTAGRAM_SOURCES;

  for (const source of sources) {
    try {
      const posts = await scrapeCafeteriaInstagramPosts(
        source,
        params.limitPerSource,
      );

      for (const post of posts) {
        const sample = await downloadInstagramImage(post, params.outputDir);
        if (sample) {
          samples.push(sample);
        }
      }
    } catch (error) {
      errors.push(`${source.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return { samples, errors };
}

export function countBrokenKoreanSuspects(text: string): number {
  const replacementChars = text.match(/\uFFFD/g)?.length ?? 0;
  const questionRuns = text.match(/\?{2,}/g)?.length ?? 0;
  return replacementChars + questionRuns;
}

async function runCandidateCommand(
  commandTemplate: string,
  imagePath: string,
): Promise<CafeteriaOcrBenchmarkCandidate> {
  const startedAt = Date.now();
  try {
    const result = await runExternalOcrCommand(commandTemplate, imagePath);
    return {
      command: result.command,
      text: result.text,
      confidence: result.confidence,
      rawOutput: result.rawOutput,
      durationMs: result.durationMs,
    };
  } catch (error) {
    return {
      command: commandTemplate,
      text: "",
      confidence: null,
      rawOutput: "",
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function runCafeteriaOcrBenchmark(params: {
  samples: CafeteriaOcrBenchmarkSample[];
  outputDir: string;
  cacheDir: string;
  ocrLanguages: string[];
  collectionErrors: string[];
  candidateCommand?: string;
  recognizer?: Pick<OcrRecognizer, "recognize" | "terminate">;
}): Promise<CafeteriaOcrBenchmarkResult> {
  await fs.mkdir(params.outputDir, { recursive: true });
  await fs.mkdir(params.cacheDir, { recursive: true });

  const recognizer = params.recognizer ?? new OcrRecognizer(
    params.ocrLanguages,
    params.cacheDir,
  );
  const rows: CafeteriaOcrBenchmarkRow[] = [];

  try {
    for (const sample of params.samples) {
      const startedAt = Date.now();
      const baseline = await recognizer.recognize(sample.imagePath);
      const row: CafeteriaOcrBenchmarkRow = {
        sample,
        baseline: {
          ...baseline,
          durationMs: Date.now() - startedAt,
          brokenKoreanSuspectCount: countBrokenKoreanSuspects(baseline.text),
        },
      };

      if (params.candidateCommand) {
        row.candidate = await runCandidateCommand(
          params.candidateCommand,
          sample.imagePath,
        );
      }

      rows.push(row);
    }
  } finally {
    await recognizer.terminate();
  }

  const result: CafeteriaOcrBenchmarkResult = {
    generatedAt: new Date().toISOString(),
    samples: params.samples,
    rows,
    collectionErrors: params.collectionErrors,
  };

  await writeBenchmarkArtifacts(params.outputDir, result);
  return result;
}

function truncateForMarkdown(text: string, maxLength = 500): string {
  const normalized = text.trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength)}...`;
}

export function renderBenchmarkMarkdown(
  result: CafeteriaOcrBenchmarkResult,
): string {
  const lines = [
    "# Cafeteria OCR Benchmark Report",
    "",
    `Generated at: ${result.generatedAt}`,
    `Samples: ${result.samples.length}`,
    `Collection errors: ${result.collectionErrors.length}`,
    "",
    "## Collection Errors",
    "",
    ...(
      result.collectionErrors.length > 0
        ? result.collectionErrors.map((error) => `- ${error}`)
        : ["- None"]
    ),
    "",
    "## Rows",
    "",
  ];

  for (const row of result.rows) {
    lines.push(
      `### ${row.sample.sampleId}`,
      "",
      `- Source: ${row.sample.sourceId ?? "manual"}`,
      `- Image: ${row.sample.imagePath}`,
      `- Baseline confidence: ${row.baseline.confidence ?? "n/a"}`,
      `- Baseline duration: ${row.baseline.durationMs}ms`,
      `- Baseline broken-Korean suspects: ${row.baseline.brokenKoreanSuspectCount}`,
      "",
      "Baseline text:",
      "",
      "```text",
      truncateForMarkdown(row.baseline.text),
      "```",
      "",
    );

    if (row.candidate) {
      lines.push(
        `- Candidate command: \`${row.candidate.command.replace(/`/g, "\\`")}\``,
        `- Candidate confidence: ${row.candidate.confidence ?? "n/a"}`,
        `- Candidate duration: ${row.candidate.durationMs}ms`,
      );
      if (row.candidate.error) {
        lines.push(`- Candidate error: ${row.candidate.error}`);
      }
      lines.push(
        "",
        "Candidate text:",
        "",
        "```text",
        truncateForMarkdown(row.candidate.text),
        "```",
        "",
      );
    }
  }

  if (result.rows.length === 0) {
    lines.push(
      "No OCR rows were generated. Check sample collection errors or pass `--input-dir` with local images.",
      "",
    );
  }

  return `${lines.join("\n")}\n`;
}

export async function writeBenchmarkArtifacts(
  outputDir: string,
  result: CafeteriaOcrBenchmarkResult,
): Promise<void> {
  await fs.mkdir(outputDir, { recursive: true });
  await fs.writeFile(
    path.join(outputDir, "sample-manifest.json"),
    JSON.stringify(result.samples, null, 2),
  );
  await fs.writeFile(
    path.join(outputDir, "benchmark-results.json"),
    JSON.stringify(result, null, 2),
  );
  await fs.writeFile(
    path.join(outputDir, "benchmark-report.md"),
    renderBenchmarkMarkdown(result),
  );
}

async function runCli(): Promise<void> {
  const args = parseCafeteriaOcrBenchmarkArgs(process.argv.slice(2));
  const localSamples = await discoverLocalSamples(args.inputDirs);
  const collection = args.collectInstagram
    ? await collectInstagramSamples({
        outputDir: args.outputDir,
        limitPerSource: args.limitPerSource,
      })
    : { samples: [], errors: [] };
  const samples = [...localSamples, ...collection.samples];

  const result = await runCafeteriaOcrBenchmark({
    samples,
    outputDir: args.outputDir,
    cacheDir: args.cacheDir,
    ocrLanguages: args.ocrLanguages,
    collectionErrors: collection.errors,
    ...(args.candidateCommand ? { candidateCommand: args.candidateCommand } : {}),
  });

  console.log(JSON.stringify({
    outputDir: args.outputDir,
    sampleCount: result.samples.length,
    rowCount: result.rows.length,
    collectionErrorCount: result.collectionErrors.length,
  }, null, 2));
}

if (process.argv[1] && path.basename(process.argv[1]) === "ocr-benchmark.ts") {
  runCli().catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : error);
    process.exitCode = 1;
  });
}
