import fs from "node:fs/promises";
import path from "node:path";
import { loadConfig } from "./config/env.js";
import { CAFETERIA_INSTAGRAM_SOURCES } from "./cafeterias/sources.js";
import { checkCafeteriaInstagramSourceReachability } from "./cafeterias/instagram-scraper.js";
import { createPool } from "./db/client.js";
import { runMigrations } from "./db/migrator.js";
import { checkReachability } from "./http/client.js";
import { NOTICE_SOURCES } from "./notices/sources.js";
import { runNoticeNormalizationEvaluation } from "./notices/normalization-evaluator.js";
import { collectCafeteriaInstagramPosts } from "./workers/cafeteria-instagram-collector.js";
import { collectCafeteriaOfficialPages } from "./workers/cafeteria-official-page-collector.js";
import {
  collectCourseCatalog,
  collectCourseCatalogFromMjuCliDepartmentTimetable,
  collectCourseCatalogFromMjuCliDepartmentTimetables,
  collectCourseCatalogFromMjuCliTimetable,
  exportCourseCatalogFromMjuCliDepartmentTimetable,
  exportCourseCatalogsFromMjuCliDepartmentTimetables,
  exportCourseCatalogFromMjuCliTimetable,
} from "./workers/course-catalog-collector.js";
import {
  importGraduationRequirements,
  importGraduationRequirementsDirectory,
} from "./workers/graduation-requirement-importer.js";
import { collectNotices } from "./workers/notice-collector.js";
import { runSchedulerTick } from "./workers/scheduler-tick.js";

function parseLimit(args: string[], defaultLimit: number): number {
  const index = args.findIndex((arg) => arg === "--limit");
  if (index !== -1) {
    const raw = args[index + 1];
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      throw new Error(`--limit must be a positive number, received: ${raw}`);
    }

    return parsed;
  }

  const equalStyle = args.find((arg) => arg.startsWith("--limit="));
  if (equalStyle) {
    const parsed = Number(equalStyle.split("=")[1]);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      throw new Error(`--limit must be a positive number, received: ${equalStyle}`);
    }

    return parsed;
  }

  // Windows PowerShell + npm 조합에서는 `-- --limit 3`가 드물게 마지막 숫자만
  // 남는 경우가 있어, 맨 끝의 단일 숫자도 limit로 받아들인다.
  const trailingValue = args.at(-1);
  const trailingParsed = Number(trailingValue);
  if (
    trailingValue &&
    trailingValue !== "notices" &&
    Number.isFinite(trailingParsed) &&
    trailingParsed > 0
  ) {
    return trailingParsed;
  }

  return defaultLimit;
}

function hasFlag(args: string[], flag: string): boolean {
  return args.includes(flag);
}

function parseStringOption(args: string[], flag: string): string | undefined {
  const index = args.findIndex((arg) => arg === flag);
  if (index !== -1) {
    return args[index + 1];
  }

  const equalStyle = args.find((arg) => arg.startsWith(`${flag}=`));
  if (equalStyle) {
    return equalStyle.split("=")[1];
  }

  return undefined;
}

function parseListOption(args: string[], flag: string): string[] | undefined {
  const raw = parseStringOption(args, flag);
  return raw === undefined ? undefined : parseList(raw);
}

function parseList(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function parseDepartmentCodes(args: string[]): string[] {
  const explicitMany = parseListOption(args, "--dept-codes");
  if (explicitMany !== undefined) return explicitMany;
  const envMany = parseList(process.env.MJU_COURSE_CATALOG_DEPT_CODES);
  if (envMany.length > 0) return envMany;
  const explicitOne = parseStringOption(args, "--dept-code");
  if (explicitOne !== undefined) return parseList(explicitOne);
  return parseList(process.env.MJU_COURSE_CATALOG_DEPT_CODE);
}

function isDepartmentBatch(departmentCodes: string[]): boolean {
  return departmentCodes.length > 1 ||
    departmentCodes.some((code) => code.toLowerCase() === "all");
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`required environment variable is missing: ${name}`);
  }
  return value;
}

function throwMissingString(name: string): never {
  throw new Error(`required option or environment variable is missing: ${name}`);
}

function throwMissingPositiveInteger(name: string): never {
  throw new Error(`required positive integer option or environment variable is missing: ${name}`);
}

