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

  // 대표키워드(원문/5개)
  keywords?: string[];
  keywords5?: string[];

  // 사진
  photos?: { count?: number };

  // 메뉴
  menus?: Menu[];

  // 경쟁사
  competitors?: Competitor[];

  // 점수/리포트 확장
  [k: string]: any;

  // 디버그
  _basicDebug?: any;
  _menuDebug?: any;
  _keywordDebug?: any;
  _competitorDebug?: any;
  _scoreDebug?: any;
};

type EnrichOptions = {
  // ✅ 결제 전이면 pro 영역만 블랭크 처리
  isPaid?: boolean;
  // 경쟁사 검색 쿼리(없으면 자동 생성)
  competitorQuery?: string;
  competitorLimit?: number;
};

export async function enrichPlace(place: PlaceProfileLike, opts: EnrichOptions = {}): Promise<PlaceProfileLike> {
  const base = basePlaceUrl(place.placeUrl);
  const isPaid = !!opts.isPaid;
  const competitorLimit = typeof opts.competitorLimit === "number" ? opts.competitorLimit : 5;

  // =========================================================
  // 0) 주소/오시는길/사진 수 보강 (빠른 DOM 추출)
  // - parse에서 못 뽑히는 경우가 많아서 playwright로 1회 보강
  // =========================================================
  try {
    const homeUrl = `${base}/home`;
    const basic = await fetchBasicFieldsViaPlaywright(homeUrl);

    // name/category는 기존 값 우선. 없으면 basic에서 채움
    if (!place.name && basic.name) place.name = basic.name;
    if (!place.category && basic.category) place.category = basic.category;

    // 주소/도로명/오시는길은 빈 값일 때만 채움
    if (!place.address && basic.address) place.address = basic.address;
    if (!place.roadAddress && basic.roadAddress) place.roadAddress = basic.roadAddress;
    if (!place.directions && basic.directions) place.directions = basic.directions;

    // 사진 수: 기존 우선, 없으면 basic
    if (!place.photos) place.photos = {};
    if (typeof place.photos.count !== "number" && typeof basic.photoCount === "number") {
      place.photos.count = basic.photoCount;
    }

    place._basicDebug = basic.debug;
  } catch (e: any) {
    place._basicDebug = { used: true, error: e?.message ?? "basic fields pw failed" };
  }

  // =========================================================
  // 1) 대표키워드(최우선): frame keywordList → fallback
  // =========================================================
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
  } else if (!place.keywords5 || place.keywords5.length === 0) {
    place.keywords5 = place.keywords.slice(0, 5);
  }

  // =========================================================
  // 2) 메뉴/가격: 미용실은 /price Playwright만 (안되면 배제)
  // =========================================================
  if (isHairSalon(place) && (!place.menus || place.menus.length === 0)) {
    const priceUrl = `${base}/price`;
    try {
      const pw = await fetchMenusViaPlaywright(priceUrl);

      if (pw.menus.length) {
        place.menus = cleanMenus(pw.menus);
        place._menuDebug = { via: "hair-price-pw", used: true, ...pw.debug };
      } else {
        place._menuDebug = { via: "hair-none", used: true, ...pw.debug };
      }
    } catch (e: any) {
      place._menuDebug = { via: "hair-price-pw", used: true, error: e?.message ?? "price pw failed" };
    }
  }

  // =========================================================
  // 3) 경쟁사 Top5 + 대표키워드 5개 추출
  // - 네이버 place 검색이 종종 막히므로: 검색 → 후보 리스트 → 각 home에서 keywordList
  // =========================================================
  try {
    const query = (opts.competitorQuery || buildCompetitorQuery(place)).trim();
    if (query) {
      const comp = await fetchCompetitorsTop5ViaSearch(query, { limit: competitorLimit });

      // 경쟁사 각각 키워드5(프레임 소스) 보강
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
            debug: { ...c.debug, keyword: { error: e?.message ?? "keywordList competitor failed" } }
          });
        }
      }

      // 내 placeId가 섞이는 경우 제거(검색 결과에 본인 포함될 수 있음)
      place.competitors = filled.filter((x) => x.placeId && x.placeId !== String(place.placeId)).slice(0, competitorLimit);

      place._competitorDebug = {
        used: true,
        query,
        limit: competitorLimit,
        ...comp.debug
      };
    } else {
      place._competitorDebug = { used: true, skipped: true, reason: "empty query" };
    }
  } catch (e: any) {
    place._competitorDebug = { used: true, error: e?.message ?? "competitor fetch failed" };
  }

  // =========================================================
  // 4) 점수 산정(scorePlace) → 반드시 audit 아래로만 넣어서 구조 섞임 방지
  // =========================================================
  try {
    const audit = scorePlace(place);
    place.audit = audit; // ✅ 절대 Object.assign(place, audit) 하지 말기(중복 recommend 방지)
  } catch (e: any) {
    place._scoreDebug = { error: e?.message ?? "scorePlace failed" };
  }

  // =========================================================
  // 5) 유료 영역 블랭크 처리(값은 유지, 노출만 막기)
  // - 값은 place._proRaw 에 저장해두고, place.pro에는 블랭크/프리뷰만 제공
  // =========================================================
  applyProMask(place, { isPaid });

  // =========================================================
  // 6) 경쟁사 키워드 5 + 추천키워드 5 결합(노출용)
  // - 추천키워드5는 audit에서 가져오되, 없으면 fallback
  // =========================================================
  try {
    const suggested5 = pickSuggested5(place);
    const competitorK5 = (place.competitors || [])
      .flatMap((c) => (c.keywords5 || []).slice(0, 5))
      .filter(Boolean);

    place.keywordPack = {
      suggested5,
      competitorTopKeywords5: topNByFreq(competitorK5, 5),
      merged10: dedup([...competitorK5, ...suggested5]).slice(0, 10),
      notes: ["경쟁사 키워드(빈도 상위) + 추천키워드(전환용) 조합입니다."]
    };
  } catch (e: any) {
    place._keywordPackDebug = { error: e?.message ?? "keywordPack failed" };
  }

  return place;
}

