import { createWorker, PSM, setLogging } from "tesseract.js";

setLogging(false);

export interface OcrRecognitionResult {
  text: string;
  confidence: number | null;
}

export interface OcrRecognitionOptions {
  psm?: PSM;
}

export class OcrRecognizer {
  private workerPromise:
    | ReturnType<typeof createWorker>
    | undefined;

  constructor(
    private readonly languages: string[],
    private readonly cachePath: string,
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

  async terminate(): Promise<void> {
    if (!this.workerPromise) {
      return;
    }

    const worker = await this.workerPromise;
    await worker.terminate();
    this.workerPromise = undefined;
  }
}
