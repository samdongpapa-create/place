// src/services/enrichPlace.ts
import { fetchMenusViaPlaywright, type Menu } from "./playwrightMenus.js";
import { fetchExistingKeywordsViaPlaywright } from "./playwrightKeywords.js";
import { fetchRepresentativeKeywords5ByFrameSource } from "./playwrightKeywordList.js";
import { scorePlace } from "./scorePlace.js";

import { fetchPhotoCountViaPlaywright } from "./playwrightPhotosCount.js";
import { fetchCompetitorsTop, type Competitor as PwCompetitor } from "./playwrightCompetitors.js";
import { fetchBasicFieldsViaPlaywright } from "./playwrightBasicFields.js"; // ✅ 너가 방금 고친 버전 기준

type Competitor = {
  placeId: string;
  placeUrl: string;
  keywords5?: string[];
  debug?: any;
};

type ProBlock =
  | { key: "descriptionRewrite"; label: string; value: string }
  | { key: "directionsRewrite"; label: string; value: string }
  | { key: "proTodo"; label: string; value: any[] }
  | { key: "competitorAnalysis"; label: string; value: any };

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

  // 대표키워드(원문 전체/5개)
  keywords?: string[];
  keywords5?: string[];

  // 메뉴
  menus?: Menu[];

  // 사진
  photos?: { count?: number };

  // 경쟁업체
  competitors?: Competitor[];

  // 점수/리포트 확장
  audit?: any; // scorePlace 결과를 audit로도 넣어주고
  scores?: any;
  keyword?: any;
  recommend?: any;
  todoTop5?: any[];

  // ✅ PRO 영역: 항상 생성
  _proRaw?: any;
  pro?: { locked: boolean; blocks: ProBlock[] };

  // ✅ 키워드 패키지(경쟁사키워드5 + 추천키워드5)
  keywordPack?: {
    suggested5: string[];
    competitorTopKeywords5: string[];
    merged10: string[];
    notes: string[];
  };

  // debug
  _basicDebug?: any;
  _menuDebug?: any;
  _keywordDebug?: any;
  _competitorDebug?: any;
  _photoDebug?: any;

  [k: string]: any;
};

type EnrichOptions = {
  unlockPro?: boolean; // 결제 후 true
  competitorLimit?: number;
};

