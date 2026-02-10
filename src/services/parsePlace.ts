// src/services/parsePlace.ts
import * as cheerio from "cheerio";

type MenuItem = { name: string; price?: number; durationMin?: number; note?: string };

export function parsePlaceFromHtml(html: string, placeUrl: string) {
  const $ = cheerio.load(html);

  const ogTitle = $('meta[property="og:title"]').attr("content")?.trim();
  const ogDesc = $('meta[property="og:description"]').attr("content")?.trim();
  const ogUrl = $('meta[property="og:url"]').attr("content")?.trim();

  // ld+json
  const ldjsonTexts: string[] = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    const t = $(el).text()?.trim();
    if (t) ldjsonTexts.push(t);
  });

  const ldObjects = ldjsonTexts
    .map((t) => {
      try {
        return JSON.parse(t);
      } catch {
        return null;
      }
    })
    .filter(Boolean);

  // __NEXT_DATA__
  const nextDataText = $("#__NEXT_DATA__").text()?.trim();
  let nextData: any = null;
  if (nextDataText) {
    try {
      nextData = JSON.parse(nextDataText);
    } catch {
      nextData = null;
    }
  }

  // ✅ dehydrated queries + candidates 구성
  const queryDatas: any[] = [];
  const candidates: any[] = [];

  if (nextData) {
    candidates.push(nextData);
    const pp = nextData?.props?.pageProps;
    if (pp) candidates.push(pp);

    const dq = pp?.dehydratedState?.queries;
    if (Array.isArray(dq)) {
      for (const q of dq) {
        const data = q?.state?.data;
        if (data) {
          queryDatas.push(data);
          candidates.push(data);
        }
      }
    }
  }
  for (const obj of ldObjects) candidates.push(obj);

  const placeId =
    extractPlaceId(placeUrl) ?? deepFindString(candidates, ["placeId", "businessId", "id"]) ?? undefined;

  // name
  const nameFromData = deepFindString(candidates, ["placeName", "bizName", "name", "title"]);
  const rawName = isUselessTitle(ogTitle) ? nameFromData ?? "UNKNOWN" : ogTitle ?? nameFromData ?? "UNKNOWN";
  const name = cleanupName(rawName);

  const category = deepFindString(candidates, ["categoryName", "category", "bizCategory", "categoryLabel"]) ?? undefined;

  const address = deepFindString(candidates, ["jibunAddress", "address", "addr"]) ?? undefined;
  const roadAddress = deepFindString(candidates, ["roadAddress", "roadAddr", "newAddress"]) ?? undefined;

  let description =
    deepFindString(candidates, ["intro", "summary", "description", "desc"]) ??
    (ogDesc && !isUselessDesc(ogDesc) ? ogDesc : undefined);

  if (description && looksLikeReviewCountLine(description)) {
    const alt =
      deepFindString(candidates, ["introduction", "about", "bizIntro", "placeIntro", "homeDescription"]) ?? undefined;
    if (alt) description = alt;
  }

  // ✅ "기존 대표키워드" (진짜 대표키워드만)
  const keywords = extractRepresentativeKeywords($, queryDatas, candidates);

  // 기존 tags는 그대로(시설/서비스/해시태그 등 넓게)
  const tags = extractTags(candidates);

  // menus (너가 메뉴/가격을 안 쓰면 주석 처리 가능)
  const menus = extractMenusFromQueries(queryDatas).concat(extractMenusEnhanced(candidates));
  const dedupMenus = dedupMenu(menus);

  const visitorCount =
    deepFindNumber(candidates, ["visitorReviewCount", "visitorReviews", "reviewCount", "userReviewCount"]) ?? undefined;

  const blogCount = deepFindNumber(candidates, ["blogReviewCount", "blogReviews"]) ?? undefined;

  const rating = deepFindNumber(candidates, ["rating", "averageRating", "starRating", "score"]) ?? undefined;

  const photoCountFromKeys =
    deepFindNumber(candidates, ["photoCount", "imageCount", "totalPhotoCount", "totalImages"]) ?? undefined;

  const photoCountFromArrays = estimatePhotoCountFromArrays(candidates) ?? undefined;

  const photoCount =
    typeof photoCountFromKeys === "number"
      ? photoCountFromKeys
      : typeof photoCountFromArrays === "number"
      ? photoCountFromArrays
      : undefined;

  return {
    placeId,
    placeUrl: ogUrl ?? placeUrl,
    name,
    category,
    address,
    roadAddress,
    description,
    directions: undefined,
    keywords: keywords.length ? keywords : undefined, // ✅ 기존 대표키워드
    tags: tags.length ? tags : undefined,
    // menus: dedupMenus.length ? dedupMenus : undefined, // ✅ 메뉴/가격 안 쓰면 주석 처리
    reviews: {
      visitorCount,
      blogCount,
      rating
    },
    photos: {
      count: photoCount
    }
  };
}

