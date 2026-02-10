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

  // script blob state
  const placeIdHint = extractPlaceId(placeUrl);
  const scriptStateObjects = extractStateObjectsFromScripts($, html, placeIdHint);

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

  for (const o of scriptStateObjects) candidates.push(o);
  for (const obj of ldObjects) candidates.push(obj);

  const placeId =
    placeIdHint
    ?? deepFindString(candidates, ["placeId", "businessId", "id"])
    ?? undefined;

  const nameFromData = deepFindString(candidates, ["placeName", "bizName", "name", "title"]);
  const rawName = isUselessTitle(ogTitle) ? (nameFromData ?? "UNKNOWN") : (ogTitle ?? nameFromData ?? "UNKNOWN");
  const name = cleanupName(rawName);

  const category = deepFindString(candidates, ["categoryName", "category", "bizCategory", "categoryLabel"]) ?? undefined;

  const address = deepFindString(candidates, ["jibunAddress", "address", "addr"]) ?? undefined;
  const roadAddress = deepFindString(candidates, ["roadAddress", "roadAddr", "newAddress"]) ?? undefined;

  let description =
    deepFindString(candidates, ["intro", "summary", "description", "desc"]) ??
    (ogDesc && !isUselessDesc(ogDesc) ? ogDesc : undefined);

  if (description && looksLikeReviewCountLine(description)) {
    const alt = deepFindString(candidates, ["introduction", "about", "bizIntro", "placeIntro", "homeDescription"]) ?? undefined;
    if (alt) description = alt;
  }

  const tags = extractTags(candidates);

  // ✅ menus: 기존 키 기반 + 강제 스캔(키 몰라도)
  const menus =
    extractMenusFromQueries(queryDatas)
      .concat(extractMenusEnhanced(candidates))
      .concat(scanMenusByPattern(candidates)); // 🔥 NEW

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
    menus: dedupMenus.length ? dedupMenus : undefined,
    reviews: { visitorCount, blogCount, rating },
    photos: { count: photoCount }
  };
}

/**
 * 🔥 NEW: 키 이름 몰라도 “name/title + price 숫자” 패턴이 많은 배열을 찾아 menus로 변환
 * - /price 페이지에서 menu 구조가 특이할 때 이게 마지막 안전장치
 */
function scanMenusByPattern(objs: any[]): MenuItem[] {
  const out: MenuItem[] = [];
  const arrays = collectArraysFromMany(objs);

  // 후보 배열을 점수화해서 상위 몇 개만 변환
  const scored: { arr: any[]; score: number }[] = [];

  for (const arr of arrays) {
    if (!Array.isArray(arr) || arr.length < 3) continue;

    // 너무 큰 배열(수천)도 스킵(성능)
    if (arr.length > 2000) continue;

    // 샘플로 점수 계산
    const sample = arr.slice(0, 30);
    let hasName = 0;
    let hasPrice = 0;

    for (const it of sample) {
      const n = asNonEmptyString(it?.name ?? it?.title ?? it?.menuName ?? it?.serviceName ?? it?.productName);
      if (n) hasName++;

      const p = asNumber(it?.price ?? it?.minPrice ?? it?.maxPrice ?? it?.amount ?? it?.value ?? it?.cost ?? it?.priceValue);
      if (typeof p === "number" && p >= 5000 && p <= 2000000) hasPrice++;
    }

    // 최소 조건: 이름/가격이 어느 정도는 있어야 menu 후보
    if (hasName < 3 || hasPrice < 2) continue;

    // “비율” 점수
    const score = hasName * 2 + hasPrice * 3;
    scored.push({ arr, score });
  }

  scored.sort((a, b) => b.score - a.score);

  for (const c of scored.slice(0, 6)) {
    out.push(...menuFromAny(c.arr));
    if (out.length >= 60) break;
  }

  return out;
}

function collectArraysFromMany(objs: any[]): any[][] {
  const out: any[][] = [];
  for (const o of objs) out.push(...collectArrays(o, 0));
  return out;
}

/**
 * script에서 state blob 추출
 */
