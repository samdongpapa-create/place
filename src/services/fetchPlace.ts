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
  // Next.js buildId는 보통 이런 형태로 shell에 박혀 있음:
  // /_next/static/<BUILDID>/_buildManifest.js
  const m = html.match(/\/_next\/static\/([^\/]+)\/_buildManifest\.js/i);
  return m?.[1] ?? null;
}

function toRoutePath(placeUrl: string): string | null {
  // placeUrl 예: https://m.place.naver.com/hairshop/1443688242/home
  // route: hairshop/1443688242/home
  try {
    const u = new URL(placeUrl);
    const path = u.pathname.replace(/^\/+/, ""); // leading slash 제거
    if (!path) return null;
    return path;
  } catch {
    return null;
  }
}

function wrapAsNextDataHtml(nextDataJson: any): string {
  // 기존 enrichPlace의 guessMenusFromNextData(html) 가 그대로 먹도록
  const safe = JSON.stringify(nextDataJson);
  return `<!doctype html><html><head></head><body><script id="__NEXT_DATA__" type="application/json">${safe}</script></body></html>`;
}

function looksDefinitelyCaptchaOrBlock(html: string) {
  const t = html.toLowerCase();
  // ✅ “진짜” 차단/보안문자 관련 키워드만
  return (
    t.includes("captcha") ||
    t.includes("보안문자") ||
    t.includes("자동입력") ||
    t.includes("비정상적인 접근") ||
    t.includes("접근이 제한") ||
    t.includes("로봇이") ||
    t.includes("robot") ||
    t.includes("blocked")
  );
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

  // Next.js data URL
  const nextUrl = `https://m.place.naver.com/_next/data/${buildId}/${route}.json`;

  try {
    const { text, finalUrl } = await fetchText(nextUrl, {
      ...headers,
      Accept: "application/json, text/plain, */*",
      Referer: placeUrl
    }, timeoutMs);

    // JSON 파싱
    const json = JSON.parse(text);

    // 기존 파서가 먹도록 __NEXT_DATA__로 감싸서 HTML로 리턴
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

  // ✅ UA 2종: iPhone(Safari) -> Desktop(Chrome)
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

      // 1) 진짜 캡차/차단이면 그때만 재시도 가치
      if (looksDefinitelyCaptchaOrBlock(htmlRaw)) {
        throw new Error(
          `fetchPlaceHtml blocked/captcha (definite).\nfinalUrl=${finalUrl}\nhead=${htmlRaw.slice(0, 400)}`
        );
      }

      // 2) __NEXT_DATA__가 있으면 길이 상관없이 통과
      if (hasNextData(htmlRaw)) {
        return { html: htmlRaw, finalUrl };
      }

      // 3) __NEXT_DATA__가 없고, HTML이 짧거나(또는 shell로 보이면)
      //    shell에서 buildId 뽑아서 /_next/data JSON을 직접 가져와본다.
      if (htmlRaw.length < minLength) {
        const nextData = await tryFetchNextDataJsonFromShell({
          html: htmlRaw,
          placeUrl,
          headers,
          timeoutMs
        });
        if (nextData) return nextData;

        // next-data도 실패하면 길이 기준 에러
        throw new Error(
          `fetchPlaceHtml got too-small html (${htmlRaw.length}). minLength=${minLength}\nfinalUrl=${finalUrl}\nhead=${htmlRaw.slice(0, 250)}`
        );
      }

      // 4) 길이는 충분하지만 __NEXT_DATA__가 없는 케이스도 있음 → next-data 한번 더 시도
      const nextData2 = await tryFetchNextDataJsonFromShell({
        html: htmlRaw,
        placeUrl,
        headers,
        timeoutMs
      });
      if (nextData2) return nextData2;

      // 5) 그냥 HTML 반환(일부 파서가 본문 텍스트에서 뽑을 수도 있음)
      return { html: htmlRaw, finalUrl };
    } catch (e: any) {
      lastErr = e;
      if (attempt < retries) await sleep(350 + attempt * 250);
    }
  }

  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}
