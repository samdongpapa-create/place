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

  // ✅ 1) directions: 주소 없어도 "역명"만 있으면 생성
  if (!place.directions || place.directions.trim().length < 3) {
    const auto = autoDirections(place);
    if (auto) place.directions = auto;
  }

  // ✅ 2) photos: /photo 탭에서 먼저 시도 (minLength 완화)
  if (!place.photos?.count) {
    const photoUrl = `${base}/photo`;
    try {
      const fetched = await fetchPlaceHtml(photoUrl, { minLength: 300 }); // 🔥 완화
      const parsed = parsePlaceFromHtml(fetched.html, fetched.finalUrl);

      const mergedCount = parsed?.photos?.count;
      if (typeof mergedCount === "number" && mergedCount > 0) {
        place.photos = { count: mergedCount };
      } else {
        // ✅ 이미지 URL 개수로 추정
        const guessed = guessPhotoCountFromHtmlStrong(fetched.html);
        if (typeof guessed === "number" && guessed > 0) place.photos = { count: guessed };
      }
    } catch {
      // 조용히 패스
    }
  }

  // ✅ 3) menus: /price /menu /booking 순서로 (minLength 완화)
  if (!place.menus || place.menus.length === 0) {
    const candidates = [`${base}/price`, `${base}/menu`, `${base}/booking`];

    for (const url of candidates) {
      try {
        const fetched = await fetchPlaceHtml(url, { minLength: 300 }); // 🔥 완화
        const parsed = parsePlaceFromHtml(fetched.html, fetched.finalUrl);

        if (parsed?.menus && parsed.menus.length > 0) {
          const cleaned = cleanMenus(parsed.menus);
          if (cleaned.length > 0) {
            place.menus = cleaned;
            break;
          }
        }

        // ✅ fallback A: "커트 30,000원" 등 텍스트 패턴
        const guessed = guessMenusFromHtml(fetched.html);
        const cleaned2 = cleanMenus(guessed);
        if (cleaned2.length > 0) {
          place.menus = cleaned2;
          break;
        }

        // ✅ fallback B (핵심): Next.js __NEXT_DATA__ JSON 안에서 메뉴/가격 추출
        const guessed3 = guessMenusFromNextData(fetched.html);
        const cleaned3 = cleanMenus(guessed3);
        if (cleaned3.length > 0) {
          place.menus = cleaned3;
          break;
        }
      } catch {
        // 다음 후보로
      }
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

function guessPhotoCountFromHtmlStrong(html: string): number | null {
  // 1) "사진 123" 텍스트
  const t = html.match(/사진\s*([0-9][0-9,]*)/);
  if (t?.[1]) {
    const n = Number(t[1].replace(/,/g, ""));
    if (Number.isFinite(n)) return n;
  }

  // 2) 이미지 CDN URL 카운트로 추정 (네이버/포토 CDN)
  const urlRe = /(https?:\/\/(?:phinf\.pstatic\.net|search\.pstatic\.net|ldb-phinf\.pstatic\.net)[^"' ]+)/g;
  const matches = html.match(urlRe);
  if (matches && matches.length > 0) {
    // 중복 제거
    const uniq = new Set(matches.map((s) => s.split("?")[0]));
    return uniq.size;
  }

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

/**
 * ✅ Next.js __NEXT_DATA__ 안에 "메뉴/가격"이 들어있는데,
 * HTML 텍스트에 "원"으로 안 박혀서 정규식이 실패하는 케이스 대응.
 */
function guessMenusFromNextData(html: string): Menu[] {
  const out: Menu[] = [];
  const seen = new Set<string>();

  // __NEXT_DATA__ 추출
  const m = html.match(/<script[^>]+id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i);
  if (!m?.[1]) return out;

  let json: any;
  try {
    json = JSON.parse(m[1]);
  } catch {
    return out;
  }

  // 가격 키 후보 (네이버 내부 구조가 바뀌어도 최대한 버티도록 넓게)
  const priceKeys = ["price", "salePrice", "amount", "value", "minPrice", "maxPrice"];
  const nameKeys = ["name", "menuName", "title"];

  const toNumber = (v: any): number | undefined => {
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string") {
      const s = v.replace(/,/g, "");
      const n = Number(s);
      if (Number.isFinite(n)) return n;
    }
    return undefined;
  };

  const isObj = (x: any) => x && typeof x === "object" && !Array.isArray(x);

  const pickName = (obj: any): string | undefined => {
    for (const k of nameKeys) {
      if (typeof obj?.[k] === "string" && obj[k].trim()) return obj[k].trim();
    }
    return undefined;
  };

  const pickPrice = (obj: any): number | undefined => {
    for (const k of priceKeys) {
      const v = obj?.[k];
      const n = toNumber(v);
      if (typeof n === "number") return n;

      // price가 { value: 24000 } 같은 구조일 수 있음
      if (isObj(v)) {
        for (const kk of priceKeys.concat(["won", "krw"])) {
          const nn = toNumber(v?.[kk]);
          if (typeof nn === "number") return nn;
        }
      }
    }
    return undefined;
  };

  const walk = (node: any) => {
    if (!node) return;

    if (Array.isArray(node)) {
      for (const it of node) walk(it);
      return;
    }

    if (isObj(node)) {
      // 1) 메뉴로 보이는 오브젝트 패턴: name + price 조합
      const name = pickName(node);
      const price = pickPrice(node);

      if (name && (typeof price === "number")) {
        if (!looksLikeParkingFee(name)) {
          const key = `${name}:${price}`;
          if (!seen.has(key)) {
            seen.add(key);
            out.push({ name: name.replace(/\s+/g, " "), price });
          }
        }
      }

      // 2) durationMin 같이 힌트가 있을 수도 있으니 note로 담기
      // (추후 필요하면 여기 확장)

      // 3) 재귀
      for (const k of Object.keys(node)) {
        walk(node[k]);
      }
    }
  };

  walk(json);

  // 너무 잡음이 많을 수 있으니, 미용실 대표 30개까지만
  return out.slice(0, 30);
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

    // 미용실 기준: 너무 작은 금액 제거
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
