import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_CAFETERIA_OCR_COMMAND } from "../../src/cafeterias/ocr-defaults.js";
import { loadConfig } from "../../src/config/env.js";

const ENV_KEYS = [
  "PGHOST",
  "PGPORT",
  "PGDATABASE",
  "PGUSER",
  "PGPASSWORD",
  "PGSCHEMA",
  "STORAGE_PROVIDER",
  "STORAGE_LOCAL_ROOT",
  "OCR_LANGUAGES",
  "CAFETERIA_OCR_COMMAND",
] as const;

const originalEnv = new Map<string, string | undefined>();

beforeEach(() => {
  for (const key of ENV_KEYS) {
    originalEnv.set(key, process.env[key]);
    delete process.env[key];
  }

  process.env.PGHOST = "localhost";
  process.env.PGPORT = "5432";
  process.env.PGDATABASE = "mjuclaw";
  process.env.PGUSER = "mjuclaw_app";
  process.env.PGPASSWORD = "change-me";
  process.env.PGSCHEMA = "public_data";
  process.env.STORAGE_PROVIDER = "local";
  process.env.STORAGE_LOCAL_ROOT = "/tmp/mju-assets";
  process.env.OCR_LANGUAGES = "kor+eng";
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    const original = originalEnv.get(key);
    if (typeof original === "string") {
      process.env[key] = original;
    } else {
      delete process.env[key];
    }
  }
  originalEnv.clear();
});

describe("loadConfig", () => {
  it("defaults cafeteria OCR to PaddleOCR", () => {
    expect(loadConfig().cafeteriaOcrCommand).toBe(DEFAULT_CAFETERIA_OCR_COMMAND);
  });

  it("allows an explicit cafeteria OCR command override", () => {
    process.env.CAFETERIA_OCR_COMMAND = "custom-ocr {image}";

    expect(loadConfig().cafeteriaOcrCommand).toBe("custom-ocr {image}");
  });
});
