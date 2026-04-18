# Notice Read Model details_jsonb 저장 원칙 및 Payload 구조 분석

## 문서 목적

이 문서는 notice read model의 `details_jsonb`에 무엇을 어떤 방식으로 저장할지, 실제 공지 샘플을 다시 읽어본 결과를 바탕으로 정리하기 위한 문서이다.

이번 문서의 범위는 아래에 집중한다.

- 실제 저장된 notice 본문, 첨부 추출 텍스트, 이미지 OCR 텍스트를 다시 읽고
- `normalized facts`로 승격되지 않았지만 서비스에서 상세 설명에 계속 필요한 정보가 무엇인지 분류하고
- 그 결과를 `details_jsonb`의 **저장 원칙**과 **top-level payload 구조**로 정리

이번 문서에서 결정하지 않는 것은 아래와 같다.

- LLM 프롬프트의 최종 문안
- `details_jsonb` 하위 key를 공지 종류별로 완전 고정하는 일
- provenance/raw 계층의 세부 스키마 변경

즉 이번 슬라이스의 목표는 **JSONB 계층을 완전 자유형 blob으로 두지 않고, 서비스와 worker가 안정적으로 다룰 수 있는 반구조화 payload로 정리하는 것**이다.

---

## 빠른 요약

현재 기준으로 `details_jsonb`의 top-level payload는 아래와 같이 두는 것이 가장 적절하다.

| top-level key | 저장할 의미 |
| --- | --- |
| `eligibility` | 세부 자격요건, 우대조건, 제외조건 |
| `required_documents` | 제출 서류 상세 목록 |
| `application_process` | 신청/접수/참여/제출 절차와 방법 |
| `schedule_details` | 대표 시간축 외 추가 일정, 세부 마일스톤, 세션별 일정 |
| `benefit_details` | 대표 금액 외 혜택 상세, 지급 방식/기간/구성 |
| `selection_details` | 선발 절차, 심사 단계, 평가 기준, 합격 발표 관련 정보 |
| `content_details` | 행사/교육/공모전/채용/운영 변경 등 공지 본체의 세부 내용 |
| `resource_links` | 문의처 외 신청/안내/매뉴얼/참고 링크 |
| `contact` | 문의처, 담당자, 연락 방법 |
| `important_notes` | 유의사항, 참여/수혜 유지 조건, 운영상 주의사항 |
| `extra` | 위 key로 깔끔하게 들어가지 않는 중요 상세 |

핵심 원칙은 아래와 같다.

- `normalized facts`는 **반복적으로 직접 필터링/정렬/추천/알림에 쓰는 핵심 사실**
- `details_jsonb`는 **정규화 컬럼으로 올리기엔 너무 가변적이지만, 상세 설명에는 계속 필요한 정보**
- `details_jsonb`는 **같은 row 안에 저장**하며 별도 연결 ID는 두지 않음
- top-level key는 고정하되, **하위 구조는 공지마다 유연하게**
- 비어 있는 top-level key는 억지로 넣지 않고 **생략**
- top-level key 경계와 충돌 처리 규칙을 명시적으로 둠

---

## 분석 대상과 실제 읽은 샘플

`normalized facts` 분석에 사용했던 샘플셋 중, `details_jsonb` top-level 구조를 결정하는 데 대표성이 큰 공지들을 다시 읽었다.

이번 검토에서는 문서 목록만 본 것이 아니라, 실제 DB에 저장된 아래 입력을 다시 읽었다.

- `notice_items.body_text`
- `notice_attachment_extractions.extracted_text`
- `notice_image_ocr_results.ocr_text`

이번 슬라이스에서 특히 기준이 된 샘플은 아래와 같다.

