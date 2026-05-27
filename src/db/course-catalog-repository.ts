import type { Pool, PoolClient } from "pg";
import type {
  CourseCatalogCollectionResult,
  CourseCatalogEntryInput,
  CourseCatalogSnapshotInput,
} from "../course-catalogs/types.js";
import { sanitizeMetadata } from "../course-catalogs/privacy.js";
import { sha256 } from "../shared/hash.js";

export class CourseCatalogRepository {
  constructor(
    private readonly pool: Pool,
    private readonly schema: string,
  ) {}

  async replaceSnapshot(
    input: CourseCatalogSnapshotInput,
  ): Promise<CourseCatalogCollectionResult> {
    const client = await this.pool.connect();

    try {
      await client.query("BEGIN");
      const snapshotId = await this.upsertSnapshotWithClient(client, input);

      await client.query(
        `
          DELETE FROM ${this.schema}.course_catalog_entries
          WHERE snapshot_id = $1
        `,
        [snapshotId],
      );

      for (const entry of input.entries) {
        await this.insertEntryWithClient(client, snapshotId, entry);
      }

      await client.query(
        `
          UPDATE ${this.schema}.course_catalog_snapshots
          SET
            entry_count = $2,
            updated_at = now()
          WHERE id = $1
        `,
        [snapshotId, input.entries.length],
      );

      await client.query("COMMIT");
      return {
        snapshotId,
        year: input.year,
        termCode: input.termCode,
        entryCount: input.entries.length,
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  private async upsertSnapshotWithClient(
    client: PoolClient,
    input: CourseCatalogSnapshotInput,
  ): Promise<number> {
    const result = await client.query<{ id: number }>(
      `
        INSERT INTO ${this.schema}.course_catalog_snapshots (
          year,
          term_code,
          term_label,
          source_kind,
          snapshot_key,
          metadata,
          content_hash,
          entry_count,
          collected_at,
          updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, now(), now())
        ON CONFLICT (year, term_code, snapshot_key) DO UPDATE
        SET
          term_label = EXCLUDED.term_label,
          source_kind = EXCLUDED.source_kind,
          snapshot_key = EXCLUDED.snapshot_key,
          metadata = EXCLUDED.metadata,
          content_hash = EXCLUDED.content_hash,
          entry_count = EXCLUDED.entry_count,
          collected_at = EXCLUDED.collected_at,
          updated_at = now()
        RETURNING id
      `,
      [
        input.year,
        input.termCode,
        input.termLabel,
        input.sourceKind,
        buildSnapshotKey(input),
        JSON.stringify(sanitizeMetadata(input.metadata)),
        buildContentHash(input.entries),
        input.entries.length,
      ],
    );

    return Number(result.rows[0]!.id);
  }

  private async insertEntryWithClient(
    client: PoolClient,
    snapshotId: number,
    entry: CourseCatalogEntryInput,
  ): Promise<void> {
    await client.query(
      `
        INSERT INTO ${this.schema}.course_catalog_entries (
          snapshot_id,
          year,
          term_code,
          term_label,
          category,
          category_label,
          course_code,
          curriculum_number,
          course_title,
          grade_level,
          section,
          professor,
          credit,
          department,
          campus,
          meetings,
          updated_at
        )
        VALUES (
          $1,
          $2,
          $3,
          $4,
          $5,
          $6,
          $7,
          $8,
          $9,
          $10,
          $11,
          $12,
          $13,
          $14,
          $15,
          $16::jsonb,
          now()
        )
      `,
      [
        snapshotId,
        entry.year,
        entry.termCode,
        entry.termLabel,
        entry.category,
        entry.categoryLabel,
        entry.courseCode ?? null,
        entry.curriculumNumber ?? null,
        entry.courseTitle,
        entry.gradeLevel ?? null,
        entry.section ?? null,
        entry.professor ?? null,
        entry.credit ?? null,
        entry.department ?? null,
        entry.campus ?? null,
        JSON.stringify(entry.meetings),
      ],
    );
  }
}

function buildContentHash(entries: CourseCatalogEntryInput[]): string {
  return sha256(JSON.stringify(entries));
}

function buildSnapshotKey(input: CourseCatalogSnapshotInput): string {
  const metadata = sanitizeMetadata(input.metadata);
  const categoryKeys = [...new Set(input.entries.map((entry) => entry.category))]
    .filter(Boolean)
    .sort();
  const departmentKeys = [
    stringMetadata(metadata, "departmentCode"),
    stringMetadata(metadata, "departmentLabel"),
    ...[...new Set(input.entries.map((entry) => entry.department))]
      .filter((value): value is string => Boolean(value))
      .sort(),
  ].filter(Boolean);
  const campusKeys = [
    stringMetadata(metadata, "campusDiv"),
    stringMetadata(metadata, "campusLabel"),
    ...[...new Set(input.entries.map((entry) => entry.campus))]
      .filter((value): value is string => Boolean(value))
      .sort(),
  ].filter(Boolean);

  return [
    input.sourceKind,
    sha256(
      JSON.stringify({
        sourceKind: input.sourceKind,
        source: stringMetadata(metadata, "source"),
        sourceUrl: stringMetadata(metadata, "sourceUrl"),
        categories: categoryKeys,
        departments: departmentKeys,
        campuses: campusKeys,
      }),
    ).slice(0, 24),
  ].join(":");
}

function stringMetadata(
  metadata: Record<string, unknown>,
  key: string,
): string | null {
  const value = metadata[key];
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.replace(/\s+/gu, " ").trim();
  return normalized.length > 0 ? normalized : null;
}
