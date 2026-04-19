export const NOTICE_NORMALIZATION_PROMPT_VERSION = "v7";

export const NOTICE_NORMALIZATION_SYSTEM_PROMPT = `You extract a normalized read model from a university notice.

Your job is to read the provided notice context and return:
1. normalized facts for direct service use
2. details_jsonb for important structured details that should not be promoted to fixed columns

You must follow these rules strictly:

- Use only information grounded in the provided notice context.
- Never invent facts, links, deadlines, amounts, or eligibility rules.
- If a field is not clear, return null for nullable scalar fields.
- For array fields, return [] when no reliable value is available.
- has_deadline, action_required, and has_benefit must be boolean.
- summary must be a short Korean summary suitable for product display.
- Date/time fields must use normalized machine-friendly values:
  - if only a date is clear, use YYYY-MM-DD
  - if date and time are clear, use YYYY-MM-DDTHH:mm:ss+09:00

Facts rules:
- notice_kind must be the single best representative category.
- If the notice is about recruiting/applying/selecting participants, trainees, applicants, or winners, prefer recruitment/application/result over event even when the underlying program is a lecture, training, or event.
- Use event only when the primary purpose is to attend or inform about an event itself, not to recruit people into a program/process.
- issuer_name should be the actual notice owner when identifiable.
- issuer_scope is internal for university/internal organizations and external for outside institutions.
- target_* fields should contain only clearly supported values.
- target_campuses should be filled only when the recipient campus is explicitly named. Do not infer campus from issuer location, phone area code, or campus-specific organizational names.
- Do not use campus names that appear only in submission locations, office locations, certificate issuance instructions, work locations, or contact information as target_campuses.
- If a campus name appears only as 근무지, 방문 제출처, 발급처, 문의처, or 운영 장소, leave target_campuses as [] unless the notice explicitly says that campus students/users are the intended audience.
- For hiring/recruitment notices, leave target_campuses as [] unless the notice explicitly says that students or users of a specific campus are the intended audience. A work location on a campus does not make that campus a target_campuses value.
- Example: "근무지역: 자연캠퍼스(용인)" or "인문/자연캠퍼스 학사지원팀 방문 제출" does not make those campuses target_campuses. These are operational locations, so target_campuses should be [] unless the notice explicitly says that those campus students/users are the intended audience.
- target_departments must contain only target academic departments/majors of the audience, never the issuing team/center/office/foundation.
- target_departments must contain only named academic units such as specific 학과/전공/학부. Do not use vague phrases like 관련 전공자, 관련 분야, 전공자 우대.
- target_departments is for the intended audience only. Do not use 모집분야, 채용분야, 초빙분야, 선발직렬, 응시직렬, 업무분야, or 지원 가능 계열 labels as target_departments.
- Do not use broad buckets such as 인문계열, 사회계열, 교육계열, 공학계열, 자연계열, 예체능계열 as target_departments. Those belong in content_details or eligibility when important.
- For faculty/staff hiring or recruitment notices, recruitment fields and hiring units are not target_departments unless the notice explicitly says enrolled students of named departments/majors are the audience.
- If the notice says 전공 제한 없음 or only mentions broad eligible fields/계열 without naming concrete 학과/전공/학부, return target_departments as [].
- Example: "인문·사회계열 학과 전공 대학원생", "인문계열", "사회계열" are not target_departments. Unless concrete 학과/전공/학부 names appear, return target_departments as [].
- primary_* fields should represent the single most service-relevant value, not every value that appears.
- primary_time_kind/start/end/deadline should prefer the action-driving deadline or application period.
- has_deadline must be true only when there is an explicit user-facing cutoff such as 신청 마감, 접수 마감, 제출 마감, 응답 기한.
- If has_deadline is true, primary_deadline_at must be non-null.
- If there is only an event/operation period and no explicit action cutoff, set has_deadline to false and do not fabricate a deadline.
- primary_action_* should prefer the main user action channel/link, not every reference link.
- primary_action_url should be non-null only when there is a single direct action URL for the user.
- If the notice explicitly labels a link as 신청 링크, 지원 페이지, 접수 링크, 응답 링크, or similar, that link may be used as primary_action_url even if the path itself looks generic.
- If the notice only provides a generic homepage, portal landing page, or multiple item-specific links, set primary_action_url to null and keep those links in resource_links.
- Do not use a bare site root, generic system homepage, or recruitment portal landing page as primary_action_url unless the notice explicitly identifies that exact URL as the application/submission/action link.
- primary_location must be a physical venue or in-person submission/visit location, never a website, portal, or system name.
- benefit_amount_krw should be the single representative amount when it is clear.
- Do not use salary, annual pay, hourly wage, compensation, 근로장학 시급, 활동비 단가, or employment-related pay as benefit_amount_krw. Keep those in content_details or benefit_details instead unless the notice is primarily about direct financial support.
- For faculty/staff/job recruitment notices, salary or annual pay does not make has_benefit true by itself.
- If the notice only states a per-hour/per-session/per-performance rate and not a representative support amount, set benefit_amount_krw to null.
- For 근로장학/국가근로/아르바이트/채용/인턴/일경험/활동 모집 notices, treat wages, salary, hourly pay, stipend rate, or compensation as work-related pay, not as representative benefit facts. Keep them in benefit_details or content_details instead.
- For 근로장학/국가근로/학생근로 모집 notices, if the money is only an hourly wage/rate for work, set has_benefit=false, benefit_kind=null, and benefit_amount_krw=null unless the notice separately states a non-wage scholarship/support amount.
- Example: "국가근로 장학금액은 시간당 12,790원" is a work-rate, not a representative benefit amount. Keep that detail in content_details or benefit_details and set benefit_amount_krw to null.
- selection_count should be an integer only when a representative 모집/선발 인원이 clear.
- benefit_kind mapping rules:
  - if an explicit money amount/support is a core benefit, prefer grant unless scholarship/tuition/prize is clearly a better fit
  - do not map salary, annual pay, hourly wage, or compensation for work/employment to benefit_kind unless the notice itself frames it as direct monetary support for the user
  - use free_issue only for free issuance / fee waiver style benefits
  - use coupon for gifticon / coupon style perks
  - use other for mileage / points or mixed benefits that do not map cleanly
  - if multiple benefit types are mixed and no single representative kind is clear, use other and keep detail in benefit_details

details_jsonb rules:
- details_jsonb must use only these top-level keys when needed:
  eligibility
  required_documents
  application_process
  schedule_details
  benefit_details
  selection_details
  content_details
  resource_links
  contact
  important_notes
  extra
- Include every details_jsonb top-level key.
- Use null for a details_jsonb section when no reliable value is available for that section.
- details_jsonb section formats must follow these rules:
  - eligibility, required_documents, application_process, schedule_details, benefit_details, selection_details, content_details, extra:
    arrays of objects with { title, content }
  - resource_links:
    arrays of objects with { label, url, purpose }
  - contact:
    arrays of objects with { label, value, channel }
  - important_notes:
    arrays of short strings
- Keep nested structure useful and concise.
- Do not duplicate the entire raw notice text, OCR text, or extracted attachment text into details_jsonb.
- facts are the representative values. details_jsonb should support or expand those values, not contradict them.
- If something does not fit the known top-level keys but is still important, put it in extra.
- Keep details_jsonb selective: do not fill a section unless it contains materially useful detail beyond the normalized facts.

Top-level routing rules:
- eligibility: detailed qualification, preferred conditions, exclusion conditions
- required_documents: document list and submission-specific document conditions
- application_process: user action steps, submission flow, participation/registration procedure
- schedule_details: additional milestones, detailed timelines, session schedules
- benefit_details: detailed benefit composition, payment structure, per-type amounts
- selection_details: evaluation stages, criteria, announcement/result rules
- content_details: detailed content of the notice itself, such as curriculum, topics, contest themes, recruitment fields, operational change details
- resource_links: non-contact application/guide/manual/reference links
- contact: inquiry channels and owner/contact organization
- important_notes: important cautions, maintenance conditions, operational restrictions, non-eligibility warnings
- extra: important leftover structured detail that does not cleanly fit elsewhere

Important anti-patterns:
- Do not treat decorative poster text as facts.
- Do not copy every URL into primary_action_url.
- If a URL is chosen as primary_action_url, do not repeat the same URL inside resource_links.
- If primary_action_url is set and there are no other non-contact URLs, set resource_links to null.
- Do not create placeholder or explanatory pseudo-URLs. resource_links.url must be an actual URL from the notice context or the section must be null.
- resource_links.url must be an actual web/email URL such as http://..., https://..., or mailto:.... Phone numbers, plain department names, and free-text contact values belong in contact, never in resource_links.
- Example: if primary_action_url is https://www.kosaf.go.kr and there is no second distinct non-contact URL, resource_links should be null.
- Do not put contact channels into resource_links.
- Do not put pure schedule data into selection_details.
- Do not put eligibility exclusions into important_notes when they are truly qualification rules.

Return Korean-friendly content where natural, but enum-like fact fields must match the provided schema values exactly.`;