| key | 대표성 |
| --- | --- |
| `career:230907` | 본문에 세션별 일정, 장소, 진행 방식, 출석 규칙이 반복되는 프로그램형 |
| `career:230983` | 본문 + 포스터 OCR로 교육 내용, 대상, 혜택, 신청 방식이 함께 드러나는 외부 교육형 |
| `general:230921` | 대형 채용/초빙 공고로 모집 분야, 제출 서류, 전형 절차, 추천서/소견서 등 상세가 매우 많은 첨부 중심형 |
| `general:230815` | 공모전/경진대회형으로 신청 서류와 제출 절차, 심사/시상, 운영 규정이 세분화된 사례 |
| `general:230830` | 본문 + 포스터 OCR 조합으로 공모주제, 제출 형식, 유의사항이 반복되는 사례 |
| `scholarship:230182` | 장학생 선발 공고형으로 공통 자격요건, 유형별 자격, 지급액, 신청 절차가 명확한 사례 |
| `scholarship:230723` | 장학사업형으로 장학금 개요, 지원기간, 지원대상, 신청 매뉴얼, 자기소개서/추천서 양식이 함께 있는 사례 |
| `scholarship:230100` | 세부 자격요건, 제외조건, 제출 서류, 추천기관 제출 방식까지 상세히 적힌 장학지원형 |
| `scholarship:229895` | 해외교환 장학생형으로 파견 유형, 장학금액, 변경 불가 조건, 학적 유지 요건이 복합적으로 들어있는 사례 |
| `event:230718` | 행사형으로 발급 절차, 혜택 구성, 문의처가 핵심인 사례 |

---

## 실제 샘플에서 반복적으로 보인 “facts로는 부족한 정보”

실제 내용을 다시 읽어보면, 아래 정보는 중요하지만 `normalized facts` 컬럼으로는 충분히 담기지 않았다.

### 1. 세부 자격요건

대표 샘플:

- `scholarship:230182`
- `scholarship:230100`
- `scholarship:230723`
- `scholarship:229895`

반복된 정보 유형:

- 소득 기준
- 거주 요건
- 학적/학교 유형 요건
- 성적/학점 요건
- 연령 기준
- 우대 선발 조건
- 제외 대상

이 정보는 공지마다 구조와 표현이 크게 달라서, `target_*` 컬럼이나 `has_benefit`만으로는 서비스가 상세 설명을 만들기 어렵다.

따라서 별도 top-level key로 `eligibility`가 필요하다.

### 2. 제출 서류 상세 목록

대표 샘플:

- `general:230921`
- `general:230815`
- `scholarship:230100`
- `scholarship:230723`

반복된 정보 유형:

- 필수 제출 서류 목록
- 양식 여부
- 해당자만 제출하는 추가 서류
- 원본/사본/발급일 조건

이건 사용자가 “무슨 서류를 내야 하냐”를 물을 때 매우 중요하지만, 컬럼화하기엔 너무 가변적이다.

따라서 `required_documents`가 필요하다.

### 3. 신청/접수/참여 절차

대표 샘플:

- `event:230718`
- `career:230907`
- `career:230983`
- `general:230815`
- `scholarship:230100`

반복된 정보 유형:

- 신청/제출 단계 순서
- 방문/메일/온라인 접수 절차
- 별도 시스템 이용 방법
- 출석 인정 방식
- 줌 참여 방식
- 결과 확인 절차

`action_kind`, `primary_action_channel`, `primary_action_url`만으로는 절차 설명이 부족하다.

따라서 `application_process`가 필요하다.

### 4. 대표 시간축 외 세부 일정

대표 샘플:

- `career:230907`
- `career:230884`
- `general:230815`
- `scholarship:230182`

반복된 정보 유형:

- 세션별 일정
- 심사/발표/전달식 일정
- 복수 마일스톤
- 운영/참여 관련 세부 시간표

`primary_time_*`는 대표값 1개만 담으므로, 부가적인 타임라인은 `schedule_details`로 별도 보존해야 한다.

### 5. 대표 혜택 외 상세 구성

대표 샘플:

- `career:230983`
- `event:230718`
- `scholarship:230182`
- `scholarship:230723`
- `scholarship:230100`
- `scholarship:229895`

반복된 정보 유형:

- 장학금이 다년 지원인지
- 분할 지급인지
- 부가 혜택(쿠폰, 항공/숙박 할인 등)
- 참여수당/생활비/학업장려금 구분
- 지역/유형별 금액 차이

`has_benefit`, `benefit_kind`, `benefit_amount_krw`는 요약용으로 좋지만, 세부 설명은 `benefit_details`가 필요하다.

### 6. 선발/심사 관련 상세

대표 샘플:

- `general:230921`
- `general:230815`
- `scholarship:230182`
- `scholarship:229895`

반복된 정보 유형:

