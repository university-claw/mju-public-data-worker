# 공지 정규화 프롬프트 및 모델 평가 정리

## 문서 목적

이 문서는 `notice normalization context`를 기반으로 `normalized facts + details_jsonb`를 생성하기 위해 진행한 프롬프트/모델 평가 결과를 최종 정리한 문서이다.

이 문서는 아래 내용을 한 번에 확인할 수 있도록 정리한다.

- 어떤 모델을 채택했는가
- 최종 채택된 프롬프트/후처리 구성은 무엇인가
- 실제 공지 데이터 기준으로 어떤 문제가 줄었는가
- `primary_action_url` 문제를 어떻게 다뤘는가
- 현재 결과물을 어느 정도 신뢰할 수 있는가

---

## 빠른 요약

- 최종 채택 모델은 `gpt-5.4-mini`이다.
- `gpt-5.4-nano`도 구조는 맞췄지만, 핵심 facts 안정성이 `mini`보다 낮았다.
- 최종 채택 구성은 아래와 같다.
  - 모델: `gpt-5.4-mini`
  - 프롬프트 버전: `v8`
  - 출력 방식: `Responses API + Structured Outputs`
  - 추가 보정: `primary_action_url` post-processing resolver
- 최종 구성은 실제 공지 기준으로 아래를 만족한다.
  - `validation_v2` 14건: schema valid `14/14`, consistency warnings `0`
  - `regression` 6건: schema valid `6/6`, consistency warnings `0`
- 프롬프트와 후처리 보정으로 아래 문제가 크게 줄었다.
  - `notice_kind` 흔들림
  - `target_departments` 과추론
  - 급여/시급의 `benefit_*` 오분류
  - 가짜 링크 생성
  - generic root URL의 `primary_action_url` 오선택
- 현재 남은 한계는 주로 원문/OCR 품질과 source 데이터 자체의 애매함에서 온다.

---

## 평가 공통 전제

### 입력 컨텍스트

LLM에는 아래 5개만 포함된 lean context를 넣었다.

- 제목
- 본문 텍스트
- 본문 링크
- 첨부 추출 텍스트
- 이미지 OCR 텍스트

관련 코드:
- [normalization-context.ts](/C:/Users/김준현/Desktop/mju-public-data-worker/src/notices/normalization-context.ts)

### 출력 방식

- OpenAI `Responses API + Structured Outputs`
- `normalized facts`는 코드와 스키마로 이미 고정된 필드를 사용
- `details_jsonb`는 고정된 top-level key만 허용

관련 코드:
- 프롬프트: [normalization-prompt.ts](/C:/Users/김준현/Desktop/mju-public-data-worker/src/notices/normalization-prompt.ts)
- 평가 셋: [normalization-eval-datasets.ts](/C:/Users/김준현/Desktop/mju-public-data-worker/src/notices/normalization-eval-datasets.ts)
- 평가 실행기: [normalization-evaluator.ts](/C:/Users/김준현/Desktop/mju-public-data-worker/src/notices/normalization-evaluator.ts)
- Structured Outputs 스키마: [normalization-output-schema.ts](/C:/Users/김준현/Desktop/mju-public-data-worker/src/notices/normalization-output-schema.ts)

---

## 최종 채택 구성

### 채택 모델

- `gpt-5.4-mini`

### 채택 프롬프트

- `NOTICE_NORMALIZATION_PROMPT_VERSION = "v8"`

### 채택 후처리

- `primary_action_url` resolver 사용

관련 코드:
- [action-url-resolver.ts](/C:/Users/김준현/Desktop/mju-public-data-worker/src/notices/action-url-resolver.ts)

이 resolver는 모델 출력을 그대로 저장하지 않고, 아래를 추가로 보정한다.

- generic root URL 제거
- plain email을 `mailto:` direct candidate로 인식
- direct action 신호가 있는 sole candidate만 자동 채움
- 문의용 이메일은 자동 채움 금지
- `primary_action_url`와 `details_jsonb.resource_links` 중복 제거

즉 최종 결과는 **프롬프트 + Structured Outputs + 링크 후처리**의 결합 결과다.

---

## 모델 비교 결과

모델 비교는 `gpt-5.4-mini`와 `gpt-5.4-nano`를 실제 공지 데이터에 돌려서 진행했다.

사용 셋:

- 튜닝셋 10건
- 홀드아웃셋 10건

관련 코드:
- [normalization-eval-datasets.ts](/C:/Users/김준현/Desktop/mju-public-data-worker/src/notices/normalization-eval-datasets.ts)

대표 비교 기준은 아래였다.

- schema_valid
- 핵심 facts 정확도
- `details_jsonb` top-level routing 안정성
- hallucination / omission
- 토큰 / 비용

### 홀드아웃 기준 비교 요약

| 모델 | sampleCount | schemaValidCount | avg input tokens | avg output tokens | avg populated scalar facts | avg details keys |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| `gpt-5.4-mini` | 10 | 10 | 8350.7 | 1221.7 | 15.6 | 9.6 |
| `gpt-5.4-nano` | 10 | 10 | 8350.7 | 1760.8 | 13.1 | 9.1 |

