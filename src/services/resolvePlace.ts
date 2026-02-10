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
 * ✅ 핵심 목표:
 * - 사용자가 어떤 형태의 네이버 지도/플레이스 URL을 넣어도
 * - 최종적으로는 "m.place.naver.com/place/{id}/home" 로 통일
 * - 그래야 parsePlaceFromHtml가 안정적으로 동작함
 */
export async function resolvePlace(input: Input, _options: Options): Promise<ResolvedPlace> {
  if (input.mode === "biz_search") {
    // MVP: biz_search는 추후 검색 API/크롤링으로 구현
    // 지금은 구현 안 했으니 명확히 에러를 던져서 UI에 그대로 보이게 함
    throw new Error("biz_search는 아직 구현되지 않았습니다. place_url 모드로 테스트해주세요.");
  }

  const original = (input.placeUrl || "").trim();
  if (!original) throw new Error("placeUrl이 비어있습니다.");

  const placeId = extractPlaceId(original);

  // ✅ placeId 추출 성공 → m.place 홈으로 정규화
  if (placeId) {
    return {
      placeId,
      placeUrl: toMobilePlaceHome(placeId),
      confidence: 0.95,
      rawPlace: null
    };
  }

  // ✅ placeId 추출 실패 → 그래도 m.place 형태면 /home 붙여보기
  if (isMobilePlaceUrl(original)) {
    const normalized = ensureHomePath(original);
    return {
      placeId: null,
      placeUrl: normalized,
      confidence: 0.7,
      rawPlace: null
    };
  }

  // ✅ 그 외 케이스는 그대로 반환(파서 실패 가능)
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

function isMobilePlaceUrl(url: string) {
  return /https?:\/\/m\.place\.naver\.com\/place\/\d+/i.test(url);
}

function ensureHomePath(url: string) {
  // 이미 /home, /booking, /review 등일 수 있으니 /home만 강제하지는 않되
  // place/{id}까지만 있는 경우 /home 붙임
  if (/\/home($|\?)/i.test(url)) return url;
  if (/\/place\/\d+\/($|\?)/i.test(url)) return url.replace(/\/place\/(\d+)\/?(\?.*)?$/i, "/place/$1/home$2");
  if (/\/place\/\d+($|\?)/i.test(url)) return url.replace(/\/place\/(\d+)($|\?.*)/i, "/place/$1/home$2");
  return url;
}

/**
 * ✅ 다양한 URL에서 placeId를 뽑아내는 함수
 */
function extractPlaceId(url: string): string | null {
  // 1) map.naver.com/p/entry/place/{id}
  // 예: https://map.naver.com/p/entry/place/1443688242
  let m = url.match(/map\.naver\.com\/p\/entry\/place\/(\d+)/i);
  if (m?.[1]) return m[1];

  // 2) m.place.naver.com/place/{id}/...
  // 예: https://m.place.naver.com/place/1443688242/home
  m = url.match(/m\.place\.naver\.com\/place\/(\d+)/i);
  if (m?.[1]) return m[1];

  // 3) map.naver.com/v5/entry/place/{id} (가끔 나옴)
  m = url.match(/map\.naver\.com\/.*\/place\/(\d+)/i);
  if (m?.[1]) return m[1];

  // 4) 혹시 URL 어딘가에 placeId 숫자만 있는 경우(최후 수단)
  // 너무 공격적으로 잡으면 오탐 가능해서 "place" 인접 케이스만 허용
  m = url.match(/place[=/](\d{6,})/i);
  if (m?.[1]) return m[1];

  return null;
}
