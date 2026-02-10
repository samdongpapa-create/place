// src/services/enrichPlace.ts
import { fetchMenusViaPlaywright, type Menu } from "./playwrightMenus.js";
import { fetchExistingKeywordsViaPlaywright } from "./playwrightKeywords.js";
import { fetchRepresentativeKeywords5ByFrameSource } from "./playwrightKeywordList.js";
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
  keywords?: string[]; // ✅ 기존 대표키워드(원문 전체)
  keywords5?: string[]; // ✅ 대표키워드 5개(유료 전환용)
  menus?: Menu[];
  reviews?: any;
  photos?: { count?: number };
  _menuDebug?: any;
  _keywordDebug?: any;
};

export async function enrichPlace(place: PlaceProfileLike): Promise<any> {
  const base = basePlaceUrl(place.placeUrl);
  const isHair = isHairSalon(place);

  // =========================
  // 0) ✅ 대표키워드(최우선)
  //    A) frame source(keywordList) = 정답 루트
  //    B) 실패 시 GraphQL/DOM 휴리스틱 폴백
  // =========================
  if (!place.keywords || place.keywords.length === 0) {
    const homeUrl = `${base}/home`;

    // (A) frame source keywordList 파싱
    try {
      const kw = await fetchRepresentativeKeywords5ByFrameSource(homeUrl);

      if (kw?.raw?.length) {
        place.keywords = kw.raw.slice(0, 15);
        place.keywords5 = (kw.keywords5?.length ? kw.keywords5 : kw.raw.slice(0, 5)).slice(0, 5);
      }

      place._keywordDebug = { via: "frame-keywordList", ...(kw?.debug ?? {}) };
    } catch (e: any) {
      place._keywordDebug = { via: "frame-keywordList", error: e?.message ?? "keywordList parse failed" };
    }

    // (B) 폴백: GraphQL/DOM heuristic
    if (!place.keywords || place.keywords.length === 0) {
      try {
        const kw2 = await fetchExistingKeywordsViaPlaywright(homeUrl);

        if (kw2?.keywords?.length) {
          place.keywords = kw2.keywords.slice(0, 15);
          place.keywords5 = kw2.keywords.slice(0, 5);
        }

        place._keywordDebug = {
          ...(place._keywordDebug || {}),
          fallback: { via: "graphql-dom-heuristic", ...(kw2?.debug ?? {}) }
        };
      } catch (e: any) {
        place._keywordDebug = {
          ...(place._keywordDebug || {}),
          fallback: { via: "graphql-dom-heuristic", error: e?.message ?? "keyword pw failed" }
        };
      }
    }
  } else {
    // 이미 keywords가 있으면 keywords5를 맞춰줌
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

      if (pw?.menus?.length) {
        place.menus = cleanMenus(pw.menus);
        place._menuDebug = { via: "hair-price-pw", isHair, ...(pw?.debug ?? {}) };
      } else {
        place._menuDebug = { via: "hair-none", isHair, ...(pw?.debug ?? {}) };
      }
    } catch (e: any) {
      place._menuDebug = { via: "hair-price-pw", isHair, error: e?.message ?? "price pw failed" };
    }
  }

  // =========================
  // 2) ✅ 점수화 + 추천키워드 + TODO
  // =========================
  const audit = scorePlace(place);

  // 최종 응답: place + scores/recommend/todoTop5
  return { ...place, ...audit };
}

function isHairSalon(place: PlaceProfileLike) {
  const c = (place.category || "").toLowerCase();
  const n = (place.name || "").toLowerCase();
  return c.includes("미용실") || n.includes("헤어") || n.includes("hair") || c.includes("헤어");
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

