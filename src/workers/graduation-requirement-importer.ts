import fs from "node:fs/promises";
import path from "node:path";
import type { Pool } from "pg";
import {
  parseGraduationRequirementJson,
} from "../graduation-requirements/parser.js";
import type { GraduationRequirementImportResult } from "../graduation-requirements/types.js";
import { GraduationRequirementRepository } from "../db/graduation-requirement-repository.js";

export interface GraduationRequirementImportOptions {
  inputPath: string;
  department?: string;
  admissionYear?: number;
  sourceUrl?: string;
  sourceTitle?: string;
}

export interface GraduationRequirementDirectoryImportOptions {
  inputDir: string;
}

export interface GraduationRequirementDirectoryImportResult {
  imported: number;
  results: GraduationRequirementImportResult[];
}

export async function importGraduationRequirements(
  pool: Pool,
  schema: string,
  options: GraduationRequirementImportOptions,
): Promise<GraduationRequirementImportResult> {
  const rawInput = await fs.readFile(options.inputPath, "utf8");
  const parsed = parseGraduationRequirementJson(rawInput, {
    ...(options.department ? { defaultDepartment: options.department } : {}),
    ...(options.admissionYear ? { defaultAdmissionYear: options.admissionYear } : {}),
    ...(options.sourceUrl ? { defaultSourceUrl: options.sourceUrl } : {}),
    ...(options.sourceTitle ? { defaultSourceTitle: options.sourceTitle } : {}),
  });
  const repository = new GraduationRequirementRepository(pool, schema);
  return repository.replaceSource(parsed);
}

export async function importGraduationRequirementsDirectory(
  pool: Pool,
  schema: string,
  options: GraduationRequirementDirectoryImportOptions,
): Promise<GraduationRequirementDirectoryImportResult> {
  const entries = await fs.readdir(options.inputDir, { withFileTypes: true });
  const inputPaths = entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".json"))
    .map((entry) => path.join(options.inputDir, entry.name))
    .sort((a, b) => a.localeCompare(b));

  if (!inputPaths.length) {
    throw new Error(`graduation requirement input directory has no json files: ${options.inputDir}`);
  }

  const results: GraduationRequirementImportResult[] = [];
  for (const inputPath of inputPaths) {
    try {
      results.push(await importGraduationRequirements(pool, schema, { inputPath }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`graduation requirement import failed for ${inputPath}: ${message}`, {
        cause: error,
      });
    }
  }

  return {
    imported: results.length,
    results,
  };
}
