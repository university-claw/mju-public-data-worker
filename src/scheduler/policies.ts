import type { SchedulerTaskDefinition } from "./types.js";

export const SCHEDULER_TASKS: SchedulerTaskDefinition[] = [
  {
    taskKey: "notices/all",
    name: "공지 전체 수집",
    description: "공지 4종 게시판을 6시간 간격으로 수집한다.",
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
    taskKey: "cafeterias/student-hall-weekday",
    name: "학생회관 주중 식단 감지",
    description:
      "학생회관 주중 식단표 업로드 창(일요일/월요일/화요일)에 신규 게시물을 감지한다.",
    collectorType: "cafeteria-instagram",
    taskType: "cafeteria-source-check",
    active: true,
    schedule: {
      kind: "weekly_windows",
      windows: [
        { dayOfWeek: 0, start: "14:00", end: "23:00", intervalMinutes: 30, label: "sun-primary" },
        { dayOfWeek: 1, start: "08:00", end: "14:00", intervalMinutes: 120, label: "mon-retry" },
        { dayOfWeek: 2, start: "12:00", end: "15:00", intervalMinutes: 60, label: "tue-safety" },
      ],
    },
    cafeteriaSourceId: "student-hall",
    cafeteriaLimit: 10,
  },
  {
    taskKey: "cafeterias/student-hall-weekend",
    name: "학생회관 주말 식단 감지",
    description:
      "학생회관 주말 식단표 업로드 창(금요일 밤, 토요일 아침)을 집중 확인한다.",
    collectorType: "cafeteria-instagram",
    taskType: "cafeteria-source-check",
    active: true,
    schedule: {
      kind: "weekly_windows",
      windows: [
        { dayOfWeek: 5, start: "21:00", end: "23:30", intervalMinutes: 30, label: "fri-primary" },
        { dayOfWeek: 6, start: "06:30", end: "10:00", intervalMinutes: 30, label: "sat-retry" },
        { dayOfWeek: 6, start: "11:30", end: "11:31", intervalMinutes: 60, label: "sat-safety" },
      ],
    },
    cafeteriaSourceId: "student-hall",
    cafeteriaLimit: 10,
  },
  {
    taskKey: "cafeterias/myeongjin-weekday",
    name: "명진당 주중 식단 감지",
    description:
      "명진당 주중 식단표 업로드 창(토요일 보조, 일요일 메인, 월/화 안전망)을 확인한다.",
    collectorType: "cafeteria-instagram",
    taskType: "cafeteria-source-check",
    active: true,
    schedule: {
      kind: "weekly_windows",
      windows: [
        { dayOfWeek: 6, start: "15:00", end: "18:00", intervalMinutes: 60, label: "sat-early" },
        { dayOfWeek: 0, start: "15:00", end: "21:00", intervalMinutes: 30, label: "sun-primary" },
        { dayOfWeek: 1, start: "07:00", end: "10:00", intervalMinutes: 60, label: "mon-retry" },
        { dayOfWeek: 2, start: "07:00", end: "07:01", intervalMinutes: 60, label: "tue-safety" },
      ],
    },
    cafeteriaSourceId: "myeongjin",
    cafeteriaLimit: 10,
  },
  {
    taskKey: "cafeterias/bokji-weekday",
    name: "복지동 주중 식단 감지",
    description:
      "복지동 주중 식단표 업로드 창(월요일 오전 중심)을 확인한다.",
    collectorType: "cafeteria-instagram",
    taskType: "cafeteria-source-check",
    active: true,
    schedule: {
      kind: "weekly_windows",
      windows: [
        { dayOfWeek: 1, start: "09:00", end: "10:30", intervalMinutes: 20, label: "mon-primary" },
        { dayOfWeek: 1, start: "12:00", end: "12:01", intervalMinutes: 60, label: "mon-retry" },
        { dayOfWeek: 2, start: "09:00", end: "10:00", intervalMinutes: 30, label: "tue-safety" },
      ],
    },
    cafeteriaSourceId: "bokji",
    cafeteriaLimit: 10,
  },
  {
    taskKey: "cafeterias/bangmok-weekday",
    name: "방목기념관 주중 식단 감지",
    description:
      "방목기념관 주중 식단표 업로드 창(토요일 밤/일요일 선공개, 월요일 오전)을 확인한다.",
    collectorType: "cafeteria-instagram",
    taskType: "cafeteria-source-check",
    active: true,
    schedule: {
      kind: "weekly_windows",
      windows: [
        { dayOfWeek: 6, start: "20:30", end: "22:30", intervalMinutes: 30, label: "sat-early" },
        { dayOfWeek: 0, start: "09:30", end: "13:00", intervalMinutes: 30, label: "sun-early" },
        { dayOfWeek: 1, start: "09:00", end: "11:30", intervalMinutes: 30, label: "mon-primary" },
        { dayOfWeek: 1, start: "13:00", end: "13:01", intervalMinutes: 60, label: "mon-safety" },
      ],
    },
    cafeteriaSourceId: "bangmok",
    cafeteriaLimit: 10,
  },
  {
    taskKey: "cafeterias/official-pages-current",
    name: "학식 공식 페이지 후행 정정",
    description:
      "학교 식단표 페이지 4개를 6시간 간격으로 확인해서 현재 주 식단을 후행 정정한다.",
    collectorType: "cafeteria-official-pages",
    taskType: "cafeteria-official-refresh",
    active: true,
    schedule: {
      kind: "fixed_interval",
      intervalHours: 6,
    },
    cafeteriaOfficialIncludePreviousWeek: false,
  },
  {
    taskKey: "shuttles/current-semester",
    name: "현재 학기 셔틀 시간표 수집",
    description:
      "일반공지의 셔틀 검색 결과에서 현재 학기 운행 안내를 찾아 셔틀 시간표 read model을 갱신한다.",
    collectorType: "shuttles",
    taskType: "shuttle-current-semester",
    active: true,
    schedule: {
      kind: "fixed_interval",
      intervalHours: 6,
    },
    noticeLimit: 20,
  },
];
