// src/services/playwrightCompetitorSearch.ts
import { chromium } from "playwright";

export async function fetchTopPlaceIdsByQuery(query: string, limit = 5) {
  const debug: any = { used: true, query, limit, strategy: "m.search -> href scan" };

  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"]
  });

  try {
    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
      locale: "ko-KR"
    });

    const page = await context.newPage();

    // 모바일 검색 페이지(플레이스 링크가 섞여 나오는 페이지)
    const url = `https://m.search.naver.com/search.naver?where=m&query=${encodeURIComponent(query)}`;
    const t0 = Date.now();

    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });

    // 로딩 유도 스크롤(가볍게 1~2번만)
    await page.waitForTimeout(700);
    await page.mouse.wheel(0, 2000);
    await page.waitForTimeout(700);

    // ⚠️ TypeScript DOM 타입(document/HTMLAnchorElement) 안 쓰기:
    // - globalThis.document를 any로 취급
    // - querySelectorAll 결과도 any로 처리
    const ids: string[] = await page.evaluate(() => {
      const d: any = (globalThis as any).document;
      const anchors: any[] = Array.from(d.querySelectorAll("a") || []);

      const hrefs: string[] = anchors
        .map((a: any) => (typeof a?.href === "string" ? a.href : ""))
        .filter((h: string) => !!h);

      const out: string[] = [];
      const seen = new Set<string>();

      for (const h of hrefs) {
        // m.place.naver.com/place/{id}
        const m1 = h.match(/m\.place\.naver\.com\/place\/(\d+)/i);
        // .../place/{id} (일반)
        const m2 = h.match(/\/place\/(\d+)/i);

        const id = (m1?.[1] || m2?.[1] || "").trim();
        if (!id) continue;
        if (seen.has(id)) continue;

        seen.add(id);
        out.push(id);

        if (out.length >= 20) break;
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
