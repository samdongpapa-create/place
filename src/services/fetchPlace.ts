// src/services/fetchPlace.ts
export type FetchedPage = { html: string; finalUrl: string };

type FetchOptions = {
  minLength?: number; // 기본 2000
  timeoutMs?: number; // 기본 12000
  retries?: number; // 기본 0
  debug?: boolean;
};

const UA_MOBILE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

function buildHeaders(extra?: Record<string, string>) {
  return {
    "User-Agent": UA_MOBILE,
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.7,en;q=0.6",
    "Cache-Control": "no-cache",
    Pragma: "no-cache",
    Referer: "https://m.place.naver.com/",
    ...(extra || {})
  };
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    return res;
  } finally {
    clearTimeout(t);
  }
}

export async function fetchPlaceHtml(placeUrl: string, opts: FetchOptions = {}): Promise<FetchedPage> {
  if (!placeUrl) throw new Error("placeUrl is empty");
  const minLength = typeof opts.minLength === "number" ? opts.minLength : 2000;
  const timeoutMs = typeof opts.timeoutMs === "number" ? opts.timeoutMs : 12000;
  const retries = typeof opts.retries === "number" ? opts.retries : 0;

  let lastErr: any = null;

  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetchWithTimeout(placeUrl, { method: "GET", headers: buildHeaders(), redirect: "follow" }, timeoutMs);
      const html = await res.text();
      const finalUrl = (res as any).url || placeUrl;

      if (!res.ok) {
        throw new Error(`fetchPlaceHtml failed: ${res.status} ${res.statusText}\n${html.slice(0, 400)}`);
      }

      if (html.length < minLength) {
        throw new Error(`fetchPlaceHtml got too-small html (${html.length}). minLength=${minLength}\nfinalUrl=${finalUrl}`);
      }

      return { html, finalUrl };
    } catch (e: any) {
      lastErr = e;
      if (i === retries) break;
    }
  }

  throw lastErr ?? new Error("fetchPlaceHtml unknown error");
}

/**
 * ✅ 내부 API용 JSON fetch (GraphQL/REST 공용)
 */
export async function fetchPlaceJson<T = any>(
  url: string,
  init: { method?: "GET" | "POST"; headers?: Record<string, string>; body?: any } = {},
  opts: { timeoutMs?: number; retries?: number } = {}
): Promise<T> {
  const timeoutMs = typeof opts.timeoutMs === "number" ? opts.timeoutMs : 12000;
  const retries = typeof opts.retries === "number" ? opts.retries : 0;

  let lastErr: any = null;

  for (let i = 0; i <= retries; i++) {
    try {
      const method = init.method ?? (init.body ? "POST" : "GET");
      const headers = buildHeaders({
        Accept: "application/json, text/plain, */*",
        "Content-Type": init.body ? "application/json" : "text/plain",
        ...(init.headers || {})
      });

      const res = await fetchWithTimeout(
        url,
        {
          method,
          headers,
          redirect: "follow",
          body: init.body ? JSON.stringify(init.body) : undefined
        },
        timeoutMs
      );

      const text = await res.text();

      if (!res.ok) {
        throw new Error(`fetchPlaceJson failed: ${res.status} ${res.statusText}\n${text.slice(0, 400)}`);
      }

      try {
        return JSON.parse(text) as T;
      } catch {
        throw new Error(`fetchPlaceJson got non-json\nhead=${text.slice(0, 400)}`);
      }
    } catch (e: any) {
      lastErr = e;
      if (i === retries) break;
    }
  }

  throw lastErr ?? new Error("fetchPlaceJson unknown error");
}