### 모델 채택 이유

`gpt-5.4-mini`를 채택한 이유는 아래와 같다.

- `notice_kind`가 더 안정적이었다.
- `action_required`, `action_kind` 판단이 더 덜 흔들렸다.
- `primary_action_url`에서 `nano`보다 더 자연스러운 direct link 선택을 보였다.
- `benefit_kind`, `benefit_amount_krw` 같은 금전/혜택 관련 facts가 더 안정적이었다.
- 출력 길이가 더 적절했고, 같은 입력 대비 불필요한 verbosity가 적었다.

정리하면:

- `nano`는 비용은 더 싸지만 의미 판단이 더 흔들렸고,
- 실제 서비스 정규화에는 `mini`가 더 적합했다.

---

## 프롬프트와 후처리로 줄인 대표 문제

이번 평가에서 중요한 건 “몇 버전까지 갔는가”보다, **최종적으로 어떤 오류가 정리됐는가**이다.

### 1. `target_departments` 과추론 감소

초기에는 아래 같은 값이 `target_departments`에 잘못 들어가곤 했다.

- `인문계열`
- `사회계열`
- `교육계열`
- `공학계열`
- `자연계열`
- `예체능계열`
- 초빙분야 / 모집분야 / 선발직렬

최종 구성에서는 이런 broad bucket / 모집분야 성격 값들을 `target_departments`에서 배제하도록 정리됐다.

대표 예시:
- [general-230869.json](/C:/Users/김준현/Desktop/mju-public-data-worker/tmp/notice-normalization-evals-v2/2026-04-19T06-18-03-927Z-validation_v2/gpt-5.4-mini/general-230869.json)
- [scholarship-230580.json](/C:/Users/김준현/Desktop/mju-public-data-worker/tmp/notice-normalization-evals-v2/2026-04-19T06-18-03-927Z-validation_v2/gpt-5.4-mini/scholarship-230580.json)
- [general-230921.json](/C:/Users/김준현/Desktop/mju-public-data-worker/tmp/notice-normalization-evals-v2/2026-04-19T06-15-55-920Z-regression/gpt-5.4-mini/general-230921.json)

### 2. 급여/시급의 `benefit_*` 오분류 감소

초기에는 아래 같은 값이 대표 혜택으로 오해되던 문제가 있었다.

- 채용 연봉
- 근로장학 시급
- 활동비 단가

최종 구성에서는 아래 원칙을 강하게 반영했다.

- 급여/시급/보수는 원칙적으로 `benefit_amount_krw`로 쓰지 않는다.
- 채용/근로/인턴/일경험류 보수는 `content_details` 또는 `benefit_details`로 내린다.
- 대표 혜택 facts는 “직접 지원/장학/수혜” 성격일 때만 올린다.

대표 예시:
- [general-231000.json](/C:/Users/김준현/Desktop/mju-public-data-worker/tmp/notice-normalization-evals-v2/2026-04-19T06-18-03-927Z-validation_v2/gpt-5.4-mini/general-231000.json)
- [scholarship-229764.json](/C:/Users/김준현/Desktop/mju-public-data-worker/tmp/notice-normalization-evals-v2/2026-04-19T06-18-03-927Z-validation_v2/gpt-5.4-mini/scholarship-229764.json)

### 3. 가짜 링크 / 설명용 문자열 생성 방지

초기에는 실제 URL이 없는데도 `resource_links`에 설명용 문자열이 들어갈 위험이 있었다.

최종 구성에서는 아래를 강하게 제한했다.

- `resource_links.url`은 실제 URL만 허용
- `primary_action_url`와 중복되는 링크는 `resource_links`에서 제거
- URL이 없으면 섹션을 `null`로 둔다

### 4. `notice_kind` 경계 안정화

행사/모집/채용/근로/장학이 섞인 공지에서 `notice_kind`가 흔들리는 문제가 줄었다.

특히:

- 행사처럼 보이지만 실제로는 모집이 핵심인 공지
- 장학처럼 보이지만 실제로는 근로/보수 성격이 강한 공지
- 채용/초빙/근로 공지

에서 더 안정적인 대표 category를 고르게 됐다.

대표 예시:
- [event-230718.json](/C:/Users/김준현/Desktop/mju-public-data-worker/tmp/notice-normalization-evals-v2/2026-04-19T06-15-55-920Z-regression/gpt-5.4-mini/event-230718.json)

---

## `primary_action_url` 정리 결과

이번 평가 문서에서 가장 중요한 보강 포인트는 `primary_action_url`이다.

### 문제 유형

초기에는 아래 같은 문제가 남아 있었다.

- 학교 메인 홈페이지를 `primary_action_url`로 선택
- 재단/포털 메인 URL을 `primary_action_url`로 선택
- `홈페이지 접속 후 ... 클릭`류 경로 안내를 direct action URL처럼 오해
- plain email을 놓쳐서 제출 메일 주소가 비는 경우
- 반대로 문의용 이메일을 과하게 direct action으로 올릴 위험

### 최종 처리 원칙

