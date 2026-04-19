import { describe, expect, it } from "vitest";
import {
  buildNoticeNormalizationUserPrompt,
  NOTICE_NORMALIZATION_PROMPT_VERSION,
  NOTICE_NORMALIZATION_SYSTEM_PROMPT,
} from "../../src/notices/normalization-prompt.js";

describe("notice normalization prompt", () => {
  it("tracks the initial prompt version", () => {
    expect(NOTICE_NORMALIZATION_PROMPT_VERSION).toBe("v7");
  });

  it("includes core extraction and anti-hallucination rules", () => {
    expect(NOTICE_NORMALIZATION_SYSTEM_PROMPT).toContain(
      "Never invent facts, links, deadlines, amounts, or eligibility rules.",
    );
    expect(NOTICE_NORMALIZATION_SYSTEM_PROMPT).toContain(
      "details_jsonb must use only these top-level keys when needed:",
    );
    expect(NOTICE_NORMALIZATION_SYSTEM_PROMPT).toContain(
      "has_deadline must be true only when there is an explicit user-facing cutoff",
    );
    expect(NOTICE_NORMALIZATION_SYSTEM_PROMPT).toContain(
      "target_departments must contain only target academic departments/majors of the audience",
    );
    expect(NOTICE_NORMALIZATION_SYSTEM_PROMPT).toContain(
      "Do not use broad buckets such as 인문계열, 사회계열, 교육계열, 공학계열, 자연계열, 예체능계열 as target_departments.",
    );
    expect(NOTICE_NORMALIZATION_SYSTEM_PROMPT).toContain(
      "If the notice says 전공 제한 없음 or only mentions broad eligible fields/계열 without naming concrete 학과/전공/학부, return target_departments as [].",
    );
    expect(NOTICE_NORMALIZATION_SYSTEM_PROMPT).toContain(
      "Do not use campus names that appear only in submission locations, office locations, certificate issuance instructions, work locations, or contact information as target_campuses.",
    );
    expect(NOTICE_NORMALIZATION_SYSTEM_PROMPT).toContain(
      "For hiring/recruitment notices, leave target_campuses as [] unless the notice explicitly says that students or users of a specific campus are the intended audience.",
    );
    expect(NOTICE_NORMALIZATION_SYSTEM_PROMPT).toContain(
      "근무지역: 자연캠퍼스(용인)",
    );
    expect(NOTICE_NORMALIZATION_SYSTEM_PROMPT).toContain(
      "Do not use salary, annual pay, hourly wage, compensation, 근로장학 시급, 활동비 단가, or employment-related pay as benefit_amount_krw.",
    );
    expect(NOTICE_NORMALIZATION_SYSTEM_PROMPT).toContain(
      "For 근로장학/국가근로/학생근로 모집 notices, if the money is only an hourly wage/rate for work, set has_benefit=false, benefit_kind=null, and benefit_amount_krw=null",
    );
    expect(NOTICE_NORMALIZATION_SYSTEM_PROMPT).toContain(
      "Do not use a bare site root, generic system homepage, or recruitment portal landing page as primary_action_url",
    );
    expect(NOTICE_NORMALIZATION_SYSTEM_PROMPT).toContain(
      "Do not create placeholder or explanatory pseudo-URLs.",
    );
    expect(NOTICE_NORMALIZATION_SYSTEM_PROMPT).toContain(
      "If a URL is chosen as primary_action_url, do not repeat the same URL inside resource_links.",
    );
    expect(NOTICE_NORMALIZATION_SYSTEM_PROMPT).toContain(
      "If primary_action_url is set and there are no other non-contact URLs, set resource_links to null.",
    );
    expect(NOTICE_NORMALIZATION_SYSTEM_PROMPT).toContain(
      "resource_links.url must be an actual web/email URL such as http://..., https://..., or mailto:....",
    );
    expect(NOTICE_NORMALIZATION_SYSTEM_PROMPT).toContain(
      "prefer recruitment/application/result over event",
    );
    expect(NOTICE_NORMALIZATION_SYSTEM_PROMPT).toContain(
      "use coupon for gifticon / coupon style perks",
    );
    expect(NOTICE_NORMALIZATION_SYSTEM_PROMPT).toContain(
      "primary_location must be a physical venue or in-person submission/visit location",
    );
    expect(NOTICE_NORMALIZATION_SYSTEM_PROMPT).toContain(
      "Include every details_jsonb top-level key.",
    );
    expect(NOTICE_NORMALIZATION_SYSTEM_PROMPT).toContain(
      "arrays of objects with { title, content }",
    );
    expect(NOTICE_NORMALIZATION_SYSTEM_PROMPT).toContain(
      "arrays of objects with { label, url, purpose }",
    );
    expect(NOTICE_NORMALIZATION_SYSTEM_PROMPT).toContain(
      "facts are the representative values.",
    );
  });

  it("wraps the assembled context in a user instruction block", () => {
    const prompt = buildNoticeNormalizationUserPrompt("[NOTICE TITLE]\ntitle: 테스트");

    expect(prompt).toContain("[NOTICE NORMALIZATION CONTEXT]");
    expect(prompt).toContain("[NOTICE TITLE]");
    expect(prompt).toContain("details_jsonb는 문서에서 정한 top-level key만 사용한다.");
    expect(prompt).toContain("값이 없으면 null로 둔다.");
    expect(prompt).toContain("일반 홈페이지나 포털 랜딩은 primary_action_url로 두지 말고");
    expect(prompt).toContain("관련 전공자/관련 분야 같은 자격 표현은 target_departments에 넣지 않는다.");
    expect(prompt).toContain("계열 이름, 모집분야/채용분야/초빙분야/선발직렬은 target_departments에 넣지 않는다.");
    expect(prompt).toContain("전공 제한 없음이거나 구체 학과명 없이 계열만 적힌 경우 target_departments는 []로 둔다.");
    expect(prompt).toContain("근무지, 방문 제출처, 증명서 발급처, 문의처에 나온 캠퍼스명만으로 target_campuses를 채우지 않는다.");
    expect(prompt).toContain("채용/모집 공지에서 근무지가 특정 캠퍼스여도 그 캠퍼스 학생이 명시적 대상이 아니면 target_campuses는 []로 둔다.");
    expect(prompt).toContain("예: '근무지역 자연캠퍼스(용인)' 또는 '인문/자연캠퍼스 학사지원팀 방문 제출'은 target_campuses 근거가 아니다.");
    expect(prompt).toContain("사이트 루트나 채용시스템 메인 URL은 본문이 그 URL을 직접 신청/접수 링크로 명시하지 않으면 primary_action_url로 쓰지 않는다.");
    expect(prompt).toContain("연봉/급여/시급/보수/근로장학 단가 같은 고용·근로성 금액은 benefit_amount_krw에 넣지 않는다.");
    expect(prompt).toContain("근로장학/국가근로 모집에서 금액이 시급뿐이면 has_benefit=false, benefit_kind=null, benefit_amount_krw=null로 둔다.");
    expect(prompt).toContain("예: '시간당 12,790원' 같은 국가근로 시급은 benefit_amount_krw에 넣지 않는다.");
    expect(prompt).toContain("primary_action_url로 채택한 URL은 resource_links에 중복해서 넣지 않는다.");
    expect(prompt).toContain("primary_action_url 외에 다른 유효한 비문의 링크가 없으면 resource_links는 null로 둔다.");
    expect(prompt).toContain("resource_links에는 http/https/mailto 형태의 실제 URL만 넣고, 전화번호나 문의처 문자열은 contact로 보낸다.");
    expect(prompt).toContain("실제 URL이 없으면 resource_links에 설명용 문구나 가짜 URL을 넣지 말고 null로 둔다.");
    expect(prompt).toContain("resource_links는 { label, url, purpose } 배열");
  });
});
