# Notice Read Model 정규화 컬럼 분석

## 문서 목적

이 문서는 notice read model에서 **서비스가 반복적으로 직접 읽어야 하는 `normalized facts` 컬럼**을 실제 공지 샘플을 바탕으로 확정하기 위한 문서이다.

이번 문서의 범위는 아래에 집중한다.

- 실제 공지 샘플을 읽고 어떤 사실을 `normalized facts`로 승격할지 결정
- 그 결과를 notice read model의 **최종 후보 컬럼**으로 정리
- 다음 슬라이스에서 바로 스키마와 적재 로직으로 옮길 수 있는 수준까지 정리

이번 문서에서 **결정하지 않는 것**은 아래와 같다.

- provenance/raw 계층의 세부 설계
- LLM prompt 세부안
- 마이그레이션/코드 구현

다만, read model의 저장 방식에 대해서는 한 가지를 명확히 전제한다.

- `normalized facts`와 JSONB는 **같은 row 안에 함께 저장한다**
- 따라서 JSONB를 가리키는 **별도 연결 ID는 필요 없다**
- 원문 notice와의 연결은 `notice_item_id` 하나로 충분하다

즉 기본 구조는 아래 느낌으로 간다.

- `notice_item_id`
- 자주 조회할 `normalized facts` 컬럼들
- `details_jsonb`

---

## 빠른 요약

현재 기준으로 확정한 `normalized facts` 후보는 아래와 같다.

| 임시 컬럼명              | 저장할 의미                                                                |
| ------------------------ | -------------------------------------------------------------------------- |
| `notice_item_id`         | 원문 notice 정본과 연결되는 내부 ID                                        |
| `source_id`              | 공지가 속한 공개 source                                                    |
| `external_id`            | 공지의 외부 식별자                                                         |
| `notice_kind`            | 공지 종류(장학, 채용, 행사, 설문, 시스템 안내, 모집, 공모전, 결과 안내 등) |
| `issuer_name`            | 공지의 주관 조직 또는 공고 주체                                            |
| `issuer_scope`           | 내부 조직 공지인지 외부 기관 공지인지                                      |
| `target_campuses`        | 대상 캠퍼스(인문/자연 등)                                                  |
| `target_audiences`       | 대상 집단 유형(재학생, 휴학생, 졸업생, 졸업예정자, 교직원 등)              |
| `target_program_levels`  | 대상 과정(학부, 대학원 등)                                                 |
| `target_departments`     | 대상 학과/전공/전공계열                                                    |
| `target_grade_years`     | 대상 학년                                                                  |
| `primary_time_kind`      | 대표 시간축의 종류(신청기간, 행사기간, 운영중단, 응답기한 등)              |
| `primary_start_at`       | 대표 시작 시각                                                             |
| `primary_end_at`         | 대표 종료 시각                                                             |
| `primary_deadline_at`    | 대표 마감 시각                                                             |
| `has_deadline`           | 마감 시각 존재 여부                                                        |
| `action_required`        | 사용자가 실제 행동을 해야 하는 공지인지                                    |
| `action_kind`            | 행동 유형(신청, 접수, 참여, 응답, 조회, 지원 등)                           |
| `primary_action_channel` | 대표 행동 채널(웹폼, 시스템, 이메일, 방문, 현장, 전화 등)                  |
| `primary_action_url`     | 대표 신청/응답/안내 링크                                                   |
| `primary_location`       | 대표 장소                                                                  |
| `participation_mode`     | 온라인/오프라인/혼합/비대면/현장 등 대표 참여 방식                         |
| `has_benefit`            | 장학금, 지원금, 상금, 무료발급, 쿠폰 등 혜택 존재 여부                     |
| `benefit_kind`           | 혜택 종류(장학금, 지원금, 등록금, 이자지원, 상금, 무료발급, 쿠폰 등)       |
| `benefit_amount_krw`     | 대표 금액(가능할 때만)                                                     |
| `selection_count`        | 모집/선발 인원                                                             |
| `summary`                | 서비스가 바로 보여줄 1~3문장 요약                                          |
| `normalized_confidence`  | 구조화 결과 신뢰도                                                         |
| `normalized_at`          | 구조화 시각                                                                |

