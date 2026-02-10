// src/services/enrichPlace.ts
import { fetchPlaceHtml } from "./fetchPlace.js";
import { parsePlaceFromHtml } from "./parsePlace.js";

type Menu = { name: string; price?: number; durationMin?: number; note?: string };

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
};

export async function enrichPlace(place: PlaceProfileLike): Promise<PlaceProfileLike> {
  const base = basePlaceUrl(place.placeUrl);
  const baseCandidates = buildBaseCandidates(base, place.placeId);

  // 1) directions
  if (!place.directions || place.directions.trim().length < 3) {
    const auto = autoDirections(place);
    if (auto) place.directions = auto;
  }

  // 2) photos
  if (!place.photos?.count) {
    for (const b of baseCandidates) {
      const url = `${b}/photo`;
      try {
        const fetched = await fetchPlaceHtml(url, { minLength: 120, retries: 1, timeoutMs: 9000 });
        const parsed = parsePlaceFromHtml(fetched.html, fetched.finalUrl);

        const merged = parsed?.photos?.count;
        if (typeof merged === "number" && merged > 0) {
          place.photos = { count: merged };
          break;
        }

        const guessed = guessPhotoCountFromHtmlStrong(fetched.html);
        if (typeof guessed === "number" && guessed > 0) {
          place.photos = { count: guessed };
          break;
        }
      } catch {}
    }
  }

  // 3) menus
  if (!place.menus || place.menus.length === 0) {
    for (const b of baseCandidates) {
      const candidates = [`${b}/price`, `${b}/menu`, `${b}/booking`];

      for (const url of candidates) {
        try {
          const fetched = await fetchPlaceHtml(url, { minLength: 120, retries: 1, timeoutMs: 9000 });
          const parsed = parsePlaceFromHtml(fetched.html, fetched.finalUrl);

          if (parsed?.menus && parsed.menus.length > 0) {
            const cleaned = cleanMenus(parsed.menus);
            if (cleaned.length > 0) {
              place.menus = cleaned;
              return place;
            }
          }

          const guessed = guessMenusFromHtml(fetched.html);
          const cleaned2 = cleanMenus(guessed);
          if (cleaned2.length > 0) {
            place.menus = cleaned2;
            return place;
          }
        } catch {}
      }
    }
  } else {
    place.menus = cleanMenus(place.menus);
  }

  return place;
}

function buildBaseCandidates(base: string, placeId?: string) {
  const out: string[] = [base];
  if (placeId) out.push(`https://m.place.naver.com/hairshop/${placeId}`);
  return Array.from(new Set(out));
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

function guessPhotoCountFromHtmlStrong(html: string): number | null {
  const t = html.match(/사진\s*([0-9][0-9,]*)/);
  if (t?.[1]) {
    const n = Number(t[1].replace(/,/g, ""));
    if (Number.isFinite(n)) return n;
  }
  const urlRe = /(https?:\/\/(?:phinf\.pstatic\.net|search\.pstatic\.net|ldb-phinf\.pstatic\.net)[^"' ]+)/g;
  const matches = html.match(urlRe);
  if (matches?.length) return new Set(matches.map((s) => s.split("?")[0])).size;
  return null;
}

function guessMenusFromHtml(html: string): Menu[] {
  const out: Menu[] = [];
  const re = /([가-힣A-Za-z][가-힣A-Za-z0-9\s·()]{1,40})\s*([0-9][0-9,]{2,8})\s*원/g;

  let m: RegExpExecArray | null;
  const seen = new Set<string>();

  while ((m = re.exec(html))) {
    const name = m[1].trim().replace(/\s+/g, " ");
    const price = Number(m[2].replace(/,/g, ""));
    if (!name || !Number.isFinite(price)) continue;
    if (looksLikeParkingFee(name)) continue;

    const key = `${name}:${price}`;
    if (seen.has(key)) continue;
    seen.add(key);

    out.push({ name, price });
    if (out.length >= 30) break;
  }
  return out;
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