/* ===========================
   Pro masking
=========================== */

function applyProMask(place: PlaceProfileLike, opts: { isPaid: boolean }) {
  const isPaid = opts.isPaid;

  // pro에서 보여줄 “원본” 값은 _proRaw로 안전하게 보관
  const raw = {
    descriptionRewrite: pickProDescriptionRewrite(place),
    directionsRewrite: pickProDirectionsRewrite(place),
    proTodo: pickProTodo(place),
    competitorAnalysis: buildCompetitorAnalysis(place)
  };

  place._proRaw = raw;

  // free 노출용: 어떤 블록이 있는지 “이름만” 보여주고 내용은 블랭크
  if (!isPaid) {
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

  // paid면 실제 값 노출
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
  // scorePlace가 pro rewrite를 만들면 그걸 우선
  const r =
    place?.audit?.recommend?.rewrite?.description ??
    place?.recommend?.rewrite?.description ??
    undefined;
  return typeof r === "string" ? r : undefined;
}
function pickProDirectionsRewrite(place: any): string | undefined {
  const r =
    place?.audit?.recommend?.rewrite?.directions ??
    place?.recommend?.rewrite?.directions ??
    undefined;
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
  const top = topNByFreq(all, 10);

  return {
    topKeywords10: top,
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
  // 주소가 잘 잡히면 “역/동” 추출을 해도 되지만, 일단 안정적으로:
  // - keywords5 중 지역성 있는 게 있으면 그걸 사용
  // - 없으면 name 기반 추정
  const kw = (place.keywords5 || []).join(" ");
  const name = place.name || "";

  // 가장 안전한 기본값: "서대문역 미용실" 같은 형태를 scorePlace에서 이미 만들 가능성이 높음
  const suggested = pickSuggested5(place);
  const best = suggested.find((x) => /역|동|구|시청|광화문|종로/i.test(x));
  if (best) return best;

  // fallback
  if (/서대문/i.test(kw + name)) return "서대문역 미용실";
  return `${cleanupQuery(name)} 미용실`.trim();
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
  // audit.keyword.suggested5 우선
  const s1 = place?.audit?.keyword?.suggested5;
  if (Array.isArray(s1) && s1.length) return s1.slice(0, 5);

  // audit.recommend.keywords5 배열({keyword}) fallback
  const s2 = place?.audit?.recommend?.keywords5;
  if (Array.isArray(s2) && s2.length) return s2.map((x: any) => x.keyword).filter(Boolean).slice(0, 5);

  // legacy
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
