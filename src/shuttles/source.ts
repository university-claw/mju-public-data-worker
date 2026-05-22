import type { NoticeSource } from "../notices/types.js";

const DEFAULT_GENERAL_NOTICE_URL = "https://www.mju.ac.kr/mjukr/255/subview.do";
const DEFAULT_SITE_ID = "mjukr";
const DEFAULT_BOARD_ID = "141";

export function buildMjuBoardSearchUrl(params?: {
  baseUrl?: string;
  siteId?: string;
  boardId?: string;
  keyword?: string;
}): string {
  const baseUrl = params?.baseUrl ?? DEFAULT_GENERAL_NOTICE_URL;
  const siteId = params?.siteId ?? DEFAULT_SITE_ID;
  const boardId = params?.boardId ?? DEFAULT_BOARD_ID;
  const keyword = params?.keyword ?? "셔틀";
  const innerPath =
    `/bbs/${siteId}/${boardId}/artclList.do?` +
    `bbsClSeq=&bbsOpenWrdSeq=&isViewMine=false&isView=true&` +
    `srchColumn=sj&srchWrd=${keyword}&`;
  const payload = `fnct1|@@|${encodeURIComponent(innerPath)}`;
  const enc = Buffer.from(payload, "utf8").toString("base64");
  const url = new URL(baseUrl);
  url.searchParams.set("enc", enc);
  return url.toString();
}

export const SHUTTLE_NOTICE_SOURCE: NoticeSource = {
  id: "general",
  name: "일반공지 셔틀 검색",
  description: "명지대학교 일반공지 게시판에서 제목에 셔틀이 포함된 게시물 검색 결과",
  listUrl: buildMjuBoardSearchUrl(),
};
