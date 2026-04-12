import { describe, expect, it } from "vitest";
import {
  checkCafeteriaInstagramSourceReachabilityWithClient,
  instagramFeedTestHelpers,
  scrapeCafeteriaInstagramPostsWithClient,
  type InstagramClientLike,
} from "../../src/cafeterias/instagram-scraper.js";
import type { CafeteriaInstagramSource } from "../../src/cafeterias/types.js";

const SOURCE: CafeteriaInstagramSource = {
  id: "student-hall",
  name: "학생회관",
  description: "명지대 자연캠퍼스 학생회관 학식 인스타 계정",
  profileUrl: "https://www.instagram.com/mjhs_yongin/",
  instagramUsername: "mjhs_yongin",
  menuImageGroup: "student-hall-myeongjin",
  supportsWeekendMenu: true,
};

describe("instagram-scraper helpers", () => {
  it("builds the username feed url from a profile source", () => {
    expect(instagramFeedTestHelpers.buildFeedUrl(SOURCE, 6)).toBe(
      "https://www.instagram.com/api/v1/feed/user/mjhs_yongin/username/?count=6",
    );
  });

  it("parses instagram feed items into raw cafeteria posts", () => {
    const payload = {
      items: [
        {
          code: "DW99EJ0E3mb",
          taken_at: 1775860429,
          caption: {
            text: "반성의 의미로 다음주 식단 미리 투척..!  \n이것저것 다 챙겨왓다잉",
          },
          image_versions2: {
            candidates: [
              { url: "https://cdn.example.com/latest.jpg" },
              { url: "https://cdn.example.com/smaller.jpg" },
            ],
          },
        },
        {
          code: "skip-me",
          caption: { text: "taken_at missing" },
        },
      ],
    };

    const items = instagramFeedTestHelpers.parseFeedItems(SOURCE, payload);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      sourceId: "student-hall",
      postCode: "DW99EJ0E3mb",
      profileUrl: "https://www.instagram.com/mjhs_yongin/",
      permalink: "https://www.instagram.com/p/DW99EJ0E3mb/",
      postedAt: "2026-04-10T22:33:49.000Z",
      postedAtEpoch: 1775860429,
      caption: "반성의 의미로 다음주 식단 미리 투척..! 이것저것 다 챙겨왓다잉",
      imageUrl: "https://cdn.example.com/latest.jpg",
    });
  });

  it("keeps raw items even when caption or image is missing", () => {
    const payload = {
      items: [
        {
          code: "DW980ijE2YL",
          taken_at: 1775860325,
        },
      ],
    };

    const items = instagramFeedTestHelpers.parseFeedItems(SOURCE, payload);
    expect(items[0]?.postCode).toBe("DW980ijE2YL");
    expect(items[0]?.caption).toBeUndefined();
    expect(items[0]?.imageUrl).toBeUndefined();
    expect(items[0]?.rawItem).toEqual(payload.items[0]);
  });

  it("fetches profile first and then the username feed", async () => {
    const calls: string[] = [];
    const client: InstagramClientLike = {
      get(url: string) {
        calls.push(url);
        return {
          async text() {
            return "<html>profile ok</html>";
          },
          async json() {
            return {
              items: [
                {
                  code: "DW99EJ0E3mb",
                  taken_at: 1775860429,
                  caption: { text: "다음주 식단" },
                  image_versions2: {
                    candidates: [{ url: "https://cdn.example.com/latest.jpg" }],
                  },
                },
              ],
            };
          },
        };
      },
    };

    const posts = await scrapeCafeteriaInstagramPostsWithClient(client, SOURCE, 1);
    expect(posts).toHaveLength(1);
    expect(calls).toEqual([
      "https://www.instagram.com/mjhs_yongin/",
      "https://www.instagram.com/api/v1/feed/user/mjhs_yongin/username/?count=1",
    ]);
  });

  it("fails fast when the instagram profile body is empty", async () => {
    const client: InstagramClientLike = {
      get() {
        return {
          async text() {
            return "   ";
          },
          async json() {
            return { items: [] };
          },
        };
      },
    };

    await expect(
      scrapeCafeteriaInstagramPostsWithClient(client, SOURCE, 1),
    ).rejects.toThrow(/instagram profile returned an empty body/);
  });

  it("fails when the feed payload does not contain usable posts", async () => {
    let callCount = 0;
    const client: InstagramClientLike = {
      get() {
        callCount += 1;
        return {
          async text() {
            return "<html>profile ok</html>";
          },
          async json() {
            return callCount === 2 ? { items: [] } : { items: [] };
          },
        };
      },
    };

    await expect(
      scrapeCafeteriaInstagramPostsWithClient(client, SOURCE, 1),
    ).rejects.toThrow(/parsed 0 instagram posts/);
  });

  it("reports profile success separately when the feed check fails", async () => {
    let callCount = 0;
    const client: InstagramClientLike = {
      get() {
        callCount += 1;
        if (callCount === 1) {
          return {
            async text() {
              return "<html>profile ok</html>";
            },
            async json() {
              return { items: [] };
            },
          };
        }

        return {
          async text() {
            return "<html>unused</html>";
          },
          async json() {
            throw new Error("feed blocked");
          },
        };
      },
    };

    await expect(
      checkCafeteriaInstagramSourceReachabilityWithClient(client, SOURCE),
    ).resolves.toEqual({
      profileReachable: true,
      feedReachable: false,
      error: "feed blocked",
    });
  });
});
