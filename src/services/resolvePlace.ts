function extractPlaceIdFromNaverMapUrl(url: string): string | null {
  const u = (url || "").trim();

  // 예: https://map.naver.com/p/entry/place/1443688242
  // 예: https://map.naver.com/v5/entry/place/1443688242
  let m = u.match(/\/entry\/place\/(\d+)/);
  if (m?.[1]) return m[1];

  m = u.match(/\/v5\/entry\/place\/(\d+)/);
  if (m?.[1]) return m[1];

  // 혹시 query에 들어오는 케이스 방어
  m = u.match(/[?&]placeId=(\d+)/i);
  if (m?.[1]) return m[1];

  return null;
}

// resolvePlace 내부에서, input이 URL일 때 최우선으로 처리
function normalizeToMobilePlaceHome(url: string): { placeId: string; placeUrl: string } | null {
  const placeId = extractPlaceIdFromNaverMapUrl(url);
  if (!placeId) return null;

  // ✅ map 페이지를 긁지 말고 m.place로 직행
  return {
    placeId,
    placeUrl: `https://m.place.naver.com/place/${placeId}/home`,
  };
}
