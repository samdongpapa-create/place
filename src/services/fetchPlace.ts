// src/services/fetchPlace.ts
export type FetchedPage = { html: string; finalUrl: string };

type FetchOptions = {
  minLength?: number; // 기본 2000
};

export async function fetchPlaceHtml(placeUrl: string, opts: FetchOptions = {}): Promise<FetchedPage> {
  if (!placeUrl) throw new Error("placeUrl is empty");
  const minLength = typeof opts.minLength === "number" ? opts.minLength : 2000;

  const headers: Record<string, string> = {
    "User-Agent":
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.7,en;q=0.6",
    "Cache-Control": "no-cache",
    Pragma: "no-cache",
    Referer: "https://m.place.naver.com/"
  };

  const res = await fetch(placeUrl, { method: "GET", headers, redirect: "follow" });
  const html = await res.text();
  const finalUrl = (res as any).url || placeUrl;

  if (!res.ok) {
    throw new Error(`fetchPlaceHtml failed: ${res.status} ${res.statusText}\n${html.slice(0, 400)}`);
  }

  // ✅ /photo, /price 같은 탭은 HTML이 짧을 수 있어서 옵션으로 완화
  if (html.length < minLength) {
    throw new Error(`fetchPlaceHtml got too-small html (${html.length}). minLength=${minLength}\nfinalUrl=${finalUrl}`);
  }

  return { html, finalUrl };
}