한 줄 요약으로 정리하면, notice read model은 아래 질문에 바로 답할 수 있어야 한다.

- 이 공지는 무슨 종류인가
- 누구에게 relevant 한가
- 언제까지 무엇을 해야 하나
- 어디서/어떻게 해야 하나
- 금전/혜택이 있나
- 지금 빠르게 보여줄 요약은 무엇인가

---

## 샘플 선정 원칙

공지 read model 컬럼은 추상적으로 정할 수 없기 때문에, 실제 저장된 notice 데이터에서 대표 샘플을 뽑아 분석했다.

샘플 선정 원칙은 아래와 같다.

- 공개 공지 4개 source 전반을 포함한다.
- 본문 중심형, 첨부 중심형, 이미지/포스터 중심형, 복합형을 모두 포함한다.
- 단순 안내형, 모집형, 행사형, 설문형, 선발결과형, 시스템 안내형, 장학형, 채용형이 고르게 드러나도록 한다.
- 반복적으로 서비스가 직접 판단해야 할 사실이 무엇인지 보기 위해, 가능한 한 서로 다른 구조의 공지를 포함한다.

### source별 실제 데이터 한계

현재 DB 기준으로 `event` source는 저장된 공지가 1건뿐이다.

따라서 샘플은 완전히 균등 분포로 잡지 않고, **실제 저장량과 유형 다양성**을 우선했다.

---

## 분석에 사용한 샘플셋

### 분석셋 24건

분석셋은 실제로 컬럼 후보를 도출하는 데 사용한 메인 샘플셋이다.

분포:

- `career`: 6건
- `event`: 1건
- `general`: 8건
- `scholarship`: 9건

형태 분포:

- `body_only`: 4건
- `attachment_only`: 5건
- `image_only`: 6건
- `mixed`: 9건

