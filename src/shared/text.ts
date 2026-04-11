/**
 * HTML에서 나온 줄바꿈/여러 공백을 사람 읽기 좋은 한 줄 문자열로 정리한다.
 * 공지 제목, 파일명, 작성자처럼 "표시용 텍스트"는 거의 항상 이 정리를 거친다.
 */
export function collapseWhitespace(input: string): string {
  return input.replace(/\s+/g, " ").trim();
}
