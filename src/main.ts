import { loadConfig } from "./config/env.js";
import { CAFETERIA_INSTAGRAM_SOURCES } from "./cafeterias/sources.js";
import { checkCafeteriaInstagramSourceReachability } from "./cafeterias/instagram-scraper.js";
import { createPool } from "./db/client.js";
import { runMigrations } from "./db/migrator.js";
import { checkReachability } from "./http/client.js";
import { NOTICE_SOURCES } from "./notices/sources.js";
import { collectCafeteriaInstagramPosts } from "./workers/cafeteria-instagram-collector.js";
import { collectNotices } from "./workers/notice-collector.js";

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

    throw new Error(`unsupported collect target: ${target ?? "(missing)"}`);
  } finally {
    await pool.end();
  }
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
    default:
      throw new Error(
        `unsupported command: ${command ?? "(missing)"} (expected: migrate | doctor | collect notices | collect cafeterias)`,
      );
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});
