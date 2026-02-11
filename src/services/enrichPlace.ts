// src/services/enrichPlace.ts
import { fetchMenusViaPlaywright, type Menu } from "./playwrightMenus.js";
import { fetchExistingKeywordsViaPlaywright } from "./playwrightKeywords.js";
import { fetchRepresentativeKeywords5ByFrameSource } from "./playwrightKeywordList.js";
import { scorePlace } from "./scorePlace.js";
import { getMonthlySearchVolumeMap, attachVolumesToKeywords } from "./keywordVolume.js";

type Competitor = {
  placeId: string;
  placeUrl: string;
  keywords5?: string[];
  keywords5WithVolume?: { keyword: string; monthly?: number | null }[];
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

  // ✅ 기존 대표키워드(원문 전체)
  keywords?: string[];
  // ✅ 기존 대표키워드 5개(유료 전환용)
  keywords5?: string[];

  // ✅ 메뉴
  menus?: Menu[];

  // ✅ 경쟁업체(상위 1~5)
  competitors?: Competitor[];

  // ✅ 점수/리포트 확장 필드(동적)
  [k: string]: any;

  // ✅ 디버그
  _menuDebug?: any;
  _keywordDebug?: any;
  _competitorDebug?: any;
  _volumeDebug?: any;
};

export async function enrichPlace(place: PlaceProfileLike): Promise<PlaceProfileLike> {
  const base = basePlaceUrl(place.placeUrl);
  const isHair = isHairSalon(place);

  // =========================
  // 0) ✅ 기존 대표키워드(최우선)
  //    1) "프레임 소스(keywordList)" 방식
  //    2) 실패 시 기존 GraphQL/DOM 휴리스틱 폴백
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
  }

  // =========================
  // 2) ✅ 점수 산정(등급/개선포인트)
  // - scorePlace.ts가 place 객체를 받아 계산해서 반환한다고 가정
  // =========================
  try {
    const audit = scorePlace(place);
    // scorePlace가 { scores, keyword, recommend, todoTop5 ... } 같은 구조로 반환하는 형태를 그대로 merge
    Object.assign(place, audit);
  } catch (e: any) {
    place._scoreDebug = { error: e?.message ?? "scorePlace failed" };
  }

  // =========================
  // 3) ✅ 월간검색량(네이버 광고 API)
  // - 추천키워드 5개 + 경쟁업체 키워드(각 5개)
  // =========================
  try {
    // 추천키워드 5: scorePlace 결과 우선 → 없으면 기존 로직 fallback
    const suggested5: string[] =
      Array.isArray(place?.keyword?.suggested5) && place.keyword.suggested5.length
        ? place.keyword.suggested5.slice(0, 5)
        : Array.isArray(place?.recommend?.keywords5) && place.recommend.keywords5.length
          ? place.recommend.keywords5.map((x: any) => x.keyword).slice(0, 5)
          : [];

    // 경쟁업체 키워드들(최대 25개)
    const competitorKeywords: string[] = (place.competitors || []).flatMap((c) => (c.keywords5 || []).slice(0, 5));

    // 합쳐서 조회(중복 제거는 내부에서)
    const toQuery = [...suggested5, ...competitorKeywords].filter(Boolean);

    if (toQuery.length) {
      const vol = await getMonthlySearchVolumeMap(toQuery, { timeoutMs: 8000, batchSize: 50, debug: true });

      place.suggested5WithVolume = attachVolumesToKeywords(suggested5, vol.volumes);
      place.competitors = (place.competitors || []).map((c) => ({
        ...c,
        keywords5WithVolume: attachVolumesToKeywords(c.keywords5 || [], vol.volumes)
      }));

      place._volumeDebug = vol.debug;
    } else {
      place._volumeDebug = { used: true, skipped: true, reason: "no keywords to query" };
    }
  } catch (e: any) {
    place._volumeDebug = { used: true, error: e?.message ?? "volume attach failed" };
  }

  return place;
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
