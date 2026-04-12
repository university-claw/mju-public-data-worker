import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Pool, PoolClient } from "pg";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const migrationsDir = path.resolve(__dirname, "..", "..", "migrations");

function assertSafeSchemaName(schema: string): void {
  if (!/^[a-z_][a-z0-9_]*$/.test(schema)) {
    throw new Error(`unsafe schema name: ${schema}`);
  }
}

async function ensureMigrationTable(client: PoolClient, schema: string) {
  await client.query(`CREATE SCHEMA IF NOT EXISTS ${schema}`);
  await client.query(`
    CREATE TABLE IF NOT EXISTS ${schema}.schema_migrations (
      version text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
}

export async function runMigrations(pool: Pool, schema: string): Promise<void> {
  assertSafeSchemaName(schema);
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    // worker가 동시에 올라오더라도 마이그레이션은 한 세션만 실행되게 잠근다.
    // collect와 migrate를 병렬로 실행했을 때 중복 insert가 나는 경로를 막기 위함이다.
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [
      `migrations:${schema}`,
    ]);
    await ensureMigrationTable(client, schema);

    const appliedRows = await client.query<{ version: string }>(
      `SELECT version FROM ${schema}.schema_migrations`,
    );
    const appliedVersions = new Set(appliedRows.rows.map((row) => row.version));

    const files = (await fs.readdir(migrationsDir))
      .filter((file) => file.endsWith(".sql"))
      .sort();

    for (const file of files) {
      if (appliedVersions.has(file)) {
        continue;
      }

      const sql = await fs.readFile(path.join(migrationsDir, file), "utf8");
      await client.query(sql);
      await client.query(
        `INSERT INTO ${schema}.schema_migrations (version) VALUES ($1)`,
        [file],
      );
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
