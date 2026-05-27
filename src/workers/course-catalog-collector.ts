import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Pool } from "pg";
import {
  parseCourseCatalogHtml,
  parseCourseCatalogJsonSnapshots,
} from "../course-catalogs/parser.js";
import { courseCatalogFromMjuCliDepartmentTimetable } from "../course-catalogs/mju-cli-department-timetable.js";
import { courseCatalogFromMjuCliTimetable } from "../course-catalogs/mju-cli-timetable.js";
import type { CourseCatalogCollectionResult } from "../course-catalogs/types.js";
import type { CourseCatalogSnapshotInput } from "../course-catalogs/types.js";
import { CourseCatalogRepository } from "../db/course-catalog-repository.js";

const execFileAsync = promisify(execFile);
const MJU_CLI_MAX_ATTEMPTS = 3;
const MJU_CLI_RETRY_DELAY_MS = 750;
const MJU_CLI_TRANSIENT_ERROR_PATTERN =
  /\b(?:ECONNRESET|ETIMEDOUT|EAI_AGAIN|ECONNREFUSED|ENOTFOUND|EPIPE)\b|socket hang up|network timeout/i;

export interface CourseCatalogCollectionOptions {
  inputPath: string;
  year?: number;
  termCode?: string;
  termLabel?: string;
}

export interface MjuCliTimetableCollectionOptions {
  command: string;
  appDir: string;
  userId: string;
  password: string;
  year: number;
  termCode: string;
  termLabel: string;
  category?: string;
  categoryLabel?: string;
  runner?: CommandRunner;
}

export interface MjuCliDepartmentTimetableCollectionOptions {
  command: string;
  appDir: string;
  userId: string;
  password: string;
  year: number;
  termCode: string;
  termLabel: string;
  departmentCode: string;
  campusDiv?: string;
  category?: string;
  categoryLabel?: string;
  runner?: CommandRunner;
}

export interface MjuCliDepartmentTimetableBatchCollectionOptions
  extends Omit<MjuCliDepartmentTimetableCollectionOptions, "departmentCode"> {
  departmentCodes: string[];
  seedDepartmentCode?: string;
}

interface CommandResult {
  stdout: string;
  stderr: string;
}

interface MjuCliCommandContext {
  file: string;
  baseArgs: string[];
  runner: CommandRunner;
}

type CommandRunner = (
  file: string,
  args: string[],
  options: { timeout: number; maxBuffer: number },
) => Promise<CommandResult>;

export async function collectCourseCatalog(
  pool: Pool,
  schema: string,
  options: CourseCatalogCollectionOptions,
): Promise<CourseCatalogCollectionResult | CourseCatalogCollectionResult[]> {
  const rawInput = await fs.readFile(options.inputPath, "utf8");
  const extension = path.extname(options.inputPath).toLowerCase();
  const parseOptions = {
    ...(options.year ? { defaultYear: options.year } : {}),
    ...(options.termCode ? { defaultTermCode: options.termCode } : {}),
    ...(options.termLabel ? { defaultTermLabel: options.termLabel } : {}),
  };
  const parsed = extension === ".html" || extension === ".htm"
    ? parseCourseCatalogHtml(rawInput, {
        ...parseOptions,
        sourceKind: "html_import",
      })
    : parseCourseCatalogJsonSnapshots(rawInput, {
        ...parseOptions,
        sourceKind: options.inputPath.toLowerCase().includes("fixture")
          ? "fixture_import"
          : "json_import",
      });

  const repository = new CourseCatalogRepository(pool, schema);
  const snapshots = Array.isArray(parsed) ? parsed : [parsed];
  const results: CourseCatalogCollectionResult[] = [];
  for (const snapshot of snapshots) {
    results.push(await repository.replaceSnapshot(snapshot));
  }
  return results.length === 1 ? results[0]! : results;
}

