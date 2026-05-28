# Docker Worker Image

The production worker image includes:

- Node.js runtime
- compiled TypeScript worker
- runtime npm dependencies
- Python virtualenv
- PaddlePaddle CPU
- PaddleOCR
- migrations
- OCR scripts

It runs PaddleOCR directly inside the worker container. It does not call Docker
from inside Docker.

## Build

```bash
docker build -t mju-public-data-worker:ocr-paddle .
```

## Paddle OCR Environment

These values are baked into the image as defaults. Override them only when
intentionally testing another OCR command or model.

```env
CAFETERIA_OCR_COMMAND=python scripts/cafeteria_paddleocr_candidate.py {image}
PADDLE_OCR_REC_MODEL_NAME=korean_PP-OCRv5_mobile_rec
STORAGE_LOCAL_ROOT=/data/public-assets
PUBLIC_DATA_WORKER_TICK_INTERVAL_SECONDS=600
```

The default container command runs migrations once, then executes `schedule tick`
on the configured interval.

Set `PUBLIC_DATA_WORKER_RUN_MIGRATIONS=0` to skip the startup migration step.

## Public Data Seed Import

Large MSI course catalog exports and graduation requirement JSON files should be
kept out of code PRs. Store them as a private GitHub Release asset zip and let the
worker import them into Postgres.

Required zip layout:

```text
course-catalog-2026-10.json
graduation-requirements/*.json
```

Run once on demand:

```bash
PUBLIC_DATA_SEED_RELEASE_TAG=public-data-seeds-2026-10 \
PUBLIC_DATA_SEED_ASSET_NAME=mju-public-data-seeds-2026-10.zip \
PUBLIC_DATA_SEED_GITHUB_TOKEN=<token-for-private-release> \
npm run seed:import-release
```

Or import at container startup after migrations:

```env
PUBLIC_DATA_SEED_IMPORT_ON_START=1
PUBLIC_DATA_SEED_RELEASE_REPO=university-claw/mju-public-data-worker
PUBLIC_DATA_SEED_RELEASE_TAG=public-data-seeds-2026-10
PUBLIC_DATA_SEED_ASSET_NAME=mju-public-data-seeds-2026-10.zip
PUBLIC_DATA_SEED_GITHUB_TOKEN=<token-for-private-release>
```

Mount `/data/public-assets` as the persisted local asset volume and `/root/.paddlex`
as the Paddle model cache volume.