최종 구성에서는 아래 규칙을 적용했다.

1. homepage/root URL + 메뉴 이동 안내는 `generic root URL`로 본다
2. generic root URL은 direct action 링크가 아니면 `null`
3. plain email은 `mailto:` direct candidate로 인식 가능
4. `primary_action_url`이 비었을 때도, direct action 신호가 있는 sole candidate면 채운다
5. 문의용 이메일은 자동 채움하지 않는다
6. generic root URL을 direct 후보로 교체할 때는
   - 단일 후보이거나
   - 충분히 우세한 후보일 때만 교체
   - 복수 direct 후보가 있으면 임의 치환하지 않는다

### 최종 실데이터 대표 케이스

#### 이메일 제출 케이스 유지

- `career:230967`
  - 최종: `primary_action_channel = email`
  - 최종: `primary_action_url = mailto:ani2012kaia@gmail.com`
- `scholarship:230100`
  - 최종: `primary_action_channel = email`
  - 최종: `primary_action_url = mailto:gjsw@daum.net`

대표 artifact:
- [career-230967.json](/C:/Users/김준현/Desktop/mju-public-data-worker/tmp/notice-normalization-evals-v5/2026-04-19T06-56-37-869Z-validation_v2/gpt-5.4-mini/career-230967.json)
- [scholarship-230100.json](/C:/Users/김준현/Desktop/mju-public-data-worker/tmp/notice-normalization-evals-v6/2026-04-19T07-06-04-169Z-regression/gpt-5.4-mini/scholarship-230100.json)

#### generic root URL 제거

- `scholarship:230321`
  - 초기: `https://www.hissf.or.kr`
  - 최종: `primary_action_url = null`

대표 artifact:
- [scholarship-230321.json](/C:/Users/김준현/Desktop/mju-public-data-worker/tmp/notice-normalization-evals-v5/2026-04-19T06-56-37-869Z-validation_v2/gpt-5.4-mini/scholarship-230321.json)

### 최종 평가 수치

`primary_action_url` 보정까지 반영한 최종 실데이터 결과:

#### validation_v2 / v8 + resolver

- sampleCount: `14`
- schemaValidCount: `14`
- consistencyWarningCount: `0`
- primaryActionUrlChangedCount: `2`
- genericRootClearedCount: `1`
- directCandidateReplacementCount: `0`

summary:
- [validation_v2 summary](/C:/Users/김준현/Desktop/mju-public-data-worker/tmp/notice-normalization-evals-v5/2026-04-19T06-56-37-869Z-validation_v2/summary.json)

#### regression / v8 + resolver

- sampleCount: `6`
- schemaValidCount: `6`
- consistencyWarningCount: `0`
- primaryActionUrlChangedCount: `0`
- genericRootClearedCount: `0`
- directCandidateReplacementCount: `0`

summary:
- [regression summary](/C:/Users/김준현/Desktop/mju-public-data-worker/tmp/notice-normalization-evals-v6/2026-04-19T07-06-04-169Z-regression/summary.json)

이 수치가 의미하는 바는 다음과 같다.

- generic root URL은 실제로 걸러지기 시작했다.
- 이미 잘 맞던 direct action URL은 regression 없이 유지됐다.
- resolver가 과하게 random replacement를 하지 않도록 제한됐다.

---

## 토큰과 비용 감각

모델 비교와 후속 재검증에서 확인된 평균값 기준으로 보면, `gpt-5.4-mini`는 공지 1건당 대략 아래 수준이었다.

- 평균 입력 토큰: 약 `8.3k ~ 9.9k`
- 평균 출력 토큰: 약 `1.0k ~ 1.2k`
- 평균 비용: 대략 `약 $0.011 ~ $0.012`

즉 공지 1건당 대략 **1.1~1.2센트 수준**으로 보면 된다.

---

## 최종 평가 결과

### 채택 모델

- `gpt-5.4-mini`

### 최종 채택 구성

- `Responses API + Structured Outputs`
- lean notice normalization context
- `v8` prompt
- `primary_action_url` resolver

### 결과 요약

- 모델 비교 기준으로 `mini`가 `nano`보다 더 안정적이었다.
- prompt-only 개선으로 핵심 facts 품질이 상당히 올라갔다.
- `primary_action_url`의 대표적인 남은 문제는 후처리로 다뤄서 상당 부분 정리했다.
- 최종 실데이터 검증에서 schema와 basic consistency는 모두 안정적으로 유지됐다.

---

## 현재 한계

현재도 아래 한계는 남아 있다.

- 일부 공지는 원문/OCR 품질 때문에 대표값 자체가 애매하다.
- aggregate summary만으로는 semantic correctness를 완전히 판정할 수 없다.
- 최종 산출물은 여전히 per-notice artifact 수동 검토가 병행되어야 한다.

즉 이 문서의 결론은:

> `gpt-5.4-mini + v8 prompt + primary_action_url resolver` 조합이 현재 notice read model 정규화에 가장 적절한 평가 결과를 보여주며, 실데이터 기준으로 충분히 안정적인 수준에 도달했다.
