// src/services/enrichPlace.ts
import { fetchMenusViaPlaywright, type Menu } from "./playwrightMenus.js";
import { fetchExistingKeywordsViaPlaywright } from "./playwrightKeywords.js";
import { fetchRepresentativeKeywords5ByFrameSource } from "./playwrightKeywordList.js";
import { scorePlace } from "./scorePlace.js";
import { fetchBasicFieldsViaPlaywright } from "./playwrightBasicFields.js";

// ✅ 실제 export에 맞춤 (TS2724 해결)
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
  description?: string; // 상세설명(소개)
  directions?: string;  // 오시는길

  tags?: string[];
  keywords?: string[];   // 기존 대표키워드(원문 전체)
  keywords5?: string[];  // 대표키워드 5개

  menus?: Menu[];
  photos?: { count?: number };
  competitors?: Competitor[];

  // 디버그
  _basicDebug?: any;
  _menuDebug?: any;
  _keywordDebug?: any;
  _competitorDebug?: any;
  _scoreDebug?: any;

  // 확장 필드
  [k: string]: any;
};

// ✅ ctx를 optional 처리해서 analyze.ts에서 1개 인자로 호출해도 컴파일 통과 (TS2554 방어)
export async function enrichPlace(
  place: PlaceProfileLike,
  ctx?: { page: any }
): Promise<PlaceProfileLike> {
  const base = basePlaceUrl(place.placeUrl);
  const isHair = isHairSalon(place);

  const page = ctx?.page;

  // =========================================================
  // 0) 기본필드(이름/주소/오시는길/상세설명) - Playwright 필요
  // =========================================================
  if (page) {
    try {
      const homeUrl = `${base}/home`;
      const bf = await fetchBasicFieldsViaPlaywright(page, homeUrl, { timeoutMs: 15000 });

      place.name = place.name || bf.fields.name;
      place.category = place.category || bf.fields.category;
      place.address = place.address || bf.fields.address;
      place.roadAddress = place.roadAddress || bf.fields.roadAddress;
      place.directions = place.directions || bf.fields.directions;

      // 상세설명은 meta 스니펫일 수 있어 빈값 처리 규칙은 playwrightBasicFields에서 처리
      place.description = place.description || bf.fields.description;

      place._basicDebug = Object.assign({}, { used: true, targetUrl: homeUrl }, bf.debug);
    } catch (e: any) {
      place._basicDebug = { used: true, error: e?.message ?? "basicFields failed" };
    }
  } else {
    place._basicDebug = { used: false, reason: "ctx.page missing (skipped Playwright basicFields)" };
  }

  // =========================================================
  // 1) 대표키워드(최우선) - frame source keywordList -> fallback
  // =========================================================
  if (!place.keywords || place.keywords.length === 0) {
    const homeUrl = `${base}/home`;

    // (A) frame source keywordList (page 없어도 가능하게 만들어둔 경우가 많아서 그대로 시도)
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

    // (B) fallback (Playwright 필요)
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
  // 2) 메뉴/가격: 미용실은 /price Playwright만
  // =========================================================
  if (isHair && (!place.menus || place.menus.length === 0)) {
    const priceUrl = `${base}/price`;

    if (page) {
      try {
        const pw = await fetchMenusViaPlaywright(priceUrl);

        if (pw.menus.length) {
          place.menus = cleanMenus(pw.menus);
        }

        place._menuDebug = Object.assign({}, { used: true, targetUrl: priceUrl, via: "hair-price-pw" }, pw.debug);
      } catch (e: any) {
        place._menuDebug = { used: true, targetUrl: priceUrl, via: "hair-price-pw", error: e?.message ?? "price pw failed" };
      }
    } else {
      place._menuDebug = { used: false, targetUrl: priceUrl, reason: "ctx.page missing (skipped Playwright menus)" };
    }
  }

  // =========================================================
  // 3) 경쟁사 Top5 (키워드 5개씩) - Playwright 필요
  // =========================================================
  if (page) {
    try {
      const query = buildCompetitorQuery(place);

      // ✅ 기존 코드가 fetchCompetitorsTop5를 쓰고 있었으니,
      //    여기서 호환 래퍼로 해결 (import/export 불일치 TS2724 방어)
      const res = await fetchCompetitorsTop5(page, { query, limit: 5, excludePlaceId: place.placeId });

      place.competitors = res.competitors || [];
      place._competitorDebug = res.debug || { used: true, query, limit: 5 };
    } catch (e: any) {
      place._competitorDebug = { used: true, error: e?.message ?? "competitors failed" };
    }
  } else {
    place._competitorDebug = { used: false, reason: "ctx.page missing (skipped Playwright competitors)" };
  }

  // =========================================================
  // 4) 점수/리포트 생성
  // =========================================================
  try {
    Object.assign(place, scorePlace(place));
  } catch (e: any) {
    place._scoreDebug = { used: true, error: e?.message ?? "scorePlace failed" };
  }

  return place;
}

/* ---------------- compat wrapper ---------------- */

// ✅ fetchCompetitorsTop만 있는 프로젝트에서도 기존 코드 형태(fetchCompetitorsTop5) 유지 가능
async function fetchCompetitorsTop5(
  page: any,
  opts: { query: string; limit?: number; excludePlaceId?: string }
): Promise<{ competitors?: Competitor[]; debug?: any }> {
  // fetchCompetitorsTop의 시그니처가 (page, opts) 형태라고 가정(너 에러 메시지가 이 구조를 강하게 시사)
  // 만약 내부 시그니처가 다르면 여기만 고치면 전체가 살아남.
  return fetchCompetitorsTop(page, { ...opts, limit: opts.limit ?? 5 });
}

/* ---------------- helpers ---------------- */

function isHairSalon(place: PlaceProfileLike) {
  const c = (place.category || "").toLowerCase();
  const n = (place.name || "").toLowerCase();
  return c.includes("미용실") || n.includes("헤어") || n.includes("hair");
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
