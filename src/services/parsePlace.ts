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

  const placeId = extractPlaceId(placeUrl) ?? deepFindString(candidates, ["id", "placeId", "businessId"]);

  const nameFromData = deepFindString(candidates, ["name", "placeName", "bizName", "title"]);
  const name = isUselessTitle(ogTitle) ? (nameFromData ?? "UNKNOWN") : (ogTitle ?? nameFromData ?? "UNKNOWN");

  const category = deepFindString(candidates, ["category", "categoryName", "bizCategory", "categoryLabel"]) ?? undefined;
  const address = deepFindString(candidates, ["address", "addr", "jibunAddress"]) ?? undefined;
  const roadAddress = deepFindString(candidates, ["roadAddress", "roadAddr", "newAddress"]) ?? undefined;

  const description =
    deepFindString(candidates, ["description", "intro", "summary", "desc"]) ??
    (ogDesc && !isUselessDesc(ogDesc) ? ogDesc : undefined);

  const menus = extractMenus(candidates);
  const tags = extractTags(candidates);

  const visitorCount =
    deepFindNumber(candidates, ["visitorReviewCount", "reviewCount", "visitorReviews", "userReviewCount"]) ?? undefined;

  const rating = deepFindNumber(candidates, ["rating", "averageRating", "starRating", "score"]) ?? undefined;

  const photoCount = deepFindNumber(candidates, ["photoCount", "imageCount", "totalPhotoCount"]) ?? undefined;

  // ✅ PlaceProfile에 맞춰 key 이름을 menus/photos로 정확히 맞춤
  return {
    placeId: placeId ?? undefined,
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
      rating
    },
    photos: {
      count: photoCount
    }
  };
}

function extractPlaceId(url: string): string | null {
  let m = url.match(/\/place\/(\d+)/i);
  if (m?.[1]) return m[1];
  m = url.match(/place\/(\d+)/i);
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
  if (!obj || depth > 8) return undefined;

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
  const keys = ["tags", "keywords", "hashTags", "themeTags", "services"];

  for (const k of keys) {
    const v = deepFindByKey(objs, k);
    if (Array.isArray(v)) {
      for (const it of v) {
        const s = asNonEmptyString(it?.name ?? it);
        if (s) out.add(s);
      }
    }
  }

  return Array.from(out).slice(0, 12);
}

function extractMenus(objs: any[]): MenuItem[] {
  const out: MenuItem[] = [];

  for (const o of objs) {
    if (!o) continue;

    const hasMenu = deepFindByKey([o], "hasMenu");
    if (hasMenu && typeof hasMenu === "object") {
      const items = (hasMenu?.hasMenuSection ?? hasMenu?.itemListElement ?? []) as any[];
      out.push(...menuFromAny(items));
    }

    const menuLike = deepFindByKey([o], "menus") ?? deepFindByKey([o], "menu") ?? deepFindByKey([o], "items");
    if (Array.isArray(menuLike)) {
      out.push(...menuFromAny(menuLike));
    }
  }

  // ✅ 중복 제거 (name 기준)
  const dedup = new Map<string, MenuItem>();
  for (const m of out) {
    if (!m?.name) continue;
    if (!dedup.has(m.name)) dedup.set(m.name, m);
  }

  return Array.from(dedup.values()).slice(0, 20);
}

function menuFromAny(arr: any[]): MenuItem[] {
  const out: MenuItem[] = [];

  for (const it of arr) {
    const name = asNonEmptyString(it?.name ?? it?.title ?? it);
    if (!name) continue;

    // ✅ price는 number로만 넣고, 못 바꾸면 아예 생략
    const rawPrice = it?.price ?? it?.offers?.price ?? it?.cost ?? it?.priceValue;
    const price = asNumber(rawPrice) ?? undefined;

    const durationMin = asNumber(it?.durationMin ?? it?.duration ?? it?.time) ?? undefined;
    const note = asNonEmptyString(it?.note ?? it?.desc ?? it?.description) ?? undefined;

    const item: MenuItem = { name };
    if (typeof price === "number") item.price = price;
    if (typeof durationMin === "number") item.durationMin = durationMin;
    if (note) item.note = note;

    out.push(item);
  }

  return out;
}