| source      | key                  | URL                                                             | 형태            | 선정 이유                                              |
| ----------- | -------------------- | --------------------------------------------------------------- | --------------- | ------------------------------------------------------ |
| career      | `career:230907`      | [원문](https://www.mju.ac.kr/bbs/mjukr/146/230907/artclView.do) | body_only       | 본문만으로 일정, 대상, 신청링크가 드러나는 특강 모집형 |
| career      | `career:230858`      | [원문](https://www.mju.ac.kr/bbs/mjukr/146/230858/artclView.do) | attachment_only | 본문 + 첨부가 결합된 대비반 모집형                     |
| career      | `career:231010`      | [원문](https://www.mju.ac.kr/bbs/mjukr/146/231010/artclView.do) | image_only      | 포스터/OCR 보조가 필요한 모집형                        |
| career      | `career:230983`      | [원문](https://www.mju.ac.kr/bbs/mjukr/146/230983/artclView.do) | mixed           | 외부 교육 프로그램 모집형, 기간/수당/대상 포함         |
| career      | `career:230923`      | [원문](https://www.mju.ac.kr/bbs/mjukr/146/230923/artclView.do) | mixed           | 마감 임박 + 외부 링크 다수 + 포스터 혼합형             |
| career      | `career:230863`      | [원문](https://www.mju.ac.kr/bbs/mjukr/146/230863/artclView.do) | image_only      | 졸업생 취업조사형, 안내/참여 유도형                    |
| event       | `event:230718`       | [원문](https://www.mju.ac.kr/bbs/mjukr/142/230718/artclView.do) | mixed           | 행사형 공지의 대표 사례                                |
| general     | `general:230921`     | [원문](https://www.mju.ac.kr/bbs/mjukr/141/230921/artclView.do) | mixed           | 대형 채용/초빙형, 첨부 의존도가 매우 큰 사례           |
| general     | `general:231000`     | [원문](https://www.mju.ac.kr/bbs/mjukr/141/231000/artclView.do) | attachment_only | 교내 계약직 채용형, 본문/첨부 병행형                   |
| general     | `general:230815`     | [원문](https://www.mju.ac.kr/bbs/mjukr/141/230815/artclView.do) | attachment_only | 신청서 PDF 첨부 기반 공모전형                          |
| general     | `general:230945`     | [원문](https://www.mju.ac.kr/bbs/mjukr/141/230945/artclView.do) | image_only      | 진단검사 참여형, 이미지 포스터 중심                    |
| general     | `general:230903`     | [원문](https://www.mju.ac.kr/bbs/mjukr/141/230903/artclView.do) | image_only      | 행사형 포스터 중심 사례                                |
| general     | `general:230856`     | [원문](https://www.mju.ac.kr/bbs/mjukr/141/230856/artclView.do) | body_only       | 시스템 중단 안내형                                     |
| general     | `general:230747`     | [원문](https://www.mju.ac.kr/bbs/mjukr/141/230747/artclView.do) | body_only       | 훈련/소집 안내형                                       |
| general     | `general:230830`     | [원문](https://www.mju.ac.kr/bbs/mjukr/141/230830/artclView.do) | mixed           | 공모전형, 포스터+첨부 혼합                             |
| scholarship | `scholarship:230148` | [원문](https://www.mju.ac.kr/bbs/mjukr/145/230148/artclView.do) | body_only       | 선발결과/조회 안내형                                   |
| scholarship | `scholarship:230182` | [원문](https://www.mju.ac.kr/bbs/mjukr/145/230182/artclView.do) | attachment_only | 장학생 모집형, 첨부 PDF 추출 성공형                    |
| scholarship | `scholarship:229764` | [원문](https://www.mju.ac.kr/bbs/mjukr/145/229764/artclView.do) | attachment_only | 국가근로 모집형, 본문과 첨부 결합형                    |
| scholarship | `scholarship:230938` | [원문](https://www.mju.ac.kr/bbs/mjukr/145/230938/artclView.do) | image_only      | 포스터형 지원사업 안내                                 |
| scholarship | `scholarship:229819` | [원문](https://www.mju.ac.kr/bbs/mjukr/145/229819/artclView.do) | image_only      | 장학생 모집 포스터형                                   |
| scholarship | `scholarship:230984` | [원문](https://www.mju.ac.kr/bbs/mjukr/145/230984/artclView.do) | mixed           | 본문 없이 첨부/포스터가 핵심인 혼합형                  |
| scholarship | `scholarship:230723` | [원문](https://www.mju.ac.kr/bbs/mjukr/145/230723/artclView.do) | mixed           | 장학사업 공고형, 첨부 다수                             |
| scholarship | `scholarship:230100` | [원문](https://www.mju.ac.kr/bbs/mjukr/145/230100/artclView.do) | mixed           | 장학사업형, 본문+첨부+포스터 혼합                      |
| scholarship | `scholarship:229895` | [원문](https://www.mju.ac.kr/bbs/mjukr/145/229895/artclView.do) | mixed           | 해외교환 장학생 선발형                                 |

### 검증셋 8건

검증셋은 분석셋으로 뽑은 컬럼 후보가 특정 샘플에만 맞춘 과적합이 아닌지 확인하기 위한 보조 샘플셋이다.

분포:

- `career`: 2건
- `general`: 3건
- `scholarship`: 3건

형태 분포:

- `body_only`: 1건
- `attachment_only`: 2건
- `image_only`: 3건
- `mixed`: 2건

| source      | key                  | URL                                                             | 형태            | 검증 포인트                         |
| ----------- | -------------------- | --------------------------------------------------------------- | --------------- | ----------------------------------- |
| career      | `career:230884`      | [원문](https://www.mju.ac.kr/bbs/mjukr/146/230884/artclView.do) | image_only      | 행사형/설명회형 포스터 공지 검증    |
| career      | `career:230814`      | [원문](https://www.mju.ac.kr/bbs/mjukr/146/230814/artclView.do) | image_only      | 졸업생 조사형 검증                  |
| general     | `general:230883`     | [원문](https://www.mju.ac.kr/bbs/mjukr/141/230883/artclView.do) | body_only       | 정책/공유 안내형 검증               |
| general     | `general:230869`     | [원문](https://www.mju.ac.kr/bbs/mjukr/141/230869/artclView.do) | attachment_only | 첨부 기반 모집형 검증               |
| general     | `general:230745`     | [원문](https://www.mju.ac.kr/bbs/mjukr/141/230745/artclView.do) | mixed           | 공모전형 혼합 구조 검증             |
| scholarship | `scholarship:230190` | [원문](https://www.mju.ac.kr/bbs/mjukr/145/230190/artclView.do) | attachment_only | 장학 공고 첨부 의존형 검증          |
| scholarship | `scholarship:230321` | [원문](https://www.mju.ac.kr/bbs/mjukr/145/230321/artclView.do) | mixed           | 이미지+첨부 기반 장학생 선발형 검증 |
| scholarship | `scholarship:229816` | [원문](https://www.mju.ac.kr/bbs/mjukr/145/229816/artclView.do) | image_only      | 등록금 지원 포스터형 검증           |

### 추가 검증셋 32건

초기 분석셋 24건 + 검증셋 8건으로 도출한 후보가 특정 샘플에 과적합되지 않았는지 확인하기 위해, 이전에 사용하지 않은 공지를 같은 방식으로 추가 검증했다.

원래 목표는 `4개 source × 8건 = 32건`이었지만, 실제 DB 기준으로는 `event` source에 남아 있는 미사용 공지가 없었다.

따라서 이번 추가 검증은 **실제로 남아 있는 공지 중 총 32건**으로 진행했다.

- `career`: 5건
- `general`: 13건
- `scholarship`: 14건

형태 분포:

- `body_only`: 1건
- `attachment_only`: 8건
- `image_only`: 14건
- `mixed`: 9건

#### career 5건

- `career:230967` ([원문](https://www.mju.ac.kr/bbs/mjukr/146/230967/artclView.do))
- `career:230901` ([원문](https://www.mju.ac.kr/bbs/mjukr/146/230901/artclView.do))
- `career:230882` ([원문](https://www.mju.ac.kr/bbs/mjukr/146/230882/artclView.do))
- `career:230748` ([원문](https://www.mju.ac.kr/bbs/mjukr/146/230748/artclView.do))
- `career:230239` ([원문](https://www.mju.ac.kr/bbs/mjukr/146/230239/artclView.do))

#### general 13건

- `general:230944` ([원문](https://www.mju.ac.kr/bbs/mjukr/141/230944/artclView.do))
- `general:230925` ([원문](https://www.mju.ac.kr/bbs/mjukr/141/230925/artclView.do))
- `general:230946` ([원문](https://www.mju.ac.kr/bbs/mjukr/141/230946/artclView.do))
- `general:230904` ([원문](https://www.mju.ac.kr/bbs/mjukr/141/230904/artclView.do))
- `general:230896` ([원문](https://www.mju.ac.kr/bbs/mjukr/141/230896/artclView.do))
- `general:230868` ([원문](https://www.mju.ac.kr/bbs/mjukr/141/230868/artclView.do))
- `general:230895` ([원문](https://www.mju.ac.kr/bbs/mjukr/141/230895/artclView.do))
- `general:230842` ([원문](https://www.mju.ac.kr/bbs/mjukr/141/230842/artclView.do))
- `general:230857` ([원문](https://www.mju.ac.kr/bbs/mjukr/141/230857/artclView.do))
- `general:230746` ([원문](https://www.mju.ac.kr/bbs/mjukr/141/230746/artclView.do))
- `general:230782` ([원문](https://www.mju.ac.kr/bbs/mjukr/141/230782/artclView.do))
- `general:230790` ([원문](https://www.mju.ac.kr/bbs/mjukr/141/230790/artclView.do))
- `general:219450` ([원문](https://www.mju.ac.kr/bbs/mjukr/141/219450/artclView.do))

#### scholarship 14건

- `scholarship:230710` ([원문](https://www.mju.ac.kr/bbs/mjukr/145/230710/artclView.do))
- `scholarship:230580` ([원문](https://www.mju.ac.kr/bbs/mjukr/145/230580/artclView.do))
- `scholarship:230490` ([원문](https://www.mju.ac.kr/bbs/mjukr/145/230490/artclView.do))
- `scholarship:230359` ([원문](https://www.mju.ac.kr/bbs/mjukr/145/230359/artclView.do))
- `scholarship:230187` ([원문](https://www.mju.ac.kr/bbs/mjukr/145/230187/artclView.do))
- `scholarship:230186` ([원문](https://www.mju.ac.kr/bbs/mjukr/145/230186/artclView.do))
- `scholarship:230185` ([원문](https://www.mju.ac.kr/bbs/mjukr/145/230185/artclView.do))
- `scholarship:230183` ([원문](https://www.mju.ac.kr/bbs/mjukr/145/230183/artclView.do))
- `scholarship:230213` ([원문](https://www.mju.ac.kr/bbs/mjukr/145/230213/artclView.do))
- `scholarship:230008` ([원문](https://www.mju.ac.kr/bbs/mjukr/145/230008/artclView.do))
- `scholarship:229830` ([원문](https://www.mju.ac.kr/bbs/mjukr/145/229830/artclView.do))
- `scholarship:229768` ([원문](https://www.mju.ac.kr/bbs/mjukr/145/229768/artclView.do))
- `scholarship:229817` ([원문](https://www.mju.ac.kr/bbs/mjukr/145/229817/artclView.do))
- `scholarship:229820` ([원문](https://www.mju.ac.kr/bbs/mjukr/145/229820/artclView.do))

---

## 최종 normalized facts 후보와 설명

아래는 현재 기준으로 확정한 `normalized facts` 후보와 각각의 의미이다.

### 1. 식별/연결용 기본 필드

| 임시 컬럼명      | 저장할 의미                         | 설명                                                                                                                                                                                      |
| ---------------- | ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `notice_item_id` | 원문 notice 정본과 연결되는 내부 ID | read model이 어떤 원문 notice를 기준으로 만들어졌는지 가리키는 기준 ID다. JSONB도 같은 row 안에 저장하므로, 별도 JSONB 연결 ID 대신 이 값 하나로 원문과 read model을 안정적으로 연결한다. |
| `source_id`      | 공지가 속한 공개 source             | `general`, `scholarship`, `career`, `event`처럼 공지 source를 구분한다. 목록 조회와 source별 필터링에 직접 사용된다.                                                                      |
| `external_id`    | 공지의 외부 식별자                  | 원문 상세 URL과 1:1로 대응되는 외부 식별자다. 원문 추적과 상세 조회 연결에 필요하다.                                                                                                      |

### 2. 공지 성격

| 임시 컬럼명    | 저장할 의미                           | 설명                                                                                                                                                        |
| -------------- | ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `notice_kind`  | 공지 종류                             | 장학, 채용, 행사, 설문, 시스템 안내, 모집, 공모전, 결과 안내 등 공지의 대표 성격이다. 목록 분류, 관련 공지 추천, 사용자 relevance 계산에 반복적으로 쓰인다. |
| `issuer_name`  | 공지의 주관 조직 또는 공고 주체       | 인문진로취업지원팀, 한국장학재단, 특정 재단, 특정 사업단처럼 공지의 발신 주체를 저장한다.                                                                   |
| `issuer_scope` | 내부 조직 공지인지 외부 기관 공지인지 | 내부 공지인지 외부 기관/재단/협회 공지인지 구분한다. 서비스 응답에서 신뢰 맥락과 관련 공지 묶기에 유용하다.                                                 |

### 3. 대상자 관련 사실

| 임시 컬럼명             | 저장할 의미             | 설명                                                                           |
| ----------------------- | ----------------------- | ------------------------------------------------------------------------------ |
| `target_campuses`       | 대상 캠퍼스             | 인문, 자연 등 대상 캠퍼스를 저장한다. 사용자 개인화 relevance에 직접 중요하다. |
| `target_audiences`      | 대상 집단 유형          | 재학생, 휴학생, 졸업생, 졸업예정자, 교직원 등 대상 집단을 저장한다.            |
| `target_program_levels` | 대상 과정               | 학부, 대학원, 전문대학원 등 대상 과정을 구분한다.                              |
| `target_departments`    | 대상 학과/전공/전공계열 | 특정 학과, 전공, 계열 제한이 있는 공지를 위해 저장한다.                        |
| `target_grade_years`    | 대상 학년               | 특정 학년 대상 공지를 직접 필터링하기 위한 값이다.                             |

### 4. 시간 관련 사실

| 임시 컬럼명           | 저장할 의미         | 설명                                                                                            |
| --------------------- | ------------------- | ----------------------------------------------------------------------------------------------- |
| `primary_time_kind`   | 대표 시간축의 종류  | 신청기간인지, 행사기간인지, 운영중단 시간인지, 응답기한인지 같은 대표 시간축의 의미를 저장한다. |
| `primary_start_at`    | 대표 시작 시각      | 신청/행사/운영중단 등 대표 시간축의 시작 시각이다.                                              |
| `primary_end_at`      | 대표 종료 시각      | 대표 시간축의 종료 시각이다.                                                                    |
| `primary_deadline_at` | 대표 마감 시각      | 사용자에게 `언제까지 해야 하는지`를 직접 보여주기 위한 대표 마감 시각이다.                      |
| `has_deadline`        | 마감 시각 존재 여부 | 단순 안내형과 마감성 공지를 빠르게 구분하기 위한 플래그다.                                      |

### 5. 행동/참여 관련 사실

| 임시 컬럼명              | 저장할 의미                             | 설명                                                                                                      |
| ------------------------ | --------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `action_required`        | 사용자가 실제 행동을 해야 하는 공지인지 | 신청, 응답, 참여, 제출, 조회 같은 행동이 필요한 공지인지 나타낸다.                                        |
| `action_kind`            | 행동 유형                               | 신청, 접수, 참여, 응답, 조회, 지원 등 사용자가 해야 하는 대표 행동의 종류다.                              |
| `primary_action_channel` | 대표 행동 채널                          | 웹폼, 시스템, 이메일, 방문, 현장, 전화 등 실제 행동을 수행하는 대표 채널이다.                             |
| `primary_action_url`     | 대표 신청/응답/안내 링크                | 사용자가 바로 이동해야 할 대표 링크다.                                                                    |
| `primary_location`       | 대표 장소                               | 행사, 설명회, 오프라인 제출, 훈련 등에서 직접 가야 할 대표 장소다.                                        |
| `participation_mode`     | 대표 참여 방식                          | 온라인, 오프라인, 혼합, 비대면, 현장 등 참여 방식을 나타낸다. 장소만으로 설명되지 않는 케이스를 보완한다. |

### 6. 혜택/규모 관련 사실

| 임시 컬럼명          | 저장할 의미    | 설명                                                                              |
| -------------------- | -------------- | --------------------------------------------------------------------------------- |
| `has_benefit`        | 혜택 존재 여부 | 장학금, 지원금, 상금, 무료발급, 쿠폰 등 눈에 띄는 혜택이 있는지 저장한다.         |
| `benefit_kind`       | 혜택 종류      | 장학금, 지원금, 등록금, 이자지원, 상금, 무료발급, 쿠폰 등 혜택의 성격을 저장한다. |
| `benefit_amount_krw` | 대표 금액      | 금액이 명확히 드러나는 경우 원화 기준 대표 금액을 저장한다.                       |
| `selection_count`    | 모집/선발 인원 | 선발 인원, 모집 인원처럼 규모를 직접 보여줄 수 있는 값이다.                       |

### 7. 서비스 응답 보강용 필드

| 임시 컬럼명             | 저장할 의미        | 설명                                                                                                                                                                                       |
| ----------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `summary`               | 서비스용 짧은 요약 | 목록과 알림에서 바로 보여줄 1~3문장 수준의 요약이다.                                                                                                                                       |
| `normalized_confidence` | 구조화 결과 신뢰도 | 이번 구조화 결과를 얼마나 믿을 수 있는지 나타내는 값이다. 본문, 첨부 추출, 이미지 OCR이 얼마나 명확했는지에 따라 달라질 수 있으며, 낮으면 JSONB나 원문 fallback을 더 적극적으로 쓰게 된다. |
| `normalized_at`         | 구조화 시각        | 이 read model row가 언제 생성되었는지를 나타낸다. 공지 게시 시각이 아니라, worker가 구조화 결과를 만든 시각이다. 재처리/backfill 추적에 필요하다.                                          |

---

## 값 선정 기준 메모

다음 슬라이스에서 실제 스키마와 적재 코드를 만들 때 값이 흔들리지 않도록, 이번 분석 단계에서 아래 선택 기준도 함께 남긴다.

### 1. enum 성격 필드

아래 필드는 고정 컬럼으로 올리되, 실제 canonical value 집합은 다음 슬라이스에서 스키마와 함께 확정한다.

- `notice_kind`
- `issuer_scope`
- `primary_time_kind`
- `action_kind`
- `primary_action_channel`
- `participation_mode`
- `benefit_kind`

이번 문서에서는 이 필드들이 왜 필요한지와 어떤 의미를 담아야 하는지만 확정하고, 실제 값 집합은 `normalized facts v1` 구현 단계에서 제한된 enum 후보로 정리한다.

### 2. `primary_*` 필드 선정 원칙

공지 하나에 여러 시간축, 여러 행동 채널, 여러 장소가 함께 나타날 수 있으므로, 아래 우선순위로 대표값을 고른다.

- `primary_time_*`
  - 서비스가 사용자에게 가장 먼저 알려야 하는 행동 마감과 직접 연결되는 시간축을 우선한다.
  - 예: 행사일과 신청마감이 함께 있으면, 우선 `신청 마감`을 대표 시간축으로 둔다.
  - 행동 마감이 없고 단순 일정 안내가 핵심이면 행사/운영 기간을 대표 시간축으로 둔다.
- `primary_action_*`
  - 사용자가 실제로 가장 먼저 수행해야 하는 행동의 채널과 링크를 우선한다.
  - 예: 안내 페이지 링크와 신청 폼 링크가 함께 있으면, `신청 폼`을 우선한다.
- `primary_location`
  - 복수 장소가 있더라도 실제 참여/제출/방문이 가장 직접적으로 일어나는 대표 장소를 우선한다.

즉 `primary_*`는 “문서에 등장한 첫 값”이 아니라, 서비스 관점에서 **가장 대표성이 높고 행동과 직접 연결되는 값**으로 해석한다.

---

## JSONB 저장 방식 메모

JSONB는 공지마다 구조가 달라질 수 있는 상세 정보를 담는 계층으로 본다. 이 계층의 상세 내용은 공지 본문, 첨부 추출 텍스트, 이미지 OCR 결과를 바탕으로 **LLM이 공지별로 판단해 넣는 구조**이며, 모든 공지에 대해 고정된 키 집합을 우리가 미리 정해두지는 않는다.

- `normalized facts`와 JSONB는 **같은 row 안에 저장**
- 따라서 JSONB를 위한 **별도 연결 ID는 만들지 않음**
- 원문 notice와의 연결은 `notice_item_id` 하나로 충분

즉 개념적으로는 아래와 같은 형태다.

- `notice_item_id`
- `notice_kind`
- `target_campuses`
- `primary_deadline_at`
- ...
- `details_jsonb`

이 방식의 장점은:

- 정규화 컬럼과 상세 구조를 한 row에서 함께 읽을 수 있음
- read model 1건을 조회하면 JSONB까지 바로 따라옴
- JSONB 전용 연결 관계를 추가로 관리하지 않아도 됨

---

## 예시 row

아래는 위 구조를 기준으로 한 예시 row이다.

```json
{
  "id": 101,
  "notice_item_id": 184,
  "source_id": "scholarship",
  "external_id": "230100",
  "notice_kind": "scholarship",
  "issuer_name": "광진복지재단",
  "issuer_scope": "external",
  "target_campuses": ["humanities"],
  "target_audiences": ["student"],
  "target_program_levels": ["undergraduate", "graduate"],
  "target_departments": [],
  "target_grade_years": [],
  "primary_time_kind": "application_period",
  "primary_start_at": "2026-03-12T00:00:00+09:00",
  "primary_end_at": "2026-03-26T18:00:00+09:00",
  "primary_deadline_at": "2026-03-26T18:00:00+09:00",
  "has_deadline": true,
  "action_required": true,
  "action_kind": "apply",
  "primary_action_channel": "email",
  "primary_action_url": null,
  "primary_location": null,
  "participation_mode": "online",
  "has_benefit": true,
  "benefit_kind": "scholarship",
  "benefit_amount_krw": 2500000,
  "selection_count": null,
  "summary": "광진복지재단이 저소득 가구 대학(원)생을 대상으로 미래도약 장학지원을 모집한다. 거주 및 소득 기준이 있으며 신청 기간 내 서류 제출이 필요하다.",
  "normalized_confidence": 0.84,
  "normalized_at": "2026-04-18T16:10:00+09:00",
  "details_jsonb": {
    "eligibility": {
      "income_requirement": "기준 중위소득 100% 이하",
      "residency_requirement": "본인 또는 부/모/배우자 중 1명이 광진구 1년 이상 거주",
      "academic_requirement": "직전 학기 12학점 이상, 백분율 77점 이상"
    },
    "required_documents": [
      "장학금 신청서",
      "재학증명서",
      "성적증명서",
      "주민등록 관련 서류"
    ],
    "contact": {
      "organization": "광진복지재단",
      "phone": "02-000-0000"
    },
    "notes": [
      "휴학생, 초과학기생, 해외교환학생 제외",
      "광진지역 장학금과 중복 수혜 불가"
    ]
  }
}
```

이 예시에서 중요한 점은:

- 자주 조회할 사실은 일반 컬럼으로 꺼내둠
- 공지마다 달라지는 세부 조건은 `details_jsonb` 안에 둠
- 이 예시의 `details_jsonb`는 한 공지에서 나올 수 있는 예시일 뿐이며, 실제 key 구성은 공지마다 달라질 수 있음
- 둘이 같은 row에 있으므로 별도 JSONB 연결 ID는 필요 없음

---

## normalized facts로 올리지 않기로 본 정보

아래 정보는 중요하긴 하지만 공지마다 구조가 너무 달라 `normalized facts` 컬럼보다 상세 구조 계층에 두는 편이 낫다고 판단했다.

- 제출 서류 상세 목록
- 세부 지원 자격 문장
- 복잡한 예외 조건
- 세부 프로그램 일정표
- 문의처 상세 정보 전체
- 포스터 장식 문구/홍보 문구
- 첨부파일별 상세 의미 해석

즉 `normalized facts`는 **반복적으로 직접 조회되는 핵심 사실**에만 집중한다.

---

## 추가 검증에서 최종 확인한 점

초기 분석셋과 추가 검증셋을 함께 보면 아래 판단은 유지 가능했다.

- `notice_kind`는 거의 모든 공지에서 안정적으로 필요하다.
- 시간 관련 사실은 `body_only`, `image_only`, `attachment_only`, `mixed` 전부에서 반복적으로 중요하다.
- 대상 캠퍼스/대상 집단/행동 유형은 서비스 relevance 판단에 직접 연결된다.
- 첨부 중심 공지에서도 서비스가 먼저 알고 싶은 것은 세부 문서 전체보다 `누가, 언제까지, 무엇을 해야 하는지`였다.
- 다만 실제 운영 응답 관점에서는 `participation_mode`, `primary_action_channel`, `benefit_kind`를 같이 올려두는 편이 더 좋다.
