import { describe, expect, it } from "vitest";
import {
  NOTICE_NORMALIZATION_HOLDOUT_SET,
  NOTICE_NORMALIZATION_REGRESSION_SET,
  NOTICE_NORMALIZATION_TUNING_SET,
  NOTICE_NORMALIZATION_VALIDATION_V2_SET,
} from "../../src/notices/normalization-eval-datasets.js";

describe("notice normalization evaluation datasets", () => {
  it("keeps tuning and holdout sets disjoint", () => {
    const tuningKeys = new Set(
      NOTICE_NORMALIZATION_TUNING_SET.map(
        (sample) => `${sample.sourceId}:${sample.externalId}`,
      ),
    );
    const overlap = NOTICE_NORMALIZATION_HOLDOUT_SET.filter((sample) =>
      tuningKeys.has(`${sample.sourceId}:${sample.externalId}`)
    );

    expect(overlap).toEqual([]);
  });

  it("keeps validation_v2 disjoint from tuning and holdout", () => {
    const priorKeys = new Set(
      [...NOTICE_NORMALIZATION_TUNING_SET, ...NOTICE_NORMALIZATION_HOLDOUT_SET].map(
        (sample) => `${sample.sourceId}:${sample.externalId}`,
      ),
    );
    const overlap = NOTICE_NORMALIZATION_VALIDATION_V2_SET.filter((sample) =>
      priorKeys.has(`${sample.sourceId}:${sample.externalId}`),
    );

    expect(overlap).toEqual([]);
  });

  it("provides the expected sample counts for each dataset", () => {
    expect(NOTICE_NORMALIZATION_TUNING_SET).toHaveLength(10);
    expect(NOTICE_NORMALIZATION_HOLDOUT_SET).toHaveLength(10);
    expect(NOTICE_NORMALIZATION_VALIDATION_V2_SET).toHaveLength(14);
    expect(NOTICE_NORMALIZATION_REGRESSION_SET).toHaveLength(6);
  });

  it("keeps event coverage in the regression set", () => {
    const regressionKeys = new Set(
      NOTICE_NORMALIZATION_REGRESSION_SET.map(
        (sample) => `${sample.sourceId}:${sample.externalId}`,
      ),
    );

    expect(regressionKeys.has("event:230718")).toBe(true);
  });
});