export async function enrichPlace(place: PlaceProfileLike, opts: EnrichOptions = {}): Promise<PlaceProfileLike> {
  const unlockPro = !!opts.unlockPro;
  const competitorLimit = typeof opts.competitorLimit === "number" ? opts.competitorLimit : 5;

  const base = basePlaceUrl(place.placeUrl);
  const isHair = isHairSalon(place);
  const homeUrl = `${base}/home`;

  // =========================
  // A) 기본필드 보강 (주소/오시는길/사진개수 일부)
  // =========================
  try {
    const basic = await fetchBasicFieldsViaPlaywright(homeUrl);
    place._basicDebug = basic.debug;

    if (!place.name && basic.name) place.name = basic.name;
    if (!place.category && basic.category) place.category = basic.category;

    // ❗ address가 "거리뷰" 같은 쓰레기값인 경우 덮어쓰기
    if ((!place.address || looksBadAddress(place.address)) && basic.address) place.address = basic.address;
    if ((!place.roadAddress || looksBadAddress(place.roadAddress)) && basic.roadAddress) place.roadAddress = basic.roadAddress;

    // directions가 전체 텍스트처럼 길게 들어오면 덮어쓰기
    if ((!place.directions || looksBadDirections(place.directions)) && basic.directions) place.directions = basic.directions;

    // home에서 photoCount 잡히면 일단 반영
    if (!place.photos) place.photos = {};
    if (typeof place.photos.count !== "number" && typeof basic.photoCount === "number") {
      place.photos.count = basic.photoCount;
    }
  } catch (e: any) {
    place._basicDebug = { used: true, error: e?.message ?? "basic fields failed" };
  }

  // =========================
  // B) 대표키워드(최우선) - frame keywordList → fallback
  // =========================
  if (!place.keywords || place.keywords.length === 0) {
    // (1) frame keywordList
    try {
      const kw = await fetchRepresentativeKeywords5ByFrameSource(homeUrl);
      if (kw.raw?.length) {
        place.keywords = kw.raw.slice(0, 15);
        place.keywords5 = (kw.keywords5?.length ? kw.keywords5 : kw.raw).slice(0, 5);
      }
      place._keywordDebug = { via: "frame-keywordList", ...kw.debug };
    } catch (e: any) {
      place._keywordDebug = { via: "frame-keywordList", error: e?.message ?? "keywordList parse failed" };
    }

    // (2) fallback graphql/dom heuristic
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
    if (!place.keywords5 || place.keywords5.length === 0) place.keywords5 = place.keywords.slice(0, 5);
  }

  // =========================
  // C) 메뉴/가격 (미용실은 /price Playwright)
  // =========================
  if (isHair && (!place.menus || place.menus.length === 0)) {
    const priceUrl = `${base}/price`;
    try {
      const pw = await fetchMenusViaPlaywright(priceUrl);
      if (pw.menus.length) {
        place.menus = cleanMenus(pw.menus);
        place._menuDebug = { via: "hair-price-pw", ...pw.debug };
      } else {
        place._menuDebug = { via: "hair-none", ...pw.debug };
      }
    } catch (e: any) {
      place._menuDebug = { via: "hair-price-pw", error: e?.message ?? "price pw failed" };
    }
  }

  // =========================
  // D) 사진 개수 보강 (/photo 탭)
  // =========================
  if (!place.photos) place.photos = {};
  if (typeof place.photos.count !== "number") {
    const photoUrl = `${base}/photo`;
    try {
      const pc = await fetchPhotoCountViaPlaywright(photoUrl);
      place._photoDebug = pc.debug;
      if (typeof pc.count === "number") place.photos.count = pc.count;
    } catch (e: any) {
      place._photoDebug = { used: true, error: e?.message ?? "photo count failed" };
    }
  }

  // =========================
  // E) 경쟁사 Top5 키워드 (역+업종 기반 쿼리로 안정화)
  // - "가게명 미용실"은 흔들림 → "서대문역 미용실" 같이 고정
  // =========================
  try {
    const q = buildCompetitorQuery(place);
    const excludePlaceId = place.placeId ? String(place.placeId) : extractPlaceId(place.placeUrl) || "";

    const r = await fetchCompetitorsTop(q, { limit: competitorLimit, excludePlaceId, timeoutMs: 15000 });
    place._competitorDebug = r.debug;

    // 타입 매핑
    place.competitors = (r.competitors || []).map((c: PwCompetitor) => ({
      placeId: c.placeId,
      placeUrl: c.placeUrl,
      keywords5: (c.keywords5 || []).slice(0, 5),
      debug: c.debug
    }));
  } catch (e: any) {
    place._competitorDebug = { used: true, error: e?.message ?? "competitors failed" };
    if (!place.competitors) place.competitors = [];
  }

  // =========================
  // F) 점수 산정 (scorePlace)
  // =========================
  try {
    const audit = scorePlace(place);
    place.audit = audit;
    // scorePlace가 place에 바로 머지되는 형태면 덮어써도 됨
    if (audit && typeof audit === "object") Object.assign(place, audit);
  } catch (e: any) {
    place._scoreDebug = { used: true, error: e?.message ?? "scorePlace failed" };
  }

  // =========================
  // G) 키워드 패키지: 경쟁사키워드5 + 추천키워드5 (merged10)
  // =========================
  const suggested5 = pickSuggested5(place);
  const competitorTopKeywords5 = pickCompetitorTopKeywords5(place.competitors || []);
  const merged10 = dedupKeepOrder([...competitorTopKeywords5, ...suggested5]).slice(0, 10);

  place.keywordPack = {
    suggested5,
    competitorTopKeywords5,
    merged10,
    notes: ["경쟁사 키워드(빈도 상위) + 추천키워드(전환용) 조합입니다."]
  };

  // =========================
  // H) PRO 콘텐츠는 항상 생성(_proRaw), 노출은 pro.locked로 블랭크
  // =========================
  const proRaw = buildProRaw(place);
  place._proRaw = proRaw;

  place.pro = buildProBlocks(place._proRaw, unlockPro);

  return place;
}

// =========================
// helpers
// =========================
function isHairSalon(place: PlaceProfileLike) {
  const c = (place.category || "").toLowerCase();
  const n = (place.name || "").toLowerCase();
  return c.includes("미용실") || n.includes("헤어") || n.includes("hair");
}

function basePlaceUrl(url: string) {
  return url.replace(/\/(home|photo|review|price|menu|booking)(\?.*)?$/i, "");
}

function extractPlaceId(url: string): string | null {
  let m = url.match(/\/place\/(\d+)/i);
  if (m?.[1]) return m[1];
  m = url.match(/\/hairshop\/(\d+)/i);
  if (m?.[1]) return m[1];
  return null;
}

function looksBadAddress(s?: string) {
  if (!s) return true;
  const x = String(s).trim();
  if (!x) return true;
  if (x === "거리뷰" || x === "지도" || x.length < 6) return true;
  // 페이지 텍스트 덩어리면 비정상
  if (x.length > 120) return true;
  return false;
}

