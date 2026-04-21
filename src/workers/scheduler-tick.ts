import type { Pool } from "pg";
import { CAFETERIA_INSTAGRAM_SOURCES } from "../cafeterias/sources.js";
import { scrapeCafeteriaInstagramPosts } from "../cafeterias/instagram-scraper.js";
import { CafeteriaRepository } from "../db/cafeteria-repository.js";
import { SchedulerRepository } from "../db/scheduler-repository.js";
import { collectNotices } from "./notice-collector.js";
import { collectCafeteriaInstagramPosts } from "./cafeteria-instagram-collector.js";
import { collectCafeteriaOfficialPages } from "./cafeteria-official-page-collector.js";
import { SCHEDULER_TASKS } from "../scheduler/policies.js";
import { evaluateSchedulerTask } from "../scheduler/evaluator.js";
import type {
  SchedulerTaskDefinition,
  SchedulerTaskEvaluation,
  SchedulerTaskRunSummary,
  SchedulerTaskState,
} from "../scheduler/types.js";

export interface RunSchedulerTickOptions {
  storageLocalRoot: string;
  ocrLanguages: string[];
  noticeNormalizationEnabled: boolean;
  noticeNormalizationApiKey?: string;
  noticeNormalizationModel: string;
  noticeNormalizationMaxOutputTokens: number;
  dryRun?: boolean;
  now?: Date;
}

export interface SchedulerTickExecutionResult {
  taskKey: string;
  status: "success" | "failed" | "skipped";
  reason: string;
  nextDueAt: string;
  resultSummary?: Record<string, unknown>;
  errorMessage?: string;
}

export interface SchedulerTickResult {
  evaluatedAt: string;
  tasks: Array<SchedulerTaskEvaluation & { status: "pending" | "not_due" | "dry_run" }>;
  executed: SchedulerTickExecutionResult[];
}

interface CafeteriaScheduleRunnerDependencies {
  listExistingPostCodes(sourceId: string, postCodes: string[]): Promise<string[]>;
  collect(sourceId: string, limit: number): Promise<{
    scrapeRunId: number;
    scrapedCount: number;
    processedCount: number;
    insertedCount: number;
    updatedCount: number;
  }>;
  scrape(source: (typeof CAFETERIA_INSTAGRAM_SOURCES)[number], limit: number): Promise<
    Array<{ postCode: string }>
  >;
}

interface CafeteriaOfficialScheduleRunnerDependencies {
  collect(includePreviousWeek: boolean): Promise<{
    scrapeRunId: number;
    fetchedPageCount: number;
    processedPageCount: number;
    storedEntryCount: number;
  }>;
}

interface SchedulerTaskRepositoryLike {
  ensureTasks(definitions: SchedulerTaskDefinition[]): Promise<void>;
  listTaskStates(): Promise<SchedulerTaskState[]>;
  updateTaskEvaluation(taskKey: string, nextDueAt: string, evaluatedAt: string): Promise<void>;
  recordTaskRunStarted(
    taskKey: string,
    triggerReason: string,
    startedAt: string,
    expectedState: SchedulerTaskState | undefined,
  ): Promise<number | null>;
  finishTaskRun(
    runId: number,
    taskKey: string,
    summary: SchedulerTaskRunSummary,
    nextDueAt: string,
    finishedAt: string,
    startedAt: string,
  ): Promise<void>;
}

interface SchedulerRuntimeDependencies {
  definitions: SchedulerTaskDefinition[];
  repository: SchedulerTaskRepositoryLike;
  runTask(definition: SchedulerTaskDefinition): Promise<SchedulerTaskRunSummary>;
}

/**
 * 스케줄러는 "OS가 10분마다 호출하는 얇은 tick"을 목표로 만든다.
 * 그래서 내부 로직은 현재 시각에 due인 task만 선별하고, 각 task의 마지막
 * 실행 상태는 DB에 저장해 다음 tick에서도 이어서 판단할 수 있게 한다.
 */
