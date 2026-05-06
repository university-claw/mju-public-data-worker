#!/usr/bin/env python3
import contextlib
import json
import os
import statistics
import sys
import warnings
from pathlib import Path

warnings.filterwarnings("ignore")


def extract_payload(result_page):
    if isinstance(result_page, dict):
        return result_page

    json_value = getattr(result_page, "json", None)
    if callable(json_value):
        return json_value()
    if isinstance(json_value, dict):
        return json_value

    return {}


def to_list(value):
    if value is None:
        return []
    tolist = getattr(value, "tolist", None)
    if callable(tolist):
        return tolist()
    if isinstance(value, list):
        return value
    if isinstance(value, tuple):
        return list(value)
    return []


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: cafeteria_paddleocr_candidate.py <image-path>", file=sys.stderr)
        return 2

    image_path = Path(sys.argv[1])
    if not image_path.exists():
        print(f"image does not exist: {image_path}", file=sys.stderr)
        return 2

    with contextlib.redirect_stdout(sys.stderr):
        from paddleocr import PaddleOCR

        det_model = os.environ.get("PADDLE_OCR_DET_MODEL_NAME")
        rec_model = os.environ.get("PADDLE_OCR_REC_MODEL_NAME")
        kwargs = {
            "use_doc_orientation_classify": False,
            "use_doc_unwarping": False,
            "use_textline_orientation": False,
        }
        if det_model:
            kwargs["text_detection_model_name"] = det_model
        if rec_model:
            kwargs["text_recognition_model_name"] = rec_model

        ocr = PaddleOCR(**kwargs)
        result = ocr.predict(str(image_path))

    texts = []
    confidences = []
    blocks = []
    for page in result:
        payload = extract_payload(page)
        res = payload.get("res", payload) if isinstance(payload, dict) else {}
        rec_texts = to_list(res.get("rec_texts"))
        rec_scores = to_list(res.get("rec_scores"))
        rec_boxes = to_list(res.get("rec_boxes"))

        for index, text in enumerate(rec_texts):
            normalized = str(text).strip()
            if normalized:
                texts.append(normalized)
                block = {"text": normalized}
                if index < len(rec_scores):
                    try:
                        block["confidence"] = float(rec_scores[index]) * 100
                    except (TypeError, ValueError):
                        pass
                if index < len(rec_boxes):
                    box = rec_boxes[index]
                    if isinstance(box, (list, tuple)) and len(box) >= 4:
                        try:
                            block["box"] = [float(box[0]), float(box[1]), float(box[2]), float(box[3])]
                        except (TypeError, ValueError):
                            pass
                blocks.append(block)

        for score in rec_scores:
            try:
                confidences.append(float(score))
            except (TypeError, ValueError):
                pass

    confidence = statistics.fmean(confidences) * 100 if confidences else None
    print(json.dumps({
        "text": "\n".join(texts),
        "confidence": confidence,
        "blocks": blocks,
    }, ensure_ascii=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
