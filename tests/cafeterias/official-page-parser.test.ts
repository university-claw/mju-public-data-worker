import { describe, expect, it } from "vitest";
import { parseCafeteriaOfficialPage } from "../../src/cafeterias/official-page-parser.js";

describe("official-page-parser", () => {
  it("parses weekday rows into normalized menu entries", () => {
    const html = `
      <html>
        <body>
          <table>
            <tbody>
              <tr>
                <th rowspan="2">04.20 (월)</th>
                <td>조식</td>
                <td>-</td>
                <td class="alignL">참치김치볶음밥<br>유부우동장국<br>단무지무침</td>
                <td>-</td>
              </tr>
              <tr>
                <td>중식</td>
                <td>-</td>
                <td class="alignL">[중식 - 덮밥]<br><br>닭갈비덮밥<br><br>[중식 - 샐러드]<br><br>닭가슴살샐러드</td>
                <td>-</td>
              </tr>
              <tr>
                <th>04.21 (화)</th>
                <td>중식</td>
                <td>-</td>
                <td class="alignL">제육볶음<br>된장국<br>깍두기</td>
                <td>-</td>
              </tr>
            </tbody>
          </table>
        </body>
      </html>
    `;

    const parsed = parseCafeteriaOfficialPage(html, "2026-04-20");

    expect(parsed).toMatchObject({
      weekStartDate: "2026-04-20",
      status: "succeeded",
      documentScope: "weekday",
      serviceStartDate: "2026-04-20",
      serviceEndDate: "2026-04-21",
      breakfastAvailable: true,
      lunchAvailable: true,
      dinnerAvailable: false,
    });
    expect(parsed.entries).toEqual([
      {
        serviceDate: "2026-04-20",
        mealType: "breakfast",
        isClosed: false,
        menuText: "참치김치볶음밥\n유부우동장국\n단무지무침",
        menuItems: ["참치김치볶음밥", "유부우동장국", "단무지무침"],
        confidence: 1,
      },
      {
        serviceDate: "2026-04-20",
        mealType: "lunch",
        isClosed: false,
        menuText: "[중식 - 덮밥]\n닭갈비덮밥\n[중식 - 샐러드]\n닭가슴살샐러드",
        menuItems: [
          "[중식 - 덮밥]",
          "닭갈비덮밥",
          "[중식 - 샐러드]",
          "닭가슴살샐러드",
        ],
        confidence: 1,
      },
      {
        serviceDate: "2026-04-21",
        mealType: "lunch",
        isClosed: false,
        menuText: "제육볶음\n된장국\n깍두기",
        menuItems: ["제육볶음", "된장국", "깍두기"],
        confidence: 1,
      },
    ]);
  });

  it("treats placeholder rows as empty and does not create overwrite candidates", () => {
    const html = `
      <html>
        <body>
          <table>
            <tbody>
              <tr>
                <th>04.13 (월)</th>
                <td>조식</td>
                <td>-</td>
                <td class="alignL">등록된 식단내용이(가) 없습니다.</td>
                <td>-</td>
              </tr>
              <tr>
                <th>04.14 (화)</th>
                <td>중식</td>
                <td>-</td>
                <td class="alignL">등록된 식단내용이(가) 없습니다.</td>
                <td>-</td>
              </tr>
            </tbody>
          </table>
        </body>
      </html>
    `;

    const parsed = parseCafeteriaOfficialPage(html, "2026-04-13");

    expect(parsed).toMatchObject({
      status: "empty",
      documentScope: "weekday",
      serviceStartDate: "2026-04-13",
      serviceEndDate: "2026-04-14",
      breakfastAvailable: false,
      lunchAvailable: false,
      dinnerAvailable: false,
    });
    expect(parsed.entries).toEqual([]);
  });
});
