import { httpClient } from "../http/client.js";
import { collapseWhitespace } from "../shared/text.js";
import type {
  CafeteriaInstagramPost,
  CafeteriaInstagramSource,
} from "./types.js";

interface InstagramFeedItem {
  code?: unknown;
  taken_at?: unknown;
  caption?: {
    text?: unknown;
  } | null;
  image_versions2?: {
    candidates?: Array<{
      url?: unknown;
    }>;
  } | null;
  [key: string]: unknown;
}

interface InstagramFeedResponse {
  items?: unknown;
}

const instagramClient = httpClient.extend({
  headers: {
    "user-agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36",
    accept: "*/*",
    "accept-language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
    referer: "https://www.instagram.com/",
    "x-ig-app-id": "936619743392459",
    "x-requested-with": "XMLHttpRequest",
  },
});

export interface InstagramClientLike {
  get(url: string, options?: unknown): {
    text(): Promise<string>;
    json<T>(): Promise<T>;
  };
}

function buildFeedUrl(source: CafeteriaInstagramSource, limit: number): string {
  return `https://www.instagram.com/api/v1/feed/user/${source.instagramUsername}/username/?count=${limit}`;
}

function toInstagramPermalink(code: string): string {
  return `https://www.instagram.com/p/${code}/`;
}

function parsePostedAt(epoch: number): string {
  return new Date(epoch * 1000).toISOString();
}

function parseFeedItems(
  source: CafeteriaInstagramSource,
  payload: InstagramFeedResponse,
): CafeteriaInstagramPost[] {
  const rawItems = Array.isArray(payload.items) ? payload.items : [];
  const posts: CafeteriaInstagramPost[] = [];

  for (const rawItem of rawItems) {
    const item = rawItem as InstagramFeedItem;
    const postCode = typeof item.code === "string" ? item.code : undefined;
    const postedAtEpoch =
      typeof item.taken_at === "number" ? item.taken_at : undefined;

    if (!postCode || !postedAtEpoch) {
      continue;
    }

    const caption = collapseWhitespace(
      typeof item.caption?.text === "string" ? item.caption.text : "",
    );
    const imageUrl = item.image_versions2?.candidates?.find(
      (candidate) => typeof candidate.url === "string" && candidate.url.length > 0,
    )?.url as string | undefined;

    const post: CafeteriaInstagramPost = {
      sourceId: source.id,
      postCode,
      profileUrl: source.profileUrl,
      permalink: toInstagramPermalink(postCode),
      postedAt: parsePostedAt(postedAtEpoch),
      postedAtEpoch,
      rawItem,
    };

    if (caption) {
      post.caption = caption;
    }

    if (imageUrl) {
      post.imageUrl = imageUrl;
    }

    posts.push(post);
  }

  return posts;
}

function buildFeedRetryLimits(limit: number): number[] {
  const normalizedLimit = Math.max(1, Math.trunc(limit));
  const limits: number[] = [];

  for (let current = normalizedLimit; current >= 1; current -= 1) {
    limits.push(current);
  }

  return limits;
}

function isRetryableFeedCountError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return /status code 401|status code 403/i.test(error.message);
}

/**
 * 1차 슬라이스에서는 "프로필 URL만 알고 있어도 최신 게시물을 찾을 수 있는가"를
 * 실제 worker 흐름으로 굳히는 것이 목표다. 그래서 프로필 접근 확인과 피드 호출을
 * 같은 함수 안에서 연속으로 수행해, 공개 계정/비공개 계정 문제를 빠르게 드러낸다.
 */
export async function scrapeCafeteriaInstagramPosts(
  source: CafeteriaInstagramSource,
  limit: number,
): Promise<CafeteriaInstagramPost[]> {
  return scrapeCafeteriaInstagramPostsWithClient(instagramClient, source, limit);
}

export async function checkCafeteriaInstagramSourceReachability(
  source: CafeteriaInstagramSource,
): Promise<{
  profileReachable: boolean;
  feedReachable: boolean;
  error?: string;
}> {
  return checkCafeteriaInstagramSourceReachabilityWithClient(instagramClient, source);
}

export async function checkCafeteriaInstagramSourceReachabilityWithClient(
  client: InstagramClientLike,
  source: CafeteriaInstagramSource,
): Promise<{
  profileReachable: boolean;
  feedReachable: boolean;
  error?: string;
}> {
  let profileReachable = false;

  try {
    const profileHtml = await client.get(source.profileUrl, {
      timeout: { request: 5_000 },
      retry: { limit: 0 },
    }).text();
    profileReachable = profileHtml.trim().length > 0;
    if (!profileReachable) {
      return {
        profileReachable: false,
        feedReachable: false,
        error: "instagram profile returned an empty body",
      };
    }

    const feedUrl = buildFeedUrl(source, 1);
    const payload = await client.get(feedUrl, {
      timeout: { request: 5_000 },
      retry: { limit: 0 },
    }).json<InstagramFeedResponse>();

    return {
      profileReachable: true,
      feedReachable: Array.isArray(payload.items),
    };
  } catch (error) {
    return {
      profileReachable,
      feedReachable: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function scrapeCafeteriaInstagramPostsWithClient(
  client: InstagramClientLike,
  source: CafeteriaInstagramSource,
  limit: number,
): Promise<CafeteriaInstagramPost[]> {
  const profileHtml = await client.get(source.profileUrl).text();
  if (!profileHtml.trim()) {
    throw new Error(`instagram profile returned an empty body: ${source.profileUrl}`);
  }

  let lastError: unknown;

  /**
   * 공개 인스타 피드는 같은 계정이어도 count 값이 조금 커지면 401/403을 내는 경우가 있다.
   * 이럴 때 worker 전체를 깨뜨리기보다, 더 작은 count로 한 단계씩 줄여서
   * "지금 가져올 수 있는 최신 게시물"만이라도 확보하는 쪽이 운영상 더 안전하다.
   */
  for (const feedCount of buildFeedRetryLimits(limit)) {
    try {
      const feedUrl = buildFeedUrl(source, feedCount);
      const payload = await client.get(feedUrl).json<InstagramFeedResponse>();
      const posts = parseFeedItems(source, payload);
      if (posts.length === 0) {
        throw new Error(`parsed 0 instagram posts for cafeteria source "${source.id}"`);
      }

      return posts.slice(0, limit);
    } catch (error) {
      lastError = error;
      if (!isRetryableFeedCountError(error) || feedCount === 1) {
        throw error;
      }
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`failed to fetch instagram feed for cafeteria source "${source.id}"`);
}

export const instagramFeedTestHelpers = {
  buildFeedUrl,
  buildFeedRetryLimits,
  isRetryableFeedCountError,
  parseFeedItems,
  parsePostedAt,
  toInstagramPermalink,
};
