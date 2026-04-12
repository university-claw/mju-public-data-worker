import { describe, expect, it } from "vitest";
import { parseKoreanDateToIso } from "../../src/shared/date.js";

describe("parseKoreanDateToIso", () => {
  it("parses a korean board date without time as midnight KST", () => {
    expect(parseKoreanDateToIso("2026.04.07")).toBe("2026-04-06T15:00:00.000Z");
  });

  it("parses a korean board date with time", () => {
    expect(parseKoreanDateToIso("2026.04.01 09:30")).toBe(
      "2026-04-01T00:30:00.000Z",
    );
  });

  it("falls back to the platform date parser for RFC dates", () => {
    expect(parseKoreanDateToIso("Tue, 07 Apr 2026 09:00:00 +0900")).toBe(
      "2026-04-07T00:00:00.000Z",
    );
  });

  it("throws when the input is not a supported date", () => {
    expect(() => parseKoreanDateToIso("점검 중")).toThrow(
      /unrecognized korean date format/,
    );
  });
});
