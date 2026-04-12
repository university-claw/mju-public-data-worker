# mju-public-data-worker

`mju-public-data-worker`는 명지대학교의 **공통 정보**를 수집, 저장, 정규화하는 Node.js 기반 worker입니다.

이 worker는 사용자 인증이 필요한 개인 데이터는 다루지 않고, 여러 사용자가 함께 참조할 수 있는 공개 정보만 처리합니다.

현재 지원 범위는 다음과 같습니다.

- 공개 공지 4종 수집
- 공지 상세 본문, 첨부파일, 본문 이미지 수집
- 공지 첨부파일 로컬 저장
- 공지 첨부파일 텍스트 추출
- 공지 본문 이미지 OCR
- 학식 인스타그램 게시물 수집
- 학식 이미지 로컬 저장
- 학식 OCR
- 식단표 게시물 판별
- 평일/주말 문서 구조화
- 날짜별 / 식당별 / 끼니별 메뉴 정규화
- 공지 / 학식 스케줄링 실행

## 핵심 개념

이 worker는 아래 세 가지 저장 대상을 함께 만듭니다.

1. `Postgres`
공통 정보 정본과 실행 이력을 저장합니다.

2. `Local Storage`
첨부파일, 본문 이미지, 학식 이미지 같은 원본 자산을 저장합니다.

3. `Read Model`
학식처럼 서비스가 바로 읽기 좋은 정규화 테이블을 만듭니다.

현재 정본 스키마는 기본적으로 `public_data`를 사용합니다.

## 현재 지원하는 데이터 소스

### 공지

현재 아래 4개 공개 공지 게시판을 수집합니다.

- 일반공지
- 장학 / 학자금 공지
- 행사공지
- 진로 / 취업 / 창업 공지

수집 내용:

- 목록 메타데이터
- 상세 본문 HTML / text
- 첨부파일 메타데이터
- 본문 이미지 메타데이터
- 첨부파일 원본 저장
- 본문 이미지 원본 저장
- 첨부파일 텍스트 추출
- 본문 이미지 OCR 결과

현재 첨부파일 텍스트 추출 지원:

- `pdf`
- `docx`
- `hwpx`

현재 미지원:

- `hwp`
- 이미지 첨부 OCR은 별도 후속 지원 범위

### 학식

현재 아래 4개 인스타그램 계정을 수집합니다.

- 학생회관
- 명진당
- 복지동
- 방목기념관

수집 내용:

- 인스타 raw 게시물 메타데이터
- 원본 이미지 저장
- OCR 결과 저장
- 식단표 게시물 판별
- 평일 / 주말 문서 구조화
- 날짜별 / 식당별 / 끼니별 메뉴 정규화

현재 학식 read model:

- `public_data.cafeteria_menu_entries`

이 테이블은 서비스가 바로 읽기 좋은 정규화 결과입니다.

## 기술 스택

- TypeScript
- Node.js
- PostgreSQL
- `got` for HTTP
- `cheerio` for HTML parsing
- `pdf-parse` for PDF text extraction
- `jszip` for `docx` / `hwpx` extraction
- `tesseract.js` for OCR
- `jimp` for image crop / preprocessing / fingerprint

## 실행 환경

권장 환경:

- Node.js 22 이상
- PostgreSQL
- 로컬 파일시스템 저장 경로

## 환경변수

예시는 [.env.example](/C:/Users/김준현/Desktop/mju-public-data-worker/.env.example)에 있습니다.

필수 환경변수:

```env
PGHOST=localhost
PGPORT=5432
PGDATABASE=mjuclaw
PGUSER=mjuclaw_app
PGPASSWORD=change-me
PGSCHEMA=public_data
STORAGE_PROVIDER=local
STORAGE_LOCAL_ROOT=/absolute/path/to/mjuclaw-data/assets
OCR_LANGUAGES=kor+eng
```

설명:

