import type { Pool, PoolClient } from "pg";
import type {
  SchedulerTaskDefinition,
  SchedulerTaskRunSummary,
  SchedulerTaskState,
} from "../scheduler/types.js";

const TASK_CLAIM_LEASE_MINUTES = 30;

export class SchedulerRepository {
  constructor(
    private readonly pool: Pool,
    private readonly schema: string,
  ) {}

  async ensureTasks(definitions: SchedulerTaskDefinition[]): Promise<void> {
    for (const definition of definitions) {
      await this.pool.query(
        `
          INSERT INTO ${this.schema}.scheduler_tasks (
            task_key,
            name,
            description,
            collector_type,
            task_type,
            active,
            schedule_kind,
            schedule_config,
            updated_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, now())
          ON CONFLICT (task_key) DO UPDATE
          SET
            name = EXCLUDED.name,
            description = EXCLUDED.description,
            collector_type = EXCLUDED.collector_type,
            task_type = EXCLUDED.task_type,
            active = EXCLUDED.active,
            schedule_kind = EXCLUDED.schedule_kind,
            schedule_config = EXCLUDED.schedule_config,
            updated_at = now()
        `,
        [
          definition.taskKey,
          definition.name,
          definition.description,
          definition.collectorType,
          definition.taskType,
          definition.active,
          definition.schedule.kind,
          JSON.stringify(definition.schedule),
        ],
      );
    }
  }

  async listTaskStates(): Promise<SchedulerTaskState[]> {
    const result = await this.pool.query<{
      task_key: string;
      last_triggered_at: string | null;
      next_due_at: string | null;
      last_status: "running" | "success" | "failed" | "skipped" | null;
      updated_at: string | null;
    }>(
      `
        SELECT
          task_key,
          last_triggered_at::text,
          next_due_at::text,
          last_status,
          updated_at::text
        FROM ${this.schema}.scheduler_tasks
      `,
    );

    return result.rows.map((row) => ({
      taskKey: row.task_key,
      lastTriggeredAt: row.last_triggered_at,
      nextDueAt: row.next_due_at,
      lastStatus: row.last_status,
      updatedAt: row.updated_at,
    }));
  }

  async updateTaskEvaluation(
    taskKey: string,
    nextDueAt: string,
    evaluatedAt: string,
  ): Promise<void> {
    await this.pool.query(
      `
        UPDATE ${this.schema}.scheduler_tasks
        SET
          last_evaluated_at = $2,
          next_due_at = $3,
          updated_at = now()
        WHERE task_key = $1
      `,
      [taskKey, evaluatedAt, nextDueAt],
    );
  }

  async recordTaskRunStarted(
    taskKey: string,
    triggerReason: string,
    startedAt: string,
    expectedState: SchedulerTaskState | undefined,
  ): Promise<number | null> {
    const client = await this.pool.connect();

    try {
      await client.query("BEGIN");
      /**
       * due 판정은 scheduler tick마다 미리 계산되지만, 실제 실행 시작은
       * 동시에 여러 tick이 겹칠 수 있다. 여기서는 scheduler_tasks 한 행을
       * running으로 먼저 점유한 경우에만 run row를 만들도록 해서, 동일한
       * task가 중복으로 실행되지 않게 막는다.
       *
       * 또한 "내가 평가할 때 본 task 상태"와 지금 DB 상태가 같은지까지
       * updated_at으로 다시 확인해서, 다른 tick이 먼저 finish한 뒤 stale한
       * evaluation 결과로 다시 claim하는 race도 막는다.
       *
       * 마지막으로 running 상태가 30분 넘게 유지된 경우에는 비정상 종료로
       * 보고 재점유를 허용한다.
       */
      const claimResult = await client.query<{ task_key: string }>(
        `
          UPDATE ${this.schema}.scheduler_tasks
          SET
            last_started_at = $2,
            last_triggered_at = $2,
            last_status = 'running',
            last_error_message = null,
            updated_at = now()
          WHERE task_key = $1
            AND (
              (
                COALESCE(last_status, '') <> 'running'
                AND (
                  ($3::timestamptz IS NULL AND updated_at IS NULL)
                  OR updated_at = $3::timestamptz
                )
              )
              OR (
                last_status = 'running'
                AND last_started_at <= ($2::timestamptz - make_interval(mins => $4::int))
              )
            )
          RETURNING task_key
        `,
        [taskKey, startedAt, expectedState?.updatedAt ?? null, TASK_CLAIM_LEASE_MINUTES],
      );

      if (claimResult.rowCount === 0) {
        await client.query("ROLLBACK");
        return null;
      }

      const runResult = await client.query<{ id: number }>(
        `
          INSERT INTO ${this.schema}.scheduler_task_runs (
            task_key,
            trigger_reason,
            status,
            started_at
          )
          VALUES ($1, $2, 'running', $3)
          RETURNING id
        `,
        [taskKey, triggerReason, startedAt],
      );

      await client.query("COMMIT");
      return Number(runResult.rows[0]!.id);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async finishTaskRun(
    runId: number,
    taskKey: string,
    summary: SchedulerTaskRunSummary,
    nextDueAt: string,
    finishedAt: string,
    startedAt: string,
  ): Promise<void> {
    const client = await this.pool.connect();

    try {
      await client.query("BEGIN");
      await client.query(
        `
          UPDATE ${this.schema}.scheduler_task_runs
          SET
            status = $2,
            finished_at = $3,
            result_summary = $4::jsonb,
            error_message = $5
          WHERE id = $1
        `,
        [
          runId,
          summary.status,
          finishedAt,
          summary.resultSummary ? JSON.stringify(summary.resultSummary) : null,
          summary.errorMessage ?? null,
        ],
      );

      await client.query(
        `
          UPDATE ${this.schema}.scheduler_tasks
          SET
            last_finished_at = $2,
            last_status = $3,
            last_error_message = $4,
            last_result_summary = $5::jsonb,
            next_due_at = $6,
            updated_at = now()
          WHERE task_key = $1
            AND last_started_at = $7::timestamptz
        `,
        [
          taskKey,
          finishedAt,
          summary.status,
          summary.errorMessage ?? null,
          summary.resultSummary ? JSON.stringify(summary.resultSummary) : null,
          nextDueAt,
          startedAt,
        ],
      );

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}
