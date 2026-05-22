import { describe, expect, it } from "vitest";
import { buildMjuBoardSearchUrl } from "../../src/shuttles/source.js";

describe("shuttle source", () => {
  it("builds a general notice title-search URL for the shuttle keyword", () => {
    const url = new URL(buildMjuBoardSearchUrl({ keyword: "셔틀" }));
    const decodedPayload = Buffer.from(
      url.searchParams.get("enc") ?? "",
      "base64",
    ).toString("utf8");

    expect(url.toString()).toContain("/mjukr/255/subview.do");
    expect(decodedPayload).toContain("fnct1|@@|");
    expect(decodedPayload).toContain("srchColumn%3Dsj");
    expect(decodedPayload).toContain("srchWrd%3D%EC%85%94%ED%8B%80");
  });
});
