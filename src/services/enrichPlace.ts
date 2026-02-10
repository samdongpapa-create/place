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

  // ✅ directions 복구: 비어있으면 자동 생성
  if (!place.directions || place.directions.trim().length < 3) {
    const auto = autoDirections(place);
    if (auto) place.directions = auto;
  }

  // ✅ menus: 정적(price/menu/home) → booking html → playwright(booking → price)
  if (!place.menus || place.menus.length === 0) {
    const debug: any = { chain: [] as any[] };

    // (A) 정적/HTML 파싱: /price → /menu → /home
    for (const url of [`${base}/price`, `${base}/menu`, `${base}/home`]) {
      try {
        const fetched = await fetchPlaceHtml(url, { minLength: 120 });
        const parsed = parsePlaceFromHtml(fetched.html, fetched.finalUrl);
        const cleaned = parsed?.menus ? cleanMenus(parsed.menus) : [];

        debug.chain.push({ step: "html", url, len: fetched.html.length, menus: cleaned.length });

        if (cleaned.length) {
          place.menus = cleaned;
          place._menuDebug = { via: "html", ...debug };
          return place;
        }
      } catch (e: any) {
        debug.chain.push({ step: "html", url, error: e?.message ?? "html failed" });
      }
    }

    // (B) booking html 파싱
    const bookingUrl = `${base}/booking`;
    try {
      const fetched = await fetchPlaceHtml(bookingUrl, { minLength: 120 });
      const parsed = parsePlaceFromHtml(fetched.html, fetched.finalUrl);
      const cleaned = parsed?.menus ? cleanMenus(parsed.menus) : [];

      debug.chain.push({ step: "booking-html", url: bookingUrl, len: fetched.html.length, menus: cleaned.length });

      if (cleaned.length) {
        place.menus = cleaned;
        place._menuDebug = { via: "booking-html", ...debug };
        return place;
      }
    } catch (e: any) {
      debug.chain.push({ step: "booking-html", url: bookingUrl, error: e?.message ?? "booking html failed" });
    }

    // (C) playwright: booking 우선 → price 폴백
    try {
      const pw1 = await fetchMenusViaPlaywright(bookingUrl);
      debug.chain.push({ step: "playwright", url: bookingUrl, ...pw1.debug, menus: pw1.menus.length });

      if (pw1.menus.length) {
        place.menus = cleanMenus(pw1.menus);
        place._menuDebug = { via: "playwright-booking", ...debug };
        return place;
      }

      const priceUrl = `${base}/price`;
      const pw2 = await fetchMenusViaPlaywright(priceUrl);
      debug.chain.push({ step: "playwright", url: priceUrl, ...pw2.debug, menus: pw2.menus.length });

      if (pw2.menus.length) {
        place.menus = cleanMenus(pw2.menus);
        place._menuDebug = { via: "playwright-price", ...debug };
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

function autoDirections(place: PlaceProfileLike): string | null {
  const station = extractStationFromName(place.name || "");
  const road = (place.roadAddress || place.address || "").trim();

  const lines: string[] = [];
  if (road) lines.push(`주소: ${road}`);

  if (station) lines.push(`- ${station} 인근 (도보 이동 기준, 네이버 길찾기에서 최단 경로 확인)`);
  else lines.push(`- 네이버 지도 ‘길찾기’로 출발지 기준 경로를 확인해 주세요.`);

  lines.push(`- 건물 입구/층수는 ‘사진’과 ‘지도’에서 함께 확인 권장`);
  lines.push(`- 주차 가능 여부는 방문 전 문의 권장`);
  return lines.join("\n");
}

function extractStationFromName(name: string) {
  const m = name.match(/([가-힣A-Za-z]+역)/);
  return m?.[1] ?? null;
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

    // 가격이 있으면만 sanity check
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
