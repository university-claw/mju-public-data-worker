import type { NoticeListItem } from "../notices/types.js";
import type { CurrentAcademicTerm, ShuttleNoticeCandidate } from "./types.js";

const SHUTTLE_KEYWORD_PATTERN = /(셔틀|통학|버스)/u;

export function resolveCurrentAcademicTerm(now = new Date()): CurrentAcademicTerm {
  const year = now.getFullYear();
  const month = now.getMonth() + 1;

  if (month >= 3 && month <= 8) {
    return {
      academicYear: year,
      termLabel: "1학기",
    };
  }

  if (month >= 9) {
    return {
      academicYear: year,
      termLabel: "2학기",
    };
  }

  return {
    academicYear: year - 1,
    termLabel: "2학기",
  };
}

export function scoreShuttleNotice(
  item: Pick<NoticeListItem, "title" | "publishedAt">,
  term: CurrentAcademicTerm,
): number {
  const title = item.title.replace(/\s+/g, " ").trim();
  if (!SHUTTLE_KEYWORD_PATTERN.test(title)) {
    return -1;
  }

  let score = 0;
  if (/셔틀/u.test(title)) {
    score += 6;
  }
  if (/통학/u.test(title)) {
    score += 4;
  }
  if (/버스/u.test(title)) {
    score += 2;
  }
  if (title.includes(`${term.academicYear}학년도`)) {
    score += 8;
  }
  if (title.includes(`${term.academicYear}년`)) {
    score += 5;
  }
  if (title.includes(term.termLabel)) {
    score += 7;
  }
  if (/학기\s*중/u.test(title)) {
    score += 3;
  }
  if (/운행\s*(안내|시간표|변경)/u.test(title)) {
    score += 3;
  }
  if (/계절\s*학기/u.test(title)) {
    score -= 4;
  }
  if (/휴무|중단|임시/u.test(title)) {
    score -= 2;
  }

  return score;
}

export function selectCurrentSemesterShuttleNotice(
  items: NoticeListItem[],
  now = new Date(),
): ShuttleNoticeCandidate | null {
  const term = resolveCurrentAcademicTerm(now);
  const candidates = items
    .map((item) => ({
      ...item,
      score: scoreShuttleNotice(item, term),
    }))
    .filter((item) => item.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }

      return Date.parse(b.publishedAt) - Date.parse(a.publishedAt);
    });

  const selected = candidates[0];
  if (!selected) {
    return null;
  }

  return {
    sourceId: selected.sourceId,
    externalId: selected.externalId,
    title: selected.title,
    detailUrl: selected.detailUrl,
    publishedAt: selected.publishedAt,
    publishedAtRaw: selected.publishedAtRaw,
    score: selected.score,
  };
}
