import { exec as execCallback } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { createWorker, PSM, setLogging } from "tesseract.js";

setLogging(false);

const exec = promisify(execCallback);

export interface OcrRecognitionResult {
  text: string;
  confidence: number | null;
  blocks?: OcrTextBlock[];
}

export interface OcrTextBlock {
  text: string;
  confidence: number | null;
  box: {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
  };
}

export interface OcrRecognitionOptions {
  psm?: PSM;
}

export interface OcrRecognizerOptions {
  externalCommand?: string;
  externalCommandTimeoutMs?: number;
}

export interface ExternalOcrCommandResult extends OcrRecognitionResult {
  command: string;
  rawOutput: string;
  durationMs: number;
}

export class OcrRecognizer {
  private workerPromise:
    | ReturnType<typeof createWorker>
    | undefined;

  constructor(
    private readonly languages: string[],
    private readonly cachePath: string,
    private readonly options: OcrRecognizerOptions = {},
  ) {}

  private getWorker() {
    if (!this.workerPromise) {
      this.workerPromise = createWorker(this.languages, undefined, {
        cachePath: this.cachePath,
        logger: () => undefined,
      });
    }

    return this.workerPromise;
  }

  /**
   * 학식표 이미지는 텍스트량이 많은 정적 이미지라, 매번 worker를 새로 띄우는 것보다
   * 한 번 만든 worker를 재사용하는 편이 훨씬 안정적이다.
   */
  async recognize(imagePath: string): Promise<OcrRecognitionResult> {
    return this.recognizeInput(imagePath, {
      psm: PSM.AUTO,
    });
  }

  /**
   * 메뉴 정규화 단계에서는 이미지 전체가 아니라 "셀 단위 crop"을 다시 읽는 경우가
   * 많다. 이때는 임시 파일로 다시 쓰지 않고 메모리 buffer를 그대로 OCR에 넘길 수
   * 있어야 속도와 코드 복잡도 모두 관리가 된다.
   */
  async recognizeBuffer(
    imageBuffer: Buffer,
    options: OcrRecognitionOptions = {},
  ): Promise<OcrRecognitionResult> {
    return this.recognizeInput(imageBuffer, options);
  }

  private async recognizeInput(
    image: string | Buffer,
    options: OcrRecognitionOptions = {},
  ): Promise<OcrRecognitionResult> {
    if (this.options.externalCommand) {
      return this.recognizeWithExternalCommand(image);
    }

    const worker = await this.getWorker();
    await worker.setParameters({
      tessedit_pageseg_mode: options.psm ?? PSM.AUTO,
      preserve_interword_spaces: "1",
    });

    const result = await worker.recognize(image);
    return {
      text: result.data.text.trim(),
      confidence:
        typeof result.data.confidence === "number"
          ? Number(result.data.confidence.toFixed(2))
          : null,
    };
  }

  private async recognizeWithExternalCommand(
    image: string | Buffer,
  ): Promise<OcrRecognitionResult> {
    if (typeof image === "string") {
      const result = await runExternalOcrCommand(
        this.options.externalCommand!,
        image,
        this.externalCommandOptions(),
      );
      return {
        text: result.text,
        confidence: result.confidence,
        ...(result.blocks ? { blocks: result.blocks } : {}),
      };
    }

    await fs.mkdir(this.cachePath, { recursive: true });
    const tempDirectory = await fs.mkdtemp(path.join(this.cachePath, "external-ocr-"));
    const tempImagePath = path.join(tempDirectory, "input.png");

    try {
      await fs.writeFile(tempImagePath, image);
      const result = await runExternalOcrCommand(
        this.options.externalCommand!,
        tempImagePath,
        this.externalCommandOptions(),
      );
      return {
        text: result.text,
        confidence: result.confidence,
        ...(result.blocks ? { blocks: result.blocks } : {}),
      };
    } finally {
      await fs.rm(tempDirectory, { recursive: true, force: true });
    }
  }

