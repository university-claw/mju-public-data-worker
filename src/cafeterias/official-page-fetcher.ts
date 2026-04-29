import { load as loadHtml } from "cheerio";
import type {
  CafeteriaOfficialFetchedPage,
  CafeteriaOfficialPageSource,
  CafeteriaOfficialPageWeekScope,
} from "./types.js";
import { httpClient } from "../http/client.js";

interface OfficialPageHttpClient {
  get(url: string, options?: { headers?: Record<string, string> }): Promise<{
    body: string;
  }>;
  post(
    url: string,
    options: {
      form: Record<string, string>;
      headers?: Record<string, string>;
      followRedirect?: boolean;
    },
  ): Promise<{
    body: string;
    headers: Record<string, string | string[] | undefined>;
  }>;
}

interface OfficialPageNavigation {
  actionUrl: string;
  layout: string;
  monday: string;
}

export class OfficialPageFetchError extends Error {
  constructor(
    message: string,
    readonly weekScope: CafeteriaOfficialPageWeekScope,
    readonly weekStartDate?: string,
    readonly rawHtml?: string,
  ) {
    super(message);
    this.name = "OfficialPageFetchError";
  }
}

const defaultHttpClient: OfficialPageHttpClient = {
  async get(url, options) {
    const requestOptions = options?.headers
      ? { headers: options.headers }
      : {};
    const response = await httpClient.get(url, requestOptions);

    return { body: response.body };
  },
  async post(url, options) {
    const requestOptions = {
      form: options.form,
      followRedirect: options.followRedirect ?? true,
      ...(options.headers ? { headers: options.headers } : {}),
    };
    const response = await httpClient.post(url, requestOptions);

    return {
      body: response.body,
      headers: response.headers,
    };
  },
};

function toWeekFormValue(weekScope: CafeteriaOfficialPageWeekScope): string {
  switch (weekScope) {
    case "previous":
      return "pre";
    case "next":
      return "next";
    case "current":
      throw new Error("current week does not use the week form value");
  }
}

function normalizeWeekStartDate(rawMonday: string): string {
  const match = rawMonday.match(/(\d{4})\.(\d{2})\.(\d{2})/u);
  if (!match) {
    throw new Error(`failed to parse monday from official cafeteria page: ${rawMonday}`);
  }

  return `${match[1]}-${match[2]}-${match[3]}`;
}

function shiftWeekStartDate(
  weekStartDate: string,
  weekScope: CafeteriaOfficialPageWeekScope,
): string {
  const baseDate = new Date(`${weekStartDate}T12:00:00+09:00`);
  const diffDays =
    weekScope === "previous" ? -7 : weekScope === "next" ? 7 : 0;
  const shifted = new Date(baseDate.getTime() + diffDays * 24 * 60 * 60 * 1000);

  return shifted.toISOString().slice(0, 10);
}

function inferCurrentWeekStartDate(date: Date): string {
  const kstDate = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  const kstWeekday = kstDate.getUTCDay() === 0 ? 7 : kstDate.getUTCDay();
  kstDate.setUTCDate(kstDate.getUTCDate() - (kstWeekday - 1));

  return kstDate.toISOString().slice(0, 10);
}

export function parseOfficialPageNavigation(
  html: string,
  pageUrl: string,
): OfficialPageNavigation {
  const $ = loadHtml(html);
  const viewForm = $("#viewForm");
  const action = viewForm.attr("action");
  const layout = viewForm.find("input[name='layout']").val();
  const monday = viewForm.find("input[name='monday']").val();

  if (!action) {
    throw new Error(`official cafeteria page is missing #viewForm action: ${pageUrl}`);
  }

  if (typeof layout !== "string" || !layout.trim()) {
    throw new Error(`official cafeteria page is missing layout input: ${pageUrl}`);
  }

  if (typeof monday !== "string" || !monday.trim()) {
    throw new Error(`official cafeteria page is missing monday input: ${pageUrl}`);
  }

  return {
    actionUrl: new URL(action, pageUrl).toString(),
    layout: layout.trim(),
    monday: monday.trim(),
  };
}