- `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, `PGPASSWORD`
  - Postgres 접속 정보
- `PGSCHEMA`
  - worker가 사용하는 스키마 이름
- `STORAGE_PROVIDER`
  - 현재는 `local`만 지원
- `STORAGE_LOCAL_ROOT`
  - 자산을 저장할 로컬 루트 디렉터리
- `OCR_LANGUAGES`
  - `tesseract.js`에 넘길 OCR 언어 조합

Windows 예시:

```env
STORAGE_LOCAL_ROOT=C:\Users\your-name\Desktop\mjuclaw-data\assets
```

## 설치

```bash
npm install
```

## 기본 실행 순서

### 1. 마이그레이션 적용

```bash
npm run migrate
```

### 2. 환경 점검

```bash
npm run doctor
```

확인 항목:

- DB 연결
- 현재 schema
- 공지 source reachability
- 학식 인스타 source reachability

### 3. 수동 수집 실행

공지:

```bash
npm run collect:notices -- --limit 30
```

학식:

```bash
npm run collect:cafeterias -- --limit 6
```

### 4. 스케줄 tick 실행

```bash
npm run schedule:tick
```

dry-run:

```bash
tsx src/main.ts schedule tick --dry-run
```

## 사용 가능한 CLI 명령

현재 엔트리 포인트는 [src/main.ts](/C:/Users/김준현/Desktop/mju-public-data-worker/src/main.ts)입니다.

지원 명령:

- `migrate`
- `doctor`
- `collect notices`
- `collect cafeterias`
- `schedule tick`

예시:

```bash
tsx src/main.ts migrate
tsx src/main.ts doctor
tsx src/main.ts collect notices --limit 10
tsx src/main.ts collect cafeterias --limit 3
tsx src/main.ts schedule tick --dry-run
```

## 스케줄링 개요

현재 스케줄러는 아래 정책을 사용합니다.

- 공지: 6시간 고정 간격
- 학식: 소스별 주간 시간 창 기반 polling

학식은 “최신 1건 확인”이 아니라 **최근 여러 게시물 코드 집합 비교**로 신규 게시물을 감지합니다.

즉 pinned 게시물이나 운영 공지 때문에 최신 식단표가 top 1에 안 보여도 놓치지 않도록 설계되어 있습니다.

## 저장 구조 개요

### Postgres

주요 테이블 예시:

- `notice_items`
- `notice_attachments`
- `notice_attachment_extractions`
- `notice_images`
- `notice_image_ocr_results`
- `cafeteria_instagram_posts`
- `cafeteria_menu_documents`
- `cafeteria_menu_entries`
- `scrape_runs`
- `scheduler_tasks`

자세한 스키마는 [migrations](/C:/Users/김준현/Desktop/mju-public-data-worker/migrations) 디렉터리에서 확인할 수 있습니다.

### Local Storage

예시 경로:

- `notices/{source_id}/{external_id}/attachments/...`
- `notices/{source_id}/{external_id}/images/...`
- `cafeterias/{source_id}/{instagram_post_code}/original.jpg`

DB에는 절대경로가 아니라 `storage_key`만 저장합니다.

## 현재 구현 수준

### 공지

현재는 **문서 / 자산 / 추출 결과**까지 정리되어 있습니다.

즉 다음과 같은 용도에 적합합니다.

- 최근 공지 목록 조회
- 공지 상세 확인
- 첨부파일 목록 확인
- 첨부 텍스트 추출 결과 확인
- 본문 이미지 OCR 확인

하지만 아직 공지 전용 **읽기용 의미 정규화 모델**은 없습니다.

예를 들면 아직 아래 같은 구조는 별도 설계 대상입니다.

- 마감일
- 대상 학과 / 학년
- 장학금 액수
- 제출 서류 목록
- 핵심 fact 분해

### 학식

현재는 **read model까지 생성**됩니다.

즉 다음과 같은 용도에 적합합니다.

- 오늘 식당별 점심 / 저녁 조회
- 특정 식당의 주간 메뉴 조회
- 정규화 confidence 기반 품질 확인

## 개발 스크립트

```bash
npm run check
npm run test
npm run test:watch
npm run build
```

## 프로젝트 구조

```text
src/
  cafeterias/   # 학식 수집, OCR, 분류, 정규화
  config/       # 환경변수 로딩
  db/           # DB client, repository, migrator
  http/         # HTTP client
  notices/      # 공지 목록/상세 수집, 자산/OCR/추출
  scheduler/    # 스케줄 정책과 due 계산
  shared/       # 공통 유틸
  storage/      # local asset store
  workers/      # 도메인별 수집 실행
  main.ts       # CLI entrypoint
```

## 테스트

이 프로젝트는 다음을 함께 검증합니다.

- 파싱 로직 단위 테스트
- DB repository 테스트
- worker orchestration 테스트
- 스케줄 evaluator 테스트
- 실데이터 수집 테스트

실데이터 검증을 자주 수행하는 worker이므로, 단순 fixture 테스트뿐 아니라 실제 source reachability와 collect 실행을 함께 확인하는 운영 흐름이 중요합니다.

## 앞으로 확장 가능한 범위

현재 구조는 다음 공통정보 도메인 확장도 염두에 두고 있습니다.

- 학사일정
- 셔틀
- 생활정보

또한 공지 쪽은 향후 별도의 read model을 추가해, 서비스가 바로 읽기 좋은 의미 단위 테이블로 확장할 수 있습니다.

