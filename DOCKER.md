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

Mount `/data/public-assets` as the persisted local asset volume and `/root/.paddlex`
as the Paddle model cache volume.