async function fetchWeekScopeHtml(
  source: CafeteriaOfficialPageSource,
  weekScope: Exclude<CafeteriaOfficialPageWeekScope, "current">,
  navigation: OfficialPageNavigation,
  client: OfficialPageHttpClient,
): Promise<string> {
  const postResponse = await client.post(navigation.actionUrl, {
    form: {
      layout: navigation.layout,
      monday: navigation.monday,
      week: toWeekFormValue(weekScope),
    },
    headers: {
      referer: source.pageUrl,
    },
    followRedirect: false,
  });

  const locationHeader = postResponse.headers.location;
  const redirectLocation = Array.isArray(locationHeader)
    ? locationHeader[0]
    : locationHeader;

  if (!redirectLocation) {
    throw new Error(
      `official cafeteria page did not return a redirect location for ${source.sourceId}/${weekScope}`,
    );
  }

  const redirectUrl = new URL(redirectLocation, source.pageUrl).toString();
  const redirectResponse = await client.get(redirectUrl, {
    headers: {
      referer: source.pageUrl,
    },
  });

  return redirectResponse.body;
}

export async function fetchCafeteriaOfficialPage(
  source: CafeteriaOfficialPageSource,
  weekScope: CafeteriaOfficialPageWeekScope,
  client: OfficialPageHttpClient = defaultHttpClient,
  options?: {
    currentPageHtml?: string;
  },
): Promise<CafeteriaOfficialFetchedPage> {
  const fetchedAt = new Date().toISOString();
  let currentHtml: string | undefined;
  let currentWeekStartDate: string | undefined;
  let requestedHtml: string | undefined;

  try {
    currentHtml =
      options?.currentPageHtml
      ?? (
        await client.get(source.pageUrl, {
          headers: {
            referer: source.pageUrl,
          },
        })
      ).body;
    const currentNavigation = parseOfficialPageNavigation(currentHtml, source.pageUrl);
    currentWeekStartDate = normalizeWeekStartDate(currentNavigation.monday);

    if (weekScope === "current") {
      return {
        source,
        weekScope,
        weekStartDate: currentWeekStartDate,
        rawHtml: currentHtml,
        fetchedAt,
      };
    }

    requestedHtml = await fetchWeekScopeHtml(
      source,
      weekScope,
      currentNavigation,
      client,
    );
    const navigation = parseOfficialPageNavigation(requestedHtml, source.pageUrl);

    return {
      source,
      weekScope,
      weekStartDate: normalizeWeekStartDate(navigation.monday),
      rawHtml: requestedHtml,
      fetchedAt,
    };
  } catch (error) {
    const fallbackCurrentWeekStartDate =
      currentWeekStartDate ?? inferCurrentWeekStartDate(new Date(fetchedAt));
    const fallbackWeekStartDate =
      weekScope === "current"
        ? fallbackCurrentWeekStartDate
        : shiftWeekStartDate(fallbackCurrentWeekStartDate, weekScope);

    throw new OfficialPageFetchError(
      `failed to fetch official cafeteria page ${source.sourceId}/${weekScope}: ${error instanceof Error ? error.message : String(error)}`,
      weekScope,
      fallbackWeekStartDate,
      weekScope === "current" ? currentHtml : requestedHtml,
    );
  }
}

export async function fetchCafeteriaOfficialPages(
  source: CafeteriaOfficialPageSource,
  weekScopes: CafeteriaOfficialPageWeekScope[] = ["current"],
  client: OfficialPageHttpClient = defaultHttpClient,
): Promise<CafeteriaOfficialFetchedPage[]> {
  const uniqueScopes = Array.from(new Set(weekScopes));
  const pages: CafeteriaOfficialFetchedPage[] = [];
  const currentPage = await fetchCafeteriaOfficialPage(
    source,
    "current",
    client,
  );

  for (const weekScope of uniqueScopes) {
    if (weekScope === "current") {
      pages.push(currentPage);
      continue;
    }

    pages.push(
      await fetchCafeteriaOfficialPage(source, weekScope, client, {
        currentPageHtml: currentPage.rawHtml,
      }),
    );
  }

  return pages;
}
