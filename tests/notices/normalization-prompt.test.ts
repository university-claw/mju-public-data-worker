import { describe, expect, it } from "vitest";
import {
  buildNoticeNormalizationUserPrompt,
  NOTICE_NORMALIZATION_PROMPT_VERSION,
  NOTICE_NORMALIZATION_SYSTEM_PROMPT,
} from "../../src/notices/normalization-prompt.js";

describe("notice normalization prompt", () => {
  it("tracks the initial prompt version", () => {
    expect(NOTICE_NORMALIZATION_PROMPT_VERSION).toBe("v2");
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
    expect(prompt).toContain("resource_links는 { label, url, purpose } 배열");
  });
});
