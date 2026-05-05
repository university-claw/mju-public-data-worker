# mju-public-data-worker — 공지/학식 정본 생성 worker.
# 컨테이너 안에서 매 15분 `npm run schedule:tick` 실행. 호스트 launchd 의존 제거.
# build context = mju-public-data-worker 루트.

FROM node:22-slim AS base

ENV NODE_ENV=production \
    LOG_LEVEL=info

# tesseract.js native deps + pdf/docx/hwpx 추출 도구
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
       ca-certificates curl tini \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/worker

# package.json 먼저 → 레이어 캐시
COPY package.json package-lock.json* ./
# tsx는 dev deps이지만 schedule:tick / migrate 모두 tsx로 도므로 포함 필요
RUN npm ci --include=dev || npm install --include=dev

# source
COPY tsconfig.json ./
COPY src/ ./src/
COPY migrations/ ./migrations/

# 자산 디렉토리 (compose의 named volume 또는 host mount)
RUN mkdir -p /data/assets && chown -R node:node /opt/worker /data/assets

USER node

ENV STORAGE_LOCAL_ROOT=/data/assets

# entrypoint:
#  1) 시작 시 마이그레이션 1회 (멱등 — 이미 적용된 마이그레이션은 skip).
#  2) 매 15분 schedule:tick. 실패해도 다음 tick에서 회복하도록 || true.
#     (장애 상황을 silent하게 흘리지 않도록 stderr는 그대로 컨테이너 로그로.)
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["bash", "-c", "set -e; npm run migrate; while true; do echo \"[$(date -Iseconds)] schedule:tick start\"; npm run schedule:tick || echo \"[$(date -Iseconds)] schedule:tick failed (will retry next tick)\"; sleep 900; done"]
