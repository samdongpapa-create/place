// src/services/playwrightCompetitors.ts
import type { Page } from "playwright";

type Competitor = {
  placeId: string;
  placeUrl: string;
  keywords5?: string[];
  debug?: any;
};

type Opts = {
  query: string;
  limit?: number;
  excludePlaceId?: string;
  timeoutMs?: number;
};

export async function fetchCompetitorsTop(
  page: Page,
  opts: Opts
): Promise<{ competitors: Competitor[]; debug: any }> {
  const t0 = Date.now();
  const limit = Math.max(1, Math.min(opts.limit ?? 5, 10));
  const timeoutMs = opts.timeoutMs ?? 12000;

  const debug: any = {
    used: true,
    query: opts.query,
    limit,
    excludePlaceId: opts.excludePlaceId ?? null,
    steps: [],
    elapsedMs: 0,
    foundCandidates: 0
  };

  const step = (s: any) => debug.steps.push({ at: Date.now() - t0, ...s });

  const q = (opts.query || "").toString().trim();
  if (!q) {
    debug.elapsedMs = Date.now() - t0;
    return { competitors: [], debug };
  }

  const seen = new Set<string>();
  const competitors: Competitor[] = [];

  // -----------------------------
  // helper: URL에서 placeId 추출
  // -----------------------------
  const extractPlaceId = (url: string) => {
    const u = url || "";
    // /place/123, /hairshop/123, /restaurant/123 등
    const m =
      u.match(/\/place\/(\d+)/) ||
      u.match(/\/hairshop\/(\d+)/) ||
      u.match(/\/restaurant\/(\d+)/) ||
      u.match(/\/hospital\/(\d+)/) ||
      u.match(/\/accommodation\/(\d+)/) ||
      u.match(/\/(\d+)\/home/);
    return m?.[1] || "";
  };

  const pushCandidate = (placeId: string) => {
    if (!placeId) return;
    if (opts.excludePlaceId && placeId === opts.excludePlaceId) return;
    if (seen.has(placeId)) return;
    seen.add(placeId);

    const placeUrl = `https://m.place.naver.com/place/${placeId}/home`;
    competitors.push({ placeId, placeUrl });
  };

  // -----------------------------------------
  // 1) m.place.naver.com/search (우선)
  // -----------------------------------------
  const url1 = `https://m.place.naver.com/search?query=${encodeURIComponent(q)}`;
  try {
    step({ step: "m.place.search", url: url1 });
    await page.goto(url1, { waitUntil: "domcontentloaded", timeout: timeoutMs });
    await page.waitForTimeout(900);

    const html = await page.content();
    step({ step: "m.place.search.content", htmlLen: html.length });

    // a href 전체에서 placeId 패턴을 최대한 긁는다
    const ids = Array.from(
      new Set(
        (html.match(/https?:\/\/m\.place\.naver\.com\/(?:place|hairshop|restaurant|hospital|accommodation)\/\d+/g) || [])
          .map((u) => extractPlaceId(u))
          .filter(Boolean)
      )
    );

    for (const id of ids) {
      pushCandidate(id);
      if (competitors.length >= limit) break;
    }

    step({ step: "m.place.search.parsed", found: competitors.length });
  } catch (e: any) {
    step({ step: "m.place.search.fail", ok: false, error: e?.message ?? String(e) });
  }

  // -----------------------------------------
  // 2) fallback: m.search.naver.com (모바일 검색)
  // -----------------------------------------
  if (competitors.length < limit) {
    const url2 = `https://m.search.naver.com/search.naver?where=m&query=${encodeURIComponent(q)}`;
    try {
      step({ step: "fallback.m.search", url: url2 });
      await page.goto(url2, { waitUntil: "domcontentloaded", timeout: timeoutMs });
      await page.waitForTimeout(900);

      const html2 = await page.content();
      step({ step: "fallback.m.search.content", htmlLen: html2.length });

      // placeId가 섞여 나오는 링크들에서 최대한 추출
      const ids2 = Array.from(
        new Set(
          (html2.match(/m\.place\.naver\.com\/(?:place|hairshop|restaurant|hospital|accommodation)\/\d+/g) || [])
            .map((u) => extractPlaceId(`https://${u.replace(/^https?:\/\//, "")}`))
            .filter(Boolean)
        )
      );

      for (const id of ids2) {
        pushCandidate(id);
        if (competitors.length >= limit) break;
      }

      step({ step: "fallback.m.search.parsed", found: competitors.length });
    } catch (e: any) {
      step({ step: "fallback.m.search.fail", ok: false, error: e?.message ?? String(e) });
    }
  }

  debug.foundCandidates = competitors.length;
  debug.elapsedMs = Date.now() - t0;

  return { competitors: competitors.slice(0, limit), debug };
}
