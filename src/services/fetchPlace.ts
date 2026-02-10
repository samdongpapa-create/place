// src/services/fetchPlace.ts
import { chromium } from "playwright";

export type FetchedPage = { html: string; finalUrl: string };

type FetchOptions = {
  minLength?: number; // 기본 2000
  timeoutMs?: number; // 기본 15000
  retries?: number; // 기본 1
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

function normalizePlaceUrl(url: string) {
  if (!url) return url;
  let u = url.trim();
  // /place/12345 -> /home
  if (/\/place\/\d+\/?$/i.test(u)) u = u.replace(/\/?$/i, "/home");
  return u;
}

function withCacheBust(url: string, attempt: number) {
  try {
    const u = new URL(url);
    u.searchParams.set("cb", `${Date.now()}_${attempt}`);
    return u.toString();
  } catch {
    const sep = url.includes("?") ? "&" : "?";
    return `${url}${sep}cb=${Date.now()}_${attempt}`;
  }
}

/**
 * ✅ 우리가 원하는 "파싱 가능한 플레이스 HTML" 판정:
 * - __NEXT_DATA__가 있어야 대표키워드/상세데이터가 안정적
 */
function looksLikeValidPlaceHtml(html: string) {
  if (!html || html.length < 800) return false;

  // 차단/보안류
  if (/접근이 제한|비정상적인 접근|captcha|자동입력|로봇|보안/i.test(html)) return false;

  // Next.js 데이터(핵심)
  const hasNext = /id="__NEXT_DATA__"/i.test(html) && /"props"\s*:\s*\{/i.test(html);
  if (!hasNext) return false;

  return true;
}

/**
 * ✅ fetch가 껍데기만 줄 때 -> Playwright로 실제 렌더링된 HTML을 받아온다.
 * (이 HTML에는 __NEXT_DATA__가 들어오는 경우가 많고, 안 들어와도 DOM 기반 추출이 훨씬 낫다)
 */
async function fetchPlaceHtmlViaPlaywright(url: string, timeoutMs: number): Promise<FetchedPage> {
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"]
  });

  try {
    const context = await browser.newContext({
      userAgent: UA_MOBILE,
      locale: "ko-KR"
    });

    const page = await context.newPage();

    // 네이버가 늦게 로드/리다이렉트 하는 케이스가 있어 domcontentloaded + 약간 대기
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: Math.max(10000, timeoutMs) }).catch(() => {});
    // __NEXT_DATA__ 등장 기다리기(짧게)
    await page.waitForTimeout(1200);
    // 스크립트가 붙는 케이스가 있어서 한 번 더 대기
    await page.waitForTimeout(1200);

    const finalUrl = page.url();

    // 렌더된 HTML
    const html = await page.content();

    return { html, finalUrl };
  } finally {
    await browser.close().catch(() => {});
  }
}

export async function fetchPlaceHtml(placeUrl: string, opts: FetchOptions = {}): Promise<FetchedPage> {
  if (!placeUrl) throw new Error("placeUrl is empty");

  const minLength = typeof opts.minLength === "number" ? opts.minLength : 2000;
  const timeoutMs = typeof opts.timeoutMs === "number" ? opts.timeoutMs : 15000;
  const retries = typeof opts.retries === "number" ? opts.retries : 1;

  let lastErr: any = null;

  const normalized = normalizePlaceUrl(placeUrl);

  for (let i = 0; i <= retries; i++) {
    const url = withCacheBust(normalized, i);

    // 1) 먼저 fetch 시도(가장 빠름)
    try {
      const res = await fetchWithTimeout(
        url,
        { method: "GET", headers: buildHeaders({ "Upgrade-Insecure-Requests": "1" }), redirect: "follow" },
        timeoutMs
      );

      const html = await res.text();
      const finalUrl = (res as any).url || normalized;

      if (!res.ok) {
        throw new Error(`fetchPlaceHtml failed: ${res.status} ${res.statusText}\n${html.slice(0, 400)}`);
      }
      if (html.length < minLength) {
        throw new Error(`fetchPlaceHtml got too-small html (${html.length}). minLength=${minLength}\nfinalUrl=${finalUrl}`);
      }

      // ✅ 정상 플레이스 HTML이면 바로 리턴
      if (looksLikeValidPlaceHtml(html)) {
        return { html, finalUrl };
      }

      // ❗여기 도달 = 네이버가 껍데기 HTML 준 것
      throw new Error(
        `fetchPlaceHtml got shell/blocked html (no __NEXT_DATA__)\nfinalUrl=${finalUrl}\nhead=${html
          .slice(0, 300)
          .replace(/\s+/g, " ")}`
      );
    } catch (e: any) {
      lastErr = e;
    }

    // 2) fetch 실패/껍데기면 -> Playwright 폴백(대표키워드 뽑기 위해 필수)
    try {
      const pw = await fetchPlaceHtmlViaPlaywright(url, timeoutMs);

      if (!pw.html || pw.html.length < minLength) {
        throw new Error(`playwright html too small (${pw.html?.length ?? 0}) finalUrl=${pw.finalUrl}`);
      }

      // Playwright로 받은 HTML은 대부분 __NEXT_DATA__가 생기거나, 최소한 DOM 칩 추출이 가능
      return pw;
    } catch (e: any) {
      lastErr = e;
      // 재시도 루프로 계속
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
