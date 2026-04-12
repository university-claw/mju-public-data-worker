import { Jimp } from "jimp";

export interface CafeteriaImageFingerprint {
  perceptualHash: string;
}

/**
 * 학식표 이미지는 같은 식당군 안에서 템플릿이 반복되는 편이라, OCR이 흔들려도
 * 이미지 자체의 "생김새"를 비교할 수 있으면 분류 안정성이 크게 올라간다.
 * 여기서는 무거운 비전 파이프라인 대신 Jimp의 perceptual hash를 사용해
 * "기존 식단표와 얼마나 비슷한가"를 가벼운 문자열 비교로 판단한다.
 */
export async function buildCafeteriaImageFingerprint(
  buffer: Buffer,
): Promise<CafeteriaImageFingerprint> {
  const image = await Jimp.read(buffer);

  return {
    perceptualHash: image.pHash(),
  };
}

export function calculatePerceptualHashDistance(
  left: string,
  right: string,
): number {
  if (!left || !right || left.length !== right.length) {
    return 1;
  }

  let differenceCount = 0;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      differenceCount += 1;
    }
  }

  return differenceCount / left.length;
}