function cleanupName(n: string) {
  return n.replace(/\s*:\s*네이버.*$/i, "").replace(/\u001c/g, "").trim();
}
function looksLikeReviewCountLine(s: string) {
  return /방문자리뷰|블로그리뷰|리뷰\s*\d+/i.test(s);
}

function extractPlaceId(url: string): string | null {
  let m = url.match(/\/place\/(\d+)/i);
  if (m?.[1]) return m[1];
  m = url.match(/\/hairshop\/(\d+)/i);
  if (m?.[1]) return m[1];
  return null;
}

function isUselessTitle(t?: string | null) {
  if (!t) return true;
  const x = t.trim();
  return x === "네이버 플레이스" || x === "Naver Place" || x.length <= 1;
}
function isUselessDesc(t?: string | null) {
  if (!t) return true;
  const x = t.trim();
  return x === "네이버 플레이스" || x.length <= 3;
}

function deepFindString(objs: any[], keys: string[]): string | null {
  for (const key of keys) {
    const v = deepFindByKey(objs, key);
    const s = asNonEmptyString(v);
    if (s) return s;
  }
  return null;
}
function deepFindNumber(objs: any[], keys: string[]): number | null {
  for (const key of keys) {
    const v = deepFindByKey(objs, key);
    const n = asNumber(v);
    if (typeof n === "number") return n;
  }
  return null;
}

function deepFindByKey(objs: any[], key: string): any {
  for (const o of objs) {
    const found = deepFindInObject(o, key, 0);
    if (found !== undefined) return found;
  }
  return undefined;
}
function deepFindInObject(obj: any, key: string, depth: number): any {
  if (!obj || depth > 12) return undefined;

  if (typeof obj === "object") {
    if (Object.prototype.hasOwnProperty.call(obj, key)) return obj[key];

    if (Array.isArray(obj)) {
      for (const it of obj) {
        const f = deepFindInObject(it, key, depth + 1);
        if (f !== undefined) return f;
      }
      return undefined;
    }

    for (const k of Object.keys(obj)) {
      const f = deepFindInObject(obj[k], key, depth + 1);
      if (f !== undefined) return f;
    }
  }
  return undefined;
}

function asNonEmptyString(v: any): string | null {
  if (typeof v === "string") {
    const s = v.trim();
    return s ? s : null;
  }
  return null;
}
function asNumber(v: any): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const cleaned = v.replace(/[^\d.]/g, "");
    if (!cleaned) return null;
    const n = Number(cleaned);
    if (Number.isFinite(n) && !Number.isNaN(n)) return n;
  }
  return null;
}

/**
 * ✅ "기존 대표키워드"만 최대한 정확하게 추출
 * 우선순위:
 * 1) queryDatas/candidates 안의 대표키워드 전용 키
 * 2) (불가피 시) candidates 안의 일반 keywords 계열 중 "가장 그럴듯한 배열" 1개 선택
 * 3) DOM에서는 "대표키워드" 섹션 근처에서만 칩 텍스트 수집 (페이지 전체 훑기 금지)
 */
