import { describe, expect, it, vi } from "vitest";
import {
  fetchCafeteriaOfficialPages,
  fetchCafeteriaOfficialPage,
  OfficialPageFetchError,
  parseOfficialPageNavigation,
} from "../../src/cafeterias/official-page-fetcher.js";
import type { CafeteriaOfficialPageSource } from "../../src/cafeterias/types.js";

const SOURCE: CafeteriaOfficialPageSource = {
  sourceId: "student-hall",
  pageKey: "486",
  pageUrl: "https://mjedu.mju.ac.kr/mjukr/486/subview.do",
  viewActionPath: "/diet/mjukr/5/view.do",
  name: "학생회관",
  active: true,
};

const CURRENT_HTML = `
  <html>
    <body>
      <form id="viewForm" method="post" action="/diet/mjukr/5/view.do">
        <input type="hidden" name="layout" value="encoded-layout" />
        <input type="hidden" name="monday" value="2026.04.20" />
        <input type="hidden" id="week" name="week" />
      </form>
      <table><tbody><tr><th>04.20 (월)</th><td>중식</td><td>-</td><td>김치볶음밥</td><td>-</td></tr></tbody></table>
    </body>
  </html>
`;

const PREVIOUS_HTML = `
  <html>
    <body>
      <form id="viewForm" method="post" action="/diet/mjukr/5/view.do">
        <input type="hidden" name="layout" value="encoded-layout" />
        <input type="hidden" name="monday" value="2026.04.13" />
        <input type="hidden" id="week" name="week" />
      </form>
      <table><tbody><tr><th>04.13 (월)</th><td>중식</td><td>-</td><td>비빔밥</td><td>-</td></tr></tbody></table>
    </body>
  </html>
`;

describe("official-page-fetcher", () => {
  it("parses navigation inputs from the official page form", () => {
    const navigation = parseOfficialPageNavigation(CURRENT_HTML, SOURCE.pageUrl);

    expect(navigation).toEqual({
      actionUrl: "https://mjedu.mju.ac.kr/diet/mjukr/5/view.do",
      layout: "encoded-layout",
      monday: "2026.04.20",
    });
  });

  it("returns the current week page without extra requests", async () => {
    const client = {
      get: vi.fn(async () => ({ body: CURRENT_HTML })),
      post: vi.fn(),
    };

    const pages = await fetchCafeteriaOfficialPages(
      SOURCE,
      ["current"],
      client,
    );

    expect(pages).toHaveLength(1);
    expect(pages[0]).toMatchObject({
      source: SOURCE,
      weekScope: "current",
      weekStartDate: "2026-04-20",
      rawHtml: CURRENT_HTML,
    });
    expect(client.get).toHaveBeenCalledTimes(1);
    expect(client.post).not.toHaveBeenCalled();
  });

  it("follows the redirect flow for the previous week page", async () => {
    const client = {
      get: vi
        .fn()
        .mockResolvedValueOnce({ body: CURRENT_HTML })
        .mockResolvedValueOnce({ body: PREVIOUS_HTML }),
      post: vi.fn(async () => ({
        body: "",
        headers: {
          location:
            "https://mjedu.mju.ac.kr/mjukr/486/subview.do?enc=dummy-previous",
        },
      })),
    };

    const pages = await fetchCafeteriaOfficialPages(
      SOURCE,
      ["current", "previous"],
      client,
    );

    expect(pages).toHaveLength(2);
    expect(pages[1]).toMatchObject({
      weekScope: "previous",
      weekStartDate: "2026-04-13",
      rawHtml: PREVIOUS_HTML,
    });
    expect(client.post).toHaveBeenCalledWith(
      "https://mjedu.mju.ac.kr/diet/mjukr/5/view.do",
      expect.objectContaining({
        form: {
          layout: "encoded-layout",
          monday: "2026.04.20",
          week: "pre",
        },
        followRedirect: false,
      }),
    );
  });

  it("keeps the fetched current html on current-page navigation failures", async () => {
    const malformedCurrentHtml = `
      <html>
        <body>
          <form id="viewForm" method="post" action="/diet/mjukr/5/view.do">
            <input type="hidden" name="layout" value="encoded-layout" />
          </form>
        </body>
      </html>
    `;
    const client = {
      get: vi.fn(async () => ({ body: malformedCurrentHtml })),
      post: vi.fn(),
    };

    await expect(
      fetchCafeteriaOfficialPage(SOURCE, "current", client),
    ).rejects.toMatchObject({
      name: "OfficialPageFetchError",
      rawHtml: malformedCurrentHtml,
      weekScope: "current",
      weekStartDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/u),
    } satisfies Partial<OfficialPageFetchError>);
  });

  it("does not reuse current html as the previous-week failed snapshot raw html", async () => {
    const client = {
      get: vi.fn(async () => ({ body: CURRENT_HTML })),
      post: vi.fn(async () => {
        throw new Error("redirect failed");
      }),
    };

    await expect(
      fetchCafeteriaOfficialPage(SOURCE, "previous", client, {
        currentPageHtml: CURRENT_HTML,
      }),
    ).rejects.toMatchObject({
      name: "OfficialPageFetchError",
      rawHtml: undefined,
      weekScope: "previous",
      weekStartDate: "2026-04-13",
    } satisfies Partial<OfficialPageFetchError>);
  });
});
