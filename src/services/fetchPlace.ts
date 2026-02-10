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

function looksBlocked(html: string) {
  // 네이버가 가끔 주는 차단/에러 패턴(완벽할 필요 없음)
  const t = html.toLowerCase();
  return (
    t.includes("captcha") ||
    t.includes("로봇") ||
    t.includes("비정상") ||
    t.includes("접근이 제한") ||
    t.includes("error") && t.includes("naver")
  );
}

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

export async function fetchPlaceHtml(placeUrl: string, opts: FetchOptions = {}): Promise<FetchedPage> {
  if (!placeUrl) throw new Error("placeUrl is empty");

  const minLength = typeof opts.minLength === "number" ? opts.minLength : 2000;
  const timeoutMs = typeof opts.timeoutMs === "number" ? opts.timeoutMs : 9000;
  const retries = typeof opts.retries === "number" ? opts.retries : 1;

  // ✅ UA 2종: iPhone(Safari) -> Desktop(Chrome) 순서로 스위치
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

    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(placeUrl, {
        method: "GET",
        headers,
        redirect: "follow",
        signal: controller.signal
      });

      const html = await res.text();
      const finalUrl = (res as any).url || placeUrl;

      if (!res.ok) {
        // 403/429는 재시도 가치가 큼
        throw new Error(`fetchPlaceHtml failed: ${res.status} ${res.statusText}\n${html.slice(0, 400)}`);
      }

      // ✅ 너무 짧아도 __NEXT_DATA__가 있으면 통과 (메뉴/사진 데이터는 보통 여기 들어있음)
      if (html.length < minLength && !hasNextData(html)) {
        throw new Error(
          `fetchPlaceHtml got too-small html (${html.length}). minLength=${minLength}\nfinalUrl=${finalUrl}\nhead=${html.slice(0, 200)}`
        );
      }

      // ✅ 차단/캡차로 보이면 다음 attempt에서 UA 바꿔 재시도
      if (looksBlocked(html)) {
        throw new Error(`fetchPlaceHtml looks blocked/captcha.\nfinalUrl=${finalUrl}\nhead=${html.slice(0, 300)}`);
      }

      return { html, finalUrl };
    } catch (e: any) {
      lastErr = e;
      clearTimeout(t);

      // 재시도 전 짧게 쉬기(429 방지)
      if (attempt < retries) await sleep(350 + attempt * 250);
    } finally {
      clearTimeout(t);
    }
  }

  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}
