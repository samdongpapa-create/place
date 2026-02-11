// src/services/enrichPlace.ts
import { fetchMenusViaPlaywright, type Menu } from "./playwrightMenus.js";
import { fetchExistingKeywordsViaPlaywright } from "./playwrightKeywords.js";
import { fetchRepresentativeKeywords5ByFrameSource } from "./playwrightKeywordList.js";
import { scorePlace } from "./scorePlace.js";
import { fetchBasicFieldsViaPlaywright } from "./playwrightBasicFields.js";
import { fetchCompetitorsTop } from "./playwrightCompetitors.js";

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
  keywords?: string[];
  keywords5?: string[];

  menus?: Menu[];
  photos?: { count?: number };
  reviews?: { count?: number };

  competitors?: Competitor[];

  _basicDebug?: any;
  _menuDebug?: any;
  _keywordDebug?: any;
  _competitorDebug?: any;
  _scoreDebug?: any;

  [k: string]: any;
};

export async function enrichPlace(place: PlaceProfileLike, ctx?: { page: any }): Promise<PlaceProfileLike> {
  const base = basePlaceUrl(place.placeUrl);
  const isHair = isHairSalon(place);
  const page = ctx?.page;

  const empty = (s?: string) => !s || !s.trim();
  const looksLikeReviewSnippet = (s?: string) => !!s && /(방문자리뷰|블로그리뷰)\s*\d+/i.test(s);

  // =========================================================
  // 0) 기본필드
  // =========================================================
  if (page) {
    try {
      const homeUrl = `${base}/home`;
      const bf = await fetchBasicFieldsViaPlaywright(page, homeUrl, { timeoutMs: 15000 });

      if (empty(place.name)) place.name = bf.fields.name;
      if (empty(place.category)) place.category = bf.fields.category;
      if (empty(place.address)) place.address = bf.fields.address;
      if (empty(place.roadAddress)) place.roadAddress = bf.fields.roadAddress;
      if (empty(place.directions)) place.directions = bf.fields.directions;

      if (empty(place.description) || looksLikeReviewSnippet(place.description)) {
        place.description = bf.fields.description;
      }

      place._basicDebug = Object.assign({}, { used: true, targetUrl: homeUrl }, bf.debug);
    } catch (e: any) {
      place._basicDebug = { used: true, error: e?.message ?? "basicFields failed" };
    }
  } else {
    place._basicDebug = { used: false, reason: "ctx.page missing (skipped Playwright basicFields)" };
  }

  // =========================================================
  // 1) 대표키워드
  // =========================================================
  if (!place.keywords || place.keywords.length === 0) {
    const homeUrl = `${base}/home`;

    try {
      const kw = await fetchRepresentativeKeywords5ByFrameSource(homeUrl);
      if (kw.raw?.length) {
        place.keywords = kw.raw.slice(0, 15);
        place.keywords5 = kw.keywords5?.length ? kw.keywords5.slice(0, 5) : kw.raw.slice(0, 5);
      }
      place._keywordDebug = Object.assign({}, { used: true, targetUrl: homeUrl, via: "frame-keywordList" }, kw.debug);
    } catch (e: any) {
      place._keywordDebug = { used: true, targetUrl: homeUrl, via: "frame-keywordList", error: e?.message ?? "keywordList parse failed" };
    }

    if ((!place.keywords || place.keywords.length === 0) && page) {
      try {
        const kw2 = await fetchExistingKeywordsViaPlaywright(homeUrl);
        if (kw2.keywords?.length) {
          place.keywords = kw2.keywords.slice(0, 15);
          place.keywords5 = kw2.keywords.slice(0, 5);
        }
        place._keywordDebug = Object.assign({}, place._keywordDebug || {}, {
          fallback: Object.assign({}, { used: true, targetUrl: homeUrl, via: "graphql-dom-heuristic" }, kw2.debug),
        });
      } catch (e: any) {
        place._keywordDebug = Object.assign({}, place._keywordDebug || {}, {
          fallback: { used: true, targetUrl: homeUrl, via: "graphql-dom-heuristic", error: e?.message ?? "keyword pw failed" },
        });
      }
    } else if (!page) {
      place._keywordDebug = Object.assign({}, place._keywordDebug || {}, {
        fallback: { used: false, reason: "ctx.page missing (skipped Playwright keyword fallback)" },
      });
    }
  } else {
    if (!place.keywords5 || place.keywords5.length === 0) place.keywords5 = place.keywords.slice(0, 5);
  }

  // =========================================================
  // 2) 메뉴/가격
  // =========================================================
  if (isHair && (!place.menus || place.menus.length === 0)) {
    const priceUrl = `${base}/price`;

    if (page) {
      try {
        const pw = await fetchMenusViaPlaywright(priceUrl);
        if (pw.menus.length) place.menus = cleanMenus(pw.menus);
        place._menuDebug = Object.assign({}, { used: true, targetUrl: priceUrl, via: "hair-price-pw" }, pw.debug);
      } catch (e: any) {
        place._menuDebug = { used: true, targetUrl: priceUrl, via: "hair-price-pw", error: e?.message ?? "price pw failed" };
      }
    } else {
      place._menuDebug = { used: false, targetUrl: priceUrl, reason: "ctx.page missing (skipped Playwright menus)" };
    }
  }

  // =========================================================
  // 3) ✅ 유료 핵심: 경쟁사 Top5 (이제 query가 문자열로 들어간다)
  // =========================================================
  if (page) {
    try {
      const query = buildCompetitorQuery(place);
      const res = await fetchCompetitorsTop(page, {
        query,
        limit: 5,
        excludePlaceId: place.placeId
      });

      place.competitors = res.competitors || [];
      place._competitorDebug = res.debug || { used: true, query, limit: 5 };
    } catch (e: any) {
      place._competitorDebug = { used: true, error: e?.message ?? "competitors failed" };
    }
  } else {
    place._competitorDebug = { used: false, reason: "ctx.page missing (skipped Playwright competitors)" };
  }

  // =========================================================
  // 4) 점수/리포트
  // =========================================================
  try {
    Object.assign(place, scorePlace(place));
  } catch (e: any) {
    place._scoreDebug = { used: true, error: e?.message ?? "scorePlace failed" };
  }

  return place;
}

/* ---------------- helpers ---------------- */

function isHairSalon(place: PlaceProfileLike) {
  const c = (place.category || "").toLowerCase();
  const n = (place.name || "").toLowerCase();
  return c.includes("미용실") || n.includes("헤어") || n.includes("hair") || place.placeUrl.includes("/hairshop/");
}

function basePlaceUrl(url: string) {
  return url.replace(/\/(home|photo|review|price|menu|booking)(\?.*)?$/i, "");
}

function buildCompetitorQuery(place: PlaceProfileLike) {
  const addr = (place.address || "").toString();
  if (addr.includes("서대문역")) return "서대문역 미용실";
  if (addr.includes("종로구")) return "종로구 미용실";
  return `${place.name || ""} 미용실`.trim() || "미용실";
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
      ...(it.note ? { note: it.note } : {}),
    });
  }

  return out.slice(0, 30);
}
