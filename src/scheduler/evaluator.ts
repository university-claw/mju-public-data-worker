import type {
  SchedulerTaskDefinition,
  SchedulerTaskEvaluation,
  SchedulerTaskState,
  WeeklyWindowSchedule,
} from "./types.js";

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const ONE_WEEK_DAYS = 7;

function toKstClock(date: Date): Date {
  return new Date(date.getTime() + KST_OFFSET_MS);
}

function fromKstParts(
  year: number,
  monthIndex: number,
  day: number,
  hour: number,
  minute: number,
): Date {
  return new Date(Date.UTC(year, monthIndex, day, hour, minute) - KST_OFFSET_MS);
}

function addKstDays(kstDate: Date, days: number): Date {
  const next = new Date(kstDate.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function parseClock(raw: `${number}:${number}`): { hour: number; minute: number } {
  const [rawHour, rawMinute] = raw.split(":");
  const hour = Number(rawHour);
  const minute = Number(rawMinute);
  if (
    !Number.isInteger(hour) ||
    hour < 0 ||
    hour > 23 ||
    !Number.isInteger(minute) ||
    minute < 0 ||
    minute > 59
  ) {
    throw new Error(`invalid schedule clock value: ${raw}`);
  }

  return { hour, minute };
}

interface WindowOccurrence {
  window: WeeklyWindowSchedule;
  start: Date;
  end: Date;
}

function buildWindowOccurrence(
  now: Date,
  window: WeeklyWindowSchedule,
): WindowOccurrence {
  const nowKst = toKstClock(now);
  const currentDow = nowKst.getUTCDay();
  const baseDiffDays = window.dayOfWeek - currentDow;
  const candidateKst = addKstDays(nowKst, baseDiffDays);
  const startClock = parseClock(window.start);
  const endClock = parseClock(window.end);

  let start = fromKstParts(
    candidateKst.getUTCFullYear(),
    candidateKst.getUTCMonth(),
    candidateKst.getUTCDate(),
    startClock.hour,
    startClock.minute,
  );
  let end = fromKstParts(
    candidateKst.getUTCFullYear(),
    candidateKst.getUTCMonth(),
    candidateKst.getUTCDate(),
    endClock.hour,
    endClock.minute,
  );

  if (now > end) {
    const nextWeekKst = addKstDays(candidateKst, ONE_WEEK_DAYS);
    start = fromKstParts(
      nextWeekKst.getUTCFullYear(),
      nextWeekKst.getUTCMonth(),
      nextWeekKst.getUTCDate(),
      startClock.hour,
      startClock.minute,
    );
    end = fromKstParts(
      nextWeekKst.getUTCFullYear(),
      nextWeekKst.getUTCMonth(),
      nextWeekKst.getUTCDate(),
      endClock.hour,
      endClock.minute,
    );
  }

  return {
    window,
    start,
    end,
  };
}

function findNextWindowStart(definition: SchedulerTaskDefinition, now: Date): Date {
  if (definition.schedule.kind !== "weekly_windows") {
    throw new Error("findNextWindowStart only supports weekly window schedules");
  }

  const occurrences = definition.schedule.windows.map((window) =>
    buildWindowOccurrence(now, window),
  );
  const nextWindow = occurrences.reduce((earliest, occurrence) =>
    occurrence.start < earliest.start ? occurrence : earliest,
  );

  return nextWindow.start;
}

function evaluateFixedIntervalTask(
  definition: SchedulerTaskDefinition,
  state: SchedulerTaskState | undefined,
  now: Date,
): SchedulerTaskEvaluation {
  if (definition.schedule.kind !== "fixed_interval") {
    throw new Error("fixed interval evaluator received an unsupported schedule");
  }

  if (!state?.lastTriggeredAt) {
    return {
      taskKey: definition.taskKey,
      due: true,
      reason: "no previous trigger recorded",
      nextDueAt: now.toISOString(),
    };
  }

  const nextDueAt = new Date(state.lastTriggeredAt);
  nextDueAt.setUTCHours(nextDueAt.getUTCHours() + definition.schedule.intervalHours);

  return {
    taskKey: definition.taskKey,
    due: now >= nextDueAt,
    reason:
      now >= nextDueAt
        ? `interval ${definition.schedule.intervalHours}h elapsed`
        : "interval window not reached yet",
    nextDueAt: nextDueAt.toISOString(),
  };
}

function evaluateWeeklyWindowTask(
  definition: SchedulerTaskDefinition,
  state: SchedulerTaskState | undefined,
  now: Date,
): SchedulerTaskEvaluation {
  if (definition.schedule.kind !== "weekly_windows") {
    throw new Error("weekly window evaluator received an unsupported schedule");
  }

  const activeOccurrence = definition.schedule.windows
    .map((window) => buildWindowOccurrence(now, window))
    .find((occurrence) => occurrence.start <= now && now <= occurrence.end);

  if (!activeOccurrence) {
    const nextDueAt = findNextWindowStart(definition, now);
    return {
      taskKey: definition.taskKey,
      due: false,
      reason: "outside every active polling window",
      nextDueAt: nextDueAt.toISOString(),
    };
  }

  const intervalMs = activeOccurrence.window.intervalMinutes * 60 * 1000;
  const lastTriggeredAt = state?.lastTriggeredAt
    ? new Date(state.lastTriggeredAt)
    : null;

  let nextDueAt = activeOccurrence.start;
  if (
    lastTriggeredAt &&
    lastTriggeredAt >= activeOccurrence.start &&
    lastTriggeredAt <= activeOccurrence.end
  ) {
    nextDueAt = new Date(lastTriggeredAt.getTime() + intervalMs);
  }

  if (nextDueAt <= activeOccurrence.end) {
    return {
      taskKey: definition.taskKey,
      due: now >= nextDueAt,
      reason:
        now >= nextDueAt
          ? `active window ${activeOccurrence.window.label} is due`
          : `waiting for next interval in ${activeOccurrence.window.label}`,
      nextDueAt: nextDueAt.toISOString(),
      activeWindowLabel: activeOccurrence.window.label,
    };
  }

  const nextDueAfterWindow = findNextWindowStart(
    definition,
    new Date(activeOccurrence.end.getTime() + 60 * 1000),
  );
  return {
    taskKey: definition.taskKey,
    due: false,
    reason: `current window ${activeOccurrence.window.label} is exhausted`,
    nextDueAt: nextDueAfterWindow.toISOString(),
    activeWindowLabel: activeOccurrence.window.label,
  };
}

export function evaluateSchedulerTask(
  definition: SchedulerTaskDefinition,
  state: SchedulerTaskState | undefined,
  now: Date,
): SchedulerTaskEvaluation {
  if (!definition.active) {
    return {
      taskKey: definition.taskKey,
      due: false,
      reason: "task is inactive",
      nextDueAt: now.toISOString(),
    };
  }

  if (definition.schedule.kind === "fixed_interval") {
    return evaluateFixedIntervalTask(definition, state, now);
  }

  return evaluateWeeklyWindowTask(definition, state, now);
}
