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
      try { return JSON.parse(t); } catch { return null; }
    })
    .filter(Boolean);

  // __NEXT_DATA__
  const nextDataText = $("#__NEXT_DATA__").text()?.trim();
  let nextData: any = null;
  if (nextDataText) {
    try { nextData = JSON.parse(nextDataText); } catch { nextData = null; }
  }

  // 후보 데이터 풀 구성
  const candidates: any[] = [];
  if (nextData) {
    candidates.push(nextData);
    const pp = nextData?.props?.pageProps;
    if (pp) candidates.push(pp);

    const dq = pp?.dehydratedState?.queries;
    if (Array.isArray(dq)) {
      for (const q of dq) {
        const data = q?.state?.data;
        if (data) candidates.push(data);
      }
    }
  }
  for (const obj of ldObjects) candidates.push(obj);

  const placeId = extractPlaceId(placeUrl) ?? deepFindString(candidates, ["placeId", "businessId", "id"]) ?? undefined;

  // name: ogTitle가 쓸만하면 쓰되 " : 네이버" 꼬리 제거
  const nameFromData = deepFindString(candidates, ["placeName", "bizName", "name", "title"]);
  const rawName = isUselessTitle(ogTitle) ? (nameFromData ?? "UNKNOWN") : (ogTitle ?? nameFromData ?? "UNKNOWN");
  const name = cleanupName(rawName);

  const category = deepFindString(candidates, ["categoryName", "category", "bizCategory", "categoryLabel"]) ?? undefined;

  const address = deepFindString(candidates, ["jibunAddress", "address", "addr"]) ?? undefined;
  const roadAddress = deepFindString(candidates, ["roadAddress", "roadAddr", "newAddress"]) ?? undefined;

  // description: "방문자리뷰/블로그리뷰" 같은 문구면 소개로 대체 시도
  let description =
    deepFindString(candidates, ["intro", "summary", "description", "desc"]) ??
    (ogDesc && !isUselessDesc(ogDesc) ? ogDesc : undefined);

  if (description && looksLikeReviewCountLine(description)) {
    const alt =
      deepFindString(candidates, ["introduction", "about", "bizIntro", "placeIntro", "homeDescription"]) ??
      undefined;
    if (alt) description = alt;
  }

  // tags/keywords
  const tags = extractTags(candidates);

  // menus/services/price list
  const menus = extractMenusEnhanced(candidates);

  // reviews/rating/photoCount
  const visitorCount =
    deepFindNumber(candidates, ["visitorReviewCount", "visitorReviews", "reviewCount", "userReviewCount"]) ?? undefined;

  const blogCount =
    deepFindNumber(candidates, ["blogReviewCount", "blogReviews"]) ?? undefined;

  const rating =
    deepFindNumber(candidates, ["rating", "averageRating", "starRating", "score"]) ?? undefined;

  const photoCountFromKeys =
    deepFindNumber(candidates, ["photoCount", "imageCount", "totalPhotoCount", "totalImages"]) ?? undefined;

  const photoCountFromArrays = estimatePhotoCountFromArrays(candidates) ?? undefined;

  const photoCount =
    typeof photoCountFromKeys === "number"
      ? photoCountFromKeys
      : (typeof photoCountFromArrays === "number" ? photoCountFromArrays : undefined);

  return {
    placeId,
    placeUrl: ogUrl ?? placeUrl,
    name,
    category,
    address,
    roadAddress,
    description,
    directions: undefined,
    tags: tags.length ? tags : undefined,
    menus: menus.length ? menus : undefined,
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
  // "파인트리 ... : 네이버" / 특수문자(\u001c) 제거
  return n
    .replace(/\s*:\s*네이버.*$/i, "")
    .replace(/\u001c/g, "")
    .trim();
}

function looksLikeReviewCountLine(s: string) {
  // "방문자리뷰 1,927 · 블로그리뷰 393" 같은 패턴
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
  if (!obj || depth > 10) return undefined;

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
 * ✅ 미용실/서비스업은 menus가 priceList/priceItems/services/treatments 등으로 들어있는 경우가 많음
 */
function extractMenusEnhanced(objs: any[]): MenuItem[] {
  const out: MenuItem[] = [];

  const menuKeys = [
    "menus", "menu", "items",
    "priceList", "priceLists", "priceItems", "prices",
    "services", "serviceItems", "treatments", "treatmentItems",
    "products"
  ];

  for (const key of menuKeys) {
    const v = deepFindByKey(objs, key);
    if (Array.isArray(v)) out.push(...menuFromAny(v));
    else if (v && typeof v === "object") {
      // object 안에 array가 들어있는 경우
      const maybeArr =
        v.items ?? v.list ?? v.elements ?? v.sections ?? v.data ?? undefined;
      if (Array.isArray(maybeArr)) out.push(...menuFromAny(maybeArr));
    }
  }

  const dedup = new Map<string, MenuItem>();
  for (const m of out) {
    if (!m?.name) continue;
    if (!dedup.has(m.name)) dedup.set(m.name, m);
  }
  return Array.from(dedup.values()).slice(0, 30);
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

function estimatePhotoCountFromArrays(objs: any[]): number | null {
  // 흔한 사진 배열 키에서 길이를 추정
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
