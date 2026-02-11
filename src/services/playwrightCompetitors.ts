// src/services/playwrightCompetitors.ts
import { chromium } from "playwright";

const UA_MOBILE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

type CompetitorItem = { placeId: string; placeUrl: string; name?: string; debug?: any };
export type CompetitorSearchResult = { items: CompetitorItem[]; debug: any };

export async function fetchCompetitorsTop5ViaSearch(
  query: string,
  opts: { limit?: number } = {}
): Promise<CompetitorSearchResult> {
  const limit = typeof opts.limit === "number" ? opts.limit : 5;
  const started = Date.now();

  const browser = await chromium.launch({ args: ["--no-sandbox"] });
  const page = await browser.newPage({ userAgent: UA_MOBILE });

  try {
    const url1 = `https://m.place.naver.com/search?query=${encodeURIComponent(query)}`;
    await page.goto(url1, { waitUntil: "domcontentloaded", timeout: 15000 });
    await page.waitForTimeout(300);

    let items = await extractPlaceCandidates(page, limit);

    let fallbackUsed = false;
    if (!items.length) {
      fallbackUsed = true;
      const url2 = `https://m.search.naver.com/search.naver?query=${encodeURIComponent(query)}&where=m`;
      await page.goto(url2, { waitUntil: "domcontentloaded", timeout: 15000 });
      await page.waitForTimeout(300);
      items = await extractPlaceCandidates(page, limit);
    }

    return {
      items,
      debug: { used: true, query, limit, elapsedMs: Date.now() - started, fallbackUsed }
    };
  } finally {
    await page.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

async function extractPlaceCandidates(page: any, limit: number): Promise<CompetitorItem[]> {
  const fn = `
    (limitInner) => {
      const anchors = Array.from(document.querySelectorAll("a"));
      const urls = anchors.map((a) => (a && a.href ? String(a.href) : "")).filter(Boolean);

      const candidates = [];
      const seen = new Set();

      for (const u of urls) {
        const m = u.match(/\\/place\\/(\\d+)(\\/home)?/);
        if (!m || !m[1]) continue;

        const placeId = m[1];
        if (seen.has(placeId)) continue;
        seen.add(placeId);

        candidates.push({
          placeId,
          placeUrl: "https://m.place.naver.com/place/" + placeId + "/home"
        });

        if (candidates.length >= limitInner) break;
      }

      return candidates;
    }
  `;

  // @ts-ignore
  const out = await page.evaluate(eval(fn), limit);

  return Array.isArray(out) ? out.slice(0, limit) : [];
}
