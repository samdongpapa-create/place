// src/services/fetchPlace.ts
export type FetchedPage = {
  html: string;
  finalUrl: string;
};

export async function fetchPlaceHtml(placeUrl: string): Promise<FetchedPage> {
  if (!placeUrl) throw new Error("placeUrl is empty");

  const headers: Record<string, string> = {
    "User-Agent":
      "Mozilla/5.0 (iPhone; CPU i_basic like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.7,en;q=0.6",
    "Cache-Control": "no-cache",
    Pragma: "no-cache",
    Referer: "https://m.place.naver.com/"
  };

  const res = await fetch(placeUrl, {
    method: "GET",
    headers,
    redirect: "follow"
  });

  const html = await res.text();
  const finalUrl = (res as any).url || placeUrl;

  if (!res.ok) {
    throw new Error(
      `fetchPlaceHtml failed: ${res.status} ${res.statusText}\n${html.slice(0, 400)}`
    );
  }

  if (html.length < 2000) {
    throw new Error(
      `fetchPlaceHtml got too-small html (${html.length}). Possibly blocked.\nfinalUrl=${finalUrl}\n${html.slice(0, 400)}`
    );
  }

  return { html, finalUrl };
}
