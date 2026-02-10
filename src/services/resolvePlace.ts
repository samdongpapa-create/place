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

export async function resolvePlace(input: Input, _options: Options): Promise<ResolvedPlace> {
  if (input.mode === "biz_search") {
    throw new Error("biz_search는 아직 구현되지 않았습니다. place_url 모드로 테스트해주세요.");
  }

  const original = (input.placeUrl || "").trim();
  if (!original) throw new Error("placeUrl이 비어있습니다.");

  const placeId = extractPlaceId(original);

  // ✅ hairshop은 유지
  if (placeId && /m\.place\.naver\.com\/hairshop\/\d+/i.test(original)) {
    return { placeId, placeUrl: ensureHomePath(original), confidence: 0.95, rawPlace: null };
  }

  // ✅ placeId만 있으면 기본 place home
  if (placeId) {
    return { placeId, placeUrl: `https://m.place.naver.com/place/${placeId}/home`, confidence: 0.9, rawPlace: null };
  }

  // ✅ m.place이면 /home 보정
  if (/https?:\/\/m\.place\.naver\.com\/(place|hairshop)\//i.test(original)) {
    const normalized = ensureHomePath(original);
    return { placeId: extractPlaceId(normalized), placeUrl: normalized, confidence: 0.7, rawPlace: null };
  }

  return { placeId: null, placeUrl: original, confidence: 0.4, rawPlace: null };
}

function ensureHomePath(url: string) {
  if (/\/(home|photo|review|price|menu|booking)($|\?)/i.test(url)) return url;
  if (/\/(place|hairshop)\/\d+\/?($|\?)/i.test(url)) {
    return url.replace(/\/(place|hairshop)\/(\d+)\/?(\?.*)?$/i, "/$1/$2/home$3");
  }
  return url;
}

function extractPlaceId(url: string): string | null {
  let m = url.match(/map\.naver\.com\/p\/entry\/place\/(\d+)/i);
  if (m?.[1]) return m[1];

  m = url.match(/m\.place\.naver\.com\/place\/(\d+)/i);
  if (m?.[1]) return m[1];

  m = url.match(/m\.place\.naver\.com\/hairshop\/(\d+)/i);
  if (m?.[1]) return m[1];

  m = url.match(/map\.naver\.com\/.*\/place\/(\d+)/i);
  if (m?.[1]) return m[1];

  m = url.match(/place[=/](\d{6,})/i);
  if (m?.[1]) return m[1];

  return null;
}
