import type { AnalyzeInput, AnalyzeOptions, PlaceProfile } from "../core/types.js";
import { cacheGet, cacheSet } from "../core/cache.js";
import { httpJson } from "../core/http.js";

type ResolveResult = {
  placeUrl: string;
  confidence: number;
  rawPlace?: PlaceProfile; // 이미 충분하면 바로 반환(옵션)
};

export async function resolvePlace(input: AnalyzeInput, options: AnalyzeOptions): Promise<ResolveResult> {
  if (input.mode === "place_url") {
    const placeUrl = normalizePlaceUrl(input.placeUrl);
    return { placeUrl, confidence: 0.95 };
  }

  // biz_search: 상호+주소로 후보 찾기 → placeUrl 만들기
  // 1) 캐시
  const key = `resolve:${input.name}:${input.address}`;
  const cached = cacheGet<ResolveResult>(key);
  if (cached) return cached;

  // 2) 네이버 지역검색 API(권장) - 없으면 낮은 confidence로 “placeUrl 미확정” 처리 가능
  // 공식 문서: https://developers.naver.com/docs/serviceapi/search/local/local.md
  // 응답에는 placeId가 직접 없을 수 있어서, 여기서는 "title/roadAddress/mapx/mapy" 기반으로 후보를 만들고
  // 최종적으로는 사용자가 placeUrl을 선택하도록 UI 보완하거나, 지도 검색 결과에서 placeUrl 추출 로직을 추가해야 함.
  const id = process.env.NAVER_CLIENT_ID;
  const secret = process.env.NAVER_CLIENT_SECRET;

  if (!id || !secret) {
    // MVP fallback: biz_search는 placeUrl 확정 못하면 에러로 돌려도 되고,
    // UI에서 "플레이스 URL을 입력해달라"로 유도해도 됨.
    throw new Error("NAVER_API_KEYS_MISSING: set NAVER_CLIENT_ID / NAVER_CLIENT_SECRET");
  }

  const query = encodeURIComponent(`${input.name} ${simplifyAddress(input.address)}`);
  const url = `https://openapi.naver.com/v1/search/local.json?query=${query}&display=5&start=1&sort=random`;

  const data = await httpJson<any>(url, {
    "X-Naver-Client-Id": id,
    "X-Naver-Client-Secret": secret
  });

  const items = Array.isArray(data?.items) ? data.items : [];
  if (items.length === 0) throw new Error("NO_CANDIDATE_FOUND");

  // 가장 주소가 근접한 후보를 1개 선택(간단 룰)
  const pick = pickBestCandidate(items, input.address);

  // ⚠️ 여기서 중요한 점:
  // Local Search API 응답은 m.place.naver.com URL을 직접 주지 않는 경우가 많음.
  // 실전에서는:
  // - (A) 후보의 'link'가 존재하면 그걸 사용하거나
  // - (B) mapx/mapy + 이름으로 지도 검색 페이지를 한번 더 조회해서 placeId를 얻거나
  // - (C) 사용자에게 후보 리스트를 보여주고 선택하게 하거나
  // 중 하나를 해야 해.
  // MVP는 (A) link가 있으면 사용, 없으면 "선택 필요"로 돌리는 구조 추천.
  const link = (pick?.link ?? "").trim();
  if (link && link.includes("place.naver.com")) {
    const placeUrl = normalizePlaceUrl(link);
    const result = { placeUrl, confidence: 0.75 };
    cacheSet(key, result);
    return result;
  }

  throw new Error("CANDIDATE_NEEDS_SELECTION: provide placeUrl or enhance resolver");
}

function normalizePlaceUrl(url: string) {
  // desktop place도 m.place로 맞추기
  const u = url.replace("https://place.naver.com", "https://m.place.naver.com");
  return u.split("?")[0];
}

function simplifyAddress(addr: string) {
  // 너무 길면 검색 정확도 떨어져서 "구/동"까지만 대충
  return addr.replace(/\d{2,}-\d{1,}/g, "").trim();
}

function pickBestCandidate(items: any[], targetAddress: string) {
  const t = targetAddress.replace(/\s+/g, "");
  let best = items[0];
  let bestScore = -1;

  for (const it of items) {
    const road = (it.roadAddress ?? "").replace(/\s+/g, "");
    const addr = (it.address ?? "").replace(/\s+/g, "");
    const score =
      (road && t.includes(road.slice(0, 6)) ? 2 : 0) +
      (addr && t.includes(addr.slice(0, 6)) ? 1 : 0);
    if (score > bestScore) {
      bestScore = score;
      best = it;
    }
  }
  return best;
}
