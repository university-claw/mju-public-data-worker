FROM node:22-slim AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --include=dev

COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build
RUN npm prune --omit=dev

FROM node:22-slim AS runtime

ARG PADDLEPADDLE_VERSION=3.2.0
ARG PADDLEOCR_VERSION=3.3.0

ENV DEBIAN_FRONTEND=noninteractive \
    NODE_ENV=production \
    PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK=True \
    PYTHONIOENCODING=utf-8 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    CAFETERIA_OCR_COMMAND="python scripts/cafeteria_paddleocr_candidate.py {image}" \
    PADDLE_OCR_REC_MODEL_NAME=korean_PP-OCRv5_mobile_rec

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        libgl1 \
        libglib2.0-0 \
        libgomp1 \
        python3 \
        python3-pip \
        python3-venv \
    && rm -rf /var/lib/apt/lists/*

RUN python3 -m venv /opt/paddleocr-venv \
    && /opt/paddleocr-venv/bin/python -m pip install --upgrade pip \
    && /opt/paddleocr-venv/bin/python -m pip install "paddlepaddle==${PADDLEPADDLE_VERSION}" -i https://www.paddlepaddle.org.cn/packages/stable/cpu/ \
    && /opt/paddleocr-venv/bin/python -m pip install "paddleocr==${PADDLEOCR_VERSION}"

ENV PATH="/opt/paddleocr-venv/bin:${PATH}"

WORKDIR /app

COPY --from=build /app/package.json ./package.json
COPY --from=build /app/package-lock.json ./package-lock.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY migrations/ ./migrations/
COPY scripts/ ./scripts/

RUN mkdir -p /data/public-assets /root/.paddlex \
    && chmod +x scripts/cafeteria_paddleocr_candidate.py scripts/run-scheduler-loop.sh

CMD ["scripts/run-scheduler-loop.sh"]
