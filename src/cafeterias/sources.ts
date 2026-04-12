import type { CafeteriaInstagramSource } from "./types.js";

/**
 * 학식 인스타 계정은 식당마다 따로 운영되지만, 실제 메뉴 이미지는 두 그룹으로
 * 공유된다. 이 메타데이터를 source 정의에 같이 두면, 나중에 OCR/정규화 단계에서
 * "어느 계정이 같은 원본 이미지를 재사용하는지"를 별도 하드코딩 없이 참조할 수 있다.
 */
export const CAFETERIA_INSTAGRAM_SOURCES: CafeteriaInstagramSource[] = [
  {
    id: "student-hall",
    name: "학생회관",
    description: "명지대 자연캠퍼스 학생회관 학식 인스타 계정",
    profileUrl: "https://www.instagram.com/mjhs_yongin/",
    instagramUsername: "mjhs_yongin",
    menuImageGroup: "student-hall-myeongjin",
    supportsWeekendMenu: true,
  },
  {
    id: "myeongjin",
    name: "명진당",
    description: "명지대 자연캠퍼스 명진당 학식 인스타 계정",
    profileUrl: "https://www.instagram.com/mju_lounge/",
    instagramUsername: "mju_lounge",
    menuImageGroup: "student-hall-myeongjin",
    supportsWeekendMenu: false,
  },
  {
    id: "bokji",
    name: "복지동",
    description: "명지대 자연캠퍼스 복지동 생활관 식당 인스타 계정",
    profileUrl: "https://www.instagram.com/mj_bokji_foodist/",
    instagramUsername: "mj_bokji_foodist",
    menuImageGroup: "bokji-bangmok",
    supportsWeekendMenu: false,
  },
  {
    id: "bangmok",
    name: "방목기념관",
    description: "명지대 자연캠퍼스 방목기념관 직원식당 인스타 계정",
    profileUrl: "https://www.instagram.com/mj_bangmok_foodist/",
    instagramUsername: "mj_bangmok_foodist",
    menuImageGroup: "bokji-bangmok",
    supportsWeekendMenu: false,
  },
];