export async function runSchedulerTick(
  pool: Pool,
  schema: string,
  options: RunSchedulerTickOptions,
): Promise<SchedulerTickResult> {
  const schedulerRepository = new SchedulerRepository(pool, schema);
  const cafeteriaRepository = new CafeteriaRepository(pool, schema);

  return runSchedulerTickWithDependencies(
    {
      definitions: SCHEDULER_TASKS,
      repository: schedulerRepository,
      runTask: async (definition) => {
        if (definition.collectorType === "notices") {
          if (!options.storageLocalRoot) {
            throw new Error("scheduled notice collection requires STORAGE_LOCAL_ROOT");
          }

          const result = await collectNotices(pool, schema, {
            limit: definition.noticeLimit ?? 30,
            triggerReason: `scheduled:${definition.taskKey}`,
            storageLocalRoot: options.storageLocalRoot,
            ocrLanguages: options.ocrLanguages,
            noticeNormalizationEnabled: options.noticeNormalizationEnabled,
            noticeNormalizationModel: options.noticeNormalizationModel,
            noticeNormalizationMaxOutputTokens:
              options.noticeNormalizationMaxOutputTokens,
            ...(options.noticeNormalizationApiKey
              ? { noticeNormalizationApiKey: options.noticeNormalizationApiKey }
              : {}),
          });

          return {
            status: "success",
            resultSummary: {
              scrapeRunId: result.scrapeRunId,
              scrapedCount: result.scrapedCount,
              processedCount: result.processedCount,
              insertedCount: result.insertedCount,
              updatedCount: result.updatedCount,
              noticeNormalizationSucceededCount:
                result.noticeNormalizationSucceededCount,
              noticeNormalizationFailedCount:
                result.noticeNormalizationFailedCount,
            },
          };
        }

        if (definition.collectorType === "cafeteria-official-pages") {
          return runScheduledOfficialCafeteriaTask(definition, {
            collect: async (includePreviousWeek) => {
              const result = await collectCafeteriaOfficialPages(pool, schema, {
                triggerReason: `scheduled:${definition.taskKey}`,
                includePreviousWeek,
              });

              return {
                scrapeRunId: result.scrapeRunId,
                fetchedPageCount: result.fetchedPageCount,
                processedPageCount: result.processedPageCount,
                storedEntryCount: result.storedEntryCount,
              };
            },
          });
        }

        if (!options.storageLocalRoot) {
          throw new Error("scheduled cafeteria instagram collection requires STORAGE_LOCAL_ROOT");
        }

        return runScheduledCafeteriaTask(
          definition,
          {
            listExistingPostCodes: (sourceId, postCodes) =>
              cafeteriaRepository.listExistingInstagramPostCodes(sourceId, postCodes),
            collect: async (sourceId, limit) => {
              const result = await collectCafeteriaInstagramPosts(pool, schema, {
                limit,
                triggerReason: `scheduled:${definition.taskKey}`,
                storageLocalRoot: options.storageLocalRoot,
                ocrLanguages: options.ocrLanguages,
                sourceIds: [sourceId],
              });

              return {
                scrapeRunId: result.scrapeRunId,
                scrapedCount: result.scrapedCount,
                processedCount: result.processedCount,
                insertedCount: result.insertedCount,
                updatedCount: result.updatedCount,
              };
            },
            scrape: scrapeCafeteriaInstagramPosts,
          },
        );
      },
    },
    options,
  );
}

/**
 * 카페테리아 스케줄 task는 "최근 10개 코드 집합 비교"가 핵심이다.
 * pinned 게시물이나 운영 공지가 상단에 남아 있어도 신규 식단표를 놓치지 않도록,
 * 가장 위 1건이 아니라 최근 N개의 post_code를 DB와 비교해 신규 여부를 판단한다.
 */
export async function runScheduledCafeteriaTask(
  definition: SchedulerTaskDefinition,
  dependencies: CafeteriaScheduleRunnerDependencies,
): Promise<SchedulerTaskRunSummary> {
  const sourceId = definition.cafeteriaSourceId;
  const source = CAFETERIA_INSTAGRAM_SOURCES.find((candidate) => candidate.id === sourceId);
  if (!sourceId || !source) {
    throw new Error(`scheduler cafeteria task is missing a valid source: ${definition.taskKey}`);
  }

  /**
   * 신규 감지는 "최근 10개"보다 조금 더 넉넉한 관측 창이 안전하다.
   * pinned 게시물이나 운영 공지가 상단을 차지해도 실제 신규 식단표를 놓치지
   * 않도록, 스케줄 감지 단계는 최소 20개까지 본다.
   */
  const detectionLimit = Math.max(definition.cafeteriaLimit ?? 10, 20);
  const observedPosts = await dependencies.scrape(source, detectionLimit);
  const observedCodes = observedPosts.map((post) => post.postCode);
  const knownCodes = new Set(
    await dependencies.listExistingPostCodes(source.id, observedCodes),
  );
  const newCodes = observedCodes.filter((postCode) => !knownCodes.has(postCode));

  if (newCodes.length === 0) {
    return {
      status: "skipped",
      resultSummary: {
        sourceId,
        observedPostCount: observedCodes.length,
        newPostCount: 0,
        newestObservedPostCode: observedCodes[0] ?? null,
      },
    };
  }

  const result = await dependencies.collect(source.id, detectionLimit);
  return {
    status: "success",
    resultSummary: {
      sourceId,
      scrapeRunId: result.scrapeRunId,
      observedPostCount: observedCodes.length,
      newPostCount: newCodes.length,
      newPostCodes: newCodes,
      scrapedCount: result.scrapedCount,
      processedCount: result.processedCount,
      insertedCount: result.insertedCount,
      updatedCount: result.updatedCount,
    },
  };
}

