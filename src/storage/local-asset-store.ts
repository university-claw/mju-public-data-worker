import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";

export interface StoredLocalAsset {
  storageProvider: "local";
  storageKey: string;
  absolutePath: string;
  contentType: string;
  sizeBytes: number;
  sha256: string;
}

function normalizeStorageKey(storageKey: string): string {
  return storageKey.replace(/\\/g, "/");
}

function extensionFromContentType(contentType: string): string {
  switch (contentType.toLowerCase()) {
    case "image/jpeg":
    case "image/jpg":
      return ".jpg";
    case "image/png":
      return ".png";
    case "image/webp":
      return ".webp";
    default:
      return ".bin";
  }
}

export class LocalAssetStore {
  constructor(private readonly rootDirectory: string) {}

  resolve(storageKey: string): string {
    return path.join(this.rootDirectory, ...normalizeStorageKey(storageKey).split("/"));
  }

  async exists(storageKey: string): Promise<boolean> {
    try {
      await fs.access(this.resolve(storageKey));
      return true;
    } catch {
      return false;
    }
  }

  /**
   * DB에는 OS별 절대경로 대신 storageKey만 저장하고, 실제 경로 계산은 이 어댑터가
   * 맡는다. 이렇게 해 두면 Windows / macOS / Docker volume 환경이 달라도 같은
   * key를 재사용할 수 있어 팀원 환경 차이가 DB 설계에 스며들지 않는다.
   */
  async putImage(params: {
    storageKeyBase: string;
    buffer: Buffer;
    contentType?: string | null;
  }): Promise<StoredLocalAsset> {
    const normalizedContentType =
      params.contentType?.trim().toLowerCase() || "application/octet-stream";
    const extension = extensionFromContentType(normalizedContentType);
    const storageKey = normalizeStorageKey(`${params.storageKeyBase}${extension}`);
    const absolutePath = this.resolve(storageKey);
    const temporaryPath = `${absolutePath}.tmp-${Date.now()}`;

    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(temporaryPath, params.buffer);
    await fs.rename(temporaryPath, absolutePath);

    return {
      storageProvider: "local",
      storageKey,
      absolutePath,
      contentType: normalizedContentType,
      sizeBytes: params.buffer.byteLength,
      sha256: createHash("sha256").update(params.buffer).digest("hex"),
    };
  }
}
