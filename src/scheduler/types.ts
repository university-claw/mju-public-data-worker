export type SchedulerCollectorType =
  | "notices"
  | "cafeteria-instagram"
  | "cafeteria-official-pages"
  | "shuttles";

export type SchedulerTaskType =
  | "notice-full"
  | "cafeteria-source-check"
  | "cafeteria-official-refresh"
  | "shuttle-current-semester";

export interface IntervalScheduleDefinition {
  kind: "fixed_interval";
  intervalHours: number;
}

export interface WeeklyWindowSchedule {
  dayOfWeek: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  start: `${number}:${number}`;
  end: `${number}:${number}`;
  intervalMinutes: number;
  label: string;
}

export interface WeeklyWindowScheduleDefinition {
  kind: "weekly_windows";
  windows: WeeklyWindowSchedule[];
}

export type SchedulerScheduleDefinition =
  | IntervalScheduleDefinition
  | WeeklyWindowScheduleDefinition;

export interface SchedulerTaskDefinition {
  taskKey: string;
  name: string;
  description: string;
  collectorType: SchedulerCollectorType;
  taskType: SchedulerTaskType;
  active: boolean;
  schedule: SchedulerScheduleDefinition;
  noticeLimit?: number;
  cafeteriaSourceId?: string;
  cafeteriaLimit?: number;
  cafeteriaOfficialIncludePreviousWeek?: boolean;
}

export interface SchedulerTaskState {
  taskKey: string;
  lastTriggeredAt: string | null;
  nextDueAt: string | null;
  lastStatus: "running" | "success" | "failed" | "skipped" | null;
  updatedAt: string | null;
}

export interface SchedulerTaskEvaluation {
  taskKey: string;
  due: boolean;
  reason: string;
  nextDueAt: string;
  activeWindowLabel?: string;
}

export interface SchedulerTaskRunSummary {
  status: "success" | "failed" | "skipped";
  resultSummary?: Record<string, unknown>;
  errorMessage?: string;
}
