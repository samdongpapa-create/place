// src/services/fetchPlace.ts
export type FetchedPage = { html: string; finalUrl: string };

type FetchOptions = {
  minLength?: number; // 기본 2000 (하지만 이제는 "검증"만 하고 throw 안 함)
  timeoutMs?: number; // 기본 9000
  retries?: number;   // 기본 1 (총 2회 시도)
  debug?: boolean;    // true면 콘솔 로그
};

function hasNextData(html: string) {
  return /id="__NEXT_DATA__"/i.test(html);
}

function extractBuildIdFromShell(html: string): string | null {
  // Next.js shell에서 buildId 추출: /_next/static/<BUILDID>/_buildManifest.js
  const m = html.match(/\/_next\/static\/([^\/]+)\/_buildManifest\.js/i);
  return m?.[1] ?? null;
}

function toRoutePath(placeUrl: string): string | null {
  // https://m.place.naver.com/hairshop/144.../home -> hairshop/144.../home
  try {
    const u = new URL(placeUrl);
    const path = u.pathname.replace(/^\/+/, "");
    return path || null;
  } catch {
    return null;
  }
}

function wrapAsNextDataHtml(nextDataJson: any): string {
  // 기존 parsePlaceFromHtml가 __NEXT_DATA__를 읽을 수 있게 HTML로 감쌈
  const safe = JSON.stringify(nextDataJson);
  return `<!doctype html><html><head></head><body><script id="__NEXT_DATA__" type="application/json">${safe}</script></body></html>`;
}

function isProbablyShell(html: string) {
  // og:title이 "네이버 플레이스"이고 __NEXT_DATA__가 없는 경우: 셸일 확률이 높음
  return /<title>\s*네이버 플레이스\s*<\/title>/i.test(html) && !hasNextData(html);
}

function looksCaptchaHint(html: string) {
  // ⚠️ 진짜 차단 판정용이 아니라 "관측"용(절대 throw 안 함)
  const t = html.toLowerCase();
  return (
    t.includes("captcha") ||
    t.includes("보안문자") ||
    t.includes("비정상적인 접근") ||
    t.includes("접근이 제한")
  );
}

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

async function fetchText(url: string, headers: Record<string, string>, timeoutMs: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

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
      // 여기서도 throw는 하되, 상위에서 재시도/리턴 처리
      throw new Error(`fetch failed: ${res.status} ${res.statusText}\n${text.slice(0, 300)}`);
    }

    return { text, finalUrl };
  } finally {
    clearTimeout(timer);
  }
}

async function tryFetchNextDataJsonFromShell(params: {
  shellHtml: string;
  placeUrl: string;
  headers: Record<string, string>;
  timeoutMs: number;
  debug?: boolean;
}): Promise<{ html: string; finalUrl: string } | null> {
  const { shellHtml, placeUrl, headers, timeoutMs, debug } = params;

  const buildId = extractBuildIdFromShell(shellHtml);
  const route = toRoutePath(placeUrl);

  if (!buildId || !route) {
    if (debug) {
      console.log("[fetchPlaceHtml] next-data skip (no buildId/route)", {
        buildId,
        route
      });
    }
    return null;
  }

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

    const json = JSON.parse(text);
    if (debug) {
      console.log("[fetchPlaceHtml] next-data ok", {
        nextUrl,
        finalUrl,
        jsonKeys: Object.keys(json || {}).slice(0, 10)
      });
    }

    return { html: wrapAsNextDataHtml(json), finalUrl };
  } catch (e) {
    if (debug) {
      console.log("[fetchPlaceHtml] next-data failed", {
        nextUrl,
        err: e instanceof Error ? e.message : String(e)
      });
    }
    return null;
  }
}

function buildHeaders(ua: string) {
  return {
    "User-Agent": ua,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.7,en;q=0.6",
    "Cache-Control": "no-cache",
    "Pragma": "no-cache",
    "Referer": "https://m.place.naver.com/",
    "Upgrade-Insecure-Requests": "1"
  } as Record<string, string>;
}

export async function fetchPlaceHtml(placeUrl: string, opts: FetchOptions = {}): Promise<FetchedPage> {
  if (!placeUrl) throw new Error("placeUrl is empty");

  const minLength = typeof opts.minLength === "number" ? opts.minLength : 2000;
  const timeoutMs = typeof opts.timeoutMs === "number" ? opts.timeoutMs : 9000;
  const retries = typeof opts.retries === "number" ? opts.retries : 1;

  // debug 옵션: opts.debug 우선, 없으면 ENV로
  const debug =
    typeof opts.debug === "boolean"
      ? opts.debug
      : (process.env.PLACE_AUDIT_DEBUG === "1" || process.env.PLACE_AUDIT_DEBUG === "true");

  const userAgents = [
    // 모바일 사파리
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
    // 데스크탑 크롬
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
  ];

  let lastErr: any = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const ua = userAgents[Math.min(attempt, userAgents.length - 1)];
    const headers = buildHeaders(ua);

    try {
      const { text: htmlRaw, finalUrl } = await fetchText(placeUrl, headers, timeoutMs);

      const nextData = hasNextData(htmlRaw);
      const shell = isProbablyShell(htmlRaw);
      const captchaHint = looksCaptchaHint(htmlRaw);

      if (debug) {
        console.log("[fetchPlaceHtml] page", {
          attempt,
          placeUrl,
          finalUrl,
          len: htmlRaw.length,
          hasNextData: nextData,
          isShell: shell,
          captchaHint
        });
      }

      // ✅ 1) __NEXT_DATA__ 있으면 그대로 반환 (길이 상관 없음)
      if (nextData) {
        return { html: htmlRaw, finalUrl };
      }

      // ✅ 2) shell이거나 짧으면 next-data JSON을 우선 시도
      //    (이게 핵심: HTML은 껍데기인데 JSON에 데이터가 있는 케이스)
      if (shell || htmlRaw.length < minLength) {
        const nextWrapped = await tryFetchNextDataJsonFromShell({
          shellHtml: htmlRaw,
          placeUrl,
          headers,
          timeoutMs,
          debug
        });
        if (nextWrapped) {
          // next-data를 HTML로 감싼 걸 반환
          return nextWrapped;
        }
      }

      // ✅ 3) 여기까지 오면 그냥 HTML 반환
      //    (캡차/차단으로 보여도 절대 throw하지 않음: 상위 로직이 다른 탭을 계속 시도할 수 있게)
      return { html: htmlRaw, finalUrl };
    } catch (e: any) {
      lastErr = e;

      if (debug) {
        console.log("[fetchPlaceHtml] fetch error", {
          attempt,
          placeUrl,
          err: e?.message ?? String(e)
        });
      }

      if (attempt < retries) {
        await sleep(350 + attempt * 250);
        continue;
      }
    }
  }

  // 여기까지 오면 네트워크/상태코드가 계속 실패한 경우
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}