export async function collectCourseCatalogFromMjuCliTimetable(
  pool: Pool,
  schema: string,
  options: MjuCliTimetableCollectionOptions,
): Promise<CourseCatalogCollectionResult> {
  const parsed = await exportCourseCatalogFromMjuCliTimetable(options);

  const repository = new CourseCatalogRepository(pool, schema);
  return repository.replaceSnapshot(parsed);
}

export async function collectCourseCatalogFromMjuCliDepartmentTimetable(
  pool: Pool,
  schema: string,
  options: MjuCliDepartmentTimetableCollectionOptions,
): Promise<CourseCatalogCollectionResult> {
  const parsed = await exportCourseCatalogFromMjuCliDepartmentTimetable(options);

  const repository = new CourseCatalogRepository(pool, schema);
  return repository.replaceSnapshot(parsed);
}

export async function collectCourseCatalogFromMjuCliDepartmentTimetables(
  pool: Pool,
  schema: string,
  options: MjuCliDepartmentTimetableBatchCollectionOptions,
): Promise<CourseCatalogCollectionResult[]> {
  const snapshots = await exportCourseCatalogsFromMjuCliDepartmentTimetables(options);
  const repository = new CourseCatalogRepository(pool, schema);
  const results: CourseCatalogCollectionResult[] = [];
  for (const snapshot of snapshots) {
    results.push(await repository.replaceSnapshot(snapshot));
  }
  return results;
}

export async function exportCourseCatalogFromMjuCliTimetable(
  options: MjuCliTimetableCollectionOptions,
): Promise<CourseCatalogSnapshotInput> {
  const timetable = await fetchMjuCliTimetable(options);
  return courseCatalogFromMjuCliTimetable(timetable, {
    year: options.year,
    termCode: options.termCode,
    termLabel: options.termLabel,
    ...(options.category ? { category: options.category } : {}),
    ...(options.categoryLabel ? { categoryLabel: options.categoryLabel } : {}),
  });
}

export async function exportCourseCatalogFromMjuCliDepartmentTimetable(
  options: MjuCliDepartmentTimetableCollectionOptions,
): Promise<CourseCatalogSnapshotInput> {
  const context = createMjuCliCommandContext(options);
  await loginMjuCli(context, options);
  const timetable = await fetchMjuCliDepartmentTimetableWithContext(
    context,
    options,
  );
  return courseCatalogFromMjuCliDepartmentTimetable(timetable, {
    year: options.year,
    termCode: options.termCode,
    termLabel: options.termLabel,
    ...(options.category ? { category: options.category } : {}),
    ...(options.categoryLabel ? { categoryLabel: options.categoryLabel } : {}),
  });
}

export async function exportCourseCatalogsFromMjuCliDepartmentTimetables(
  options: MjuCliDepartmentTimetableBatchCollectionOptions,
): Promise<CourseCatalogSnapshotInput[]> {
  const departmentCodes = normalizeDepartmentCodes(options.departmentCodes);
  if (departmentCodes.length === 0) {
    throw new Error("at least one MSI department code is required");
  }

  if (departmentCodes.includes("all")) {
    return exportAllCourseCatalogsFromMjuCliDepartmentTimetables(options);
  }

  return exportKnownCourseCatalogsFromMjuCliDepartmentTimetables(
    options,
    departmentCodes,
  );
}

