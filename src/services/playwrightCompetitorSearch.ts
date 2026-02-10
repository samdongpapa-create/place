// src/services/playwrightCompetitorSearch.ts
import { chromium } from "playwright";

export async function fetchTopPlaceIdsByQuery(query: string, limit = 5) {
  const debug: any = { used: true, query, limit, strategy: "m.place search -> first list cards" };
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"] });

  try {
    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
      locale: "ko-KR"
    });

    const page = await context.newPage();

    // 네이버 모바일 검색(플레이스 결과가 섞여 나오는 페이지)
    // 보통 m.search.naver.com 또는 m.naver.com/search로 이동하면 플레이스 카드가 뜸
    const url = `https://m.search.naver.com/search.naver?where=m&query=${encodeURIComponent(query)}`;
    const t0 = Date.now();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });

    // 스크롤 조금(카드 로딩 유도)
    await page.waitForTimeout(800);
    await page.mouse.wheel(0, 2200);
    await page.waitForTimeout(800);

    // placeId 후보: 링크에 /place/{id} 또는 m.place.naver.com/place/{id} 가 들어감
    const ids: string[] = await page.evaluate(() => {
      const hrefs = Array.from(document.querySelectorAll("a"))
        .map((a) => (a as HTMLAnchorElement).href)
        .filter(Boolean);

      const out: string[] = [];
      const seen = new Set<string>();

      for (const h of hrefs) {
        const m1 = h.match(/m\.place\.naver\.com\/place\/(\d+)/i);
        const m2 = h.match(/\/place\/(\d+)/i);
        const id = (m1?.[1] || m2?.[1] || "").trim();
        if (!id) continue;
        if (seen.has(id)) continue;
        seen.add(id);
        out.push(id);
        if (out.length >= 20) break; // 후보 넉넉히 뽑고 위에서 자름
      }
      return out;
    });

    debug.elapsedMs = Date.now() - t0;
    debug.foundCandidates = ids.length;

    return { placeIds: ids.slice(0, limit), debug };
  } finally {
    await browser.close();
  }
}
