import { chromium } from "playwright";

const UA_MOBILE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

function uniq(arr: string[]) {
  return Array.from(new Set(arr));
}

function extractPlaceIdsFromText(text: string): string[] {
  const out: string[] = [];

  const patterns = [
    /"placeId"\s*:\s*"(\d{6,})"/g,
    /"id"\s*:\s*"(\d{6,})"/g,
    /\/place\/(\d{6,})/g,
    /m\.place\.naver\.com\/place\/(\d{6,})/g,
    /m\.place\.naver\.com\/(restaurant|hairshop|hospital|cafe|accommodation|shopping|place)\/(\d{6,})/g
  ];

  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      const id = m[2] ?? m[1];
      if (id) out.push(id);
      if (out.length > 200) break;
    }
    if (out.length > 200) break;
  }

  return out;
}

function looksBlockedHtml(html: string) {
  // 네가 겪은 “네이버 플레이스” 스켈레톤/차단류
  return (
    /<title>\s*네이버 플레이스\s*<\/title>/i.test(html) &&
    !/__NEXT_DATA__/i.test(html) &&
    html.length < 120000 // 스켈레톤은 보통 짧은 편
  );
}

/**
 * ✅ 경쟁업체 후보(placeId) 상위 N개 추출
 * 1) m.place 검색: 네트워크 응답/HTML에서 placeId 추출
 * 2) 실패 시 m.search.naver.com 일반검색에서 place 링크 추출
 */
export async function fetchTopPlaceIdsByQuery(query: string, limit = 5) {
  const debug: any = {
    used: true,
    query,
    limit,
    strategy: "place-search (network+html) -> fallback web-search(html)",
    steps: [] as any[],
    sniffedUrls: [] as string[],
    sniffedCount: 0,
    fallbackUsed: false
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
      locale: "ko-KR",
      viewport: { width: 390, height: 844 }
    });

    await context.addInitScript(() => {
      // 일부 차단 완화
      try {
        Object.defineProperty(navigator, "webdriver", { get: () => undefined });
      } catch {}
    });

    const page = await context.newPage();

    // 속도: 이미지/폰트 차단(스크립트는 살려야 함)
    await page.route("**/*", async (route) => {
      const r = route.request();
      const type = r.resourceType();
      if (type === "image" || type === "font") return route.abort();
      return route.continue();
    });

    const collected: string[] = [];
    const sniffedUrlSet = new Set<string>();

    page.on("response", async (res) => {
      const url = res.url();
      const ct = (res.headers()["content-type"] || "").toLowerCase();

      const relevant =
        /m\.place\.naver\.com\/search/i.test(url) ||
        /m\.search\.naver\.com\/search\.naver/i.test(url) ||
        /place\.naver\.com/i.test(url) ||
        /graphql/i.test(url) ||
        /api\/search/i.test(url);

      if (!relevant) return;

      // 너무 많이 쌓이지 않게 URL 샘플만 보관
      if (!sniffedUrlSet.has(url) && debug.sniffedUrls.length < 30) {
        sniffedUrlSet.add(url);
        debug.sniffedUrls.push(url);
      }

      try {
        // json/html 가리지 말고 text로
        const text = await res.text();
        const ids = extractPlaceIdsFromText(text);
        if (ids.length) {
          collected.push(...ids);
          debug.sniffedCount += ids.length;
        }
      } catch {}
    });

    // -------------------------
    // 1) m.place 검색
    // -------------------------
    {
      const url = `https://m.place.naver.com/search?query=${encodeURIComponent(query)}`;
      const t0 = Date.now();
      const resp = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });

      // 문서 자체 HTML에서도 한번 추출 (네트워크가 안 터져도 가능)
      let docHtml = "";
      try {
        docHtml = await page.content();
      } catch {}

      // 스크롤로 로딩 유도
      await page.waitForTimeout(900);
      for (let i = 0; i < 3; i++) {
        await page.mouse.wheel(0, 2600);
        await page.waitForTimeout(800);
      }
      await page.waitForTimeout(1400);

      const elapsedMs = Date.now() - t0;

      // 문서 HTML에서 placeId 추출 추가
      if (docHtml) collected.push(...extractPlaceIdsFromText(docHtml));

      const uniqueCandidates = uniq(collected).filter((x) => /^\d{6,}$/.test(x));
      const placeIds = uniqueCandidates.slice(0, limit);

      debug.steps.push({
        step: "m.place.search",
        url,
        elapsedMs,
        docHtmlLen: docHtml.length,
        blocked: docHtml ? looksBlockedHtml(docHtml) : false,
        collectedRaw: collected.length,
        uniqueCandidates: uniqueCandidates.length,
        foundCandidates: placeIds.length
      });

      if (placeIds.length) {
        return { placeIds, debug };
      }

      // 차단/스켈레톤이면 바로 fallback로
      const blocked = docHtml ? looksBlockedHtml(docHtml) : false;
      if (!blocked) {
        // blocked가 아니면 “조금 더 대기”를 한번 더 주고 끝낼 수도 있음
        // (하지만 지금은 단순하게 fallback으로 넘김)
      }
    }

    // -------------------------
    // 2) fallback: m.search.naver.com 일반검색
    // -------------------------
    debug.fallbackUsed = true;
    collected.length = 0; // 초기화

    {
      const url = `https://m.search.naver.com/search.naver?query=${encodeURIComponent(query)}&where=m`;
      const t0 = Date.now();
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });

      await page.waitForTimeout(900);
      for (let i = 0; i < 2; i++) {
        await page.mouse.wheel(0, 2400);
        await page.waitForTimeout(700);
      }
      await page.waitForTimeout(900);

      let html = "";
      try {
        html = await page.content();
      } catch {}

      if (html) collected.push(...extractPlaceIdsFromText(html));

      const elapsedMs = Date.now() - t0;
      const uniqueCandidates = uniq(collected).filter((x) => /^\d{6,}$/.test(x));
      const placeIds = uniqueCandidates.slice(0, limit);

      debug.steps.push({
        step: "fallback.m.search",
        url,
        elapsedMs,
        htmlLen: html.length,
        collectedRaw: collected.length,
        uniqueCandidates: uniqueCandidates.length,
        foundCandidates: placeIds.length
      });

      return { placeIds, debug };
    }
  } finally {
    await browser.close();
  }
}
