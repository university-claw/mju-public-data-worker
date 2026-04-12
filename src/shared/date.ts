/**
 * 명지대 게시판 날짜 문자열을 KST 기준으로 해석한 뒤 UTC ISO 문자열로 바꾼다.
 * DB에는 timestamptz로 넣을 예정이라, 입력 시점부터 시간대를 명확히 고정한다.
 *
 * 현재 학교 HTML 목록은 `YYYY.MM.DD` 계열을 주로 쓰지만, RSS나 다른 공개
 * 피드는 `Fri, 10 Apr 2026 10:35:32 +0900` 같은 RFC 날짜를 줄 수도 있다.
 * 그래서 한국 게시판 전용 포맷을 먼저 처리하고, 실패하면 표준 Date 파서로
 * 한 번 더 받아들이는 순서로 둔다.
 */
export function parseKoreanDateToIso(input: string): string {
  const trimmed = input.trim();
  const match =
    /^(\d{2,4})[.\-/](\d{1,2})[.\-/](\d{1,2})(?:[\sT](\d{1,2}):(\d{1,2})(?::(\d{1,2})(?:\.\d+)?)?)?$/.exec(
      trimmed,
    );

  if (!match) {
    const parsedEpochMs = Date.parse(trimmed);
    if (Number.isFinite(parsedEpochMs)) {
      return new Date(parsedEpochMs).toISOString();
    }

    throw new Error(`unrecognized korean date format: "${input}"`);
  }

  let year = Number(match[1]);
  if ((match[1] ?? "").length === 2) {
    year += 2000;
  }

  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4] ?? "0");
  const minute = Number(match[5] ?? "0");
  const second = Number(match[6] ?? "0");

  const kstEpochMs = Date.UTC(year, month - 1, day, hour, minute, second);
  const utcEpochMs = kstEpochMs - 9 * 60 * 60 * 1000;
  return new Date(utcEpochMs).toISOString();
}
