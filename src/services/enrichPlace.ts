// src/services/enrichPlace.ts
import { fetchPlaceHtml } from "./fetchPlace.js";
import { parsePlaceFromHtml } from "./parsePlace.js";
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
  keywords?: string[];       // ✅ 기존 대표키워드(실제 노출값)
  menus?: Menu[];
  reviews?: any;
  photos?: { count?: number };
  _menuDebug?: any;
  _keywordDebug?: any;       // ✅ 키워드 디버그
};

export async function enrichPlace(place: PlaceProfileLike): Promise<PlaceProfileLike> {
  const base = basePlaceUrl(place.placeUrl);

  // ✅ directions 자동 생성 유지
  if (!place.directions || place.directions.trim().length < 3) {
    const auto = autoDirections(place);
    if (auto) place.directions = auto;
  }

  // ✅ 업종 판단
  const isHair = isHairSalon(place);

  // =========================
  // 0) ✅ "기존 대표키워드" 확보가 최우선
  //    - parsePlaceFromHtml이 못 뽑는 케이스가 많아서,
  //      없으면 /home을 Playwright로 열고 GraphQL+DOM에서 추출
  // =========================
  if (!place.keywords || place.keywords.length === 0) {
    try {
      // home을 대상으로
      const homeUrl = `${base}/home`;
      const kw = await fetchExistingKeywordsViaPlaywright(homeUrl);
      if (kw.keywords.length) {
        place.keywords = kw.keywords.slice(0, 15);
      }
      place._keywordDebug = kw.debug;
    } catch (e: any) {
      place._keywordDebug = { error: e?.message ?? "keyword pw failed" };
    }
  }

  // =========================
  // 1) 메뉴(미용실이면 /price 중심)
  // =========================
  if (!place.menus || place.menus.length === 0) {
    const debug: any = { isHair, chain: [] as any[] };

    if (isHair) {
      const priceUrl = `${base}/price`;

      // (A) /price HTML 파싱
      try {
        const fetched = await fetchPlaceHtml(priceUrl, { minLength: 120 });
        const parsed = parsePlaceFromHtml(fetched.html, fetched.finalUrl);
        const cleaned = parsed?.menus ? cleanMenus(parsed.menus as any) : [];
        debug.chain.push({ step: "hair-price-html", url: priceUrl, len: fetched.html.length, menus: cleaned.length });

        if (cleaned.length) {
          place.menus = cleaned;
          place._menuDebug = { via: "hair-price-html", ...debug };
          return place;
        }
      } catch (e: any) {
        debug.chain.push({ step: "hair-price-html", url: priceUrl, error: e?.message ?? "price html failed" });
      }

      // (B) /price Playwright(GraphQL/DOM)
      try {
        const pw = await fetchMenusViaPlaywright(priceUrl);
        debug.chain.push({ step: "hair-price-pw", url: priceUrl, ...pw.debug, menus: pw.menus.length });

        if (pw.menus.length) {
          place.menus = cleanMenus(pw.menus);
          place._menuDebug = { via: "hair-price-pw", ...debug };
          return place;
        }
      } catch (e: any) {
        debug.chain.push({ step: "hair-price-pw", url: priceUrl, error: e?.message ?? "price pw failed" });
      }

      // (C) /booking 폴백
      const bookingUrl = `${base}/booking`;
      try {
        const pw = await fetchMenusViaPlaywright(bookingUrl);
        debug.chain.push({ step: "hair-booking-pw", url: bookingUrl, ...pw.debug, menus: pw.menus.length });

        if (pw.menus.length) {
          place.menus = cleanMenus(pw.menus);
          place._menuDebug = { via: "hair-booking-pw", ...debug };
          return place;
        }
      } catch (e: any) {
        debug.chain.push({ step: "hair-booking-pw", url: bookingUrl, error: e?.message ?? "booking pw failed" });
      }

      place._menuDebug = { via: "hair-none", ...debug };
      return place;
    }

    // 일반 업종
    for (const url of [`${base}/menu`, `${base}/home`, `${base}/price`]) {
      try {
        const fetched = await fetchPlaceHtml(url, { minLength: 120 });
        const parsed = parsePlaceFromHtml(fetched.html, fetched.finalUrl);
        const cleaned = parsed?.menus ? cleanMenus(parsed.menus as any) : [];

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

    const bookingUrl = `${base}/booking`;
    try {
      const pw = await fetchMenusViaPlaywright(bookingUrl);
      debug.chain.push({ step: "pw", url: bookingUrl, ...pw.debug, menus: pw.menus.length });

      if (pw.menus.length) {
        place.menus = cleanMenus(pw.menus);
        place._menuDebug = { via: "pw", ...debug };
        return place;
      }
    } catch (e: any) {
      debug.chain.push({ step: "pw", url: bookingUrl, error: e?.message ?? "pw failed" });
    }

    place._menuDebug = { via: "none", ...debug };
  } else {
    place.menus = cleanMenus(place.menus);
  }

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
