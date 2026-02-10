// src/services/parsePlace.ts
import * as cheerio from "cheerio";

type MenuItem = { name: string; price?: string | null };

export function parsePlaceFromHtml(html: string, placeUrl: string) {
  const $ = cheerio.load(html);

  // 1) OG/meta 기반 최소값
  const ogTitle = $('meta[property="og:title"]').attr("content")?.trim();
  const ogDesc = $('meta[property="og:description"]').attr("content")?.trim();
  const ogUrl = $('meta[property="og:url"]').attr("content")?.trim();

  // 2) ld+json 있으면 활용
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

  // 3) Next.js __NEXT_DATA__에서 데이터 찾기
  const nextDataText = $('#__NEXT_DATA__').text()?.trim();
  let nextData: any = null;
  if (nextDataText) {
    try {
      nextData = JSON.parse(nextDataText);
    } catch {
      nextData = null;
    }
  }

  // nextData 내부에서 place 관련 “가능성 있는 값”을 폭넓게 탐색
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

  // name 후보: ogTitle가 “네이버 플레이스” 같은 공통이면 버리고, next/ld에서 찾음
  const nameFromData =
    deepFindString(candidates, ["name", "placeName", "bizName", "title"]) ??
    null;

  const name =
    isUselessTitle(ogTitle) ? (nameFromData ?? "UNKNOWN") : (ogTitle ?? nameFromData ?? "UNKNOWN");

  const category =
    deepFindString(candidates, ["category", "categoryName", "bizCategory", "categoryLabel"]) ??
    null;

  const address =
    deepFindString(candidates, ["address", "addr", "jibunAddress"]) ??
    null;

  const roadAddress =
    deepFindString(candidates, ["roadAddress", "roadAddr", "newAddress"]) ??
    null;

  const description =
    deepFindString(candidates, ["description", "intro", "summary", "desc"]) ??
    (ogDesc && !isUselessDesc(ogDesc) ? ogDesc : null);

  // 메뉴: next/ld 어디서든 “이름”만이라도 잡히면 좋음
  const menus = extractMenus(candidates);

  // 태그/키워드
  const tags = extractTags(candidates);

  // 리뷰/평점/사진 수 (있으면)
  const visitorCount =
    deepFindNumber(candidates, ["visitorReviewCount", "reviewCount", "visitorReviews", "userReviewCount"]) ??
    null;

  const rating =
    deepFindNumber(candidates, ["rating", "averageRating", "starRating", "score"]) ??
    null;

  const photoCount =
    deepFindNumber(candidates, ["photoCount", "imageCount", "totalPhotoCount"]) ??
    null;

  return {
    placeId: placeId ?? undefined,
    placeUrl: ogUrl ?? placeUrl,
    name: name ?? "UNKNOWN",
    category: category ?? undefined,
    address: address ?? undefined,
    roadAddress: roadAddress ?? undefined,
    description: description ?? undefined,
    directions: undefined, // directions는 후속에서 별도 데이터로 채우는 게 안정적 (지금은 스킵)
    tags: tags.length ? tags : undefined,
    menus: menus.length ? menus : undefined,
    reviews: {
      visitorCount: typeof visitorCount === "number" ? visitorCount : undefined,
      rating: typeof rating === "number" ? rating : undefined
    },
    photos: {
      count: typeof photoCount === "number" ? photoCount : undefined
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
    const n = Number(v.replace(/[^\d.]/g, ""));
    if (Number.isFinite(n) && !Number.isNaN(n)) return n;
  }
  return null;
}

function extractTags(objs: any[]): string[] {
  const out = new Set<string>();

  // 흔한 키들에서 태그/키워드 후보를 뽑음
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

  // ld+json Menu가 있는 경우
  for (const o of objs) {
    if (!o) continue;

    // schema.org MenuItem
    const hasMenu = deepFindByKey([o], "hasMenu");
    if (hasMenu && typeof hasMenu === "object") {
      const items = (hasMenu?.hasMenuSection ?? hasMenu?.itemListElement ?? []) as any[];
      const extracted = menuFromAny(items);
      out.push(...extracted);
    }

    // 일반 menu/items 키
    const menuLike = deepFindByKey([o], "menus") ?? deepFindByKey([o], "menu") ?? deepFindByKey([o], "items");
    if (Array.isArray(menuLike)) {
      out.push(...menuFromAny(menuLike));
    }
  }

  // 중복 제거
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
    const price = asNonEmptyString(it?.price ?? it?.offers?.price ?? it?.cost);
    out.push({ name, price: price ?? null });
  }
  return out;
}
