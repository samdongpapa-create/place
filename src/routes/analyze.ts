// src/services/resolvePlace.ts
import type { Plan } from "../industry/types.js";

type Input =
  | { mode: "place_url"; placeUrl: string }
  | { mode: "biz_search"; name: string; address: string; phone?: string };

type Options = {
  plan: Plan;
  language?: "ko";
  depth?: "standard" | "deep";
};

export type ResolvedPlace = {
  placeUrl: string;
  confidence: number;
  placeId?: string | null;
  rawPlace?: any | null;
};

/**
 * 목표:
 * - 사용자가 어떤 형태 URL을 넣어도 placeId는 뽑고,
 * - 원래 경로가 hairshop이면 hairshop을 유지(가장 중요)
 * - 아니면 기본은 place/{id}/home
 */
export async function resolvePlace(input: Input, _options: Options): Promise<ResolvedPlace> {
  if (input.mode === "biz_search") {
    throw new Error("biz_search는 아직 구현되지 않았습니다. place_url 모드로 테스트해주세요.");
  }

  const original = (input.placeUrl || "").trim();
  if (!original) throw new Error("placeUrl이 비어있습니다.");

  const placeId = extractPlaceId(original);

  // ✅ hairshop URL이면 절대 /place로 바꾸지 말고 hairshop 그대로 유지
  if (placeId && isHairshopUrl(original)) {
    return {
      placeId,
      placeUrl: ensureHomePath(original), // /home 붙여줌
      confidence: 0.95,
      rawPlace: null
    };
  }

  // ✅ placeId만 있으면 기본은 /place/{id}/home
  if (placeId) {
    return {
      placeId,
      placeUrl: toMobilePlaceHome(placeId),
      confidence: 0.9,
      rawPlace: null
    };
  }

  // ✅ m.place 형태면 /home 붙여보기
  if (isMobilePlaceUrl(original) || isMobileHairshopUrl(original)) {
    const normalized = ensureHomePath(original);
    return {
      placeId: extractPlaceId(normalized),
      placeUrl: normalized,
      confidence: 0.7,
      rawPlace: null
    };
  }

  // ✅ 그 외
  return {
    placeId: null,
    placeUrl: original,
    confidence: 0.4,
    rawPlace: null
  };
}

function toMobilePlaceHome(placeId: string) {
  return `https://m.place.naver.com/place/${placeId}/home`;
}

function isHairshopUrl(url: string) {
  return /m\.place\.naver\.com\/hairshop\/\d+/i.test(url);
}
function isMobileHairshopUrl(url: string) {
  return /https?:\/\/m\.place\.naver\.com\/hairshop\/\d+/i.test(url);
}
function isMobilePlaceUrl(url: string) {
  return /https?:\/\/m\.place\.naver\.com\/place\/\d+/i.test(url);
}

function ensureHomePath(url: string) {
  // 이미 탭이 있으면 유지 (home/booking/review/price/menu/photo 등)
  if (/\/(home|photo|review|price|menu|booking)($|\?)/i.test(url)) return url;

  // /place/{id} or /hairshop/{id} 뒤에 /home 붙임
  if (/\/(place|hairshop)\/\d+\/?($|\?)/i.test(url)) {
    return url.replace(/\/(place|hairshop)\/(\d+)\/?(\?.*)?$/i, "/$1/$2/home$3");
  }
  return url;
}

/**
 * 다양한 URL에서 placeId 추출
 */
function extractPlaceId(url: string): string | null {
  // 1) map.naver.com/p/entry/place/{id}
  let m = url.match(/map\.naver\.com\/p\/entry\/place\/(\d+)/i);
  if (m?.[1]) return m[1];

  // 2) m.place.naver.com/place/{id}/...
  m = url.match(/m\.place\.naver\.com\/place\/(\d+)/i);
  if (m?.[1]) return m[1];

  // 3) m.place.naver.com/hairshop/{id}/...
  m = url.match(/m\.place\.naver\.com\/hairshop\/(\d+)/i);
  if (m?.[1]) return m[1];

  // 4) map.naver.com/v5/entry/place/{id}
  m = url.match(/map\.naver\.com\/.*\/place\/(\d+)/i);
  if (m?.[1]) return m[1];

  // 5) 최후수단: place 인접 숫자
  m = url.match(/place[=/](\d{6,})/i);
  if (m?.[1]) return m[1];

  return null;
}
