// src/services/playwrightCompetitorSearch.ts
import { chromium } from "playwright";

const UA_MOBILE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

function uniq(arr: string[]) {
  return Array.from(new Set(arr));
}

function extractPlaceIdsFromText(text: string): string[] {
  // JSON/HTML 어디서든 placeId/ id 패턴 최대한 줍기
  const out: string[] = [];

  const r1 = /"placeId"\s*:\s*"(\d+)"/g;
  const r2 = /"id"\s*:\s*"(\d{6,})"/g; // place id는 보통 6자리 이상인 경우가 많음
  const r3 = /\/place\/(\d{6,})/g;
  const r4 = /m\.place\.naver\.com\/place\/(\d{6,})/g;

  for (const re of [r1, r2, r3, r4]) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      if (m[1]) out.push(m[1]);
      if (out.length > 80) break;
    }
    if (out.length > 80) break;
  }

  return out;
}

/**
 * ✅ 경쟁업체 후보(placeId) 상위 N개 추출
 * - DOM <a href>를 믿지 말고, search 페이지가 호출하는 JSON/GraphQL 응답에서 placeId를 스니핑
 */
export async function fetchTopPlaceIdsByQuery(query: string, limit = 5) {
  const debug: any = {
    used: true,
    query,
    limit,
    strategy: "m.place search -> network sniff (json/graphql) -> placeId regex",
    steps: [] as any[],
    sniffedUrls: [] as string[],
    sniffedCount: 0
  };

  const browser = await chromium.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-blink-features=AutomationControlled"
    ]
  });

  try {
    const context = await browser.newContext({
      userAgent: UA_MOBILE,
      locale: "ko-KR"
    });

    // webdriver 힌트 제거(일부 케이스 차단 완화)
    await context.addInitScript(() => {
      try {
        (Object.getPrototypeOf(navigator) as any).webdriver = undefined;
      } catch {}
    });

    const page = await context.newPage();

    const collected: string[] = [];
    const seenUrl = new Set<string>();

    page.on("response", async (res) => {
      const url = res.url();
      const ct = (res.headers()["content-type"] || "").toLowerCase();

      // 너무 광범위하면 느려지니 place/search/graphql만
      const looksRelevant =
        /m\.place\.naver\.com\/search/i.test(url) ||
        /place\.naver\.com/i.test(url) ||
        /graphql/i.test(url) ||
        /search/i.test(url);

      if (!looksRelevant) return;

      // 동일 URL 반복 방지(일부 polling)
      if (seenUrl.has(url)) return;
      seenUrl.add(url);

      if (seenUrl.size <= 30) debug.sniffedUrls.push(url);

      try {
        // json이든 html이든 텍스트로 받아서 정규식으로 placeId 추출
        const text = await res.text();
        const ids = extractPlaceIdsFromText(text);
        if (ids.length) {
          collected.push(...ids);
          debug.sniffedCount += ids.length;
        }
      } catch {}
    });

    const url = `https://m.place.naver.com/search?query=${encodeURIComponent(query)}`;

    const t0 = Date.now();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });

    // 결과 로딩 유도(너무 길게 끌지 말고 짧게)
    await page.waitForTimeout(800);
    for (let i = 0; i < 3; i++) {
      await page.mouse.wheel(0, 2400);
      await page.waitForTimeout(700);
    }

    // 네트워크 늦게 오는 응답 조금 더 받기
    await page.waitForTimeout(1200);

    const elapsedMs = Date.now() - t0;

    const placeIds = uniq(collected)
      // 내 placeId가 섞일 수 있으니 최소 6자리 이상만
      .filter((x) => /^\d{6,}$/.test(x))
      .slice(0, limit);

    debug.steps.push({
      step: "place-search",
      url,
      elapsedMs,
      collectedRaw: collected.length,
      uniqueCandidates: uniq(collected).length,
      foundCandidates: placeIds.length
    });

    return { placeIds, debug };
  } finally {
    await browser.close();
  }
}
