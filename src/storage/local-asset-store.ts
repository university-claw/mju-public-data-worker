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
    case "application/pdf":
      return ".pdf";
    case "application/x-hwp":
    case "application/haansofthwp":
      return ".hwp";
    case "application/hwp+zip":
    case "application/x-hwp+zip":
    case "application/vnd.hancom.hwp":
    case "application/vnd.hancom.hwp+zip":
      return ".hwpx";
    default:
      return ".bin";
  }
}

function extensionFromFileName(fileName: string): string | null {
  const extension = path.extname(fileName).trim().toLowerCase();
  return extension ? extension : null;
}

function sanitizeFileNameSegment(value: string): string {
  const sanitized = value
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  return sanitized || "asset";
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

  async delete(storageKey: string): Promise<void> {
    try {
      await fs.unlink(this.resolve(storageKey));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
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
    return this.putAsset(params);
  }

  /**
   * 공통 자산 저장은 "안전한 storage key 계산"과 "실제 파일 쓰기"를 한 곳에서
   * 맡기는 편이 가장 단순하다. 첨부파일은 원래 파일명을 힌트로 쓰되, key 자체는
   * 운영체제에 안전한 문자만 남겨서 Windows / macOS / Docker volume 모두에서
   * 문제 없이 재사용할 수 있게 한다.
   */
  async putAsset(params: {
    storageKeyBase: string;
    buffer: Buffer;
    contentType?: string | null;
    fileName?: string | null;
    includeFileNameSuffix?: boolean;
  }): Promise<StoredLocalAsset> {
    const normalizedContentType =
      params.contentType?.trim().toLowerCase() || "application/octet-stream";
    const fileNameExtension =
      params.fileName ? extensionFromFileName(params.fileName) : null;
    const extension =
      fileNameExtension ?? extensionFromContentType(normalizedContentType);
    const fileNameSuffix = params.fileName && params.includeFileNameSuffix !== false
      ? `-${sanitizeFileNameSegment(path.basename(params.fileName, fileNameExtension ?? ""))}`
      : "";
    const storageKey = normalizeStorageKey(
      `${params.storageKeyBase}${fileNameSuffix}${extension}`,
    );
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
