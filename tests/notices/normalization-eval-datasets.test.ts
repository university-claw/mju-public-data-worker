import { describe, expect, it } from "vitest";
import {
  NOTICE_NORMALIZATION_HOLDOUT_SET,
  NOTICE_NORMALIZATION_TUNING_SET,
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

  it("provides ten real-data samples for both tuning and holdout", () => {
    expect(NOTICE_NORMALIZATION_TUNING_SET).toHaveLength(10);
    expect(NOTICE_NORMALIZATION_HOLDOUT_SET).toHaveLength(10);
  });
});
