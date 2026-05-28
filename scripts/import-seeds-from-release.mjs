#!/usr/bin/env node
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import got from "got";
import JSZip from "jszip";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

dotenv.config({ path: path.join(projectRoot, ".env.local"), override: true, quiet: true });
dotenv.config({ path: path.join(projectRoot, ".env"), quiet: true });

const repo = envString("PUBLIC_DATA_SEED_RELEASE_REPO", "university-claw/mju-public-data-worker");
const tag = requiredEnv("PUBLIC_DATA_SEED_RELEASE_TAG");
const assetName = requiredEnv("PUBLIC_DATA_SEED_ASSET_NAME");
const workDir = path.resolve(envString("PUBLIC_DATA_SEED_WORK_DIR", path.join(projectRoot, ".tmp", "public-data-seeds")));
const extractDir = path.join(workDir, "extracted");
const zipPath = path.join(workDir, assetName);
const token = envString("PUBLIC_DATA_SEED_GITHUB_TOKEN", envString("GITHUB_TOKEN", ""));

await main();

async function main() {
  await fs.rm(extractDir, { recursive: true, force: true });
  await fs.mkdir(extractDir, { recursive: true });
  await fs.mkdir(workDir, { recursive: true });

  const release = await fetchRelease();
  const asset = release.assets.find((candidate) => candidate.name === assetName);
  if (!asset) {
    throw new Error(`release asset not found: ${repo}@${tag}/${assetName}`);
  }

  await downloadAsset(asset);
  await extractZip();

  const courseCatalogPath = await resolveCourseCatalogPath();
  const graduationRequirementsDir = await resolveGraduationRequirementsDir();

  if (courseCatalogPath) {
    await runWorker(["collect", "course-catalog", "--input", courseCatalogPath]);
  } else {
    console.error("seed import: no course catalog JSON found; skipping course catalog import");
  }

  if (graduationRequirementsDir) {
    await runWorker(["collect", "graduation-requirements", "--input-dir", graduationRequirementsDir]);
  } else {
    console.error("seed import: no graduation-requirements directory found; skipping graduation import");
  }

  console.log(JSON.stringify({
    ok: true,
    repo,
    tag,
    assetName,
    courseCatalogImported: Boolean(courseCatalogPath),
    graduationRequirementsImported: Boolean(graduationRequirementsDir),
  }, null, 2));
}

async function fetchRelease() {
  const url = `https://api.github.com/repos/${repo}/releases/tags/${encodeURIComponent(tag)}`;
  return got(url, {
    headers: githubHeaders("application/vnd.github+json"),
    responseType: "json",
    timeout: { request: 60_000 },
  }).json();
}

async function downloadAsset(asset) {
  const response = await got(asset.url, {
    headers: githubHeaders("application/octet-stream"),
    responseType: "buffer",
    timeout: { request: 120_000 },
  });
  await fs.writeFile(zipPath, response.body);
}

async function extractZip() {
  const zip = await JSZip.loadAsync(await fs.readFile(zipPath));
  for (const [name, entry] of Object.entries(zip.files)) {
    if (entry.dir) continue;
    const normalizedName = name.replace(/\\/g, "/");
    const outputPath = path.resolve(extractDir, normalizedName);
    if (!outputPath.startsWith(extractDir + path.sep)) {
      throw new Error(`unsafe zip entry path: ${name}`);
    }
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, await entry.async("nodebuffer"));
  }
}

async function resolveCourseCatalogPath() {
  const configured = envString("PUBLIC_DATA_SEED_COURSE_CATALOG_JSON", "");
  if (configured) return resolveSeedPath(configured);

  const files = await listFiles(extractDir);
  return files.find((file) => (
    /course[-_]?catalog.*\.json$/i.test(path.basename(file)) &&
    !file.split(path.sep).some((part) => part.toLowerCase() === "graduation-requirements")
  ));
}

async function resolveGraduationRequirementsDir() {
  const configured = envString("PUBLIC_DATA_SEED_GRADUATION_REQUIREMENTS_DIR", "");
  if (configured) return resolveSeedPath(configured);

  const candidate = path.join(extractDir, "graduation-requirements");
  if (await isDirectory(candidate)) return candidate;
  return undefined;
}

function resolveSeedPath(value) {
  return path.isAbsolute(value) ? value : path.join(extractDir, value);
}

async function runWorker(args) {
  const entry = await workerEntry();
  await runCommand(entry.file, [...entry.args, ...args]);
}

async function workerEntry() {
  const distMain = path.join(projectRoot, "dist", "main.js");
  try {
    await fs.access(distMain);
    return { file: process.execPath, args: [distMain] };
  } catch {
    return {
      file: process.platform === "win32" ? "npx.cmd" : "npx",
      args: ["tsx", "src/main.ts"],
    };
  }
}

function runCommand(file, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, {
      cwd: projectRoot,
      env: process.env,
      stdio: "inherit",
    });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${file} ${args.join(" ")} failed with ${signal ?? code}`));
    });
  });
}

async function listFiles(root) {
  const entries = await fs.readdir(root, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listFiles(fullPath));
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }
  return files.sort((a, b) => a.localeCompare(b));
}

async function isDirectory(candidate) {
  try {
    return (await fs.stat(candidate)).isDirectory();
  } catch {
    return false;
  }
}

function githubHeaders(accept) {
  return {
    accept,
    "user-agent": "mju-public-data-worker-seed-import",
    ...(token ? { authorization: `Bearer ${token}` } : {}),
  };
}

function requiredEnv(name) {
  const value = envString(name, "");
  if (!value) {
    throw new Error(`required environment variable is missing: ${name}`);
  }
  return value;
}

function envString(name, fallback) {
  return process.env[name]?.trim() || fallback;
}