function extractStateObjectsFromScripts($: cheerio.CheerioAPI, rawHtml: string, placeIdHint: string | null) {
  const out: any[] = [];

  const assignKeys = [
    "__APOLLO_STATE__",
    "__INITIAL_STATE__",
    "__PLACE_STATE__",
    "__PRELOADED_STATE__",
    "__STATE__"
  ];

  const scripts: string[] = [];
  $("script").each((_, el) => {
    const t = $(el).text();
    if (t && t.length > 200) scripts.push(t);
  });
  if (rawHtml && rawHtml.length > 2000) scripts.push(rawHtml);

  for (const text of scripts) {
    if (placeIdHint && text.length > 5000 && !text.includes(placeIdHint)) continue;

    for (const k of assignKeys) {
      const obj = extractAssignedJsonObject(text, k);
      if (obj) out.push(obj);
    }

    if (/dehydratedstate|apollo|graphql|price|menu|product/i.test(text)) {
      const obj2 = extractFirstLargeJsonObject(text);
      if (obj2) out.push(obj2);
    }
  }

  return out.slice(0, 10);
}

function extractAssignedJsonObject(text: string, key: string): any | null {
  const re = new RegExp(`(?:window\\.)?${escapeRegExp(key)}\\s*=\\s*({)`, "m");
  const m = re.exec(text);
  if (!m || m.index == null) return null;

  const start = text.indexOf("{", m.index);
  if (start < 0) return null;

  const jsonStr = sliceBalancedBraces(text, start, 2_000_000);
  if (!jsonStr) return null;

  try { return JSON.parse(jsonStr); } catch { return null; }
}

function extractFirstLargeJsonObject(text: string): any | null {
  const start = text.indexOf("{");
  if (start < 0) return null;
  const jsonStr = sliceBalancedBraces(text, start, 1_200_000);
  if (!jsonStr) return null;
  try {
    const obj = JSON.parse(jsonStr);
    if (obj && typeof obj === "object") return obj;
  } catch {}
  return null;
}

function sliceBalancedBraces(text: string, start: number, maxLen: number): string | null {
  let depth = 0;
  let inStr = false;
  let esc = false;

  const endLimit = Math.min(text.length, start + maxLen);

  for (let i = start; i < endLimit; i++) {
    const ch = text[i];

    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    } else {
      if (ch === '"') { inStr = true; continue; }
      if (ch === "{") depth++;
      if (ch === "}") {
        depth--;
        if (depth === 0) return text.slice(start, i + 1);
      }
    }
  }
  return null;
}

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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

function extractMenusFromQueries(queryDatas: any[]): MenuItem[] {
  const out: MenuItem[] = [];

  const keys = [
    "priceList", "priceLists", "priceItems", "prices",
    "serviceItems", "services", "treatments", "treatmentItems",
    "menu", "menus", "items",
    "bookingProducts", "products"
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

    const foundArrays = collectArrays(data, 0);
    for (const arr of foundArrays) {
      if (arr.length < 2) continue;
      const sample = arr.slice(0, 3);
      const ok =
        sample.some((it: any) => asNonEmptyString(it?.name ?? it?.title ?? it?.menuName ?? it?.serviceName)) &&
        sample.some((it: any) => asNumber(it?.price ?? it?.minPrice ?? it?.maxPrice ?? it?.amount ?? it?.value));
      if (!ok) continue;
      out.push(...menuFromAny(arr));
    }
  }

  return out;
}

function collectArrays(obj: any, depth: number): any[][] {
  if (!obj || depth > 10) return [];
  const out: any[][] = [];

  if (Array.isArray(obj)) {
    out.push(obj);
    for (const it of obj) out.push(...collectArrays(it, depth + 1));
    return out;
  }

  if (typeof obj === "object") {
    for (const k of Object.keys(obj)) out.push(...collectArrays(obj[k], depth + 1));
  }

  return out;
}

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
      const maybeArr = v.items ?? v.list ?? v.elements ?? v.sections ?? v.data ?? undefined;
      if (Array.isArray(maybeArr)) out.push(...menuFromAny(maybeArr));
    }
  }
  return out;
}

function menuFromAny(arr: any[]): MenuItem[] {
  const out: MenuItem[] = [];
  for (const it of arr) {
    const name = asNonEmptyString(it?.name ?? it?.title ?? it?.menuName ?? it?.serviceName ?? it?.productName ?? it);
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