- 전형 단계
- 심사 방식
- 발표 시점
- 예비 합격 관련 정보
- 지원 후 변경 불가 조건

`selection_count`만으로는 부족하므로 `selection_details`가 필요하다.

### 7. 공지 본체의 세부 내용

대표 샘플:

- `career:230907`
- `career:230983`
- `general:230815`
- `general:230830`
- `event:230718`

반복된 정보 유형:

- 강의 주제 목록
- 교육 커리큘럼
- 공모 주제와 제출 형식
- 행사 혜택 항목
- 참가 단위(개인/팀)
- 채용/초빙 분야
- 시스템/운영 변경 내용

이건 `notice_kind`만으로 대체되지 않으므로 `content_details`가 필요하다.

### 8. 신청/안내/참고 링크

대표 샘플:

- `career:230983`
- `career:231010`
- `general:230945`
- `general:230874`
- `event:230718`

반복된 정보 유형:

- 신청 링크
- 기관 안내 페이지
- 매뉴얼/가이드 링크
- 외부 설문/접수 링크
- 이메일 이외의 참고 링크

이 정보는 `primary_action_url` 하나로는 부족하고, 문의처와도 성격이 다르므로 `resource_links`가 필요하다.

### 9. 문의처

대표 샘플:

- `event:230718`
- `general:230945`
- `scholarship:230182`
- `scholarship:230100`

반복된 정보 유형:

- 문의 전화
- 이메일
- 담당 부서/기관
- 접수처/사무국

문의처는 거의 모든 도메인에서 반복되므로 `contact`가 필요하다.

### 10. 유의사항, 예외 규정, 유지 조건

대표 샘플:

- `scholarship:230100`
- `scholarship:229895`
- `career:230907`
- `general:230815`

반복된 정보 유형:

- 휴학생 제외
- 초과학기생 제외
- 중복수혜 불가
- 참석/출석 기준
- 지원 후 변경 불가
- 행사 필수 참여 조건

이런 값은 자주 중요하지만, 구조가 들쭉날쭉해서 `important_notes`가 적절하다.

---

## details_jsonb 저장 원칙

### 1. facts와 details는 같은 row에 저장

- `details_jsonb`는 `public_data.notice_read_models`의 같은 row 안에 저장
- 원문 notice와의 연결은 `notice_item_id` 하나로 충분
- JSONB 전용 연결 ID는 두지 않음

### 2. facts를 반복 복제하지 않는다

`details_jsonb`는 `normalized facts`를 그대로 다시 담는 곳이 아니다.

예:

- `notice_kind`
- `target_campuses`
- `primary_deadline_at`
- `benefit_amount_krw`

같이 이미 컬럼화된 값은 JSONB의 중심 내용으로 반복 저장하지 않는다.

다만 아래처럼 **상세 설명을 위해 보조적으로 함께 나타나는 것**은 허용한다.

- `benefit_details.items[].amount_krw`
- `schedule_details.milestones[].start_at`
- `selection_details.stages[].announcement_at`

즉 원칙은:

- 컬럼 = 대표값
- JSONB = 대표값을 둘러싼 상세 구조

### 3. top-level key는 고정, 하위 구조는 유연

top-level key는 worker와 서버가 안정적으로 읽을 수 있도록 고정한다.

반면 각 key 내부 구조는 공지에 따라 유연하게 둔다.

예:

- `eligibility` 안에서는 어떤 공지는 `income_requirement`가 있고
- 어떤 공지는 `exchange_program_requirement`가 있고
- 어떤 공지는 `preferred_conditions`만 있을 수 있다.

### 4. 비어 있는 top-level key는 생략

모든 공지에 모든 top-level key를 억지로 넣지 않는다.

예:

- 행사형 공지는 `required_documents`가 없을 수 있음
- 시스템 안내형은 `benefit_details`가 없을 수 있음
- 단순 결과 안내형은 `application_process`가 비어 있을 수 있음

이 경우 해당 key는 아예 생략한다.

### 5. 장문 블롭보다 배열/객체를 우선

가능하면 아래처럼 구조를 나눈다.

- 단일 문장 여러 개 -> `string[]`
- 반복 항목 -> `object[]`
- 이름/조건/설명 조합 -> `object`