async function exportAllCourseCatalogsFromMjuCliDepartmentTimetables(
  options: MjuCliDepartmentTimetableBatchCollectionOptions,
): Promise<CourseCatalogSnapshotInput[]> {
  const context = createMjuCliCommandContext(options);
  await loginMjuCli(context, options);
  const explicitCodes = normalizeDepartmentCodes(
    options.departmentCodes.filter((code) => code.trim().toLowerCase() !== "all"),
  );
  const seedDepartmentCode =
    options.seedDepartmentCode?.trim() || explicitCodes[0] || "10000";
  const seedSnapshot =
    await exportCourseCatalogFromMjuCliDepartmentTimetableWithContext(context, {
      ...options,
      departmentCode: seedDepartmentCode,
    });
  const discoveredCodes = departmentCodesFromSnapshot(seedSnapshot);
  const departmentCodes = normalizeDepartmentCodes([
    ...discoveredCodes,
    ...explicitCodes,
    seedDepartmentCode,
  ]);
  const snapshots = new Map<string, CourseCatalogSnapshotInput>();
  snapshots.set(seedDepartmentCode, seedSnapshot);

  for (const departmentCode of departmentCodes) {
    if (snapshots.has(departmentCode)) continue;
    snapshots.set(
      departmentCode,
      await exportCourseCatalogFromMjuCliDepartmentTimetableWithContext(context, {
        ...options,
        departmentCode,
      }),
    );
  }

  return [...snapshots.values()];
}

async function exportKnownCourseCatalogsFromMjuCliDepartmentTimetables(
  options: MjuCliDepartmentTimetableBatchCollectionOptions,
  departmentCodes: string[],
): Promise<CourseCatalogSnapshotInput[]> {
  const context = createMjuCliCommandContext(options);
  await loginMjuCli(context, options);

  const snapshots: CourseCatalogSnapshotInput[] = [];
  for (const departmentCode of departmentCodes) {
    snapshots.push(
      await exportCourseCatalogFromMjuCliDepartmentTimetableWithContext(context, {
        ...options,
        departmentCode,
      }),
    );
  }
  return snapshots;
}

async function exportCourseCatalogFromMjuCliDepartmentTimetableWithContext(
  context: MjuCliCommandContext,
  options: MjuCliDepartmentTimetableCollectionOptions,
): Promise<CourseCatalogSnapshotInput> {
  const timetable = await fetchMjuCliDepartmentTimetableWithContext(
    context,
    options,
  );
  return courseCatalogFromMjuCliDepartmentTimetable(timetable, {
    year: options.year,
    termCode: options.termCode,
    termLabel: options.termLabel,
    ...(options.category ? { category: options.category } : {}),
    ...(options.categoryLabel ? { categoryLabel: options.categoryLabel } : {}),
  });
}

async function fetchMjuCliTimetable(
  options: MjuCliTimetableCollectionOptions,
): Promise<unknown> {
  const context = createMjuCliCommandContext(options);
  await loginMjuCli(context, options);
  return runMjuCliJson(context.runner, context.file, [
    ...context.baseArgs,
    "msi",
    "timetable",
    "--year",
    String(options.year),
    "--term-code",
    options.termCode,
  ], options);
}

async function fetchMjuCliDepartmentTimetable(
  options: MjuCliDepartmentTimetableCollectionOptions,
): Promise<unknown> {
  const context = createMjuCliCommandContext(options);
  await loginMjuCli(context, options);
  return fetchMjuCliDepartmentTimetableWithContext(context, options);
}

function createMjuCliCommandContext(
  options: Pick<MjuCliTimetableCollectionOptions, "appDir" | "command" | "runner">,
): MjuCliCommandContext {
  const command = parseCommand(options.command);
  return {
    file: command.file,
    runner: options.runner ?? defaultCommandRunner,
    baseArgs: [
      ...command.args,
      "--app-dir",
      options.appDir,
      "--format",
      "json",
    ],
  };
}

async function loginMjuCli(
  context: MjuCliCommandContext,
  options: Pick<MjuCliTimetableCollectionOptions, "password" | "userId">,
): Promise<void> {
  await runMjuCliJson(context.runner, context.file, [
    ...context.baseArgs,
    "auth",
    "login",
    "--id",
    options.userId,
    "--password",
    options.password,
  ], options);
}

async function fetchMjuCliDepartmentTimetableWithContext(
  context: MjuCliCommandContext,
  options: MjuCliDepartmentTimetableCollectionOptions,
): Promise<unknown> {
  return runMjuCliJson(context.runner, context.file, [
    ...context.baseArgs,
    "msi",
    "department-timetable",
    "--year",
    String(options.year),
    "--term-code",
    options.termCode,
    "--dept-code",
    options.departmentCode,
    ...(options.campusDiv !== undefined
      ? ["--campus-div", options.campusDiv]
      : []),
  ], options);
}

