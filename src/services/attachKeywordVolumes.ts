// src/services/attachKeywordVolumes.ts
import { fetchKeywordVolumesFromSearchAd, type KeywordVolume } from "./searchadKeywordTool.js";

export type KeywordWithVolume = {
  keyword: string;
  pc?: number;
  mobile?: number;
  total?: number;
  compIdx?: string | number;
};

export async function attachVolumesToKeywords5(
  keywords5: string[],
  opts: { timeoutMs?: number } = {}
): Promise<{ items: KeywordWithVolume[]; debug: any }> {
  const keys = (keywords5 || []).map((x) => (x || "").trim()).filter(Boolean).slice(0, 5);

  if (!keys.length) return { items: [], debug: { used: false, reason: "empty keywords5" } };

  const t0 = Date.now();
  const map = await fetchKeywordVolumesFromSearchAd(keys, { timeoutMs: opts.timeoutMs, showDetail: 1 });
  const elapsedMs = Date.now() - t0;

  // 응답은 relKeyword 기준이라, “정확히 일치”가 없으면 유사값을 넣기 애매 → 기본은 exact match
  const items: KeywordWithVolume[] = keys.map((k) => {
    const hit: KeywordVolume | undefined = map[k];
    return {
      keyword: k,
      pc: hit?.monthlyPcQcCnt,
      mobile: hit?.monthlyMobileQcCnt,
      total: hit?.monthlyTotalQcCnt,
      compIdx: hit?.compIdx
    };
  });

  return {
    items,
    debug: {
      used: true,
      elapsedMs,
      requested: keys,
      matched: items.filter((x) => typeof x.total === "number").length
    }
  };
}