  private externalCommandOptions(): { timeoutMs?: number } {
    return typeof this.options.externalCommandTimeoutMs === "number"
      ? { timeoutMs: this.options.externalCommandTimeoutMs }
      : {};
  }

  async terminate(): Promise<void> {
    if (!this.workerPromise) {
      return;
    }

    const worker = await this.workerPromise;
    await worker.terminate();
    this.workerPromise = undefined;
  }
}

function quoteForShell(value: string): string {
  return `"${value.replace(/"/g, '\\"')}"`;
}

function normalizeConfidence(confidence: unknown): number | null {
  if (typeof confidence !== "number" || !Number.isFinite(confidence)) {
    return null;
  }

  const normalized = confidence > 0 && confidence <= 1
    ? confidence * 100
    : confidence;
  return Number(normalized.toFixed(2));
}

function parseExternalOcrBlocks(blocks: unknown): OcrTextBlock[] | undefined {
  if (!Array.isArray(blocks)) {
    return undefined;
  }

  const parsedBlocks: OcrTextBlock[] = [];
  for (const block of blocks) {
    if (!block || typeof block !== "object") {
      continue;
    }

    const candidate = block as {
      text?: unknown;
      confidence?: unknown;
      box?: unknown;
    };
    if (typeof candidate.text !== "string" || !Array.isArray(candidate.box)) {
      continue;
    }

    const x1 = Number(candidate.box[0]);
    const y1 = Number(candidate.box[1]);
    const x2 = Number(candidate.box[2]);
    const y2 = Number(candidate.box[3]);
    if (![x1, y1, x2, y2].every(Number.isFinite)) {
      continue;
    }

    const text = candidate.text.trim();
    if (!text) {
      continue;
    }

    parsedBlocks.push({
      text,
      confidence: normalizeConfidence(candidate.confidence),
      box: { x1, y1, x2, y2 },
    });
  }

  return parsedBlocks.length > 0 ? parsedBlocks : undefined;
}

function parseExternalOcrOutput(
  stdout: string,
): Pick<ExternalOcrCommandResult, "text" | "confidence" | "blocks" | "rawOutput"> {
  const trimmed = stdout.trim();
  try {
    const parsed = JSON.parse(trimmed) as {
      text?: unknown;
      confidence?: unknown;
      blocks?: unknown;
    };
    const blocks = parseExternalOcrBlocks(parsed.blocks);
    return {
      text: typeof parsed.text === "string" ? parsed.text.trim() : trimmed,
      confidence: normalizeConfidence(parsed.confidence),
      ...(blocks ? { blocks } : {}),
      rawOutput: trimmed,
    };
  } catch {
    return {
      text: trimmed,
      confidence: null,
      rawOutput: trimmed,
    };
  }
}

export async function runExternalOcrCommand(
  commandTemplate: string,
  imagePath: string,
  options: { timeoutMs?: number } = {},
): Promise<ExternalOcrCommandResult> {
  const command = commandTemplate.includes("{image}")
    ? commandTemplate.replaceAll("{image}", quoteForShell(imagePath))
    : `${commandTemplate} ${quoteForShell(imagePath)}`;
  const startedAt = Date.now();
  const { stdout, stderr } = await exec(command, {
    timeout: options.timeoutMs ?? 120_000,
    maxBuffer: 10 * 1024 * 1024,
    env: {
      ...process.env,
      PYTHONIOENCODING: process.env.PYTHONIOENCODING ?? "utf-8",
    },
  });
  const parsed = parseExternalOcrOutput(stdout);

  return {
    command,
    text: parsed.text,
    confidence: parsed.confidence,
    ...(parsed.blocks ? { blocks: parsed.blocks } : {}),
    rawOutput: stderr.trim()
      ? `${parsed.rawOutput}\n[stderr]\n${stderr.trim()}`
      : parsed.rawOutput,
    durationMs: Date.now() - startedAt,
  };
}