export async function runScheduledOfficialCafeteriaTask(
  definition: SchedulerTaskDefinition,
  dependencies: CafeteriaOfficialScheduleRunnerDependencies,
): Promise<SchedulerTaskRunSummary> {
  const result = await dependencies.collect(
    definition.cafeteriaOfficialIncludePreviousWeek ?? false,
  );

  return {
    status: "success",
    resultSummary: {
      scrapeRunId: result.scrapeRunId,
      fetchedPageCount: result.fetchedPageCount,
      processedPageCount: result.processedPageCount,
      storedEntryCount: result.storedEntryCount,
      includePreviousWeek: definition.cafeteriaOfficialIncludePreviousWeek ?? false,
    },
  };
}

export async function runSchedulerTickWithDependencies(
  dependencies: SchedulerRuntimeDependencies,
  options: Pick<RunSchedulerTickOptions, "dryRun" | "now">,
): Promise<SchedulerTickResult> {
  const now = options.now ?? new Date();
  const evaluatedAt = now.toISOString();

  /**
   * dry-run은 "지금 무엇이 due인지 보기"가 목적이라서 DB를 절대 바꾸면 안 된다.
   * 그래서 task 동기화/평가 기록도 생략하고, 현재 상태만 읽어서 계산 결과만 돌려준다.
   */
  if (!options.dryRun) {
    await dependencies.repository.ensureTasks(dependencies.definitions);
  }

  const stateMap = new Map(
    (await dependencies.repository.listTaskStates()).map((state) => [state.taskKey, state]),
  );
  const tasks: SchedulerTickResult["tasks"] = [];
  const executed: SchedulerTickExecutionResult[] = [];

  for (const definition of dependencies.definitions) {
    const state = stateMap.get(definition.taskKey);
    const evaluation = evaluateSchedulerTask(definition, state, now);

    if (options.dryRun) {
      tasks.push({
        ...evaluation,
        status: evaluation.due ? "dry_run" : "not_due",
      });
      continue;
    }

    if (!evaluation.due) {
      await dependencies.repository.updateTaskEvaluation(
        definition.taskKey,
        evaluation.nextDueAt,
        evaluatedAt,
      );
      tasks.push({
        ...evaluation,
        status: "not_due",
      });
      continue;
    }

    const startedAt = new Date().toISOString();
    const runId = await dependencies.repository.recordTaskRunStarted(
      definition.taskKey,
      "scheduler-tick",
      startedAt,
      state,
    );

    if (runId === null) {
      tasks.push({
        ...evaluation,
        status: "pending",
      });
      executed.push({
        taskKey: definition.taskKey,
        status: "skipped",
        reason: `${evaluation.reason} (already claimed by another scheduler tick)`,
        nextDueAt: evaluation.nextDueAt,
      });
      continue;
    }

    try {
      const summary = await dependencies.runTask(definition);
      const finishedAt = new Date().toISOString();
      const nextEvaluation = evaluateSchedulerTask(
        definition,
        {
          taskKey: definition.taskKey,
          lastTriggeredAt: startedAt,
          nextDueAt: null,
          lastStatus: summary.status,
          updatedAt: null,
        },
        new Date(finishedAt),
      );
      await dependencies.repository.finishTaskRun(
        runId,
        definition.taskKey,
        summary,
        nextEvaluation.nextDueAt,
        finishedAt,
        startedAt,
      );

      tasks.push({
        ...evaluation,
        status: "pending",
      });
      executed.push({
        taskKey: definition.taskKey,
        status: summary.status,
        reason: evaluation.reason,
        nextDueAt: nextEvaluation.nextDueAt,
        ...(summary.resultSummary
          ? { resultSummary: summary.resultSummary }
          : {}),
      });
    } catch (error) {
      const finishedAt = new Date().toISOString();
      const nextEvaluation = evaluateSchedulerTask(
        definition,
        {
          taskKey: definition.taskKey,
          lastTriggeredAt: startedAt,
          nextDueAt: null,
          lastStatus: "failed",
          updatedAt: null,
        },
        new Date(finishedAt),
      );
      const message = error instanceof Error ? error.message : String(error);
      await dependencies.repository.finishTaskRun(
        runId,
        definition.taskKey,
        {
          status: "failed",
          errorMessage: message,
        },
        nextEvaluation.nextDueAt,
        finishedAt,
        startedAt,
      );

      tasks.push({
        ...evaluation,
        status: "pending",
      });
      executed.push({
        taskKey: definition.taskKey,
        status: "failed",
        reason: evaluation.reason,
        nextDueAt: nextEvaluation.nextDueAt,
        errorMessage: message,
      });
    }
  }

  return {
    evaluatedAt,
    tasks,
    executed,
  };
}
