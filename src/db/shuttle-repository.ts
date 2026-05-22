import type { Pool, PoolClient } from "pg";
import type {
  ShuttleDepartureInput,
  ShuttleTimetableFailureInput,
  ShuttleTimetableInput,
} from "../shuttles/types.js";

export class ShuttleRepository {
  constructor(
    private readonly pool: Pool,
    private readonly schema: string,
  ) {}

  async replaceActiveTimetable(input: ShuttleTimetableInput): Promise<{
    timetableVersionId: number;
    departureCount: number;
  }> {
    const client = await this.pool.connect();

    try {
      await client.query("BEGIN");
      await client.query(
        `
          UPDATE ${this.schema}.shuttle_timetable_versions
          SET is_active = false, updated_at = now()
          WHERE is_active = true
        `,
      );

      const result = await client.query<{ id: number }>(
        `
          INSERT INTO ${this.schema}.shuttle_timetable_versions (
            source_id,
            source_external_id,
            source_title,
            source_url,
            source_published_at,
            academic_year,
            term_label,
            is_active,
            normalization_status,
            normalization_error_message,
            departure_count,
            normalized_at,
            updated_at
          )
          VALUES ($1, $2, $3, $4, $5::timestamptz, $6, $7, true, 'succeeded', null, $8, $9::timestamptz, now())
          ON CONFLICT (source_id, source_external_id) DO UPDATE
          SET
            source_title = EXCLUDED.source_title,
            source_url = EXCLUDED.source_url,
            source_published_at = EXCLUDED.source_published_at,
            academic_year = EXCLUDED.academic_year,
            term_label = EXCLUDED.term_label,
            is_active = true,
            normalization_status = 'succeeded',
            normalization_error_message = null,
            departure_count = EXCLUDED.departure_count,
            normalized_at = EXCLUDED.normalized_at,
            updated_at = now()
          RETURNING id
        `,
        [
          input.sourceId,
          input.sourceExternalId,
          input.sourceTitle,
          input.sourceUrl,
          input.sourcePublishedAt,
          input.academicYear,
          input.termLabel,
          input.departures.length,
          input.normalizedAt,
        ],
      );
      const timetableVersionId = Number(result.rows[0]!.id);

      await client.query(
        `
          DELETE FROM ${this.schema}.shuttle_departures
          WHERE timetable_version_id = $1
        `,
        [timetableVersionId],
      );

      for (const departure of input.departures) {
        await this.insertDepartureWithClient(client, timetableVersionId, departure);
      }

      await client.query("COMMIT");
      return {
        timetableVersionId,
        departureCount: input.departures.length,
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async recordFailedTimetable(input: ShuttleTimetableFailureInput): Promise<void> {
    await this.pool.query(
      `
        INSERT INTO ${this.schema}.shuttle_timetable_versions (
          source_id,
          source_external_id,
          source_title,
          source_url,
          source_published_at,
          academic_year,
          term_label,
          is_active,
          normalization_status,
          normalization_error_message,
          departure_count,
          normalized_at,
          updated_at
        )
        VALUES ($1, $2, $3, $4, $5::timestamptz, $6, $7, false, 'failed', $8, 0, null, now())
        ON CONFLICT (source_id, source_external_id) DO UPDATE
        SET
          source_title = EXCLUDED.source_title,
          source_url = EXCLUDED.source_url,
          source_published_at = EXCLUDED.source_published_at,
          academic_year = EXCLUDED.academic_year,
          term_label = EXCLUDED.term_label,
          normalization_error_message = EXCLUDED.normalization_error_message,
          updated_at = now()
      `,
      [
        input.sourceId,
        input.sourceExternalId,
        input.sourceTitle,
        input.sourceUrl,
        input.sourcePublishedAt,
        input.academicYear,
        input.termLabel,
        input.errorMessage,
      ],
    );
  }

  private async insertDepartureWithClient(
    client: PoolClient,
    timetableVersionId: number,
    departure: ShuttleDepartureInput,
  ): Promise<void> {
    await client.query(
      `
        INSERT INTO ${this.schema}.shuttle_departures (
          timetable_version_id,
          campus,
          route_name,
          direction,
          stop_name,
          day_type,
          departure_time,
          note,
          sort_order
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7::time, $8, $9)
      `,
      [
        timetableVersionId,
        departure.campus ?? null,
        departure.routeName,
        departure.direction ?? null,
        departure.stopName,
        departure.dayType,
        departure.departureTime,
        departure.note ?? null,
        departure.sortOrder,
      ],
    );
  }
}
