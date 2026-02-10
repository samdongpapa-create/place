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

  // ✅ 1) directions: 주소 없어도 "역명 힌트"만 있으면 무조건 생성
  if (!place.directions || place.directions.trim().length < 3) {
    const auto = autoDirections(place);
    if (auto) place.directions = auto;
  }

  // ✅ 2) 사진이 비었으면 /photo 한번 더
  if (!place.photos?.count) {
    const photoUrl = `${base}/photo`;
    try {
      const fetched = await fetchPlaceHtml(photoUrl);
      const parsed = parsePlaceFromHtml(fetched.html, fetched.finalUrl);
      const mergedCount = parsed?.photos?.count;

      if (typeof mergedCount === "number" && mergedCount > 0) {
        place.photos = { count: mergedCount };
      } else {
        const guessed = guessPhotoCountFromHtml(fetched.html);
        if (typeof guessed === "number" && guessed > 0) place.photos = { count: guessed };
      }
    } catch {
      // 조용히 패스
    }
  }

  // ✅ 3) 메뉴 비었으면 /price /menu /booking 순서로 시도
  if (!place.menus || place.menus.length === 0) {
    const candidates = [`${base}/price`, `${base}/menu`, `${base}/booking`];

    for (const url of candidates) {
      try {
        const fetched = await fetchPlaceHtml(url);
        const parsed = parsePlaceFromHtml(fetched.html, fetched.finalUrl);

        // (a) 파서에서 menus가 나오면 우선 적용 + 강력 필터링
        if (parsed?.menus && parsed.menus.length > 0) {
          const cleaned = cleanMenus(parsed.menus);
          if (cleaned.length > 0) {
            place.menus = cleaned;
            break;
          }
        }

        // (b) fallback: HTML 정규식 추출(단, 숫자/주차요금 제거)
        const guessed = guessMenusFromHtml(fetched.html);
        const cleaned2 = cleanMenus(guessed);
        if (cleaned2.length > 0) {
          place.menus = cleaned2;
          break;
        }
      } catch {
        // 다음 후보로
      }
    }
  } else {
    // 이미 menus가 있으면 한번 정리만
    place.menus = cleanMenus(place.menus);
  }

  return place;
}

function basePlaceUrl(url: string) {
  return url.replace(/\/(home|photo|review|price|menu|booking)(\?.*)?$/i, "");
}

/**
 * ✅ 주소 없어도 directions 생성해서 missingFields에서 빠지게 하는 게 목적
 * - 역명 힌트가 있으면 더 구체적으로
 */
function autoDirections(place: PlaceProfileLike): string | null {
  const road = (place.roadAddress || place.address || "").trim();
  const station = extractStationFromName(place.name || "");

  const lines: string[] = [];

  if (road) lines.push(`주소: ${road}`);

  if (station) {
    lines.push(`- ${station} 인근 (도보 이동 기준, 네이버 길찾기에서 최단 경로 확인)`);
  } else {
    lines.push(`- 네이버 지도 ‘길찾기’로 출발지 기준 경로를 확인해 주세요.`);
  }

  lines.push(`- 건물 입구/층수는 ‘사진’과 ‘지도’에서 함께 확인 권장`);
  lines.push(`- 주차 가능 여부는 방문 전 문의 권장`);

  return lines.join("\n");
}

function extractStationFromName(name: string) {
  const m = name.match(/([가-힣A-Za-z]+역)/);
  return m?.[1] ?? null;
}

function guessPhotoCountFromHtml(html: string): number | null {
  // "사진 123" 형태
  let m = html.match(/사진\s*([0-9][0-9,]*)/);
  if (m?.[1]) {
    const n = Number(m[1].replace(/,/g, ""));
    if (Number.isFinite(n)) return n;
  }

  // "포토 123" 형태
  m = html.match(/포토\s*([0-9][0-9,]*)/);
  if (m?.[1]) {
    const n = Number(m[1].replace(/,/g, ""));
    if (Number.isFinite(n)) return n;
  }

  return null;
}

/**
 * ✅ HTML fallback 메뉴 추출
 * - 숫자만 있는 이름(10, 12…) 제거
 * - "초과 10분당", "최초 30분" 같은 주차요금 문구 제거
 * - 한글/영문이 최소 1자 이상 포함된 이름만 허용
 */
function guessMenusFromHtml(html: string): Menu[] {
  const out: Menu[] = [];

  // 예: "커트 30,000원" "염색 120000원"
  const re = /([가-힣A-Za-z][가-힣A-Za-z0-9\s·()]{1,40})\s*([0-9][0-9,]{2,8})\s*원/g;
  let m: RegExpExecArray | null;

  const seen = new Set<string>();
  while ((m = re.exec(html))) {
    const name = m[1].trim().replace(/\s+/g, " ");
    const price = Number(m[2].replace(/,/g, ""));

    if (!name || !Number.isFinite(price)) continue;

    // 주차/시간요금 필터
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
    /^[0-9]+$/.test(name.trim()) // 숫자만
  );
}

/**
 * ✅ menus 정리(쓰레기 제거)
 * - 이름에 글자가 없는 항목 제거
 * - 주차요금/시간요금 제거
 * - 가격이 너무 작거나(예: 0, 500) 너무 큰 값은 제거 (미용실 시술 기준)
 */
function cleanMenus(menus: Menu[]): Menu[] {
  const out: Menu[] = [];
  const seen = new Set<string>();

  for (const it of menus || []) {
    const name = (it?.name || "").trim();
    const price = typeof it?.price === "number" ? it.price : undefined;

    if (!name) continue;

    // 글자(한글/영문) 최소 1개 있어야 메뉴로 인정
    if (!/[가-힣A-Za-z]/.test(name)) continue;

    if (looksLikeParkingFee(name)) continue;

    // 가격 sanity (미용실 시술 기준 너무 작은 값 제거)
    if (typeof price === "number") {
      if (price < 5000) continue;        // 0, 500, 4000 같은 거 제거
      if (price > 2000000) continue;     // 말도 안되게 큰 값 제거
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
