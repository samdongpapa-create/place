// src/services/playwrightCompetitorSearch.ts
import { chromium } from "playwright";

const UA_MOBILE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

function uniq<T>(arr: T[]) {
  return Array.from(new Set(arr));
}

/**
 * ✅ 플레이스 검색(=m.place.naver.com/search)에서 placeId 상위 후보를 뽑는다
 * - "순위"는 개인화/위치/시간에 따라 달라질 수 있으니 “상위 후보”라고 부르는 게 안전
 */
export async function fetchTopPlaceIdsByQuery(query: string, limit = 5) {
  const debug: any = {
    used: true,
    query,
    limit,
    strategy: "m.place search -> anchor href scan",
    steps: [] as any[]
  };

  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"]
  });

  try {
    const context = await browser.newContext({ userAgent: UA_MOBILE, locale: "ko-KR" });
    const page = await context.newPage();

    // ✅ 핵심: 통합검색 말고 플레이스 검색 페이지로 간다
    const url = `https://m.place.naver.com/search?query=${encodeURIComponent(query)}`;
    const t0 = Date.now();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });

    // 가벼운 스크롤로 더 로딩 (너무 오래 끌지 않게 2~3번만)
    await page.waitForTimeout(600);
    for (let i = 0; i < 3; i++) {
      await page.mouse.wheel(0, 2200);
      await page.waitForTimeout(600);
    }

    // DOM 타입(document/HTMLAnchorElement) 사용 X: 모두 any로 처리
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
        // /place/{id} (상대/다른 도메인 포함)
        const m2 = h.match(/\/place\/(\d+)/i);

        const id = (m1?.[1] || m2?.[1] || "").trim();
        if (!id) continue;

        // search 결과에는 광고/중복 링크가 많아서, 그냥 유니크만 추림
        if (seen.has(id)) continue;
        seen.add(id);
        out.push(id);

        // 너무 많이 모을 필요 없음 (상위 후보만)
        if (out.length >= 25) break;
      }

      return out;
    });

    const elapsedMs = Date.now() - t0;

    debug.steps.push({
      step: "place-search",
      url,
      elapsedMs,
      foundCandidates: ids.length
    });

    const placeIds = uniq(ids).slice(0, limit);
    return { placeIds, debug };
  } finally {
    await browser.close();
  }
}
