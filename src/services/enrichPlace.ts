import { fetchMenusViaPlaywright, type Menu } from "./playwrightMenus.js";
import { fetchExistingKeywordsViaPlaywright } from "./playwrightKeywords.js";
import { fetchRepresentativeKeywords5ByFrameSource } from "./playwrightKeywordList.js";
import { fetchTopPlaceIdsByQuery } from "./playwrightCompetitorSearch.js";

type Competitor = {
  placeId: string;
  placeUrl: string;
  keywords5?: string[];
  debug?: any;
};

type PlaceProfileLike = {
  placeId?: string;
  placeUrl: string;
  name?: string;
  category?: string;
  address?: string;
  roadAddress?: string;
  description?: string;
  directions?: string;

  tags?: string[];

  // ✅ 대표키워드(원문 전체) + 5개
  keywords?: string[];
  keywords5?: string[];

  // ✅ 메뉴(미용실: price만)
  menus?: Menu[];

  // ✅ 경쟁업체
  competitors?: Competitor[];

  reviews?: any;
  photos?: { count?: number };

  _menuDebug?: any;
  _keywordDebug?: any;
  _competitorDebug?: any;
};

export async function enrichPlace(place: PlaceProfileLike): Promise<PlaceProfileLike> {
  const base = basePlaceUrl(place.placeUrl);
  const isHair = isHairSalon(place);

  // =========================
  // 0) ✅ 대표키워드(최우선)
  // =========================
  if (!place.keywords || place.keywords.length === 0) {
    const homeUrl = `${base}/home`;

    // (A) frame source keywordList (정답 루트)
    try {
      const kw = await fetchRepresentativeKeywords5ByFrameSource(homeUrl);

      if (kw.raw?.length) {
        place.keywords = kw.raw.slice(0, 15);
        place.keywords5 = kw.keywords5?.length ? kw.keywords5 : kw.raw.slice(0, 5);
      }

      place._keywordDebug = { via: "frame-keywordList", ...kw.debug };
    } catch (e: any) {
      place._keywordDebug = { via: "frame-keywordList", error: e?.message ?? "keywordList parse failed" };
    }

    // (B) fallback: GraphQL/DOM 휴리스틱
    if (!place.keywords || place.keywords.length === 0) {
      try {
        const kw2 = await fetchExistingKeywordsViaPlaywright(homeUrl);
        if (kw2.keywords?.length) {
          place.keywords = kw2.keywords.slice(0, 15);
          place.keywords5 = kw2.keywords.slice(0, 5);
        }
        place._keywordDebug = {
          ...(place._keywordDebug || {}),
          fallback: { via: "graphql-dom-heuristic", ...kw2.debug }
        };
      } catch (e: any) {
        place._keywordDebug = {
          ...(place._keywordDebug || {}),
          fallback: { via: "graphql-dom-heuristic", error: e?.message ?? "keyword pw failed" }
        };
      }
    }
  } else {
    if (!place.keywords5 || place.keywords5.length === 0) {
      place.keywords5 = place.keywords.slice(0, 5);
    }
  }

  // =========================
  // 1) ✅ 메뉴/가격: 미용실은 /price Playwright만 (안되면 배제)
  // =========================
  if (isHair && (!place.menus || place.menus.length === 0)) {
    const priceUrl = `${base}/price`;
    try {
      const pw = await fetchMenusViaPlaywright(priceUrl);

      if (pw.menus.length) {
        place.menus = cleanMenus(pw.menus);
        place._menuDebug = { via: "hair-price-pw", isHair, ...pw.debug };
      } else {
        place._menuDebug = { via: "hair-none", isHair, ...pw.debug };
      }
    } catch (e: any) {
      place._menuDebug = { via: "hair-price-pw", isHair, error: e?.message ?? "price pw failed" };
    }
  }

  // =========================
  // 2) ✅ 경쟁업체(상위 1~5) 대표키워드 추출
  // - 우선 쿼리는 "역/지역 + 업종" 형태가 제일 안정적
  // - placeId가 있으면 자기 자신은 제외
  // =========================
  if (!place.competitors || place.competitors.length === 0) {
    const query = buildCompetitorQuery(place); // ex) "서대문역 미용실"
    const myId = place.placeId;

    try {
      const top = await fetchTopPlaceIdsByQuery(query, 5);

      // ✅ 자기 자신 제거 + 중복 제거
      const filteredIds = Array.from(new Set(top.placeIds)).filter((id) => (myId ? id !== myId : true)).slice(0, 5);

      const comps: Competitor[] = [];
      for (const id of filteredIds) {
        const url = `https://m.place.naver.com/place/${id}/home`;
        try {
          const kw = await fetchRepresentativeKeywords5ByFrameSource(url);
          comps.push({
            placeId: id,
            placeUrl: `https://m.place.naver.com/place/${id}/home`,
            keywords5: kw.keywords5?.length ? kw.keywords5 : kw.raw?.slice(0, 5),
            debug: { ...kw.debug }
          });
        } catch (e: any) {
          comps.push({
            placeId: id,
            placeUrl: `https://m.place.naver.com/place/${id}/home`,
            keywords5: [],
            debug: { error: e?.message ?? "competitor keywordList failed" }
          });
        }
      }

      place.competitors = comps;

      place._competitorDebug = {
        used: true,
        query,
        limit: 5,
        steps: [
          {
            step: "searchTop",
            used: true,
            query,
            limit: 5,
            strategy: top.debug?.strategy ?? "unknown",
            steps: top.debug?.steps ?? [],
            sniffedUrls: top.debug?.sniffedUrls ?? [],
            sniffedCount: top.debug?.sniffedCount ?? 0,
            fallbackUsed: top.debug?.fallbackUsed ?? false
          }
        ]
      };
    } catch (e: any) {
      place._competitorDebug = { used: true, query, limit: 5, error: e?.message ?? "competitor search failed" };
      place.competitors = [];
    }
  }

  return place;
}

