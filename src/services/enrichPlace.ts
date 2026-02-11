// src/services/enrichPlace.ts
import { fetchMenusViaPlaywright, type Menu } from "./playwrightMenus.js";
import { fetchExistingKeywordsViaPlaywright } from "./playwrightKeywords.js";
import { fetchRepresentativeKeywords5ByFrameSource } from "./playwrightKeywordList.js";
import { scorePlace } from "./scorePlace.js";

import { fetchCompetitorsTop5ViaSearch } from "./playwrightCompetitors.js";
import { fetchBasicFieldsViaPlaywright } from "./playwrightBasicFields.js";

type Competitor = {
  placeId: string;
  placeUrl: string;
  name?: string;
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

  photos?: { count?: number };
  menus?: Menu[];

  competitors?: Competitor[];

  audit?: any;
  pro?: any;
  _proRaw?: any;

  [k: string]: any;

  _basicDebug?: any;
  _menuDebug?: any;
  _keywordDebug?: any;
  _competitorDebug?: any;
  _scoreDebug?: any;
};

type EnrichOptions = {
  isPaid?: boolean; // ✅ 결제 여부(노출만)
  competitorQuery?: string;
  competitorLimit?: number;
};

export async function enrichPlace(place: PlaceProfileLike, opts: EnrichOptions = {}): Promise<PlaceProfileLike> {
  const base = basePlaceUrl(place.placeUrl);
  const isPaid = !!opts.isPaid;
  const competitorLimit = typeof opts.competitorLimit === "number" ? opts.competitorLimit : 5;

  // 0) 주소/오시는길/사진 수 보강
  try {
    const homeUrl = `${base}/home`;
    const basic = await fetchBasicFieldsViaPlaywright(homeUrl);

    if (!place.name && basic.name) place.name = basic.name;
    if (!place.category && basic.category) place.category = basic.category;

    if (!place.address && basic.address) place.address = basic.address;
    if (!place.roadAddress && basic.roadAddress) place.roadAddress = basic.roadAddress;
    if (!place.directions && basic.directions) place.directions = basic.directions;

    if (!place.photos) place.photos = {};
    if (typeof place.photos.count !== "number" && typeof basic.photoCount === "number") {
      place.photos.count = basic.photoCount;
    }

    place._basicDebug = basic.debug;
  } catch (e: any) {
    place._basicDebug = { used: true, error: e?.message ?? "basic fields pw failed" };
  }

  // 1) 대표키워드(프레임 keywordList → fallback)
  if (!place.keywords || place.keywords.length === 0) {
    const homeUrl = `${base}/home`;

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
  } else if (!place.keywords5 || place.keywords5.length === 0) {
    place.keywords5 = place.keywords.slice(0, 5);
  }

  // 2) 메뉴/가격
  if (isHairSalon(place) && (!place.menus || place.menus.length === 0)) {
    const priceUrl = `${base}/price`;

    try {
      const pw = await fetchMenusViaPlaywright(priceUrl);

      if (pw.menus.length) {
        place.menus = cleanMenus(pw.menus);
        // ✅ used 중복 방지: spread에 used가 들어올 수 있으니 used는 마지막에 한 번만
        place._menuDebug = { via: "hair-price-pw", ...pw.debug, used: true };
      } else {
        place._menuDebug = { via: "hair-none", ...pw.debug, used: true };
      }
    } catch (e: any) {
      place._menuDebug = { via: "hair-price-pw", used: true, error: e?.message ?? "price pw failed" };
    }
  }

  // 3) 경쟁사 Top5 + 키워드5
  try {
    const query = (opts.competitorQuery || buildCompetitorQuery(place)).trim();

    if (query) {
      const comp = await fetchCompetitorsTop5ViaSearch(query, { limit: competitorLimit });

      const filled: Competitor[] = [];
      for (const c of comp.items || []) {
        const homeUrl = normalizeHomeUrl(c.placeUrl);
        try {
          const kw = await fetchRepresentativeKeywords5ByFrameSource(homeUrl);
          filled.push({
            placeId: c.placeId,
            placeUrl: homeUrl,
            name: c.name,
            keywords5: (kw.keywords5?.length ? kw.keywords5 : kw.raw?.slice(0, 5)) || undefined,
            debug: { ...c.debug, keyword: kw.debug }
          });
        } catch (e: any) {
          filled.push({
            placeId: c.placeId,
            placeUrl: homeUrl,
            name: c.name,
            keywords5: undefined,
            debug: { ...c.debug, keyword: { error: e?.message ?? "competitor keywordList failed" } }
          });
        }
      }

      // 본인 placeId 제거
      place.competitors = filled.filter((x) => x.placeId && x.placeId !== String(place.placeId)).slice(0, competitorLimit);

      place._competitorDebug = { used: true, query, limit: competitorLimit, ...comp.debug };
    } else {
      place._competitorDebug = { used: true, skipped: true, reason: "empty query" };
    }
  } catch (e: any) {
    place._competitorDebug = { used: true, error: e?.message ?? "competitor fetch failed" };
  }

  // 4) 점수는 audit 아래로만
  try {
    place.audit = scorePlace(place);
  } catch (e: any) {
    place._scoreDebug = { error: e?.message ?? "scorePlace failed" };
  }

  // 5) 결제 전/후: 데이터는 유지, pro만 블랭크 처리
  applyProMask(place, { isPaid });

  // 6) 경쟁사 키워드 5 + 추천키워드 5 패키징
  try {
    const suggested5 = pickSuggested5(place);
    const competitorK5 = (place.competitors || []).flatMap((c) => (c.keywords5 || []).slice(0, 5)).filter(Boolean);

    place.keywordPack = {
      suggested5,
      competitorTopKeywords5: topNByFreq(competitorK5, 5),
      merged10: dedup([...topNByFreq(competitorK5, 10), ...suggested5]).slice(0, 10),
      notes: ["경쟁사 키워드(빈도 상위) + 추천키워드(전환용) 조합입니다."]
    };
  } catch (e: any) {
    place._keywordPackDebug = { error: e?.message ?? "keywordPack failed" };
  }

  return place;
}