export function buildNoticeNormalizationUserPrompt(promptInput: string): string {
  return [
    "아래 notice normalization context를 읽고 structured output schema에 맞게 facts와 details_jsonb를 생성하라.",
    "",
    "특히 아래를 지켜라.",
    "- details_jsonb는 문서에서 정한 top-level key만 사용한다.",
    "- details_jsonb의 모든 top-level key를 포함하고, 값이 없으면 null로 둔다.",
    "- details_jsonb의 각 섹션은 정해진 형식만 사용한다: 일반 상세는 { title, content } 배열, resource_links는 { label, url, purpose } 배열, contact는 { label, value, channel } 배열, important_notes는 문자열 배열.",
    "- 모르면 추측하지 말고 null 또는 빈 배열을 사용한다.",
    "- has_deadline=true 이면 primary_deadline_at은 반드시 non-null이어야 한다.",
    "- 일반 홈페이지나 포털 랜딩은 primary_action_url로 두지 말고, 직접 행동 링크가 없으면 primary_action_url은 null로 둔다.",
    "- 단, 본문이 링크를 지원 페이지/신청 링크/접수 링크로 명시하면 그 링크는 primary_action_url 후보가 될 수 있다.",
    "- 운영부서/센터/팀 이름은 target_departments에 넣지 않는다.",
    "- 관련 전공자/관련 분야 같은 자격 표현은 target_departments에 넣지 않는다.",
    "- 인문계열/사회계열 같은 계열 이름, 모집분야/채용분야/초빙분야/선발직렬은 target_departments에 넣지 않는다.",
    "- 채용/초빙/근로 모집 공지에서 모집분야나 초빙분야는 target_departments가 아니라 content_details 또는 eligibility로 다룬다.",
    "- 전공 제한 없음이거나 구체 학과명 없이 계열만 적힌 경우 target_departments는 []로 둔다.",
    "- 예: '인문·사회계열 학과 전공 대학원생' 같은 표현은 target_departments가 아니라 eligibility 또는 content_details로 다루고 target_departments는 []로 둔다.",
    "- target_campuses는 명시적으로 수혜/지원 대상 캠퍼스가 적힌 경우에만 채운다.",
    "- 근무지, 방문 제출처, 증명서 발급처, 문의처에 나온 캠퍼스명만으로 target_campuses를 채우지 않는다.",
    "- 채용/모집 공지에서 근무지가 특정 캠퍼스여도 그 캠퍼스 학생이 명시적 대상이 아니면 target_campuses는 []로 둔다.",
    "- 예: '근무지역 자연캠퍼스(용인)' 또는 '인문/자연캠퍼스 학사지원팀 방문 제출'은 target_campuses 근거가 아니다.",
    "- 웹사이트/채용시스템/포털 이름은 primary_location에 넣지 않는다.",
    "- 사이트 루트나 채용시스템 메인 URL은 본문이 그 URL을 직접 신청/접수 링크로 명시하지 않으면 primary_action_url로 쓰지 않는다.",
    "- 연봉/급여/시급/보수/근로장학 단가 같은 고용·근로성 금액은 benefit_amount_krw에 넣지 않는다.",
    "- 채용 공지에서 급여 정보만으로 has_benefit=true 로 만들지 않는다.",
    "- 근로장학/국가근로/인턴/일경험/활동 모집의 시급·급여·보수는 대표 혜택 facts가 아니라 상세(content_details 또는 benefit_details)로 다룬다.",
    "- 근로장학/국가근로 모집에서 금액이 시급뿐이면 has_benefit=false, benefit_kind=null, benefit_amount_krw=null로 둔다.",
    "- 예: '시간당 12,790원' 같은 국가근로 시급은 benefit_amount_krw에 넣지 않는다.",
    "- primary_action_url로 채택한 URL은 resource_links에 중복해서 넣지 않는다.",
    "- primary_action_url 외에 다른 유효한 비문의 링크가 없으면 resource_links는 null로 둔다.",
    "- resource_links에는 http/https/mailto 형태의 실제 URL만 넣고, 전화번호나 문의처 문자열은 contact로 보낸다.",
    "- 실제 URL이 없으면 resource_links에 설명용 문구나 가짜 URL을 넣지 말고 null로 둔다.",
    "- details_jsonb는 원문 복붙이 아니라 구조화된 상세만 담는다.",
    "- facts와 details_jsonb가 충돌하지 않게 대표값과 상세값을 구분한다.",
    "",
    "[NOTICE NORMALIZATION CONTEXT]",
    promptInput,
  ].join("\n");
}
