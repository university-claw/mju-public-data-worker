import { describe, expect, it } from "vitest";
import { evaluateSchedulerTask } from "../../src/scheduler/evaluator.js";
import { SCHEDULER_TASKS } from "../../src/scheduler/policies.js";
import type { SchedulerTaskDefinition } from "../../src/scheduler/types.js";

function findTask(taskKey: string): SchedulerTaskDefinition {
  const task = SCHEDULER_TASKS.find((candidate) => candidate.taskKey === taskKey);
  if (!task) {
    throw new Error(`scheduler task not found: ${taskKey}`);
  }

  return task;
}

describe("scheduler evaluator", () => {
  it("marks 6-hour notice interval as due when no state exists", () => {
    const result = evaluateSchedulerTask(
      findTask("notices/all"),
      undefined,
      new Date("2026-04-12T12:00:00.000Z"),
    );

    expect(result.due).toBe(true);
    expect(result.reason).toContain("no previous trigger");
  });

  it("waits until 6 hours pass for notice collection", () => {
    const result = evaluateSchedulerTask(
      findTask("notices/all"),
      {
        taskKey: "notices/all",
        lastTriggeredAt: "2026-04-12T12:00:00.000Z",
        nextDueAt: null,
        lastStatus: "success",
        updatedAt: "2026-04-12T12:00:00.000Z",
      },
      new Date("2026-04-12T15:00:00.000Z"),
    );

    expect(result.due).toBe(false);
    expect(result.nextDueAt).toBe("2026-04-12T18:00:00.000Z");
  });

  it("treats sunday evening as the main polling window for student hall weekday menus", () => {
    const result = evaluateSchedulerTask(
      findTask("cafeterias/student-hall-weekday"),
      undefined,
      new Date("2026-04-12T12:20:00.000Z"),
    );

    expect(result.due).toBe(true);
    expect(result.activeWindowLabel).toBe("sun-primary");
  });

  it("pushes student hall weekend checks to friday night before the saturday retry window", () => {
    const result = evaluateSchedulerTask(
      findTask("cafeterias/student-hall-weekend"),
      undefined,
      new Date("2026-04-10T10:00:00.000Z"),
    );

    expect(result.due).toBe(false);
    expect(result.nextDueAt).toBe("2026-04-10T12:00:00.000Z");
  });

  it("respects intra-window retry intervals for cafeteria tasks", () => {
    const result = evaluateSchedulerTask(
      findTask("cafeterias/bokji-weekday"),
      {
        taskKey: "cafeterias/bokji-weekday",
        lastTriggeredAt: "2026-04-13T00:00:00.000Z",
        nextDueAt: null,
        lastStatus: "skipped",
        updatedAt: "2026-04-13T00:00:00.000Z",
      },
      new Date("2026-04-13T00:15:00.000Z"),
    );

    expect(result.due).toBe(false);
    expect(result.activeWindowLabel).toBe("mon-primary");
    expect(result.nextDueAt).toBe("2026-04-13T00:20:00.000Z");
  });
});
