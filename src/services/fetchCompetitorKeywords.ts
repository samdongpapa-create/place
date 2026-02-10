// src/services/fetchCompetitorKeywords.ts
import { fetchTopPlaceIdsByQuery } from "./playwrightCompetitorSearch.js";
import { fetchRepresentativeKeywords5ByFrameSource } from "./playwrightKeywordList.js";

export type CompetitorKeyword = {
  placeId: string;
  placeUrl: string;
  keywords5: string[];
  debug?: any;
};

export async function fetchCompetitorsKeyword5(query: string, limit = 5): Promise<{
  query: string;
  competitors: CompetitorKeyword[];
  debug: any;
}> {
  const debug: any = { used: true, query, limit, steps: [] as any[] };

  const top = await fetchTopPlaceIdsByQuery(query, limit);
  debug.steps.push({ step: "searchTop", ...top.debug });

  const competitors: CompetitorKeyword[] = [];

  for (const id of top.placeIds) {
    const placeUrl = `https://m.place.naver.com/place/${id}/home`;

    try {
      const kw = await fetchRepresentativeKeywords5ByFrameSource(placeUrl);
      const keywords5 = (kw.keywords5?.length ? kw.keywords5 : (kw.raw || []).slice(0, 5)).slice(0, 5);

      competitors.push({
        placeId: id,
        placeUrl,
        keywords5,
        debug: kw.debug
      });
    } catch (e: any) {
      competitors.push({
        placeId: id,
        placeUrl,
        keywords5: [],
        debug: { error: e?.message ?? "competitor keywordList failed" }
      });
    }
  }

  return { query, competitors, debug };
}
