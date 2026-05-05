#!/usr/bin/env python3
import json
import statistics
import sys
import warnings
from pathlib import Path

warnings.filterwarnings("ignore", message="'pin_memory' argument is set as true")


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: cafeteria_easyocr_candidate.py <image-path>", file=sys.stderr)
        return 2

    image_path = Path(sys.argv[1])
    if not image_path.exists():
        print(f"image does not exist: {image_path}", file=sys.stderr)
        return 2

    import easyocr
    import cv2
    import numpy as np

    reader = easyocr.Reader(["ko", "en"], gpu=False, verbose=False)
    image_bytes = np.fromfile(str(image_path), dtype=np.uint8)
    image = cv2.imdecode(image_bytes, cv2.IMREAD_COLOR)
    if image is None:
        print(f"could not decode image: {image_path}", file=sys.stderr)
        return 2

    results = reader.readtext(image, detail=1, paragraph=False)
    texts = [text.strip() for _, text, _ in results if text.strip()]
    confidences = [float(confidence) for _, _, confidence in results]
    confidence = statistics.fmean(confidences) * 100 if confidences else None

    print(json.dumps({
        "text": "\n".join(texts),
        "confidence": confidence,
    }, ensure_ascii=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