즉 긴 본문을 통째로 다시 넣는 방식은 피하고, **의미 단위로 분해한 구조**를 우선한다.

### 6. provenance를 JSONB에 다시 복제하지 않는다

원문, 첨부 원본, 추출 텍스트, OCR 결과는 이미 provenance 계층에 있다.

따라서 `details_jsonb`는:

- 원문 전체 텍스트
- OCR 원문 전체
- 첨부파일 전체 텍스트
- storage key

를 다시 담는 곳이 아니다.

`details_jsonb`는 원문을 다시 저장하는 대신 **원문을 읽고 구조화한 결과**를 저장한다.

### 7. 최상단에 `extra`는 남겨둔다

위 key로 깔끔하게 분류되지 않지만 중요한 정보가 실제로 남을 수 있다.

예:

- 장학사업 고유 규칙
- 채용 공고의 특수 제출 방식
- 행사/공모전에서 반복되지만 아직 일반화하기 어려운 세부 구조

이런 값은 `extra`에 넣되, 남용하지 않는다.

### 8. top-level key 경계를 명시적으로 나눈다

`details_jsonb`는 key 경계가 겹치기 쉬우므로 아래 규칙을 고정한다.

- `eligibility`
  - 지원/신청/선발 자격을 결정하는 조건
  - 우대조건, 제외조건 포함
- `application_process`
  - 사용자가 실제로 해야 하는 절차와 제출 방식
  - 신청 단계, 제출 단계, 참여 등록 단계
- `schedule_details`
  - 언제 어떤 일이 일어나는지에 대한 시간 정보
  - 접수 기간, 설명회 일정, 발표일, 전달식 일정 등
- `selection_details`
  - 어떻게 평가/선발/배정되는지에 대한 규칙
  - 심사 단계, 평가 기준, 결과 통지 방식
- `content_details`
  - 공지 본체가 무엇을 제공/변경/운영하는지에 대한 내용
  - 교육 커리큘럼, 행사 프로그램, 공모 주제, 채용 분야, 시스템 변경 사항
- `important_notes`
  - 자격 자체를 정의하지는 않지만 사용자가 주의해야 하는 규정
  - 출석 기준, 수혜 유지 조건, 변경 불가 조건, 운영상 주의사항

예를 들어:

- `휴학생 제외` -> `eligibility.exclusions`
- `선발 후 파견국가 변경 불가` -> `important_notes`
- `1차 서류심사, 2차 면접` -> `selection_details.stages`
- `접수 3/1~3/7, 결과 발표 4/1` -> `schedule_details.milestones`
- `온라인 신청 후 우편 제출` -> `application_process`

### 9. unknown top-level key는 그대로 두지 않는다

LLM이 제안한 top-level key가 허용 목록에 없으면 그대로 저장하지 않는다.

허용 목록:

- `eligibility`
- `required_documents`
- `application_process`
- `schedule_details`
- `benefit_details`
- `selection_details`
- `content_details`
- `resource_links`
- `contact`
- `important_notes`
- `extra`

처리 원칙:

- 기존 key로 명확히 매핑 가능한 경우 -> 해당 key로 이동
- 중요하지만 기존 key로 매핑이 불분명한 경우 -> `extra.unclassified_entries[]`로 이동
- 중요도가 낮거나 provenance/raw 재복제에 가까운 경우 -> 저장하지 않음

즉 `details_jsonb`는 반구조화 계층이지, top-level key가 무한정 늘어나는 자유형 blob이 아니다.

### 10. facts와 details_jsonb가 충돌하면 facts를 대표값으로 본다

`notice_read_models`의 컬럼은 서비스가 직접 읽는 대표값이므로, facts와 `details_jsonb`가 충돌할 때는 아래 원칙을 따른다.

- facts 컬럼 = 대표값의 source of truth
- `details_jsonb` = 대표값 주변의 세부 구조

예:

- `primary_deadline_at`는 대표 마감일
- `schedule_details.milestones[]`에는 여러 일정이 들어갈 수 있음
- `benefit_amount_krw`는 대표 금액
- `benefit_details.items[]`에는 유형별 세부 금액이 들어갈 수 있음

처리 원칙:

- details가 facts를 보조 설명하는 경우 -> 함께 저장 가능
- details가 facts 대표값과 모순되는 경우 -> facts 값 유지, 모순되는 details 항목은 정규화 단계에서 제거하거나 `important_notes` 수준 설명으로 낮춤

