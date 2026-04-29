import { describe, expect, it, vi } from "vitest";
import {
  runScheduledOfficialCafeteriaTask,
  runScheduledCafeteriaTask,
  runSchedulerTickWithDependencies,
} from "../../src/workers/scheduler-tick.js";
import type {
  SchedulerTaskDefinition,
  SchedulerTaskRunSummary,
  SchedulerTaskState,
} from "../../src/scheduler/types.js";

class FakeSchedulerRepository {
  ensured: SchedulerTaskDefinition[] = [];
  states: SchedulerTaskState[] = [];
  updatedEvaluations: Array<{ taskKey: string; nextDueAt: string; evaluatedAt: string }> = [];
  startedRuns: Array<{ taskKey: string; triggerReason: string; startedAt: string }> = [];
  finishedRuns: Array<{
    runId: number;
    taskKey: string;
    summary: SchedulerTaskRunSummary;
    nextDueAt: string;
    finishedAt: string;
    startedAt: string;
  }> = [];
  nextRunId = 1;

  async ensureTasks(definitions: SchedulerTaskDefinition[]): Promise<void> {
    this.ensured = definitions;
  }

  async listTaskStates(): Promise<SchedulerTaskState[]> {
    return this.states;
  }

  async updateTaskEvaluation(
    taskKey: string,
    nextDueAt: string,
    evaluatedAt: string,
  ): Promise<void> {
    this.updatedEvaluations.push({ taskKey, nextDueAt, evaluatedAt });
  }

  async recordTaskRunStarted(
    taskKey: string,
    triggerReason: string,
    startedAt: string,
    _expectedState: SchedulerTaskState | undefined,
  ): Promise<number | null> {
    this.startedRuns.push({ taskKey, triggerReason, startedAt });
    return this.nextRunId++;
  }

  async finishTaskRun(
    runId: number,
    taskKey: string,
    summary: SchedulerTaskRunSummary,
    nextDueAt: string,
    finishedAt: string,
    startedAt: string,
  ): Promise<void> {
    this.finishedRuns.push({
      runId,
      taskKey,
      summary,
      nextDueAt,
      finishedAt,
      startedAt,
    });
  }
}

describe("scheduler tick", () => {
  it("runs due tasks and skips tasks outside their window", async () => {
    const repository = new FakeSchedulerRepository();
    const definitions: SchedulerTaskDefinition[] = [
      {
        taskKey: "notices/all",
        name: "공지",
        description: "공지",
        collectorType: "notices",
        taskType: "notice-full",
        active: true,
        schedule: {
          kind: "fixed_interval",
          intervalHours: 6,
        },
        noticeLimit: 30,
      },
      {
        taskKey: "cafeterias/bokji-weekday",
        name: "복지동",
        description: "복지동",
        collectorType: "cafeteria-instagram",
        taskType: "cafeteria-source-check",
        active: true,
        schedule: {
          kind: "weekly_windows",
          windows: [
            {
              dayOfWeek: 1,
              start: "09:00",
              end: "10:30",
              intervalMinutes: 20,
              label: "mon-primary",
            },
          ],
        },
        cafeteriaSourceId: "bokji",
        cafeteriaLimit: 10,
      },
    ];
    const runTask = vi.fn(async (definition: SchedulerTaskDefinition) => ({
      status: definition.collectorType === "notices" ? "success" : "skipped",
      resultSummary: {
        taskKey: definition.taskKey,
      },
    }));

    const result = await runSchedulerTickWithDependencies(
      {
        definitions,
        repository,
        runTask,
      },
      {
        now: new Date("2026-04-12T12:20:00.000Z"),
      },
    );

    expect(runTask).toHaveBeenCalledTimes(1);
    expect(runTask).toHaveBeenCalledWith(definitions[0]);
    expect(repository.updatedEvaluations).toHaveLength(1);
    expect(repository.updatedEvaluations[0]?.taskKey).toBe("cafeterias/bokji-weekday");
    expect(repository.startedRuns).toHaveLength(1);
    expect(repository.finishedRuns).toHaveLength(1);
    expect(result.executed).toHaveLength(1);
    expect(result.executed[0]?.status).toBe("success");
  });

  it("supports dry-run evaluation without mutating repository state", async () => {
    const repository = new FakeSchedulerRepository();
    const definitions: SchedulerTaskDefinition[] = [
      {
        taskKey: "cafeterias/student-hall-weekday",
        name: "학생회관",
        description: "학생회관",
        collectorType: "cafeteria-instagram",
        taskType: "cafeteria-source-check",
        active: true,
        schedule: {
          kind: "weekly_windows",
          windows: [
            {
              dayOfWeek: 0,
              start: "14:00",
              end: "23:00",
              intervalMinutes: 30,
              label: "sun-primary",
            },
          ],
        },
        cafeteriaSourceId: "student-hall",
        cafeteriaLimit: 10,
      },
    ];

    const result = await runSchedulerTickWithDependencies(
      {
        definitions,
        repository,
        runTask: vi.fn(),
      },
      {
        now: new Date("2026-04-12T12:20:00.000Z"),
        dryRun: true,
      },
    );

    expect(result.tasks[0]?.status).toBe("dry_run");
    expect(repository.ensured).toHaveLength(0);
    expect(repository.updatedEvaluations).toHaveLength(0);
    expect(repository.startedRuns).toHaveLength(0);
    expect(repository.finishedRuns).toHaveLength(0);
  });

  it("skips execution when another scheduler tick already claimed the task", async () => {
    const repository = new FakeSchedulerRepository();
    repository.recordTaskRunStarted = vi.fn(async () => null);
    const definitions: SchedulerTaskDefinition[] = [
      {
        taskKey: "notices/all",
        name: "공지",
        description: "공지",
        collectorType: "notices",
        taskType: "notice-full",
        active: true,
        schedule: {
          kind: "fixed_interval",
          intervalHours: 6,
        },
        noticeLimit: 30,
      },
    ];
    const runTask = vi.fn();

    const result = await runSchedulerTickWithDependencies(
      {
        definitions,
        repository,
        runTask,
      },
      {
        now: new Date("2026-04-12T12:20:00.000Z"),
      },
    );

    expect(runTask).not.toHaveBeenCalled();
    expect(result.executed[0]?.status).toBe("skipped");
    expect(result.executed[0]?.reason).toContain("already claimed");
  });
});