function buildCompetitorQuery(place: PlaceProfileLike) {
  // ✅ 가장 보수적/안정적인 쿼리:
  // 1) 상호명에서 “OO역” 있으면 "OO역 미용실"
  // 2) 없으면 그냥 "미용실"로만 하면 경쟁이 너무 넓어져서 비추.
  //    → 최소한 keywords5에 “서대문역미용실” 같은 경쟁사들이 쓰는 형태를 따라가야 함
  const n = place.name || "";
  const station = extractStationFromName(n);
  const 업종 = "미용실"; // 지금은 hairshop 기준이므로 고정(나중에 category 기반 확장 가능)
  return station ? `${station} ${업종}` : `${업종}`;
}

function extractStationFromName(name: string) {
  const m = name.match(/([가-힣A-Za-z]+역)/);
  return m?.[1] ?? null;
}

function isHairSalon(place: PlaceProfileLike) {
  const c = (place.category || "").toLowerCase();
  const n = (place.name || "").toLowerCase();
  return c.includes("미용실") || n.includes("헤어") || n.includes("hair");
}

function basePlaceUrl(url: string) {
  return url.replace(/\/(home|photo|review|price|menu|booking)(\?.*)?$/i, "");
}

function looksLikeParkingFee(name: string) {
  const x = name.toLowerCase();
  return (
    x.includes("주차") ||
    x.includes("분당") ||
    x.includes("초과") ||
    x.includes("최초") ||
    x.includes("시간") ||
    x.includes("요금") ||
    /^[0-9]+$/.test(name.trim())
  );
}

function cleanMenus(menus: Menu[]): Menu[] {
  const out: Menu[] = [];
  const seen = new Set<string>();

  for (const it of menus || []) {
    const name = (it?.name || "").trim();
    const price = typeof it?.price === "number" ? it.price : undefined;

    if (!name) continue;
    if (!/[가-힣A-Za-z]/.test(name)) continue;
    if (looksLikeParkingFee(name)) continue;

    if (typeof price === "number") {
      if (price < 5000) continue;
      if (price > 2000000) continue;
    }

    const key = `${name}:${price ?? "na"}`;
    if (seen.has(key)) continue;
    seen.add(key);

    out.push({
      name,
      ...(typeof price === "number" ? { price } : {}),
      ...(typeof it.durationMin === "number" ? { durationMin: it.durationMin } : {}),
      ...(it.note ? { note: it.note } : {})
    });
  }

  return out.slice(0, 30);
}
