import { extractBodyLinks } from "./normalization-context.js";
import type {
  NoticeDetailsJsonb,
  NoticeReadModelActionChannel,
  NoticeNormalizationSourceBundle,
} from "./types.js";
import type { NoticeNormalizationStructuredOutput } from "./normalization-runtime.js";

const URL_PATTERN =
  /(?:(?:https?:\/\/|mailto:|www\.)[^\s<>"'`)\]}]+)/giu;
const EMAIL_PATTERN =
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu;

const DIRECT_ACTION_KEYWORDS = [
  "신청",
  "지원",
  "접수",
  "응답",
  "제출",
  "등록",
  "예약",
  "참가",
  "조회",
  "작성",
  "지원서",
  "신청서",
  "apply",
  "application",
  "register",
  "response",
  "submit",
  "form",
] as const;

const NAVIGATION_KEYWORDS = [
  "홈페이지",
  "누리집",
  "접속 후",
  "접속하여",
  "메뉴",
  "클릭",
  "경로",
  "장학금>",
  "지원 페이지로 이동",
  "신청현황",
  "로그인 하기",
] as const;

const SHORTENER_HOSTS = new Set([
  "naver.me",
  "bit.ly",
  "forms.gle",
  "me2.do",
  "vo.la",
]);

const FORM_HOST_KEYWORDS = [
  "forms.gle",
  "docs.google.com",
  "form.naver.com",
  "naver.me",
] as const;

type NoticeActionUrlCandidateSource =
  | "body_link"
  | "body_text"
  | "attachment_text"
  | "image_ocr";

interface NoticeActionUrlCandidate {
  url: string;
  normalizedUrl: string;
  source: NoticeActionUrlCandidateSource;
  host: string | null;
  path: string | null;
  pathDepth: number;
  hasQuery: boolean;
  isMailto: boolean;
  isShortener: boolean;
  isFileLike: boolean;
  isRootLike: boolean;
  hasDirectActionSignal: boolean;
  hasNavigationSignal: boolean;
  directScore: number;
  contextSnippet: string | null;
  linkText: string | null;
}

export interface NoticePrimaryActionUrlResolution {
  initialUrl: string | null;
  finalUrl: string | null;
  decision:
    | "unchanged"
    | "replaced_with_direct_candidate"
    | "cleared_generic_root"
    | "cleared_unrecognized_url";
  reason: string;
  directCandidateCount: number;
  genericRootCandidateCount: number;
  selectedCandidate?: {
    url: string;
    source: NoticeActionUrlCandidateSource;
    score: number;
  };
}

export interface ResolvePrimaryActionUrlResult {
  output: NoticeNormalizationStructuredOutput;
  resolution: NoticePrimaryActionUrlResolution;
}

export function resolveNoticePrimaryActionUrl(params: {
  output: NoticeNormalizationStructuredOutput;
  bundle: NoticeNormalizationSourceBundle;
}): ResolvePrimaryActionUrlResult {
  const candidates = extractNoticeActionUrlCandidates(params.bundle);
  const directCandidates = getSortedDirectCandidates(candidates);
  const genericRootCandidateCount = candidates.filter((candidate) =>
    isGenericRootCandidate(candidate)
  ).length;
  const initialUrl = params.output.primary_action_url;

  if (!initialUrl) {
    const bestDirectCandidate = directCandidates[0];
    const inferredChannel = bestDirectCandidate
      ? inferActionChannelForUrl(bestDirectCandidate.url)
      : null;

    if (
      bestDirectCandidate &&
      shouldAutofillDirectCandidate({
        output: params.output,
        directCandidates,
        inferredChannel,
      })
    ) {
      const output = replacePrimaryActionUrl(
        params.output,
        bestDirectCandidate.url,
        inferredChannel,
      );

      return {
        output,
        resolution: {
          initialUrl: null,
          finalUrl: output.primary_action_url,
          decision: "replaced_with_direct_candidate",
          reason:
            "no primary_action_url was returned by the model, so the sole direct candidate was promoted",
          directCandidateCount: directCandidates.length,
          genericRootCandidateCount,
          selectedCandidate: {
            url: bestDirectCandidate.url,
            source: bestDirectCandidate.source,
            score: bestDirectCandidate.directScore,
          },
        },
      };
    }

    return {
      output: params.output,
      resolution: {
        initialUrl: null,
        finalUrl: null,
        decision: "unchanged",
        reason: "no primary_action_url returned by model",
        directCandidateCount: directCandidates.length,
        genericRootCandidateCount,
      },
    };
  }

  const normalizedInitialUrl = normalizeCandidateUrl(initialUrl);
  const matchedCandidate = candidates.find(
    (candidate) => candidate.normalizedUrl === normalizedInitialUrl,
  );
  const bestDirectCandidate = directCandidates[0];

  if (!matchedCandidate) {
    const output = clearPrimaryActionUrl(params.output);
    return {
      output,
      resolution: {
        initialUrl,
        finalUrl: output.primary_action_url,
        decision: "cleared_unrecognized_url",
        reason: "primary_action_url was not found in extracted link candidates",
        directCandidateCount: directCandidates.length,
        genericRootCandidateCount,
      },
    };
  }

  if (isGenericRootCandidate(matchedCandidate)) {
    if (
      bestDirectCandidate &&
      bestDirectCandidate.normalizedUrl !== normalizedInitialUrl &&
      shouldReplaceGenericRootWithDirectCandidate(directCandidates)
    ) {
      const output = replacePrimaryActionUrl(
        params.output,
        bestDirectCandidate.url,
        inferActionChannelForUrl(bestDirectCandidate.url),
      );

      return {
        output,
        resolution: {
          initialUrl,
          finalUrl: output.primary_action_url,
          decision: "replaced_with_direct_candidate",
          reason:
            "generic root URL was replaced with a stronger direct action candidate",
          directCandidateCount: directCandidates.length,
          genericRootCandidateCount,
          selectedCandidate: {
            url: bestDirectCandidate.url,
            source: bestDirectCandidate.source,
            score: bestDirectCandidate.directScore,
          },
        },
      };
    }

    const output = clearPrimaryActionUrl(params.output);
    return {
      output,
      resolution: {
        initialUrl,
        finalUrl: output.primary_action_url,
        decision: "cleared_generic_root",
        reason:
          "primary_action_url was a generic root URL and no better direct candidate was available",
        directCandidateCount: directCandidates.length,
        genericRootCandidateCount,
      },
    };
  }

  const output = dedupePrimaryActionUrlFromResourceLinks(params.output);
  return {
    output,
    resolution: {
      initialUrl,
      finalUrl: output.primary_action_url,
      decision: "unchanged",
      reason: "primary_action_url already points to a direct candidate",
      directCandidateCount: directCandidates.length,
      genericRootCandidateCount,
    },
  };
}

function extractNoticeActionUrlCandidates(
  bundle: NoticeNormalizationSourceBundle,
): NoticeActionUrlCandidate[] {
  const candidates = new Map<string, NoticeActionUrlCandidate>();

  for (const link of extractBodyLinks(bundle.notice.bodyHtml, 32)) {
    addCandidate(candidates, {
      rawUrl: link.href,
      source: "body_link",
      linkText: link.text ?? null,
      contextSnippet: link.text ?? null,
    });
  }

  addCandidatesFromText(candidates, bundle.notice.bodyText, "body_text");

  for (const attachment of bundle.attachments) {
    addCandidatesFromText(
      candidates,
      attachment.extractedText,
      "attachment_text",
    );
  }

  for (const image of bundle.images) {
    addCandidatesFromText(candidates, image.ocrText, "image_ocr");
  }

  return [...candidates.values()];
}

function addCandidatesFromText(
  candidates: Map<string, NoticeActionUrlCandidate>,
  text: string | null | undefined,
  source: NoticeActionUrlCandidateSource,
): void {
  if (!text) {
    return;
  }

  for (const match of text.matchAll(URL_PATTERN)) {
    const rawUrl = match[0];
    const index = match.index ?? 0;
    const snippet = text.slice(
      Math.max(0, index - 48),
      index + rawUrl.length + 12,
    );
    addCandidate(candidates, {
      rawUrl,
      source,
      contextSnippet: snippet.trim() || null,
      linkText: null,
    });
  }

  for (const match of text.matchAll(EMAIL_PATTERN)) {
    const rawEmail = match[0];
    const index = match.index ?? 0;
    const snippet = text.slice(
      Math.max(0, index - 48),
      index + rawEmail.length + 12,
    );
    addCandidate(candidates, {
      rawUrl: `mailto:${rawEmail}`,
      source,
      contextSnippet: snippet.trim() || null,
      linkText: null,
    });
  }
}

function addCandidate(
  candidates: Map<string, NoticeActionUrlCandidate>,
  params: {
    rawUrl: string;
    source: NoticeActionUrlCandidateSource;
    contextSnippet: string | null;
    linkText: string | null;
  },
): void {
  const normalizedUrl = normalizeCandidateUrl(params.rawUrl);
  if (!normalizedUrl) {
    return;
  }

  const parsed = parseCandidateUrl(normalizedUrl);
  if (!parsed) {
    return;
  }

  const existing = candidates.get(normalizedUrl);
  const nextCandidate = buildCandidate({
    url: normalizedUrl,
    source: params.source,
    contextSnippet: params.contextSnippet,
    linkText: params.linkText,
    ...parsed,
  });

  if (!existing || nextCandidate.directScore > existing.directScore) {
    candidates.set(normalizedUrl, nextCandidate);
  }
}

function buildCandidate(params: {
  url: string;
  source: NoticeActionUrlCandidateSource;
  host: string | null;
  path: string | null;
  pathDepth: number;
  hasQuery: boolean;
  isMailto: boolean;
  isShortener: boolean;
  isFileLike: boolean;
  isRootLike: boolean;
  contextSnippet: string | null;
  linkText: string | null;
}): NoticeActionUrlCandidate {
  const signalSource = [params.linkText, params.contextSnippet].filter(Boolean).join(" ");
  const hasDirectActionSignal = includesKeyword(
    signalSource,
    DIRECT_ACTION_KEYWORDS,
  );
  const hasNavigationSignal = includesKeyword(
    signalSource,
    NAVIGATION_KEYWORDS,
  );
  const directScore = calculateDirectScore({
    source: params.source,
    hasDirectActionSignal,
    hasNavigationSignal,
    isRootLike: params.isRootLike,
    isShortener: params.isShortener,
    isFileLike: params.isFileLike,
    isMailto: params.isMailto,
    pathDepth: params.pathDepth,
    hasQuery: params.hasQuery,
    host: params.host,
  });

  return {
    url: params.url,
    normalizedUrl: params.url,
    source: params.source,
    host: params.host,
    path: params.path,
    pathDepth: params.pathDepth,
    hasQuery: params.hasQuery,
    isMailto: params.isMailto,
    isShortener: params.isShortener,
    isFileLike: params.isFileLike,
    isRootLike: params.isRootLike,
    hasDirectActionSignal,
    hasNavigationSignal,
    directScore,
    contextSnippet: params.contextSnippet,
    linkText: params.linkText,
  };
}

function calculateDirectScore(params: {
  source: NoticeActionUrlCandidateSource;
  hasDirectActionSignal: boolean;
  hasNavigationSignal: boolean;
  isRootLike: boolean;
  isShortener: boolean;
  isFileLike: boolean;
  isMailto: boolean;
  pathDepth: number;
  hasQuery: boolean;
  host: string | null;
}): number {
  const host = params.host;
  let score =
    params.source === "body_link"
      ? 4
      : params.source === "body_text"
        ? 3
        : params.source === "attachment_text"
          ? 2
          : 1;

  if (params.hasDirectActionSignal) {
    score += 4;
  }
  if (params.hasNavigationSignal) {
    score -= 4;
  }
  if (params.isMailto) {
    score += 2;
  }
  if (params.isFileLike) {
    score += 1;
  }
  if (params.isShortener) {
    score += 2;
  }
  if (params.pathDepth >= 2) {
    score += 2;
  }
  if (params.hasQuery) {
    score += 1;
  }
  if (host && FORM_HOST_KEYWORDS.some((keyword) => host.includes(keyword))) {
    score += 3;
  }
  if (params.isRootLike && !params.isShortener) {
    score -= 4;
  }

  return score;
}

function getSortedDirectCandidates(
  candidates: readonly NoticeActionUrlCandidate[],
): NoticeActionUrlCandidate[] {
  return candidates
    .filter((candidate) => isDirectActionCandidate(candidate))
    .sort((left, right) => {
      if (right.directScore !== left.directScore) {
        return right.directScore - left.directScore;
      }
      if (right.pathDepth !== left.pathDepth) {
        return right.pathDepth - left.pathDepth;
      }
      return left.url.localeCompare(right.url);
    });
}

function isDirectActionCandidate(candidate: NoticeActionUrlCandidate): boolean {
  if (candidate.isMailto) {
    return true;
  }

  if (isGenericRootCandidate(candidate)) {
    return false;
  }

  return (
    candidate.directScore >= 4 ||
    candidate.isShortener ||
    candidate.pathDepth >= 2 ||
    candidate.hasQuery
  );
}

function isGenericRootCandidate(candidate: NoticeActionUrlCandidate): boolean {
  if (candidate.isMailto || candidate.isShortener || candidate.isFileLike) {
    return false;
  }

  return (
    candidate.isRootLike &&
    (
      candidate.source !== "body_link" ||
      candidate.hasNavigationSignal ||
      !candidate.hasDirectActionSignal
    )
  );
}

function replacePrimaryActionUrl(
  output: NoticeNormalizationStructuredOutput,
  nextUrl: string,
  inferredChannel: NoticeReadModelActionChannel | null,
): NoticeNormalizationStructuredOutput {
  const nextOutput: NoticeNormalizationStructuredOutput = {
    ...output,
    primary_action_url: nextUrl,
    primary_action_channel: inferredChannel ?? output.primary_action_channel,
  };
  return dedupePrimaryActionUrlFromResourceLinks(nextOutput);
}

function shouldAutofillDirectCandidate(params: {
  output: NoticeNormalizationStructuredOutput;
  directCandidates: readonly NoticeActionUrlCandidate[];
  inferredChannel: NoticeReadModelActionChannel | null;
}): boolean {
  if (!params.output.action_required) {
    return false;
  }

  if (params.directCandidates.length !== 1) {
    return false;
  }

  const selectedCandidate = params.directCandidates[0];
  if (!selectedCandidate) {
    return false;
  }

  if (selectedCandidate.isMailto && !selectedCandidate.hasDirectActionSignal) {
    return false;
  }

  if (selectedCandidate.directScore < 4) {
    return false;
  }

  if (!params.output.primary_action_channel) {
    return true;
  }

  if (!params.inferredChannel) {
    return false;
  }

  return params.output.primary_action_channel === params.inferredChannel;
}

function shouldReplaceGenericRootWithDirectCandidate(
  directCandidates: readonly NoticeActionUrlCandidate[],
): boolean {
  if (directCandidates.length === 0) {
    return false;
  }

  const firstCandidate = directCandidates[0];
  if (!firstCandidate) {
    return false;
  }

  if (firstCandidate.isMailto && !firstCandidate.hasDirectActionSignal) {
    return false;
  }

  if (directCandidates.length === 1) {
    return true;
  }

  const secondCandidate = directCandidates[1];
  if (!secondCandidate) {
    return false;
  }

  return firstCandidate.directScore >= secondCandidate.directScore + 3;
}

function clearPrimaryActionUrl(
  output: NoticeNormalizationStructuredOutput,
): NoticeNormalizationStructuredOutput {
  return dedupePrimaryActionUrlFromResourceLinks({
    ...output,
    primary_action_url: null,
  });
}

function dedupePrimaryActionUrlFromResourceLinks(
  output: NoticeNormalizationStructuredOutput,
): NoticeNormalizationStructuredOutput {
  if (!output.primary_action_url || !output.details_jsonb?.resource_links) {
    return output;
  }

  const normalizedPrimaryActionUrl = normalizeCandidateUrl(output.primary_action_url);
  const dedupedLinks = output.details_jsonb.resource_links.filter((link) => {
    const normalizedResourceUrl = normalizeCandidateUrl(link.url);
    return normalizedResourceUrl !== normalizedPrimaryActionUrl;
  });

  if (dedupedLinks.length === output.details_jsonb.resource_links.length) {
    return output;
  }

  return {
    ...output,
    details_jsonb: {
      ...output.details_jsonb,
      resource_links: dedupedLinks.length > 0 ? dedupedLinks : null,
    } satisfies NoticeDetailsJsonb,
  };
}

function inferActionChannelForUrl(
  url: string,
): NoticeReadModelActionChannel | null {
  if (url.startsWith("mailto:")) {
    return "email";
  }

  const normalizedUrl = normalizeCandidateUrl(url);
  const parsed = normalizedUrl ? parseCandidateUrl(normalizedUrl) : null;
  const host = parsed?.host ?? null;
  if (!host) {
    return null;
  }

  if (FORM_HOST_KEYWORDS.some((keyword) => host.includes(keyword))) {
    return "web_form";
  }

  const candidatePath = parsed?.path ?? null;
  if (
    candidatePath &&
    /apply|application|register|signup|survey|response|submit|form/iu.test(
      candidatePath,
    )
  ) {
    return "web_form";
  }

  return null;
}

function normalizeCandidateUrl(rawUrl: string | null | undefined): string | null {
  if (!rawUrl) {
    return null;
  }

  let cleaned = rawUrl.trim().replace(/[)\]}>.,]+$/u, "");
  if (cleaned.startsWith("www.")) {
    cleaned = `https://${cleaned}`;
  }

  if (cleaned.startsWith("mailto:")) {
    return cleaned.toLowerCase();
  }

  try {
    const parsed = new URL(cleaned);
    parsed.hash = "";
    parsed.host = parsed.host.toLowerCase();
    parsed.protocol = parsed.protocol.toLowerCase();
    if (parsed.pathname !== "/" && parsed.pathname.endsWith("/")) {
      parsed.pathname = parsed.pathname.replace(/\/+$/u, "");
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

function parseCandidateUrl(normalizedUrl: string): {
  host: string | null;
  path: string | null;
  pathDepth: number;
  hasQuery: boolean;
  isMailto: boolean;
  isShortener: boolean;
  isFileLike: boolean;
  isRootLike: boolean;
} | null {
  if (normalizedUrl.startsWith("mailto:")) {
    return {
      host: null,
      path: null,
      pathDepth: 0,
      hasQuery: false,
      isMailto: true,
      isShortener: false,
      isFileLike: false,
      isRootLike: false,
    };
  }

  try {
    const parsed = new URL(normalizedUrl);
    const pathname = parsed.pathname || "/";
    const normalizedPath = pathname.toLowerCase();
    const pathDepth = pathname
      .split("/")
      .filter((segment) => segment.trim().length > 0).length;
    const isFileLike = /\.[a-z0-9]{2,6}$/iu.test(normalizedPath);
    const isShortener = SHORTENER_HOSTS.has(parsed.host.toLowerCase());
    const isRootLike = [
      "/",
      "/index.do",
      "/index.jsp",
      "/index.html",
      "/main.do",
      "/main.jsp",
      "/main.html",
      "/home.do",
      "/home.jsp",
      "/portal.do",
    ].includes(normalizedPath) && !parsed.search;

    return {
      host: parsed.host.toLowerCase(),
      path: pathname,
      pathDepth,
      hasQuery: Boolean(parsed.search),
      isMailto: false,
      isShortener,
      isFileLike,
      isRootLike,
    };
  } catch {
    return null;
  }
}

function includesKeyword(
  value: string,
  keywords: readonly string[],
): boolean {
  const normalizedValue = value.toLowerCase();
  return keywords.some((keyword) => normalizedValue.includes(keyword.toLowerCase()));
}