/* ===========================
   Pro masking (노출만 제어)
=========================== */

function applyProMask(place: PlaceProfileLike, opts: { isPaid: boolean }) {
  const raw = {
    descriptionRewrite: pickProDescriptionRewrite(place),
    directionsRewrite: pickProDirectionsRewrite(place),
    proTodo: pickProTodo(place),
    competitorAnalysis: buildCompetitorAnalysis(place)
  };

  place._proRaw = raw;

  if (!opts.isPaid) {
    place.pro = {
      locked: true,
      blocks: [
        { key: "descriptionRewrite", label: "상세설명 복붙 완성본", value: "" },
        { key: "directionsRewrite", label: "오시는길 복붙 완성본", value: "" },
        { key: "proTodo", label: "등급 상승 체크리스트", value: [] },
        { key: "competitorAnalysis", label: "경쟁사 Top5 키워드 분석", value: {} }
      ]
    };
    return;
  }

  place.pro = {
    locked: false,
    blocks: [
      { key: "descriptionRewrite", label: "상세설명 복붙 완성본", value: raw.descriptionRewrite || "" },
      { key: "directionsRewrite", label: "오시는길 복붙 완성본", value: raw.directionsRewrite || "" },
      { key: "proTodo", label: "등급 상승 체크리스트", value: raw.proTodo || [] },
      { key: "competitorAnalysis", label: "경쟁사 Top5 키워드 분석", value: raw.competitorAnalysis || {} }
    ]
  };
}

function pickProDescriptionRewrite(place: any): string | undefined {
  const r = place?.audit?.recommend?.rewrite?.description ?? place?.recommend?.rewrite?.description ?? undefined;
  return typeof r === "string" ? r : undefined;
}
function pickProDirectionsRewrite(place: any): string | undefined {
  const r = place?.audit?.recommend?.rewrite?.directions ?? place?.recommend?.rewrite?.directions ?? undefined;
  return typeof r === "string" ? r : undefined;
}
function pickProTodo(place: any): any[] | undefined {
  const t = place?.audit?.todoTop5 ?? place?.todoTop5 ?? undefined;
  return Array.isArray(t) ? t : undefined;
}
function buildCompetitorAnalysis(place: PlaceProfileLike) {
  const comps = place.competitors || [];
  const rows = comps.map((c) => ({
    placeId: c.placeId,
    placeUrl: c.placeUrl,
    name: c.name,
    keywords5: c.keywords5 || []
  }));

  const all = rows.flatMap((r) => r.keywords5).filter(Boolean);
  return {
    topKeywords10: topNByFreq(all, 10),
    byCompetitor: rows
  };
}

/* ===========================
   Helpers
=========================== */

function isHairSalon(place: PlaceProfileLike) {
  const c = (place.category || "").toLowerCase();
  const n = (place.name || "").toLowerCase();
  return c.includes("미용실") || n.includes("헤어") || n.includes("hair");
}

function basePlaceUrl(url: string) {
  return url.replace(/\/(home|photo|review|price|menu|booking)(\?.*)?$/i, "");
}

function normalizeHomeUrl(url: string) {
  const u = url.replace(/\?.*$/, "");
  if (/(\/home)$/i.test(u)) return u;
  return u.replace(/\/$/, "") + "/home";
}

function buildCompetitorQuery(place: PlaceProfileLike): string {
  // audit 추천이 있으면 그걸 쓰는 게 제일 자연스럽고 안전함
  const suggested = pickSuggested5(place);
  const best = suggested.find((x) => /역|동|구|시청|광화문|종로/i.test(x));
  if (best) return best;

  // fallback
  const name = cleanupQuery(place.name || "");
  if (name) return `${name} 미용실`.trim();
  return "서대문역 미용실";
}

function cleanupQuery(s: string) {
  return (s || "")
    .replace(/\s*:\s*네이버.*$/i, "")
    .replace(/(헤어살롱|헤어샵|미용실)\s*$/i, "")
    .trim();
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

function pickSuggested5(place: any): string[] {
  const s1 = place?.audit?.keyword?.suggested5;
  if (Array.isArray(s1) && s1.length) return s1.slice(0, 5);

  const s2 = place?.audit?.recommend?.keywords5;
  if (Array.isArray(s2) && s2.length) return s2.map((x: any) => x.keyword).filter(Boolean).slice(0, 5);

  const s3 = place?.keyword?.suggested5;
  if (Array.isArray(s3) && s3.length) return s3.slice(0, 5);

  return [];
}

function dedup(arr: string[]) {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const x of arr) {
    const k = (x || "").trim();
    if (!k) continue;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(k);
  }
  return out;
}

function topNByFreq(items: string[], n: number): string[] {
  const m = new Map<string, number>();
  for (const it of items || []) {
    const k = (it || "").trim();
    if (!k) continue;
    m.set(k, (m.get(k) || 0) + 1);
  }
  return Array.from(m.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([k]) => k);
}