function looksBadDirections(s?: string) {
  if (!s) return true;
  const x = String(s).trim();
  if (!x) return true;
  // 메뉴/탭 텍스트가 섞인 덩어리면 비정상
  if (x.includes("홈") && x.includes("리뷰") && x.includes("사진") && x.length > 200) return true;
  // 너무 길면 비정상(오시는길은 보통 1~8줄)
  if (x.length > 600) return true;
  return false;
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
    const price = typeof (it as any)?.price === "number" ? (it as any).price : undefined;

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
      ...(typeof price === "number" ? ({ price } as any) : {}),
      ...(typeof (it as any).durationMin === "number" ? ({ durationMin: (it as any).durationMin } as any) : {}),
      ...((it as any).note ? ({ note: (it as any).note } as any) : {})
    } as any);
  }

  return out.slice(0, 30);
}

function pickSuggested5(place: PlaceProfileLike): string[] {
  // scorePlace가 keyword.suggested5를 넣는 구조를 우선
  const fromKeyword = Array.isArray(place?.keyword?.suggested5) ? place.keyword.suggested5 : [];
  if (fromKeyword.length) return fromKeyword.slice(0, 5);

  // recommend.keywords5 형태(배열 객체) fallback
  const fromRecommend = Array.isArray(place?.recommend?.keywords5)
    ? place.recommend.keywords5.map((x: any) => x?.keyword).filter(Boolean)
    : [];
  if (fromRecommend.length) return fromRecommend.slice(0, 5);

  return [];
}

function pickCompetitorTopKeywords5(competitors: Competitor[]): string[] {
  const freq = new Map<string, number>();
  for (const c of competitors || []) {
    for (const k of (c.keywords5 || []).slice(0, 5)) {
      const key = String(k || "").trim();
      if (!key) continue;
      freq.set(key, (freq.get(key) || 0) + 1);
    }
  }
  // 빈도 desc, 동률이면 길이 짧은 것 먼저(대체로 핵심 키워드)
  return Array.from(freq.entries())
    .sort((a, b) => b[1] - a[1] || a[0].length - b[0].length)
    .map((x) => x[0])
    .slice(0, 5);
}

