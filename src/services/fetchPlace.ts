// src/services/fetchPlace.ts
export type FetchedPage = { html: string; finalUrl: string };

type FetchOptions = {
  minLength?: number; // 기본 2000 (하지만 __NEXT_DATA__ 있으면 예외로 통과)
  timeoutMs?: number; // 기본 9000
  retries?: number; // 기본 1 (총 2회 시도)
};

function hasNextData(html: string) {
  return /id="__NEXT_DATA__"/i.test(html);
}

function extractBuildIdFromShell(html: string): string | null {
  // /_next/static/<BUILDID>/_buildManifest.js
  const m = html.match(/\/_next\/static\/([^\/]+)\/_buildManifest\.js/i);
  return m?.[1] ?? null;
}

function toRoutePath(placeUrl: string): string | null {
  // https://m.place.naver.com/hairshop/1443688242/home  ->  hairshop/1443688242/home
  try {
    const u = new URL(placeUrl);
    const path = u.pathname.replace(/^\/+/, "");
    return path || null;
  } catch {
    return null;
  }
}

function wrapAsNextDataHtml(nextDataJson: any): string {
  const safe = JSON.stringify(nextDataJson);
  return `<!doctype html><html><head></head><body><script id="__NEXT_DATA__" type="application/json">${safe}</script></body></html>`;
}

function looksCaptchaOnlyWhenObvious(html: string) {
  // ❗ 오탐 줄이기 위해 "진짜로 캡차/차단일 때만" 잡는다 (약하게)
  const t = html.toLowerCase();
  const hasCaptchaWord =
    t.includes("captcha") ||
    t.includes("보안문자") ||
    t.includes("자동입력") ||
    t.includes("비정상적인 접근") ||
    t.includes("접근이 제한");

  // 캡차 폼/입력 UI 느낌이 같이 있으면 그때만 true
  const hasFormLike = t.includes("<form") || t.includes("input") || t.includes("challenge");

  return hasCaptchaWord && hasFormLike;
}

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

async function fetchText(url: string, headers: Record<string, string>, timeoutMs: number) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method: "GET",
      headers,
      redirect: "follow",
      signal: controller.signal
    });

    const text = await res.text();
    const finalUrl = (res as any).url || url;

    if (!res.ok) {
      throw new Error(`fetch failed: ${res.status} ${res.statusText}\n${text.slice(0, 400)}`);
    }

    return { text, finalUrl };
  } finally {
    clearTimeout(t);
  }
}

async function tryFetchNextDataJsonFromShell(params: {
  html: string;
  placeUrl: string;
  headers: Record<string, string>;
  timeoutMs: number;
}): Promise<{ html: string; finalUrl: string } | null> {
  const { html, placeUrl, headers, timeoutMs } = params;

  const buildId = extractBuildIdFromShell(html);
  const route = toRoutePath(placeUrl);
  if (!buildId || !route) return null;

  const nextUrl = `https://m.place.naver.com/_next/data/${buildId}/${route}.json`;

  try {
    const { text, finalUrl } = await fetchText(
      nextUrl,
      {
        ...headers,
        Accept: "application/json, text/plain, */*",
        Referer: placeUrl
      },
      timeoutMs
    );

    // next-data 자체가 캡차 페이지로 오면 JSON 파싱에서 터진다 -> null 리턴
    const json = JSON.parse(text);
    return { html: wrapAsNextDataHtml(json), finalUrl };
  } catch {
    return null;
  }
}

export async function fetchPlaceHtml(placeUrl: string, opts: FetchOptions = {}): Promise<FetchedPage> {
  if (!placeUrl) throw new Error("placeUrl is empty");

  const minLength = typeof opts.minLength === "number" ? opts.minLength : 2000;
  const timeoutMs = typeof opts.timeoutMs === "number" ? opts.timeoutMs : 9000;
  const retries = typeof opts.retries === "number" ? opts.retries : 1;

  const userAgents = [
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
  ];

  let lastErr: any;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const ua = userAgents[Math.min(attempt, userAgents.length - 1)];

    const headers: Record<string, string> = {
      "User-Agent": ua,
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.7,en;q=0.6",
      "Cache-Control": "no-cache",
      "Pragma": "no-cache",
      "Referer": "https://m.place.naver.com/",
      "Upgrade-Insecure-Requests": "1"
    };

    try {
      const { text: htmlRaw, finalUrl } = await fetchText(placeUrl, headers, timeoutMs);

      // 1) __NEXT_DATA__ 있으면 즉시 통과
      if (hasNextData(htmlRaw)) {
        return { html: htmlRaw, finalUrl };
      }

      // 2) __NEXT_DATA__가 없으면 -> shell에서 buildId 추출해서 next-data JSON 먼저 시도 (핵심)
      const nextData = await tryFetchNextDataJsonFromShell({
        html: htmlRaw,
        placeUrl,
        headers,
        timeoutMs
      });
      if (nextData) return nextData;

      // 3) 여기까지 왔다는 건:
      //    - __NEXT_DATA__ 없음
      //    - next-data도 못 가져옴(또는 파싱 실패)
      //    그때만 "캡차로 보이면" blocked로 간주하고 에러
      if (looksCaptchaOnlyWhenObvious(htmlRaw)) {
        throw new Error(
          `fetchPlaceHtml blocked/captcha (obvious).\nfinalUrl=${finalUrl}\nhead=${htmlRaw.slice(0, 400)}`
        );
      }

      // 4) 짧은 HTML이라도 그냥 반환(파서/정규식이 잡을 수도 있고, 다음 단계에서 다른 탭으로 갈 수도 있음)
      //    단, 너무 짧은데 minLength를 강제하고 싶으면 여기서 throw 가능하지만,
      //    지금은 "막히는 것처럼 보이는 오탐"이 문제라서 throw 하지 않는다.
      if (htmlRaw.length < minLength) {
        return { html: htmlRaw, finalUrl };
      }

      // 5) 일반 HTML 반환
      return { html: htmlRaw, finalUrl };
    } catch (e: any) {
      lastErr = e;
      if (attempt < retries) await sleep(350 + attempt * 250);
    }
  }

  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}