### 11. `extra`는 제한된 escape hatch로만 쓴다

`extra`는 아래 조건을 모두 만족할 때만 사용한다.

1. 사용자에게 실제로 중요한 상세이다.
2. 기존 top-level key 어디에도 자연스럽게 들어가지 않는다.
3. 원문/provenance를 그대로 복제하는 내용이 아니다.

권장 형태:

- `extra.unclassified_entries` = `[{ "label": "...", "value": ... }]`
- `extra.special_rules` = `string[]`

즉 `extra`는 잡동사니 보관함이 아니라, **현재 구조에서 일반화하지 못한 중요 상세를 제한적으로 담는 곳**이다.

---

## 제안하는 top-level payload 구조

현재 기준으로는 아래 구조가 가장 적절하다.

```json
{
  "eligibility": {},
  "required_documents": [],
  "application_process": {},
  "schedule_details": {},
  "benefit_details": {},
  "selection_details": {},
  "content_details": {},
  "resource_links": [],
  "contact": {},
  "important_notes": [],
  "extra": {}
}
```

### 1. `eligibility`

의미:

- 세부 자격요건
- 우대조건
- 제외조건

예상 하위 구조 예시:

```json
{
  "requirements": [
    "직전학기 12학점 이상 이수",
    "백분율 77점 이상"
  ],
  "preferred_conditions": [
    "관련 전공자 우대"
  ],
  "exclusions": [
    "휴학생 제외",
    "초과학기생 제외"
  ]
}
```

### 2. `required_documents`

의미:

- 제출 서류 목록과 조건

예상 하위 구조 예시:

```json
[
  {
    "name": "재학증명서",
    "required": true,
    "notes": "2026년 3월 이후 발급본만 인정"
  },
  {
    "name": "자기소개서",
    "required": true,
    "notes": "첨부 양식 사용"
  }
]
```

### 3. `application_process`

의미:

- 신청/접수/참여 절차

예상 하위 구조 예시:

```json
{
  "method_summary": "온라인 신청 후 서류 제출",
  "steps": [
    "홈페이지 공고문 확인",
    "신청서 작성",
    "구비서류 업로드 또는 제출"
  ],
  "submission_details": [
    "방문 접수",
    "등기우편 접수 가능"
  ]
}
```

### 4. `schedule_details`

의미:

- 대표 시간축 외 추가 일정과 마일스톤

예상 하위 구조 예시:

```json
{
  "milestones": [
    {
      "label": "서류 접수",
      "start_at": "2026-03-23T09:00:00+09:00",
      "end_at": "2026-03-27T18:00:00+09:00"
    },
    {
      "label": "선발 결과 통지",
      "note": "2026년 6월 중"
    }
  ]
}
```

### 5. `benefit_details`

의미:

- 혜택의 세부 구성과 지급 방식

예상 하위 구조 예시:

```json
{
  "items": [
    {
      "kind": "scholarship",
      "amount_krw": 3000000,
      "description": "1년차 학업장려금"
    },
    {
      "kind": "coupon",
      "description": "메가커피 쿠폰 2매"
    }
  ],
  "payment_notes": [
    "분할 지급",
    "2년 연속 지원 가능"
  ]
}
```

### 6. `selection_details`

의미:

- 선발 절차, 전형 단계, 심사 기준, 발표 관련 정보

예상 하위 구조 예시:

```json
{
  "stages": [
    "기초심사",
    "전공심사",
    "면접심사"
  ],
  "criteria": [
    "학교 추천 필요",
    "심사위원회 심사"
  ],
  "result_notes": [
    "개별 문자 발송"
  ]
}
```

### 7. `content_details`

의미:

- 행사/교육/공모전/채용/운영 변경 등 공지 본체의 세부 내용

예상 하위 구조 예시:

```json
{
  "topics": [
    "데이터 시각화 입문",
    "조직컬처핏 완전정복"
  ],
  "session_details": [
    {
      "title": "대플센터와 함께하는 대학생활 진로 가이드",
      "mode": "zoom"
    }
  ],
  "participation_unit": "개인 또는 팀"
}
```

### 8. `resource_links`

의미:

