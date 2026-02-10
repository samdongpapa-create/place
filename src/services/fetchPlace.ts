// src/services/fetchPlace.ts
export async function fetchPlaceHtml(placeUrl: string): Promise<string> {
  if (!placeUrl) throw new Error("placeUrl is empty");

  // ✅ 모바일 UA로 접근해야 m.place가 정상 HTML을 주는 경우가 많음
  const headers: Record<string, string> = {
    "User-Agent":
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
    "Accept":
      "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.7,en;q=0.6",
    "Cache-Control": "no-cache",
    "Pragma": "no-cache",
    // 네이버가 referer 있을 때 더 잘 주는 케이스가 있음
    "Referer": "https://m.place.naver.com/"
  };

  const res = await fetch(placeUrl, {
    method: "GET",
    headers,
    redirect: "follow"
  });

  const text = await res.text();

  // ✅ 디버그: HTML이 너무 짧거나, 공통 타이틀이면 파싱 실패 가능성이 높음
  if (!res.ok) {
    throw new Error(`fetchPlaceHtml failed: ${res.status} ${res.statusText}\n${text.slice(0, 300)}`);
  }

  // 너무 짧은 HTML은 거의 실패
  if (text.length < 2000) {
    throw new Error(`fetchPlaceHtml got too-small html (${text.length}). Possibly blocked.\n${text.slice(0, 300)}`);
  }

  return text;
}