function parsePositiveIntegerOption(name: string, raw: string): number {
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer, received: ${raw}`);
  }

  return parsed;
}

function parseDatasetOption(
  args: string[],
): "tuning" | "holdout" | "validation_v2" | "regression" {
  const raw = parseStringOption(args, "--dataset") ?? "tuning";
  if (
    raw !== "tuning" &&
    raw !== "holdout" &&
    raw !== "validation_v2" &&
    raw !== "regression"
  ) {
    throw new Error(
      `--dataset must be one of: tuning, holdout, validation_v2, regression (received: ${raw})`,
    );
  }

  return raw;
}

function parseModelsOption(args: string[]): string[] {
  const raw =
    parseStringOption(args, "--models") ?? "gpt-5.4-mini,gpt-5.4-nano";
  const models = raw
    .split(/[,\s]+/u)
    .map((model) => model.trim())
    .filter(Boolean);

  if (models.length === 0) {
    throw new Error("--models must contain at least one model name");
  }

  return models;
}

async function runDoctor(): Promise<void> {
  const config = loadConfig();
  const pool = createPool(config);

  try {
    const databaseCheck = await pool.query<{
      current_database: string;
      current_schema: string;
      timezone: string;
    }>(`
      SELECT
        current_database(),
        current_schema(),
        current_setting('TimeZone') AS timezone
    `);

    console.log("database", databaseCheck.rows[0]);

    for (const source of NOTICE_SOURCES) {
      const result = await checkReachability(source.listUrl);
      console.log(source.id, result);
    }

    for (const source of CAFETERIA_INSTAGRAM_SOURCES) {
      const result = await checkCafeteriaInstagramSourceReachability(source);
      console.log(source.id, result);
    }
  } finally {
    await pool.end();
  }
}

async function runCollect(args: string[]): Promise<void> {
  const target = args[1];
  const config = loadConfig();
  const pool = createPool(config);

  try {
    await runMigrations(pool, config.pgSchema);

    if (target === "notices") {
      if (!config.storageLocalRoot) {
        throw new Error("collect notices requires STORAGE_LOCAL_ROOT");
      }

      const result = await collectNotices(pool, config.pgSchema, {
        limit: parseLimit(args, 30),
        triggerReason: "manual",
        storageLocalRoot: config.storageLocalRoot,
        ocrLanguages: config.ocrLanguages,
        noticeNormalizationEnabled: config.noticeNormalizationEnabled,
        noticeNormalizationModel: config.noticeNormalizationModel,
        noticeNormalizationMaxOutputTokens:
          config.noticeNormalizationMaxOutputTokens,
        ...(config.openAiApiKey
          ? { noticeNormalizationApiKey: config.openAiApiKey }
          : {}),
      });

      console.log(
        JSON.stringify(
          {
            scrapeRunId: result.scrapeRunId,
            totalScrapedCount: result.scrapedCount,
            totalProcessedCount: result.processedCount,
            totalInsertedCount: result.insertedCount,
            totalUpdatedCount: result.updatedCount,
            totalAttachmentExtractionSucceededCount:
              result.attachmentExtractionSucceededCount,
            totalAttachmentExtractionUnsupportedCount:
              result.attachmentExtractionUnsupportedCount,
            totalAttachmentExtractionFailedCount:
              result.attachmentExtractionFailedCount,
            totalNoticeImageOcrSucceededCount:
              result.noticeImageOcrSucceededCount,
            totalNoticeImageOcrUnsupportedCount:
              result.noticeImageOcrUnsupportedCount,
            totalNoticeImageOcrFailedCount:
              result.noticeImageOcrFailedCount,
            totalNoticeNormalizationSucceededCount:
              result.noticeNormalizationSucceededCount,
            totalNoticeNormalizationFailedCount:
              result.noticeNormalizationFailedCount,
            failedSourceCount: result.failedSourceCount,
            failedSources: result.failedSources,
            sources: result.sources,
          },
          null,
          2,
        ),
      );
      return;
    }

    if (target === "cafeterias") {
      if (!config.storageLocalRoot) {
        throw new Error("collect cafeterias requires STORAGE_LOCAL_ROOT");
      }

      const result = await collectCafeteriaInstagramPosts(pool, config.pgSchema, {
        limit: parseLimit(args, 6),
        triggerReason: "manual",
        storageLocalRoot: config.storageLocalRoot,
        ocrLanguages: config.ocrLanguages,
        cafeteriaOcrCommand: config.cafeteriaOcrCommand,
      });

      console.log(
        JSON.stringify(
          {
            scrapeRunId: result.scrapeRunId,
            totalScrapedCount: result.scrapedCount,
            totalProcessedCount: result.processedCount,
            totalInsertedCount: result.insertedCount,
            totalUpdatedCount: result.updatedCount,
            sources: result.sources,
          },
          null,
          2,
        ),
      );
      return;
    }

    if (target === "cafeteria-official-pages") {
      const result = await collectCafeteriaOfficialPages(pool, config.pgSchema, {
        triggerReason: "manual",
        includePreviousWeek: hasFlag(args, "--include-previous-week"),
      });

      console.log(
        JSON.stringify(
          {
            scrapeRunId: result.scrapeRunId,
            fetchedPageCount: result.fetchedPageCount,
            processedPageCount: result.processedPageCount,
            storedEntryCount: result.storedEntryCount,
            sources: result.sources,
          },
          null,
          2,
        ),
      );
      return;
    }

    if (target === "course-catalog") {
      const rawYear = parseStringOption(args, "--year");
      const year = rawYear
        ? parsePositiveIntegerOption("--year", rawYear)
        : process.env.MJU_COURSE_CATALOG_YEAR
          ? parsePositiveIntegerOption(
              "MJU_COURSE_CATALOG_YEAR",
              process.env.MJU_COURSE_CATALOG_YEAR,
            )
          : undefined;
      const termCode =
        parseStringOption(args, "--term-code") ??
        process.env.MJU_COURSE_CATALOG_TERM_CODE;
      const termLabel =
        parseStringOption(args, "--term-label") ??
        process.env.MJU_COURSE_CATALOG_TERM_LABEL;
      const fromMjuCliTimetable = hasFlag(args, "--from-mju-cli-timetable");
      const fromMjuCliDepartmentTimetable = hasFlag(
        args,
        "--from-mju-cli-department-timetable",
      );
      if (fromMjuCliTimetable && fromMjuCliDepartmentTimetable) {
        throw new Error(
          "collect course-catalog accepts only one MSI source flag",
        );
      }
      const explicitCategory = parseStringOption(args, "--category");
      const explicitCategoryLabel = parseStringOption(args, "--category-label");
      const campusDiv =
        parseStringOption(args, "--campus-div") ??
        process.env.MJU_COURSE_CATALOG_CAMPUS_DIV;
      const mjuCliCommand =
        parseStringOption(args, "--mju-cli-command") ??
        process.env.MJU_CLI_COMMAND;
      const mjuCliAppDir =
        parseStringOption(args, "--mju-cli-app-dir") ??
        process.env.MJU_CLI_APP_DIR;
      const inputPath =
        parseStringOption(args, "--input") ??
        process.env.MJU_COURSE_CATALOG_INPUT;
      const departmentCodes = parseDepartmentCodes(args);
      const seedDepartmentCode =
        parseStringOption(args, "--seed-dept-code") ??
        process.env.MJU_COURSE_CATALOG_SEED_DEPT_CODE;
      const departmentBatch = isDepartmentBatch(departmentCodes);
      const category = explicitCategory ??
        (!departmentBatch ? process.env.MJU_COURSE_CATALOG_CATEGORY : undefined);
      const categoryLabel = explicitCategoryLabel ??
        (!departmentBatch ? process.env.MJU_COURSE_CATALOG_CATEGORY_LABEL : undefined);
      const result = fromMjuCliDepartmentTimetable && departmentBatch
        ? await collectCourseCatalogFromMjuCliDepartmentTimetables(
            pool,
            config.pgSchema,
            {
              command: mjuCliCommand ?? throwMissingString("MJU_CLI_COMMAND"),
              appDir: mjuCliAppDir ?? throwMissingString("MJU_CLI_APP_DIR"),
              userId: requireEnv("MJU_ID"),
              password: requireEnv("MJU_PASSWORD"),
              year: year ?? throwMissingPositiveInteger("MJU_COURSE_CATALOG_YEAR"),
              termCode: termCode ?? throwMissingString("MJU_COURSE_CATALOG_TERM_CODE"),
              termLabel: termLabel ?? throwMissingString("MJU_COURSE_CATALOG_TERM_LABEL"),
              departmentCodes,
              ...(seedDepartmentCode ? { seedDepartmentCode } : {}),
              ...(campusDiv !== undefined ? { campusDiv } : {}),
              ...(category ? { category } : {}),
              ...(categoryLabel ? { categoryLabel } : {}),
            },
          )
        : fromMjuCliDepartmentTimetable
        ? await collectCourseCatalogFromMjuCliDepartmentTimetable(
            pool,
            config.pgSchema,
            {
              command: mjuCliCommand ?? throwMissingString("MJU_CLI_COMMAND"),
              appDir: mjuCliAppDir ?? throwMissingString("MJU_CLI_APP_DIR"),
              userId: requireEnv("MJU_ID"),
              password: requireEnv("MJU_PASSWORD"),
              year: year ?? throwMissingPositiveInteger("MJU_COURSE_CATALOG_YEAR"),
              termCode: termCode ?? throwMissingString("MJU_COURSE_CATALOG_TERM_CODE"),
              termLabel: termLabel ?? throwMissingString("MJU_COURSE_CATALOG_TERM_LABEL"),
              departmentCode: departmentCodes[0] ?? throwMissingString("MJU_COURSE_CATALOG_DEPT_CODE"),
              ...(campusDiv !== undefined ? { campusDiv } : {}),
              ...(category ? { category } : {}),
              ...(categoryLabel ? { categoryLabel } : {}),
            },
          )
        : fromMjuCliTimetable
          ? await collectCourseCatalogFromMjuCliTimetable(
            pool,
            config.pgSchema,
            {
              command: mjuCliCommand ?? throwMissingString("MJU_CLI_COMMAND"),
              appDir: mjuCliAppDir ?? throwMissingString("MJU_CLI_APP_DIR"),
              userId: requireEnv("MJU_ID"),
              password: requireEnv("MJU_PASSWORD"),
              year: year ?? throwMissingPositiveInteger("MJU_COURSE_CATALOG_YEAR"),
              termCode: termCode ?? throwMissingString("MJU_COURSE_CATALOG_TERM_CODE"),
              termLabel: termLabel ?? throwMissingString("MJU_COURSE_CATALOG_TERM_LABEL"),
              ...(category ? { category } : {}),
              ...(categoryLabel ? { categoryLabel } : {}),
            },
          )
          : await collectCourseCatalog(pool, config.pgSchema, {
              inputPath: inputPath ?? throwMissingString("--input"),
              ...(year ? { year } : {}),
              ...(termCode ? { termCode } : {}),
              ...(termLabel ? { termLabel } : {}),
            });

      console.log(JSON.stringify(result, null, 2));
      return;
    }

    if (target === "graduation-requirements") {
      const inputPath = parseStringOption(args, "--input");
      const inputDir = parseStringOption(args, "--input-dir");
      if (inputPath && inputDir) {
        throw new Error("collect graduation-requirements accepts only one of --input or --input-dir");
      }
      if (!inputPath && !inputDir) {
        throw new Error("collect graduation-requirements requires --input <json> or --input-dir <dir>");
      }

      const department = parseStringOption(args, "--department");
      const rawAdmissionYear = parseStringOption(args, "--admission-year");
      const sourceUrl = parseStringOption(args, "--source-url");
      const sourceTitle = parseStringOption(args, "--source-title");
      const result = inputDir
        ? await importGraduationRequirementsDirectory(pool, config.pgSchema, { inputDir })
        : await importGraduationRequirements(pool, config.pgSchema, {
            inputPath: inputPath!,
            ...(department ? { department } : {}),
            ...(rawAdmissionYear ? { admissionYear: parsePositiveIntegerOption("--admission-year", rawAdmissionYear) } : {}),
            ...(sourceUrl ? { sourceUrl } : {}),
            ...(sourceTitle ? { sourceTitle } : {}),
          });

      console.log(JSON.stringify(result, null, 2));
      return;
    }

    throw new Error(`unsupported collect target: ${target ?? "(missing)"}`);
  } finally {
    await pool.end();
  }
}

async function writeJsonFile(outputPath: string, data: unknown): Promise<void> {
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

async function runExport(args: string[]): Promise<void> {
  const target = args[1];
  if (target !== "course-catalog") {
    throw new Error(`unsupported export target: ${target ?? "(missing)"}`);
  }

  const rawYear = parseStringOption(args, "--year");
  const year = rawYear
    ? parsePositiveIntegerOption("--year", rawYear)
    : process.env.MJU_COURSE_CATALOG_YEAR
      ? parsePositiveIntegerOption(
          "MJU_COURSE_CATALOG_YEAR",
          process.env.MJU_COURSE_CATALOG_YEAR,
        )
      : undefined;
  const termCode =
    parseStringOption(args, "--term-code") ??
    process.env.MJU_COURSE_CATALOG_TERM_CODE;
  const termLabel =
    parseStringOption(args, "--term-label") ??
    process.env.MJU_COURSE_CATALOG_TERM_LABEL;
  const outputPath =
    parseStringOption(args, "--output") ??
    process.env.MJU_COURSE_CATALOG_OUTPUT;
  const explicitCategory = parseStringOption(args, "--category");
  const explicitCategoryLabel = parseStringOption(args, "--category-label");
  const campusDiv =
    parseStringOption(args, "--campus-div") ??
    process.env.MJU_COURSE_CATALOG_CAMPUS_DIV;
  const mjuCliCommand =
    parseStringOption(args, "--mju-cli-command") ??
    process.env.MJU_CLI_COMMAND;
  const mjuCliAppDir =
    parseStringOption(args, "--mju-cli-app-dir") ??
    process.env.MJU_CLI_APP_DIR;
  const fromMjuCliTimetable = hasFlag(args, "--from-mju-cli-timetable");
  const fromMjuCliDepartmentTimetable = hasFlag(
    args,
    "--from-mju-cli-department-timetable",
  );
  if (fromMjuCliTimetable && fromMjuCliDepartmentTimetable) {
    throw new Error(
      "export course-catalog accepts only one MSI source flag",
    );
  }
  if (!fromMjuCliTimetable && !fromMjuCliDepartmentTimetable) {
    throw new Error(
      "export course-catalog requires --from-mju-cli-timetable or --from-mju-cli-department-timetable",
    );
  }

  const departmentCodes = parseDepartmentCodes(args);
  const seedDepartmentCode =
    parseStringOption(args, "--seed-dept-code") ??
    process.env.MJU_COURSE_CATALOG_SEED_DEPT_CODE;
  const departmentBatch = isDepartmentBatch(departmentCodes);
  const category = explicitCategory ??
    (!departmentBatch ? process.env.MJU_COURSE_CATALOG_CATEGORY : undefined);
  const categoryLabel = explicitCategoryLabel ??
    (!departmentBatch ? process.env.MJU_COURSE_CATALOG_CATEGORY_LABEL : undefined);
  const snapshots = fromMjuCliDepartmentTimetable && departmentBatch
    ? await exportCourseCatalogsFromMjuCliDepartmentTimetables({
      command: mjuCliCommand ?? throwMissingString("MJU_CLI_COMMAND"),
      appDir: mjuCliAppDir ?? throwMissingString("MJU_CLI_APP_DIR"),
      userId: requireEnv("MJU_ID"),
      password: requireEnv("MJU_PASSWORD"),
      year: year ?? throwMissingPositiveInteger("MJU_COURSE_CATALOG_YEAR"),
      termCode: termCode ?? throwMissingString("MJU_COURSE_CATALOG_TERM_CODE"),
      termLabel: termLabel ?? throwMissingString("MJU_COURSE_CATALOG_TERM_LABEL"),
      departmentCodes,
      ...(seedDepartmentCode ? { seedDepartmentCode } : {}),
      ...(campusDiv !== undefined ? { campusDiv } : {}),
      ...(category ? { category } : {}),
      ...(categoryLabel ? { categoryLabel } : {}),
    })
    : [
      fromMjuCliDepartmentTimetable
        ? await exportCourseCatalogFromMjuCliDepartmentTimetable({
          command: mjuCliCommand ?? throwMissingString("MJU_CLI_COMMAND"),
          appDir: mjuCliAppDir ?? throwMissingString("MJU_CLI_APP_DIR"),
          userId: requireEnv("MJU_ID"),
          password: requireEnv("MJU_PASSWORD"),
          year: year ?? throwMissingPositiveInteger("MJU_COURSE_CATALOG_YEAR"),
          termCode: termCode ?? throwMissingString("MJU_COURSE_CATALOG_TERM_CODE"),
          termLabel: termLabel ?? throwMissingString("MJU_COURSE_CATALOG_TERM_LABEL"),
          departmentCode: departmentCodes[0] ?? throwMissingString("MJU_COURSE_CATALOG_DEPT_CODE"),
          ...(campusDiv !== undefined ? { campusDiv } : {}),
          ...(category ? { category } : {}),
          ...(categoryLabel ? { categoryLabel } : {}),
        })
        : await exportCourseCatalogFromMjuCliTimetable({
          command: mjuCliCommand ?? throwMissingString("MJU_CLI_COMMAND"),
          appDir: mjuCliAppDir ?? throwMissingString("MJU_CLI_APP_DIR"),
          userId: requireEnv("MJU_ID"),
          password: requireEnv("MJU_PASSWORD"),
          year: year ?? throwMissingPositiveInteger("MJU_COURSE_CATALOG_YEAR"),
          termCode: termCode ?? throwMissingString("MJU_COURSE_CATALOG_TERM_CODE"),
          termLabel: termLabel ?? throwMissingString("MJU_COURSE_CATALOG_TERM_LABEL"),
          ...(category ? { category } : {}),
          ...(categoryLabel ? { categoryLabel } : {}),
        }),
    ];

  if (outputPath) {
    await writeJsonFile(outputPath, snapshots.length === 1 ? snapshots[0] : snapshots);
  }

  console.log(
    JSON.stringify(
      {
        year: snapshots[0]?.year ?? null,
        termCode: snapshots[0]?.termCode ?? null,
        sourceKind: snapshots[0]?.sourceKind ?? null,
        snapshotCount: snapshots.length,
        entryCount: snapshots.reduce((sum, snapshot) => sum + snapshot.entries.length, 0),
        outputPath: outputPath ?? null,
      },
      null,
      2,
    ),
  );
}

async function runSchedule(args: string[]): Promise<void> {
  const target = args[1];
  if (target !== "tick") {
    throw new Error(
      `unsupported schedule target: ${target ?? "(missing)"} (expected: tick)`,
    );
  }

  const config = loadConfig();
  const pool = createPool(config);
  const dryRun = hasFlag(args, "--dry-run");

  try {
    if (!dryRun) {
      await runMigrations(pool, config.pgSchema);
    }

    if (!config.storageLocalRoot) {
      throw new Error("schedule tick requires STORAGE_LOCAL_ROOT");
    }

    const result = await runSchedulerTick(pool, config.pgSchema, {
      storageLocalRoot: config.storageLocalRoot,
      ocrLanguages: config.ocrLanguages,
      cafeteriaOcrCommand: config.cafeteriaOcrCommand,
      noticeNormalizationEnabled: config.noticeNormalizationEnabled,
      noticeNormalizationModel: config.noticeNormalizationModel,
      noticeNormalizationMaxOutputTokens:
        config.noticeNormalizationMaxOutputTokens,
      dryRun,
      ...(config.openAiApiKey
        ? { noticeNormalizationApiKey: config.openAiApiKey }
        : {}),
    });

    console.log(JSON.stringify(result, null, 2));
  } finally {
    await pool.end();
  }
}

async function runEval(args: string[]): Promise<void> {
  const target = args[1];
  if (target !== "notice-normalization") {
    throw new Error(
      `unsupported eval target: ${target ?? "(missing)"} (expected: notice-normalization)`,
    );
  }

  const dataset = parseDatasetOption(args);
  const models = parseModelsOption(args);
  const sampleLimitRaw = parseStringOption(args, "--sample-limit");
  const sampleLimit = sampleLimitRaw
    ? parsePositiveIntegerOption("--sample-limit", sampleLimitRaw)
    : undefined;
  const outputRoot = parseStringOption(args, "--output-root");

  const result = await runNoticeNormalizationEvaluation({
    dataset,
    models,
    ...(sampleLimit ? { sampleLimit } : {}),
    ...(outputRoot ? { outputRoot } : {}),
  });

  console.log(
    JSON.stringify(
      {
        summaryPath: result.summaryPath,
        resultPaths: result.resultPaths,
        summary: result.summary,
      },
      null,
      2,
    ),
  );
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];

  switch (command) {
    case "migrate": {
      const config = loadConfig();
      const pool = createPool(config);

      try {
        await runMigrations(pool, config.pgSchema);
        console.log(`migrations applied for schema "${config.pgSchema}"`);
      } finally {
        await pool.end();
      }
      return;
    }
    case "doctor":
      await runDoctor();
      return;
    case "collect":
      await runCollect(args);
      return;
    case "export":
      await runExport(args);
      return;
    case "schedule":
      await runSchedule(args);
      return;
    case "eval":
      await runEval(args);
      return;
    default:
      throw new Error(
        `unsupported command: ${command ?? "(missing)"} (expected: migrate | doctor | collect notices | collect cafeterias | collect course-catalog | collect graduation-requirements | export course-catalog | schedule tick | eval notice-normalization)`,
      );
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});
