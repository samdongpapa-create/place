// src/services/fetchPlace.ts
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
    // ✅ 일부 환경에서 압축 관련 이슈/차단이 나서 identity도 옵션으로 제공(자동 처리되면 무시됨)
    // "Accept-Encoding": "gzip, deflate, br",
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

/**
 * ✅ 네이버 플레이스 HTML이 "정상 페이지"인지 빠르게 판정
 * - __NEXT_DATA__가 있어야 (대표키워드/상세데이터) 안정적으로 추출 가능
 * - 차단/리뷰/빈껍데기 페이지면 false
 */
function looksLikeValidPlaceHtml(html: string) {
  if (!html || html.length < 800) return false;

  // 차단/접근 제한 류
  if (/접근이 제한|비정상적인 접근|captcha|자동입력|로봇|보안/i.test(html)) return false;

  // Next.js 데이터가 없으면 대표키워드 추출이 매우 불안정(=DOM 잡음으로 흐름)
  const hasNextData = /id="__NEXT_DATA__"/i.test(html) && /"props"\s*:\s*\{/i.test(html);
  if (!hasNextData) return false;

  // 플레이스 기본 단서(너무 빡세게 하지 말고)
  const hasOg = /property="og:title"|property="og:description"|property="og:url"/i.test(html);
  return hasOg || hasNextData;
}

/**
 * ✅ URL에 cache-bust 파라미터를 붙여서 (간헐적 캐시/빈껍데기) 방지
 */
function withCacheBust(url: string, attempt: number) {
  try {
    const u = new URL(url);
    // 기존 쿼리 유지 + cb 추가
    u.searchParams.set("cb", `${Date.now()}_${attempt}`);
    return u.toString();
  } catch {
    // URL 파싱 실패하면 그냥 뒤에 붙임
    const sep = url.includes("?") ? "&" : "?";
    return `${url}${sep}cb=${Date.now()}_${attempt}`;
  }
}

/**
 * ✅ 대표키워드 파싱을 위해 "가능하면 home 페이지"로 유도
 * - /place/{id}/home → 그대로 OK
 * - /place/{id} → /home 붙이기
 */
function normalizePlaceUrl(url: string) {
  if (!url) return url;

  // trailing slash 정리
  let u = url.trim();

  // /place/12345 (끝) → /place/12345/home
  if (/\/place\/\d+\/?$/i.test(u)) u = u.replace(/\/?$/i, "/home");

  // 기타: 너무 다양한 탭이 들어오면 home으로 맞춰도 됨(원하면 유지)
  // u = u.replace(/\/(photo|review|menu|price|booking)(\?.*)?$/i, "/home");

  return u;
}

export async function fetchPlaceHtml(placeUrl: string, opts: FetchOptions = {}): Promise<FetchedPage> {
  if (!placeUrl) throw new Error("placeUrl is empty");

  const minLength = typeof opts.minLength === "number" ? opts.minLength : 2000;
  const timeoutMs = typeof opts.timeoutMs === "number" ? opts.timeoutMs : 15000;
  const retries = typeof opts.retries === "number" ? opts.retries : 1;

  let lastErr: any = null;

  // ✅ URL 정규화(대표키워드/데이터는 home이 안정적)
  const normalized = normalizePlaceUrl(placeUrl);

  for (let i = 0; i <= retries; i++) {
    try {
      // ✅ cache-bust로 빈껍데기/캐시 이슈 방지
      const url = withCacheBust(normalized, i);

      // 1차 요청
      const res = await fetchWithTimeout(
        url,
        {
          method: "GET",
          headers: buildHeaders({
            // ✅ 간헐적으로 서버가 모바일 페이지를 덜 주는 케이스 방지(있으면 도움)
            "Upgrade-Insecure-Requests": "1"
          }),
          redirect: "follow"
        },
        timeoutMs
      );

      const html = await res.text();
      const finalUrl = (res as any).url || normalized;

      if (!res.ok) {
        throw new Error(`fetchPlaceHtml failed: ${res.status} ${res.statusText}\n${html.slice(0, 400)}`);
      }

      // ✅ 길이 체크
      if (html.length < minLength) {
        throw new Error(
          `fetchPlaceHtml got too-small html (${html.length}). minLength=${minLength}\nfinalUrl=${finalUrl}`
        );
      }

      // ✅ "정상 플레이스 HTML"인지 검사 (대표키워드용)
      if (!looksLikeValidPlaceHtml(html)) {
        // 한번 더 다른 헤더로 재시도할 수 있게 에러로 처리
        throw new Error(
          `fetchPlaceHtml got invalid/blocked html (no __NEXT_DATA__ or blocked)\nfinalUrl=${finalUrl}\nhead=${html
            .slice(0, 300)
            .replace(/\s+/g, " ")}`
        );
      }

      return { html, finalUrl };
    } catch (e: any) {
      lastErr = e;

      // ✅ 마지막 시도면 종료
      if (i === retries) break;

      // ✅ 다음 시도에서는 헤더를 약간 바꿔서(일부 환경에서 효과)
      // (재시도 루프 자체는 동일 fetch로 충분하지만, 구조상 여기서는 그냥 continue)
      continue;
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