function dedupKeepOrder(arr: string[]) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of arr) {
    const v = String(x || "").trim();
    if (!v) continue;
    if (seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

function buildCompetitorQuery(place: PlaceProfileLike): string {
  // ✅ 가장 안정적인 쿼리: "역 + 업종"
  // directions 안에 "서대문역 4번 출구" 같은 문구가 있으면 역 이름을 우선 사용
  const dir = String(place.directions || "");
  let station = "";

  // "OO역" 패턴
  const m = dir.match(/([가-힣A-Za-z0-9]+역)/);
  if (m?.[1]) station = m[1];

  // fallback: name에 역이 있으면
  if (!station) {
    const nm = String(place.name || "");
    const mm = nm.match(/([가-힣A-Za-z0-9]+역)/);
    if (mm?.[1]) station = mm[1];
  }

  // 그래도 없으면 "지역명 + 업종"으로 (address에서 구/동 하나 뽑기)
  let area = "";
  if (!station) {
    const addr = String(place.address || "");
    // "서울 종로구 ..." → "종로구"
    const mm = addr.match(/([가-힣]+구)/);
    if (mm?.[1]) area = mm[1];
    // "OO동"
    const md = addr.match(/([가-힣]+동)/);
    if (!area && md?.[1]) area = md[1];
  }

  const head = station || area || "해당 지역";
  const cat = isHairSalon(place) ? "미용실" : (place.category || "업체");

  return `${head} ${cat}`;
}

function buildProRaw(place: PlaceProfileLike) {
  const suggested5 = place.keywordPack?.suggested5 || [];
  const merged10 = place.keywordPack?.merged10 || [];

  const descriptionRewrite = buildDescriptionRewrite(place, suggested5, merged10);
  const directionsRewrite = buildDirectionsRewrite(place);

  const proTodo = Array.isArray(place?.audit?.todoTop5) ? place.audit.todoTop5 : Array.isArray(place?.todoTop5) ? place.todoTop5 : [];

  const competitorAnalysis = buildCompetitorAnalysis(place.competitors || []);

  return {
    descriptionRewrite,
    directionsRewrite,
    proTodo,
    competitorAnalysis
  };
}

function buildProBlocks(proRaw: any, unlockPro: boolean): { locked: boolean; blocks: ProBlock[] } {
  const locked = !unlockPro;

  const blocks: ProBlock[] = [
    {
      key: "descriptionRewrite",
      label: "상세설명 복붙 완성본",
      value: locked ? "" : (proRaw?.descriptionRewrite || "")
    },
    {
      key: "directionsRewrite",
      label: "오시는길 복붙 완성본",
      value: locked ? "" : (proRaw?.directionsRewrite || "")
    },
    {
      key: "proTodo",
      label: "등급 상승 체크리스트",
      value: locked ? [] : (Array.isArray(proRaw?.proTodo) ? proRaw.proTodo : [])
    },
    {
      key: "competitorAnalysis",
      label: "경쟁사 Top5 키워드 분석",
      value: locked ? {} : (proRaw?.competitorAnalysis || {})
    }
  ];

  return { locked, blocks };
}

function buildDescriptionRewrite(place: PlaceProfileLike, suggested5: string[], merged10: string[]) {
  // ✅ “키워드 나열” 느낌이 아니라 문장형으로 (네이버 감점 회피)
  const name = place.name || "해당 매장";
  const station = (() => {
    const d = String(place.directions || "");
    const m = d.match(/([가-힣A-Za-z0-9]+역)/);
    return m?.[1] ? m[1] : "";
  })();

  const brandOrSignature = suggested5.find((k) => k.includes("아베다")) || "";
  const core1 = suggested5[0] || (station ? `${station} 미용실` : "지역 미용실");
  const core2 = suggested5[1] || "";

  const lines: string[] = [];
  lines.push(`${core1} 찾는 분들께 ${name}을(를) 소개합니다.`);
  if (station) lines.push(`${station} 인근에서 커트/펌/염색 등 스타일 상담부터 시술까지 꼼꼼하게 진행합니다.`);
  else lines.push(`커트/펌/염색 등 스타일 상담부터 시술까지 꼼꼼하게 진행합니다.`);

  if (brandOrSignature) lines.push(`특히 ${brandOrSignature} 관련 시술/상담을 원하시는 분들께 잘 맞습니다.`);

  lines.push("");
  lines.push("이런 분들께 추천해요");
  lines.push("- 손질이 쉬운 스타일을 원하시는 분");
  lines.push("- 컬러/펌 후 손상 관리가 걱정되는 분");
  lines.push("- 분위기 전환이 필요하지만 어떤 스타일이 맞을지 고민인 분");

  lines.push("");
  lines.push("예약/문의는 네이버 플레이스 예약 버튼을 이용하시면 가장 빠릅니다.");

  // merged10은 내부 참고용이므로 본문에 다 때려넣지 않음(감점 위험)
  // 필요한 경우 1~2개만 자연스럽게 섞는 수준
  const extra = merged10.filter(Boolean).slice(0, 2);
  if (extra.length) {
    lines.push("");
    lines.push(`(참고 키워드: ${extra.join(", ")})`);
  }

  return lines.join("\n").trim();
}

function buildDirectionsRewrite(place: PlaceProfileLike) {
  // 기존 directions에서 핵심만 정리 + 주차 안내 문구 추가 유도
  const addr = place.address || place.roadAddress || "";
  const d = String(place.directions || "").trim();

  const stationLine = (() => {
    const m = d.match(/([가-힣A-Za-z0-9]+역\\s*\\d+번\\s*출구[^\\n.]{0,60})/);
    return m?.[1] ? m[1] : "";
  })();

  const lines: string[] = [];
  if (stationLine) lines.push(`- ${stationLine}`);
  else lines.push(`- 가까운 지하철역 기준 도보 이동`);

  if (addr) lines.push(`- 주소: ${addr}`);

  // 원문 길면 1~2문장만
  if (d) {
    const short = d.replace(/\s+/g, " ").trim();
    lines.push(`- 길 안내: ${short.slice(0, 180)}${short.length > 180 ? "..." : ""}`);
  }

  lines.push(`- 주차: 가능/불가/유료 여부를 함께 적어두면 문의가 줄어듭니다.`);
  lines.push(`- 입구/층수: 건물명/층/엘리베이터 여부를 한 줄로 추가하면 좋아요.`);

  return lines.join("\n").trim();
}

function buildCompetitorAnalysis(competitors: Competitor[]) {
  const byCompetitor = (competitors || []).map((c) => ({
    placeId: c.placeId,
    placeUrl: c.placeUrl,
    keywords5: (c.keywords5 || []).slice(0, 5)
  }));

  const freq = new Map<string, number>();
  for (const c of competitors || []) {
    for (const k of (c.keywords5 || []).slice(0, 5)) {
      const key = String(k || "").trim();
      if (!key) continue;
      freq.set(key, (freq.get(key) || 0) + 1);
    }
  }

  const topKeywords10 = Array.from(freq.entries())
    .sort((a, b) => b[1] - a[1] || a[0].length - b[0].length)
    .slice(0, 10)
    .map(([keyword, count]) => ({ keyword, count }));

  return { topKeywords10, byCompetitor };
}
