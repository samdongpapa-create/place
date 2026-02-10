// src/services/enrichPlace.ts
import { fetchPlaceHtml } from "./fetchPlace.js";
import { parsePlaceFromHtml } from "./parsePlace.js";
import { fetchMenusViaPlaywright, type Menu } from "./playwrightMenus.js";

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
  menus?: Menu[];
  reviews?: any;
  photos?: { count?: number };
  _menuDebug?: any;
};

export async function enrichPlace(place: PlaceProfileLike): Promise<PlaceProfileLike> {
  const base = basePlaceUrl(place.placeUrl);

  // ✅ 1) menus: 정적(price/menu/home) → booking → playwright 순서
  if (!place.menus || place.menus.length === 0) {
    const debug: any = { chain: [] as any[] };

    // (A) 정적/HTML 파싱 시도: /price → /menu → /home
    const htmlCandidates = [`${base}/price`, `${base}/menu`, `${base}/home`];
    for (const url of htmlCandidates) {
      try {
        const fetched = await fetchPlaceHtml(url, { minLength: 120, retries: 1, timeoutMs: 9000 });
        const parsed = parsePlaceFromHtml(fetched.html, fetched.finalUrl);

        if (parsed?.menus?.length) {
          place.menus = cleanMenus(parsed.menus);
          if (place.menus.length) {
            place._menuDebug = { via: "html", url, len: fetched.html.length };
            return place;
          }
        }
        debug.chain.push({ step: "html", url, ok: false, len: fetched.html.length });
      } catch (e: any) {
        debug.chain.push({ step: "html", url, ok: false, error: e?.message ?? "html failed" });
      }
    }

    // (B) 예약 페이지 HTML 파싱 시도: /booking (여기서 menus를 __NEXT_DATA__로 주는 케이스도 있음)
    const bookingUrl = `${base}/booking`;
    try {
      const fetched = await fetchPlaceHtml(bookingUrl, { minLength: 120, retries: 1, timeoutMs: 9000 });
      const parsed = parsePlaceFromHtml(fetched.html, fetched.finalUrl);
      if (parsed?.menus?.length) {
        place.menus = cleanMenus(parsed.menus);
        if (place.menus.length) {
          place._menuDebug = { via: "booking-html", url: bookingUrl, len: fetched.html.length };
          return place;
        }
      }
      debug.chain.push({ step: "booking-html", url: bookingUrl, ok: false, len: fetched.html.length });
    } catch (e: any) {
      debug.chain.push({ step: "booking-html", url: bookingUrl, ok: false, error: e?.message ?? "booking html failed" });
    }

    // (C) 마지막: Playwright 네트워크 캡처 (booking 우선 → price 폴백)
    try {
      const pw1 = await fetchMenusViaPlaywright(bookingUrl);
      debug.chain.push({ step: "playwright", url: bookingUrl, ok: pw1.menus.length > 0, ...pw1.debug });

      if (pw1.menus.length) {
        place.menus = cleanMenus(pw1.menus);
        place._menuDebug = { via: "playwright-booking", ...debug, final: pw1.debug };
        return place;
      }

      const priceUrl = `${base}/price`;
      const pw2 = await fetchMenusViaPlaywright(priceUrl);
      debug.chain.push({ step: "playwright", url: priceUrl, ok: pw2.menus.length > 0, ...pw2.debug });

      if (pw2.menus.length) {
        place.menus = cleanMenus(pw2.menus);
        place._menuDebug = { via: "playwright-price", ...debug, final: pw2.debug };
        return place;
      }

      place._menuDebug = { via: "playwright-none", ...debug };
    } catch (e: any) {
      place._menuDebug = { via: "playwright-error", ...debug, error: e?.message ?? "pw failed" };
    }
  } else {
    place.menus = cleanMenus(place.menus);
  }

  return place;
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

    // 가격이 없을 수도 있으니, 가격 필터는 "있을 때만" 적용
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
