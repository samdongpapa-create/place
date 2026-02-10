// src/services/enrichPlace.ts
import { fetchPlaceHtml } from "./fetchPlace.js";
import { parsePlaceFromHtml } from "./parsePlace.js";

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
  menus?: Array<{ name: string; price?: number; durationMin?: number; note?: string }>;
  reviews?: any;
  photos?: { count?: number };
};

export async function enrichPlace(place: PlaceProfileLike): Promise<PlaceProfileLike> {
  const base = basePlaceUrl(place.placeUrl);

  // ✅ 1) directions 자동 생성 (주소 + 역명 힌트)
  if (!place.directions || place.directions.trim().length < 3) {
    const auto = autoDirections(place);
    if (auto) place.directions = auto;
  }

  // ✅ 2) 사진이 비었으면 /photo 한번 더 긁어보기
  if (!place.photos?.count) {
    const photoUrl = `${base}/photo`;
    try {
      const fetched = await fetchPlaceHtml(photoUrl);
      const parsed = parsePlaceFromHtml(fetched.html, fetched.finalUrl);
      const mergedCount = parsed?.photos?.count;
      if (typeof mergedCount === "number" && mergedCount > 0) {
        place.photos = { count: mergedCount };
      } else {
        // HTML에서 "사진 123" 같은 텍스트로라도 추정
        const guessed = guessPhotoCountFromHtml(fetched.html);
        if (typeof guessed === "number" && guessed > 0) place.photos = { count: guessed };
      }
    } catch {
      // 조용히 패스
    }
  }

  // ✅ 3) 메뉴(미용실은 priceList) 비었으면 /price 또는 /menu 한번 더
  if (!place.menus || place.menus.length === 0) {
    const candidates = [`${base}/price`, `${base}/menu`, `${base}/booking`];
    for (const url of candidates) {
      try {
        const fetched = await fetchPlaceHtml(url);
        const parsed = parsePlaceFromHtml(fetched.html, fetched.finalUrl);
        if (parsed?.menus && parsed.menus.length > 0) {
          place.menus = parsed.menus;
          break;
        } else {
          // 최후: HTML에서 "원" 패턴으로 메뉴 추출
          const guessed = guessMenusFromHtml(fetched.html);
          if (guessed.length > 0) {
            place.menus = guessed;
            break;
          }
        }
      } catch {
        // 다음 후보로 계속
      }
    }
  }

  return place;
}

function basePlaceUrl(url: string) {
  // https://m.place.naver.com/hairshop/144.../home -> .../hairshop/144...
  return url.replace(/\/(home|photo|review|price|menu|booking)(\?.*)?$/i, "");
}

function autoDirections(place: PlaceProfileLike): string | null {
  const road = place.roadAddress || place.address;
  if (!road) return null;

  // 이름에 “서대문역점/홍대입구역점” 같은 힌트가 있으면 뽑아냄
  const station = extractStationFromName(place.name || "");

  const lines: string[] = [];
  lines.push(`주소: ${road}`);

  if (station) {
    lines.push(`- ${station} 인근 (도보 이동 기준, 지도에서 최단 경로 확인 권장)`);
  }

  lines.push(`- 건물/층수 및 입구 위치는 네이버 지도 ‘길찾기’로 확인해 주세요.`);
  lines.push(`- 주차 가능 여부는 방문 전 문의를 권장합니다.`);

  return lines.join("\n");
}

function extractStationFromName(name: string) {
  // “서대문역점”, “서대문역”, “강남역점” 등
  // 우선 “OO역”만 추출
  const m = name.match(/([가-힣A-Za-z]+역)/);
  return m?.[1] ?? null;
}

function guessPhotoCountFromHtml(html: string): number | null {
  // "사진 123" 같은 텍스트를 최대한 잡기
  const m = html.match(/사진\s*([0-9][0-9,]*)/);
  if (!m?.[1]) return null;
  const n = Number(m[1].replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

function guessMenusFromHtml(html: string): Array<{ name: string; price?: number }> {
  // 아주 러프한 fallback: "컷 30,000원" 같은 텍스트 패턴
  const out: Array<{ name: string; price?: number }> = [];
  const re = /([가-힣A-Za-z0-9\s·()]{2,30})\s*([0-9][0-9,]{2,8})\s*원/g;
  let m: RegExpExecArray | null;

  const seen = new Set<string>();
  while ((m = re.exec(html))) {
    const name = m[1].trim().replace(/\s+/g, " ");
    const price = Number(m[2].replace(/,/g, ""));
    if (!name || !Number.isFinite(price)) continue;
    const key = `${name}:${price}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ name, price });
    if (out.length >= 20) break;
  }
  return out;
}
