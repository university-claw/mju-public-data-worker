import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..", "..");

// 로컬 비밀값이 들어있는 `.env.local`을 먼저 읽고, 공유 가능한 `.env`를
// 그 다음에 읽는다. 이렇게 두면 개발자가 개인 비밀번호를 안전하게 덮어쓸 수 있다.
dotenv.config({
  path: path.join(projectRoot, ".env.local"),
  override: true,
  quiet: true,
});
dotenv.config({ path: path.join(projectRoot, ".env"), quiet: true });

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`required environment variable is missing: ${name}`);
  }
  return value;
}

function parsePositiveInteger(name: string, raw: string): number {
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer, received: ${raw}`);
  }
  return parsed;
}

function validateSchemaIdentifier(raw: string): string {
  if (!/^[a-z_][a-z0-9_]*$/i.test(raw)) {
    throw new Error(
      `PGSCHEMA must be a valid SQL identifier-like name, received: ${raw}`,
    );
  }

  return raw;
}

export interface AppConfig {
  pgHost: string;
  pgPort: number;
  pgDatabase: string;
  pgUser: string;
  pgPassword: string;
  pgSchema: string;
  storageProvider: "local";
  storageLocalRoot?: string;
  ocrLanguages: string[];
}

function parseStorageProvider(raw: string): "local" {
  if (raw !== "local") {
    throw new Error(
      `STORAGE_PROVIDER must be "local" for the current slice, received: ${raw}`,
    );
  }

  return raw;
}

function parseOcrLanguages(raw: string): string[] {
  const languages = raw
    .split("+")
    .map((language) => language.trim())
    .filter(Boolean);

  if (languages.length === 0) {
    throw new Error("OCR_LANGUAGES must contain at least one language code");
  }

  return languages;
}

export function loadConfig(): AppConfig {
  const pgPort = parsePositiveInteger("PGPORT", requireEnv("PGPORT"));
  const pgSchema = validateSchemaIdentifier(requireEnv("PGSCHEMA"));
  const storageProvider = parseStorageProvider(
    process.env.STORAGE_PROVIDER?.trim() || "local",
  );
  const storageLocalRoot = process.env.STORAGE_LOCAL_ROOT?.trim() || undefined;
  const ocrLanguages = parseOcrLanguages(
    process.env.OCR_LANGUAGES?.trim() || "kor+eng",
  );

  return {
    pgHost: requireEnv("PGHOST"),
    pgPort,
    pgDatabase: requireEnv("PGDATABASE"),
    pgUser: requireEnv("PGUSER"),
    pgPassword: requireEnv("PGPASSWORD"),
    pgSchema,
    storageProvider,
    ...(storageLocalRoot ? { storageLocalRoot } : {}),
    ocrLanguages,
  };
}
