import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import dotenv from "dotenv";

const projectRoot = path.resolve(import.meta.dirname, "..");
const args = process.argv.slice(2);
const envFileArgIndex = args.findIndex((arg) => arg === "--env-file");
const envFile =
  envFileArgIndex >= 0 && args[envFileArgIndex + 1]
    ? path.resolve(projectRoot, args[envFileArgIndex + 1])
    : path.join(projectRoot, ".env.local");
const allowPlaceholders = args.includes("--allow-placeholders");
const requireDb = args.includes("--require-db");

if (fs.existsSync(envFile)) {
  dotenv.config({ path: envFile, override: true, quiet: true });
} else if (!allowPlaceholders) {
  console.error(`Missing env file: ${envFile}`);
  process.exitCode = 1;
}

if (envFile !== path.join(projectRoot, ".env")) {
  dotenv.config({ path: path.join(projectRoot, ".env"), quiet: true });
}

const ssoKeys = [
  "MJU_CLI_APP_DIR",
  "MJU_ID",
  "MJU_PASSWORD",
  "MJU_CLI_COMMAND",
  "MJU_COURSE_CATALOG_YEAR",
  "MJU_COURSE_CATALOG_TERM_CODE",
  "MJU_COURSE_CATALOG_TERM_LABEL",
];
const dbKeys = [
  "PGHOST",
  "PGPORT",
  "PGDATABASE",
  "PGUSER",
  "PGPASSWORD",
  "PGSCHEMA",
];
const requiredKeys = [...ssoKeys, ...(requireDb ? dbKeys : [])];

const placeholderPatterns = [
  /^YOUR_/u,
  /^change-?me$/iu,
  /^example$/iu,
];

const missing = [];
const placeholders = [];
const present = {};

for (const key of requiredKeys) {
  const value = process.env[key]?.trim();
  if (!value) {
    missing.push(key);
    continue;
  }

  present[key] = key === "MJU_PASSWORD" || key === "PGPASSWORD"
    ? "present-redacted"
    : "present";
  if (placeholderPatterns.some((pattern) => pattern.test(value))) {
    placeholders.push(key);
  }
}

function buildNextSteps() {
  const steps = [];
  const missingSso = missing.filter((key) => ssoKeys.includes(key));
  const missingDb = missing.filter((key) => dbKeys.includes(key));
  const placeholderSso = placeholders.filter((key) => ssoKeys.includes(key));
  const placeholderDb = placeholders.filter((key) => dbKeys.includes(key));

  if (missingSso.length > 0 || placeholderSso.length > 0) {
    steps.push("Copy .env.example to .env.local and fill the MJU_* values with the local MSI SSO account and mju CLI settings.");
  }
  if (missingDb.length > 0 || placeholderDb.length > 0) {
    steps.push("For collect/import mode, set PGHOST, PGPORT, PGDATABASE, PGUSER, PGPASSWORD, and PGSCHEMA in .env.local.");
    steps.push("If the local database is Docker-backed, start Docker Desktop/WSL before running migrations or collect/import commands.");
    steps.push("Until Postgres is available, use export:course-catalog:* to produce JSON and pass it to the reader with --catalog-json.");
  }
  return steps;
}

if (missing.length > 0 || (!allowPlaceholders && placeholders.length > 0)) {
  console.error(
    JSON.stringify(
      {
        ok: false,
        mode: requireDb ? "collect/import" : "export",
        envFile,
        missing,
        placeholders: allowPlaceholders ? [] : placeholders,
        nextSteps: buildNextSteps(),
      },
      null,
      2,
    ),
  );
  process.exitCode = 1;
} else {
  console.log(
    JSON.stringify(
      {
        ok: true,
        mode: requireDb ? "collect/import" : "export",
        envFile,
        present,
        placeholdersAllowed: allowPlaceholders,
      },
      null,
      2,
    ),
  );
}