async function runMjuCliJson(
  runner: CommandRunner,
  file: string,
  args: string[],
  options: Pick<MjuCliTimetableCollectionOptions, "password" | "userId">,
): Promise<unknown> {
  let result: CommandResult | undefined;
  for (let attempt = 1; attempt <= MJU_CLI_MAX_ATTEMPTS; attempt += 1) {
    try {
      result = await runner(file, args, {
        timeout: 120_000,
        maxBuffer: 10 * 1024 * 1024,
      });
      break;
    } catch (error) {
      const message = redactSensitive(
        error instanceof Error ? error.message : String(error),
        options,
      );
      if (attempt < MJU_CLI_MAX_ATTEMPTS && isTransientMjuCliError(message)) {
        await delay(MJU_CLI_RETRY_DELAY_MS);
        continue;
      }
      const attempts = attempt > 1 ? ` after ${attempt} attempts` : "";
      throw new Error(`mju CLI command failed${attempts}: ${message}`);
    }
  }

  if (!result) {
    throw new Error("mju CLI command failed without a result");
  }

  const stdout = result.stdout.trim();
  if (!stdout) {
    throw new Error("mju CLI returned empty stdout");
  }

  try {
    return JSON.parse(stdout);
  } catch (error) {
    const stderr = redactSensitive(result.stderr, options);
    const output = redactSensitive(stdout.slice(0, 1000), options);
    throw new Error(
      `mju CLI did not return JSON: ${error instanceof Error ? error.message : String(error)}; stdout=${output}; stderr=${stderr}`,
    );
  }
}

async function defaultCommandRunner(
  file: string,
  args: string[],
  options: { timeout: number; maxBuffer: number },
): Promise<CommandResult> {
  const result = await execFileAsync(file, args, {
    timeout: options.timeout,
    maxBuffer: options.maxBuffer,
    windowsHide: true,
  });
  return {
    stdout: String(result.stdout ?? ""),
    stderr: String(result.stderr ?? ""),
  };
}

function isTransientMjuCliError(message: string): boolean {
  return MJU_CLI_TRANSIENT_ERROR_PATTERN.test(message);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeDepartmentCodes(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))]
    .map((value) => value.toLowerCase() === "all" ? "all" : value);
}

function departmentCodesFromSnapshot(snapshot: CourseCatalogSnapshotInput): string[] {
  const departmentOptions = snapshot.metadata.departmentOptions;
  if (!Array.isArray(departmentOptions)) return [];
  return departmentOptions
    .map((option) => isRecord(option) ? normalizeString(option.code) : null)
    .filter((code): code is string => Boolean(code));
}

function normalizeString(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || null;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseCommand(command: string): { file: string; args: string[] } {
  const parts = splitCommand(command.trim());
  if (parts.length === 0) {
    throw new Error("MJU_CLI_COMMAND is required");
  }

  const [file, ...args] = parts;
  return { file: file!, args };
}

function splitCommand(command: string): string[] {
  const parts: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;

  for (let i = 0; i < command.length; i += 1) {
    const char = command[i]!;
    if (quote) {
      if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }

    if (/\s/u.test(char)) {
      if (current) {
        parts.push(current);
        current = "";
      }
      continue;
    }

    current += char;
  }

  if (quote) {
    throw new Error("MJU_CLI_COMMAND contains an unclosed quote");
  }
  if (current) {
    parts.push(current);
  }

  return parts;
}

function redactSensitive(
  value: string,
  options: Pick<MjuCliTimetableCollectionOptions, "password" | "userId">,
): string {
  return [options.password, options.userId].reduce((text, secret) => {
    if (!secret) {
      return text;
    }
    return text.split(secret).join("[redacted]");
  }, value);
}
