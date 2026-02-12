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
      const bf = await fetchBasicFieldsViaPlaywright(page as any, homeUrl, { timeoutMs: 15000 });

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
  // 1) 대표키워드(현재 플레이스)
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
  // 3) ✅ 유료 핵심: 경쟁사 Top5 + 경쟁사 대표키워드 5개씩 수집
  // =========================================================
  if (page) {
    try {
      const query = buildCompetitorQuery(place);
      const res = await fetchCompetitorsTop(page as any, {
        query,
        limit: 5,
        excludePlaceId: place.placeId,
      });

      const competitors = (res.competitors || []) as Competitor[];

      // ✅ 각 경쟁사 홈에서 대표키워드 5개 파싱 (HTML 기반, 빠름)
      const t0 = Date.now();
      const kwSteps: any[] = [];

      for (const c of competitors) {
        try {
          const kw = await fetchRepresentativeKeywords5ByFrameSource(`${basePlaceUrl(c.placeUrl)}/home`);
          const k5 =
            (kw.keywords5?.length ? kw.keywords5 : kw.raw?.slice(0, 5))?.slice(0, 5) || [];

          c.keywords5 = k5.filter(Boolean);
          c.debug = { via: "frame-keywordList", found: c.keywords5.length, ...(kw.debug || {}) };

          kwSteps.push({ placeId: c.placeId, ok: true, found: c.keywords5.length });
        } catch (e: any) {
          c.keywords5 = [];
          c.debug = { via: "frame-keywordList", ok: false, error: e?.message ?? String(e) };
          kwSteps.push({ placeId: c.placeId, ok: false, error: e?.message ?? String(e) });
        }
      }

      place.competitors = competitors;

      // ✅ 집계: 경쟁사 키워드 Top10
      const topKeywords10 = buildTopKeywords10(competitors);

      // ✅ 유료 추천 대표키워드 5개 (경쟁사 Top + 내 강점 키워드 혼합)
      const suggested5Pro = buildSuggestedKeywords5Pro(place, topKeywords10);

      place._competitorDebug = {
        ...(res.debug || {}),
        keywordFetch: {
          used: true,
          elapsedMs: Date.now() - t0,
          steps: kwSteps,
        },
        competitorTopKeywords10: topKeywords10,
        suggested5Pro,
      };
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

/* ---------------- keyword aggregation ---------------- */

function normalizeKw(s: string) {
  return (s || "").replace(/\s+/g, " ").trim();
}

function buildTopKeywords10(competitors: Competitor[]) {
  const freq = new Map<string, number>();

  for (const c of competitors || []) {
    for (const k of c.keywords5 || []) {
      const kk = normalizeKw(k);
      if (!kk) continue;
      freq.set(kk, (freq.get(kk) || 0) + 1);
    }
  }

  const sorted = Array.from(freq.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([keyword, count]) => ({ keyword, count }));

  return sorted;
}

// ✅ “유료 추천 5개” 규칙:
// - 경쟁사 Top10에서 3개 (빈도 높은 순, 너무 일반어 제외)
// - 내 강점 키워드(아베다/염색/레이어드 등) 2개
// - 지역 키워드 1~2개 포함하도록 보정
function buildSuggestedKeywords5Pro(place: PlaceProfileLike, top10: { keyword: string; count: number }[]) {
  const out: string[] = [];
  const seen = new Set<string>();

  const push = (k: string) => {
    const kk = normalizeKw(k);
    if (!kk) return;
    if (seen.has(kk)) return;
    seen.add(kk);
    out.push(kk);
  };

  const genericBlock = ["미용실", "헤어샵", "헤어살롱"];

  const addr = (place.address || "").toString();
  const hasSeodaemun = addr.includes("서대문");
  const hasJongno = addr.includes("종로");

  // 1) 지역 2개 우선 (서대문역/서대문/종로구 중)
  if (hasSeodaemun) {
    push("서대문역 미용실");
    push("서대문역 헤어샵");
  } else if (hasJongno) {
    push("종로구 미용실");
    push("종로구 헤어샵");
  } else {
    push("해당 지역 미용실");
    push("해당 지역 헤어샵");
  }

  // 2) 경쟁사 Top에서 “의미있는 것” 2~3개
  for (const it of top10 || []) {
    const k = it.keyword;
    if (!k) continue;
    if (genericBlock.includes(k)) continue;
    // 지역/브랜드/서비스성 키워드 위주로만
    push(k);
    if (out.length >= 4) break;
  }

  // 3) 내 강점(현재 대표키워드에서) 1~2개 보충
  const my = (place.keywords5?.length ? place.keywords5 : place.keywords || []).slice(0, 10);
  for (const k of my) {
    if (!k) continue;
    if (genericBlock.includes(k)) continue;
    push(k);
    if (out.length >= 5) break;
  }

  // 4) 5개 맞추기 (부족하면 기본 서비스)
  while (out.length < 5) {
    push("아베다염색");
    if (out.length < 5) push("레이어드컷");
    if (out.length < 5) push("볼륨매직");
    break;
  }

  return out.slice(0, 5);
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

function buildCompetitorQuery(place: any) {
  const name = (place.name || "").toString();
  const addr = (place.address || "").toString();

  // ✅ 주소가 비어도 “서대문역점” 같은 지점명이 있으면 역 키워드로 고정
  if (name.includes("서대문역")) return "서대문역 미용실";
  if (name.includes("광화문")) return "광화문 미용실";
  if (name.includes("시청")) return "시청 미용실";
  if (name.includes("종로")) return "종로 미용실";

  // ✅ 주소 기반
  if (addr.includes("서대문역")) return "서대문역 미용실";
  if (addr.includes("광화문")) return "광화문 미용실";
  if (addr.includes("시청")) return "시청 미용실";
  if (addr.includes("종로구")) return "종로구 미용실";

  // fallback
  return "서대문역 미용실";
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
