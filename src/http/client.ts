import got from "got";

export const httpClient = got.extend({
  timeout: { request: 10_000 },
  retry: {
    limit: 2,
    methods: ["GET", "HEAD"],
    statusCodes: [408, 429, 500, 502, 503, 504],
    errorCodes: [
      "ETIMEDOUT",
      "ECONNRESET",
      "ECONNREFUSED",
      "ENOTFOUND",
      "EAI_AGAIN",
    ],
  },
  headers: {
    "user-agent": "mju-public-data-worker/0.1.0",
    accept:
      "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "accept-language": "ko-KR,ko;q=0.9,en;q=0.8",
  },
});

export async function fetchHtml(url: string): Promise<string> {
  return httpClient.get(url).text();
}

export async function downloadBinary(
  url: string,
  options?: {
    headers?: Record<string, string>;
  },
): Promise<{
  buffer: Buffer;
  contentType: string | null;
}> {
  const requestOptions = {
    responseType: "buffer" as const,
    ...(options?.headers ? { headers: options.headers } : {}),
  };
  const response = await httpClient.get(url, requestOptions);

  return {
    buffer: response.rawBody,
    contentType: response.headers["content-type"] ?? null,
  };
}

export async function postHtml(
  url: string,
  form: Record<string, string>,
): Promise<string> {
  return httpClient.post(url, { form }).text();
}

export async function checkReachability(url: string): Promise<{
  reachable: boolean;
  error?: string;
}> {
  try {
    const response = await httpClient.get(url, {
      timeout: { request: 5_000 },
      retry: { limit: 0 },
    });

    return { reachable: response.statusCode < 400 };
  } catch (error) {
    return {
      reachable: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
