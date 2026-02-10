// src/services/enrichPlace.ts
import { fetchMenusViaPlaywright, type Menu } from "./playwrightMenus.js";
import { fetchExistingKeywordsViaPlaywright } from "./playwrightKeywords.js";

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
  keywords?: string[]; // ✅ 기존 대표키워드
  menus?: Menu[];
  reviews?: any;
  photos?: { count?: number };
  _menuDebug?: any;
  _keywordDebug?: any;
};

export async function enrichPlace(place: PlaceProfileLike): Promise<PlaceProfileLike> {
  const base = basePlaceUrl(place.placeUrl);
  const isHair = isHairSalon(place);

  // 0) ✅ 기존 대표키워드(중요)
  if (!place.keywords || place.keywords.length === 0) {
    try {
      const homeUrl = `${base}/home`;
      const kw = await fetchExistingKeywordsViaPlaywright(homeUrl);
      if (kw.keywords.length) place.keywords = kw.keywords.slice(0, 15);
      place._keywordDebug = kw.debug;
    } catch (e: any) {
      place._keywordDebug = { error: e?.message ?? "keyword pw failed" };
    }
  }

  // 1) ✅ 메뉴/가격: 미용실은 price 탭 Playwright만 (안되면 배제)
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

  // (선택) 일반 업종 메뉴까지 할 거면 여기에 /menu playwright or html 추가
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
