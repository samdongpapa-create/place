// src/services/playwrightCompetitors.ts
import { chromium } from "playwright";
import { fetchRepresentativeKeywords5ByFrameSource } from "./playwrightKeywordList.js";

const UA_MOBILE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

export type Competitor = {
  placeId: string;
  placeUrl: string;
  keywords5?: string[];
  debug?: any;
};

export type CompetitorSearchResult = {
  competitors: Competitor[];
  debug: any;
};

function buildHeaders(extra?: Record<string, string>) {
  return {
    "User-Agent": UA_MOBILE,
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.7,en;q=0.6",
    "Cache-Control": "no-cache",
    Pragma: "no-cache",
    Referer: "https://m.place.naver.com/",
    ...(extra || {})
  };
}

function uniq<T>(arr: T[]) {
  return Array.from(new Set(arr));
}

function extractPlaceIdsFromHtml(html: string): string[] {
  const out: string[] = [];

  // href="/place/12345" or "/hairshop/12345" or full urls
  const re1 = /\/place\/(\d+)/g;
  const re2 = /\/hairshop\/(\d+)/g;
  const re3 = /m\.place\.naver\.com\/place\/(\d+)/g;
  const re4 = /m\.place\.naver\.com\/hairshop\/(\d+)/g;

  for (const re of [re1, re2, re3, re4]) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(html))) {
      if (m[1]) out.push(m[1]);
    }
  }

  return uniq(out);
}

function toHomeUrl(placeId: string) {
  return `https://m.place.naver.com/place/${placeId}/home`;
}

// ✅ 핵심: 검색은 "역+업종"으로 고정하는 게 흔들림이 적음
export async function fetchCompetitorsTop(
  query: string,
  opts: { limit?: number; excludePlaceId?: string; timeoutMs?: number } = {}
): Promise<CompetitorSearchResult> {
  const started = Date.now();
  const limit = typeof opts.limit === "number" ? opts.limit : 5;
  const exclude = opts.excludePlaceId ? String(opts.excludePlaceId) : "";
  const timeoutMs = typeof opts.timeoutMs === "number" ? opts.timeoutMs : 15000;

  const debug: any = {
    used: true,
    query,
    limit,
    excludePlaceId: exclude || undefined,
    steps: []
  };

  // 1) m.place 검색 (가끔 HTML이 너무 짧거나 결과가 안 뜸)
  let candidates: string[] = [];
  try {
    const u = `https://m.place.naver.com/search?query=${encodeURIComponent(query)}`;
    const res = await fetch(u, { headers: buildHeaders() });
    const html = await res.text();

    const ids = extractPlaceIdsFromHtml(html);
    candidates = ids;

    debug.steps.push({
      step: "m.place.search",
      url: u,
      ok: res.ok,
      htmlLen: html.length,
      found: ids.length
    });
  } catch (e: any) {
    debug.steps.push({ step: "m.place.search", error: e?.message ?? "failed" });
  }

  // 2) fallback: m.search (더 잘 뜨는 편)
  if (candidates.length < limit) {
    try {
      const u = `https://m.search.naver.com/search.naver?query=${encodeURIComponent(query)}&where=m`;
      const res = await fetch(u, { headers: buildHeaders({ Referer: "https://m.search.naver.com/" }) });
      const html = await res.text();

      const ids = extractPlaceIdsFromHtml(html);
      candidates = uniq([...candidates, ...ids]);

      debug.steps.push({
        step: "fallback.m.search",
        url: u,
        ok: res.ok,
        htmlLen: html.length,
        found: ids.length,
        merged: candidates.length
      });
    } catch (e: any) {
      debug.steps.push({ step: "fallback.m.search", error: e?.message ?? "failed" });
    }
  }

  // 자기 자신 제외 + limit 컷
  candidates = candidates.filter((id) => id && id !== exclude).slice(0, limit);

  // 경쟁사 키워드 5개 추출 (frame keywordList)
  const competitors: Competitor[] = [];

  // Playwright는 키워드 추출 함수 내부에서 쓰고 있으니, 여기서는 병렬로 돌리면 너무 무거울 수 있음
  for (const pid of candidates) {
    const homeUrl = toHomeUrl(pid);
    try {
      const kw = await fetchRepresentativeKeywords5ByFrameSource(homeUrl);
      competitors.push({
        placeId: pid,
        placeUrl: homeUrl,
        keywords5: (kw.keywords5?.length ? kw.keywords5 : kw.raw || []).slice(0, 5),
        debug: kw.debug
      });
    } catch (e: any) {
      competitors.push({
        placeId: pid,
        placeUrl: homeUrl,
        keywords5: [],
        debug: { error: e?.message ?? "keyword fetch failed" }
      });
    }
  }

  debug.elapsedMs = Date.now() - started;
  debug.foundCandidates = candidates.length;

  return { competitors, debug };
}
