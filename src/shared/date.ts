/**
 * 명지대 게시판 날짜 문자열을 KST 기준으로 해석한 뒤 UTC ISO 문자열로 바꾼다.
 * DB에는 timestamptz로 넣을 예정이라, 입력 시점부터 시간대를 명확히 고정한다.
 */
export function parseKoreanDateToIso(input: string): string {
  const trimmed = input.trim();
  const match =
    /^(\d{2,4})[.\-/](\d{1,2})[.\-/](\d{1,2})(?:[\sT](\d{1,2}):(\d{1,2})(?::(\d{1,2})(?:\.\d+)?)?)?$/.exec(
      trimmed,
    );

  if (!match) {
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