function extractRepresentativeKeywords($: cheerio.CheerioAPI, queryDatas: any[], candidates: any[]): string[] {
  // 최소 stoplist (UI/리뷰/버튼)
  const STOP = new Set([
    "홈", "메뉴", "사진", "리뷰", "예약", "가격", "지도", "정보", "더보기", "펼치기", "접기", "저장",
    "문의", "소식", "스타일", "마이플레이스"
  ]);

  const NOISE_RE = /(이미지\s*갯수|방문자\s*리뷰|블로그\s*리뷰|길찾기|공유|전화|영업시간|알림|쿠폰|주차)/i;

  const seen = new Set<string>();
  const out: string[] = [];

  const pushOne = (raw: string) => {
    const t = (raw || "").replace(/^#/, "").replace(/\s+/g, " ").trim();
    if (!t) return;
    if (t.length < 2 || t.length > 22) return;
    if (!/[가-힣A-Za-z]/.test(t)) return;
    if (NOISE_RE.test(t)) return;
    if (STOP.has(t)) return;
    if (/^\d+$/.test(t)) return;

    if (seen.has(t)) return;
    seen.add(t);
    out.push(t);
  };

  // (1) 전용 키 우선: representativeKeywords 계열
  const primaryKeys = [
    "representativeKeywords",
    "representativeKeyword",
    "placeKeywords",
    "searchKeywords",
    "bizKeywords"
  ];

  for (const k of primaryKeys) {
    pushKeywordsByValue(pushOne, deepFindByKey(queryDatas, k));
    pushKeywordsByValue(pushOne, deepFindByKey(candidates, k));
    if (out.length >= 5) break; // 전용키에서 어느 정도 나오면 충분
  }

  // (2) 일반 keywords 계열은 "모든 걸 다 넣지 말고", 후보 배열을 모아 "가장 그럴듯한 1개"만 선택
  if (out.length < 3) {
    const genericKeys = ["keywords", "keywordList", "hashTags", "themeTags", "tags"];
    const arrays: string[][] = [];

    for (const k of genericKeys) {
      collectKeywordArrays(arrays, deepFindByKey(queryDatas, k));
      collectKeywordArrays(arrays, deepFindByKey(candidates, k));
    }

    const best = pickBestKeywordArray(arrays, STOP, NOISE_RE);
    if (best?.length) {
      for (const t of best) pushOne(t);
    }
  }

  // (3) DOM 폴백: "대표키워드" 근처에서만 칩 텍스트 수집
  if (out.length < 3) {
    const domPicked = extractKeywordChipsNearLabel($, "대표키워드");
    for (const t of domPicked) pushOne(t);
  }

  return out.slice(0, 15);
}

function pushKeywordsByValue(pushOne: (s: string) => void, v: any) {
  if (!v) return;

  if (Array.isArray(v)) {
    for (const it of v) {
      const s = asNonEmptyString(it?.name ?? it?.title ?? it?.keyword ?? it);
      if (s) pushOne(s);
    }
    return;
  }

  if (typeof v === "object") {
    const arr = v.items ?? v.list ?? v.keywords ?? v.tags ?? v.representativeKeywords ?? undefined;
    if (Array.isArray(arr)) {
      for (const it of arr) {
        const s = asNonEmptyString(it?.name ?? it?.title ?? it?.keyword ?? it);
        if (s) pushOne(s);
      }
    } else {
      // 단일 문자열 케이스
      const s = asNonEmptyString(v.keyword ?? v.name ?? v.title);
      if (s) pushOne(s);
    }
  }
}

function collectKeywordArrays(out: string[][], v: any) {
  if (!v) return;

  if (Array.isArray(v)) {
    // string[]이면 후보
    if (v.length && v.every((x) => typeof x === "string")) {
      out.push(v as string[]);
    } else {
      // object[]이면 name/title/keyword로 string[] 변환 후보도 만든다
      const mapped: string[] = [];
      for (const it of v) {
        const s = asNonEmptyString(it?.name ?? it?.title ?? it?.keyword ?? it);
        if (s) mapped.push(s);
      }
      if (mapped.length >= 3) out.push(mapped);
    }
    return;
  }

  if (typeof v === "object") {
    const arr = v.items ?? v.list ?? v.keywords ?? v.tags ?? undefined;
    if (Array.isArray(arr)) collectKeywordArrays(out, arr);
  }
}

/**
 * 후보 배열 중 "대표키워드일 가능성이 가장 높은" 배열 하나 선택
 * - 길이 3~20 선호
 * - UI 잡음 적을수록 가산
 * - 토큰이 너무 길거나 숫자/리뷰문구면 감점
 */
function pickBestKeywordArray(arrays: string[][], STOP: Set<string>, NOISE_RE: RegExp): string[] | null {
  if (!arrays.length) return null;

  const score = (arr: string[]) => {
    const a = arr.map((x) => (x || "").replace(/^#/, "").trim()).filter(Boolean);

    let s = 0;
    const len = a.length;

    if (len >= 3 && len <= 20) s += 4;
    if (len >= 5 && len <= 15) s += 3;

    let good = 0;
    let noise = 0;

    for (const t of a) {
      if (t.length < 2 || t.length > 22) noise++;
      if (!/[가-힣A-Za-z]/.test(t)) noise++;
      if (/^\d+$/.test(t)) noise++;
      if (STOP.has(t)) noise++;
      if (NOISE_RE.test(t)) noise++;
      if (!STOP.has(t) && !NOISE_RE.test(t) && /[가-힣A-Za-z]/.test(t) && t.length <= 22) good++;
    }

    s += Math.min(good, 10);
    s -= noise * 2;

    return s;
  };

  const sorted = arrays
    .map((a) => ({ a, s: score(a) }))
    .sort((x, y) => y.s - x.s);

  return sorted[0]?.a ?? null;
}

/**
 * DOM에서 "대표키워드" 라벨 근처에 붙은 칩/태그 텍스트만 수집
 * - 페이지 전체를 훑지 않음
 */
function extractKeywordChipsNearLabel($: cheerio.CheerioAPI, label: string): string[] {
  const out: string[] = [];

  // label 포함하는 요소를 찾고, 그 부모/근처에서 a/button/span 텍스트 수집
  const labelEls = $(`*:contains("${label}")`).toArray().slice(0, 6);

  for (const el of labelEls) {
    const $el = $(el);
    const parent = $el.parent();
    const scope = parent.length ? parent : $el;

    const texts: string[] = [];
    scope.find("a,button,span,div").each((_, chip) => {
      const t = $(chip).text()?.trim();
      if (!t) return;
      if (t === label) return;
      texts.push(t);
    });

    // 너무 많이 담지 말고, 짧은 텍스트 위주로
    for (const t of texts) {
      const x = t.replace(/\s+/g, " ").trim();
      if (x.length < 2 || x.length > 22) continue;
      out.push(x);
      if (out.length >= 20) break;
    }
    if (out.length >= 5) break;
  }

  return out;
}

function extractTags(objs: any[]): string[] {
  const out = new Set<string>();
  const keys = ["tags", "keywords", "hashTags", "themeTags", "services", "serviceTags", "facilities"];
  for (const k of keys) {
    const v = deepFindByKey(objs, k);
    if (Array.isArray(v)) {
      for (const it of v) {
        const s = asNonEmptyString(it?.name ?? it?.title ?? it);
        if (s) out.add(s);
      }
    }
  }
  return Array.from(out).slice(0, 15);
}

/**
 * (아래 메뉴 관련 로직은 너가 “메뉴/가격 빼자”면 유지해도 되고 제거해도 됨)
 */
function extractMenusFromQueries(queryDatas: any[]): MenuItem[] {
  const out: MenuItem[] = [];
  const keys = [
    "priceList",
    "priceLists",
    "priceItems",
    "prices",
    "serviceItems",
    "services",
    "treatments",
    "treatmentItems",
    "menu",
    "menus",
    "items",
    "bookingProducts",
    "products"
  ];

  for (const data of queryDatas) {
    if (!data) continue;
    for (const k of keys) {
      const v = deepFindByKey([data], k);
      if (Array.isArray(v)) out.push(...menuFromAny(v));
      else if (v && typeof v === "object") {
        const maybeArr = v.items ?? v.list ?? v.elements ?? v.data ?? v.sections ?? undefined;
        if (Array.isArray(maybeArr)) out.push(...menuFromAny(maybeArr));
      }
    }
  }
  return out;
}

function extractMenusEnhanced(objs: any[]): MenuItem[] {
  const out: MenuItem[] = [];
  const menuKeys = [
    "menus",
    "menu",
    "items",
    "priceList",
    "priceLists",
    "priceItems",
    "prices",
    "services",
    "serviceItems",
    "treatments",
    "treatmentItems",
    "products"
  ];

  for (const key of menuKeys) {
    const v = deepFindByKey(objs, key);
    if (Array.isArray(v)) out.push(...menuFromAny(v));
    else if (v && typeof v === "object") {
      const maybeArr = v.items ?? v.list ?? v.elements ?? v.sections ?? v.data ?? undefined;
      if (Array.isArray(maybeArr)) out.push(...menuFromAny(maybeArr));
    }
  }
  return out;
}

function menuFromAny(arr: any[]): MenuItem[] {
  const out: MenuItem[] = [];
  for (const it of arr) {
    const name = asNonEmptyString(it?.name ?? it?.title ?? it?.menuName ?? it?.serviceName ?? it);
    if (!name) continue;

    const rawPrice = it?.price ?? it?.minPrice ?? it?.maxPrice ?? it?.amount ?? it?.value ?? it?.cost ?? it?.priceValue;
    const price = asNumber(rawPrice) ?? undefined;

    const durationMin = asNumber(it?.durationMin ?? it?.duration ?? it?.time ?? it?.leadTime) ?? undefined;
    const note = asNonEmptyString(it?.note ?? it?.desc ?? it?.description ?? it?.memo) ?? undefined;

    const item: MenuItem = { name };
    if (typeof price === "number") item.price = price;
    if (typeof durationMin === "number") item.durationMin = durationMin;
    if (note) item.note = note;

    out.push(item);
  }
  return out;
}

function dedupMenu(menus: MenuItem[]): MenuItem[] {
  const seen = new Map<string, MenuItem>();

  for (const m of menus) {
    const name = (m?.name || "").trim();
    if (!name) continue;
    if (!/[가-힣A-Za-z]/.test(name)) continue;
    if (typeof m.price === "number" && m.price < 5000) continue;

    const key = `${name}:${m.price ?? "na"}`;
    if (!seen.has(key)) seen.set(key, m);
  }

  return Array.from(seen.values()).slice(0, 30);
}

function estimatePhotoCountFromArrays(objs: any[]): number | null {
  const keys = ["photos", "photoList", "images", "imageList", "media", "gallery"];
  let best = 0;

  for (const k of keys) {
    const v = deepFindByKey(objs, k);
    if (Array.isArray(v)) best = Math.max(best, v.length);
    else if (v && typeof v === "object") {
      const maybeArr = v.items ?? v.list ?? v.elements ?? v.data ?? undefined;
      if (Array.isArray(maybeArr)) best = Math.max(best, maybeArr.length);
    }
  }
  return best > 0 ? best : null;
}