- 문의처 외 신청/안내/매뉴얼/참고 링크

예상 하위 구조 예시:

```json
[
  {
    "type": "application",
    "label": "신청 링크",
    "url": "https://example.com/apply"
  },
  {
    "type": "guide",
    "label": "공고문 상세 안내",
    "url": "https://example.com/guide"
  }
]
```

### 9. `contact`

의미:

- 문의처와 담당자 정보

예상 하위 구조 예시:

```json
{
  "channels": [
    {
      "type": "phone",
      "value": "053-951-8008"
    },
    {
      "type": "email",
      "value": "ctl@mju.ac.kr"
    }
  ],
  "organization": "대구동구교육재단 사무국"
}
```

### 10. `important_notes`

의미:

- 유의사항, 참여 유지 조건, 운영상 주의사항

예상 하위 구조 예시:

```json
[
  "휴학생 제외",
  "중복 수혜 불가",
  "지원 후 파견국가 변경 불가"
]
```

### 11. `extra`

의미:

- 위 key로 깔끔하게 정리되지 않는 중요 상세

예상 하위 구조 예시:

```json
{
  "unclassified_entries": [
    {
      "label": "기관 고유 규정",
      "value": "학교별 추천 인원 1명 제한"
    }
  ]
}
```

---

## 샘플을 기준으로 본 top-level key 적합성

### `eligibility`

아래 샘플에서 반복적으로 필요했다.

- `scholarship:230182`
- `scholarship:230100`
- `scholarship:230723`
- `scholarship:229895`

### `required_documents`

아래 샘플에서 반복적으로 필요했다.

- `general:230921`
- `general:230815`
- `scholarship:230100`
- `scholarship:230723`

### `application_process`

아래 샘플에서 반복적으로 필요했다.

- `event:230718`
- `career:230907`
- `career:230983`
- `general:230815`

### `schedule_details`

아래 샘플에서 반복적으로 필요했다.

- `career:230907`
- `career:230884`
- `general:230815`
- `scholarship:230182`

### `benefit_details`

아래 샘플에서 반복적으로 필요했다.

- `career:230983`
- `event:230718`
- `scholarship:230182`
- `scholarship:230723`
- `scholarship:229895`

### `selection_details`

아래 샘플에서 반복적으로 필요했다.

- `general:230921`
- `general:230815`
- `scholarship:230182`
- `scholarship:229895`

### `content_details`

아래 샘플에서 반복적으로 필요했다.

- `career:230907`
- `career:230983`
- `general:230815`
- `general:230830`
- `event:230718`

### `resource_links`

아래 샘플에서 반복적으로 필요했다.

- `career:230983`
- `career:231010`
- `general:230945`
- `general:230874`
- `event:230718`

### `contact`

아래 샘플에서 반복적으로 필요했다.

- `event:230718`
- `general:230945`
- `scholarship:230182`
- `scholarship:230100`

### `important_notes`

아래 샘플에서 반복적으로 필요했다.

- `scholarship:230100`
- `scholarship:229895`
- `career:230907`
- `general:230815`

---

## 최종 제안

현재 단계에서 `details_jsonb`는 아래 방향이 가장 적절하다.

1. `normalized facts`와 같은 row 안에 저장한다.
2. top-level key는 아래 11개로 고정한다.
   - `eligibility`
   - `required_documents`
   - `application_process`
   - `schedule_details`
   - `benefit_details`
   - `selection_details`
   - `content_details`
   - `resource_links`
   - `contact`
   - `important_notes`
   - `extra`
3. 하위 key는 공지별로 유연하게 둔다.
4. 비어 있는 key는 생략한다.
5. 이미 `normalized facts`에 들어간 대표값은 JSONB에서 반복 저장하지 않고, 상세 설명이 필요한 경우에만 보조적으로 포함한다.
6. unknown top-level key는 그대로 저장하지 않고, 기존 key로 매핑하거나 `extra.unclassified_entries`로 제한적으로 흡수한다.
7. facts와 details가 충돌하면 facts를 대표값으로 유지한다.

한 줄로 요약하면, `details_jsonb`는 **완전 자유형 blob이 아니라, 경계 규칙과 충돌 처리 원칙을 가진 반구조화 계층**으로 두는 것이 가장 적절하다.