describe("scheduled cafeteria task", () => {
  const definition: SchedulerTaskDefinition = {
    taskKey: "cafeterias/myeongjin-weekday",
    name: "명진당",
    description: "명진당",
    collectorType: "cafeteria-instagram",
    taskType: "cafeteria-source-check",
    active: true,
    schedule: {
      kind: "weekly_windows",
      windows: [
        {
          dayOfWeek: 0,
          start: "15:00",
          end: "21:00",
          intervalMinutes: 30,
          label: "sun-primary",
        },
      ],
    },
    cafeteriaSourceId: "myeongjin",
    cafeteriaLimit: 10,
  };

  it("skips when the recent 10 post codes are already known", async () => {
    const collect = vi.fn();
    const result = await runScheduledCafeteriaTask(definition, {
      scrape: vi.fn(async () => [
        { postCode: "A" },
        { postCode: "B" },
      ]),
      listExistingPostCodes: vi.fn(async () => ["A", "B"]),
      collect,
    });

    expect(collect).not.toHaveBeenCalled();
    expect(result.status).toBe("skipped");
    expect(result.resultSummary).toMatchObject({
      sourceId: "myeongjin",
      observedPostCount: 2,
      newPostCount: 0,
      newestObservedPostCode: "A",
    });
  });

  it("runs the source collector when at least one new post code is observed", async () => {
    const collect = vi.fn(async () => ({
      scrapeRunId: 91,
      scrapedCount: 6,
      processedCount: 6,
      insertedCount: 3,
      updatedCount: 3,
    }));

    const result = await runScheduledCafeteriaTask(definition, {
      scrape: vi.fn(async () => [
        { postCode: "A" },
        { postCode: "B" },
        { postCode: "C" },
      ]),
      listExistingPostCodes: vi.fn(async () => ["A"]),
      collect,
    });

    expect(collect).toHaveBeenCalledWith("myeongjin", 20);
    expect(result.status).toBe("success");
    expect(result.resultSummary).toMatchObject({
      sourceId: "myeongjin",
      newPostCount: 2,
      newPostCodes: ["B", "C"],
      scrapeRunId: 91,
      scrapedCount: 6,
      processedCount: 6,
      insertedCount: 3,
      updatedCount: 3,
    });
  });
});

describe("scheduled cafeteria official page task", () => {
  const definition: SchedulerTaskDefinition = {
    taskKey: "cafeterias/official-pages-current",
    name: "학식 공식 페이지 후행 정정",
    description: "학교 식단표 페이지 후행 정정",
    collectorType: "cafeteria-official-pages",
    taskType: "cafeteria-official-refresh",
    active: true,
    schedule: {
      kind: "fixed_interval",
      intervalHours: 6,
    },
    cafeteriaOfficialIncludePreviousWeek: false,
  };

  it("runs official page collection with the configured previous-week option", async () => {
    const collect = vi.fn(async () => ({
      scrapeRunId: 105,
      fetchedPageCount: 4,
      processedPageCount: 4,
      storedEntryCount: 35,
    }));

    const result = await runScheduledOfficialCafeteriaTask(definition, {
      collect,
    });

    expect(collect).toHaveBeenCalledWith(false);
    expect(result).toMatchObject({
      status: "success",
      resultSummary: {
        scrapeRunId: 105,
        fetchedPageCount: 4,
        processedPageCount: 4,
        storedEntryCount: 35,
        includePreviousWeek: false,
      },
    });
  });
});
