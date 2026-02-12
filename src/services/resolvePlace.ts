// src/services/resolvePlace.ts

export type ResolvedPlace = {
  placeId: string | null;
  placeUrl: string;
  confidence: number;
};

export async function resolvePlace(input: any, _options?: any): Promise<ResolvedPlace> {
  const rawUrl: string = input?.placeUrl || input?.url || input?.value || "";

  const placeId = extractPlaceId(rawUrl);

  if (placeId) {
    return {
      placeId,
      placeUrl: `https://m.place.naver.com/place/${placeId}/home`,
      confidence: 1.0
    };
  }

  // placeId를 못 찾으면, 일단 입력 URL을 그대로 던지되 confidence 낮게
  // (원하면 여기서 "throw"로 강제 실패로 바꿔도 됨)
  return {
    placeId: null,
    placeUrl: rawUrl,
    confidence: 0.2
  };
}

function extractPlaceId(url: string): string | null {
  if (!url) return null;

  let m = url.match(/\/entry\/place\/(\d+)/);
  if (m?.[1]) return m[1];

  m = url.match(/\/v5\/entry\/place\/(\d+)/);
  if (m?.[1]) return m[1];

  m = url.match(/\/place\/(\d+)/);
  if (m?.[1]) return m[1];

  m = url.match(/[?&]placeId=(\d+)/i);
  if (m?.[1]) return m[1];

  return null;
}
