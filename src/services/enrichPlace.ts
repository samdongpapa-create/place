// src/services/enrichPlace.ts
import { fetchMenusViaPlaywright, type Menu } from "./playwrightMenus.js";
import { fetchExistingKeywordsViaPlaywright } from "./playwrightKeywords.js";
import { fetchRepresentativeKeywords5ByFrameSource } from "./playwrightKeywordList.js";
import { fetchCompetitorsKeyword5 } from "./fetchCompetitorKeywords.js";
import { scorePlace } from "./scorePlace.js";

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

  // ✅ 기존 대표키워드(원문 전체)
  keywords?: string[];

  // ✅ 기존 대표키워드 5개(유료 전환용)
  keywords5?: string[];

  // ✅ 메뉴/가격(미용실은 price 탭 강제)
  menus?: Menu[];

  reviews?: any;
  photos?: { count?: number };

  // ✅ 경쟁업체 상위 1~5 대표키워드
  competitors?: Array<{
    placeId: string;
    placeUrl: string;
    keywords5: string[];
    debug?: any;
  }>;

  // debug
  _menuDebug?: any;
  _keywordDebug?: any;
  _competitorDebug?: any;
};

export async function enrichPlace(place: PlaceProfileLike): Promise<any> {
  const base = basePlaceUrl(place.placeUrl);
  const isHair = isHairSalon(place);

  // =========================
  // 0) ✅ 기존 대표키워드(최우선)
  //    1) "프레임 소스(keywordList)" 방식
  //    2) 실패 시 GraphQL/DOM 휴리스틱 폴백
  // =========================
  if (!place.keywords || place.keywords.length === 0) {
    const homeUrl = `${base}/home`;

    // (A) frame source keywordList 파싱 (정답 루트)
    try {
      const kw = await fetchRepresentativeKeywords5ByFrameSource(homeUrl);

      if (kw.raw?.length) {
        place.keywords = kw.raw.slice(0, 15);
        place.keywords5 = kw.keywords5?.length ? kw.keywords5.slice(0, 5) : kw.raw.slice(0, 5);
      }

      place._keywordDebug = { via: "frame-keywordList", ...kw.debug };
    } catch (e: any) {
      place._keywordDebug = { via: "frame-keywordList", error: e?.message ?? "keywordList parse failed" };
    }

    // (B) 그래도 없으면 폴백 (GraphQL/DOM)
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
    // keywords가 이미 있으면 5개도 맞춰줌
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
  } else if (place.menus?.length) {
    place.menus = cleanMenus(place.menus);
  }

  // =========================
  // 2) ✅ 경쟁업체 상위 1~5 대표키워드 추출
  // - 기준 쿼리: (역/주소 앞부분/이름) + 업종
  // - "순위"는 검색어/개인화에 따라 바뀌므로 debug에 query 남김
  // =========================
  try {
    const q = buildCompetitorQuery(place);
    const c = await fetchCompetitorsKeyword5(q, 5);
    place.competitors = c.competitors;
    place._competitorDebug = c.debug;
  } catch (e: any) {
    place._competitorDebug = { error: e?.message ?? "competitor fetch failed" };
  }

  // =========================
  // 3) ✅ 점수/등급 환산
  // =========================
  const audit = scorePlace(place);

  // ✅ scorePlace 결과를 place에 합쳐서 반환
  return { ...place, ...audit };
}

function isHairSalon(place: PlaceProfileLike) {
  const c = (place.category || "").toLowerCase();
  const n = (place.name || "").toLowerCase();
  return c.includes("미용실") || n.includes("헤어") || n.includes("hair");
}

function basePlaceUrl(url: string) {
  return url.replace(/\/(home|photo|review|price|menu|booking)(\?.*)?$/i, "");
}

function extractStationFromName(name: string) {
  const m = name.match(/([가-힣A-Za-z0-9]+역)/);
  return m?.[1] ?? null;
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

/**
 * 경쟁업체 검색어 구성
 * - 최우선: 플레이스명에 "OO역"이 있으면 "OO역 + 업종"
 * - 다음: 주소 앞 2토큰(예: "서울 종로구") + 업종
 * - 마지막: 플레이스명 + 업종
 */
function buildCompetitorQuery(place: PlaceProfileLike): string {
  const name = (place.name || "").trim();
  const cat = (place.category || "").trim();

  // 업종 키워드
  const business = /미용실|헤어|hair/i.test(`${name} ${cat}`) ? "미용실" : (cat || "플레이스");

  // 역명 우선
  const station = extractStationFromName(name);
  if (station) return `${station} ${business}`;

  // 주소 기반(앞 2토큰)
  const addr = (place.roadAddress || place.address || "").trim();
  if (addr) {
    const regionGuess = addr.split(/\s+/).slice(0, 2).join(" ").trim();
    if (regionGuess) return `${regionGuess} ${business}`;
  }

  // 최후: 이름+업종
  return `${name} ${business}`.trim();
}
