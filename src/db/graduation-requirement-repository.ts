import type { Pool, PoolClient } from "pg";
import { sha256 } from "../shared/hash.js";
import type {
  GraduationRequirementImportResult,
  GraduationRequirementRuleInput,
  GraduationRequirementSourceInput,
} from "../graduation-requirements/types.js";

export class GraduationRequirementRepository {
  constructor(
    private readonly pool: Pool,
    private readonly schema: string,
  ) {}

  async replaceSource(
    input: GraduationRequirementSourceInput,
  ): Promise<GraduationRequirementImportResult> {
    const client = await this.pool.connect();

    try {
      await client.query("BEGIN");
      const sourceId = await this.upsertSourceWithClient(client, input);

      await client.query(
        `
          DELETE FROM ${this.schema}.graduation_requirement_rules
          WHERE source_id = $1
        `,
        [sourceId],
      );

      for (const rule of input.rules) {
        await this.insertRuleWithClient(client, sourceId, input, rule);
      }

      await client.query("COMMIT");
      return {
        sourceId,
        department: input.department,
        admissionYear: input.admissionYear,
        ruleCount: input.rules.length,
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  private async upsertSourceWithClient(
    client: PoolClient,
    input: GraduationRequirementSourceInput,
  ): Promise<number> {
    const result = await client.query<{ id: number }>(
      `
        INSERT INTO ${this.schema}.graduation_requirement_sources (
          department,
          admission_year,
          source_kind,
          source_title,
          source_url,
          source_published_at,
          source_retrieved_at,
          content_hash,
          raw_payload,
          created_at,
          updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, now(), $7, $8::jsonb, now(), now())
        ON CONFLICT (department, admission_year, source_url) DO UPDATE
        SET
          source_kind = EXCLUDED.source_kind,
          source_title = EXCLUDED.source_title,
          source_published_at = EXCLUDED.source_published_at,
          source_retrieved_at = EXCLUDED.source_retrieved_at,
          content_hash = EXCLUDED.content_hash,
          raw_payload = EXCLUDED.raw_payload,
          updated_at = now()
        RETURNING id
      `,
      [
        input.department,
        input.admissionYear,
        input.sourceKind,
        input.sourceTitle,
        input.sourceUrl,
        input.sourcePublishedAt ?? null,
        buildRequirementContentHash(input),
        JSON.stringify(input.rawPayload),
      ],
    );

    return Number(result.rows[0]!.id);
  }

  private async insertRuleWithClient(
    client: PoolClient,
    sourceId: number,
    source: GraduationRequirementSourceInput,
    rule: GraduationRequirementRuleInput,
  ): Promise<void> {
    await client.query(
      `
        INSERT INTO ${this.schema}.graduation_requirement_rules (
          source_id,
          department,
          admission_year,
          requirement_key,
          label,
          category,
          required_credits,
          required_course_codes,
          required_course_titles,
          course_groups,
          program_track,
          min_courses,
          applies_to,
          rule_status,
          note,
          updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10::jsonb, $11, $12, $13::jsonb, $14, $15, now())
      `,
      [
        sourceId,
        source.department,
        source.admissionYear,
        rule.requirementKey,
        rule.label,
        rule.category,
        rule.requiredCredits ?? null,
        JSON.stringify(rule.requiredCourseCodes ?? []),
        JSON.stringify(rule.requiredCourseTitles ?? []),
        JSON.stringify(rule.courseGroups ?? []),
        rule.programTrack ?? null,
        rule.minCourses ?? null,
        JSON.stringify(rule.appliesTo ?? {}),
        rule.status,
        rule.note ?? null,
      ],
    );
  }
}

function buildRequirementContentHash(
  input: GraduationRequirementSourceInput,
): string {
  return sha256(JSON.stringify({
    source: input.rawPayload,
    rules: input.rules,
  }));
}
