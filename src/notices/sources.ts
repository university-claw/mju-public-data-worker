import type { NoticeSource } from "./types.js";

export const NOTICE_SOURCES: NoticeSource[] = [
  {
    id: "general",
    name: "일반공지",
    description: "명지대학교 대학생활 일반공지 게시판",
    listUrl: "https://www.mju.ac.kr/mjukr/255/subview.do",
  },
  {
    id: "scholarship",
    name: "장학/학자금공지",
    description: "명지대학교 장학 및 학자금 공지 게시판",
    listUrl: "https://www.mju.ac.kr/mjukr/259/subview.do",
  },
  {
    id: "event",
    name: "행사공지",
    description: "명지대학교 행사 공지 게시판",
    listUrl: "https://www.mju.ac.kr/mjukr/256/subview.do",
  },
  {
    id: "career",
    name: "진로/취업/창업공지",
    description: "명지대학교 진로 및 취업 공지 게시판",
    listUrl: "https://www.mju.ac.kr/mjukr/260/subview.do",
  },
];
