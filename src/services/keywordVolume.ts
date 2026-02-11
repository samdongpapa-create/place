// src/services/keywordVolume.ts
// ✅ 네이버 키워드광고(검색량) 연동용
// - 지금은 빌드 에러 방지 + 인터페이스 고정 목적 (스텁)
// - 추후 Naver SearchAd API를 붙이면 여기만 교체하면 됨

export type KeywordVolume = {
  keyword: string;
  monthlyPc?: number;
  monthlyMobile?: number;
  monthlyTotal?: number;
  source?: "stub" | "naver-searchad";
};

export type KeywordVolumeMap = Record<
  string,
  { monthlyPc?: number; monthlyMobile?: number; monthlyTotal?: number; source?: "stub" | "naver-searchad" }
>;

function norm(k: string) {
  return (k || "").trim();
}

/**
 * ✅ enrichPlace.ts가 기대하는 export #1
 * 키워드 배열을 받아서 "keyword -> volume" 맵을 반환
 */
export async function getMonthlySearchVolumeMap(
  keywords: string[],
  _opts: { timeoutMs?: number } = {}
): Promise<KeywordVolumeMap> {
  const uniq = Array.from(new Set((keywords || []).map(norm).filter(Boolean))).slice(0, 50);

  // ✅ 현재는 실제 API 미연동: 값은 undefined로 두되 shape는 유지
  const out: KeywordVolumeMap = {};
  for (const k of uniq) {
    out[k] = { monthlyPc: undefined, monthlyMobile: undefined, monthlyTotal: undefined, source: "stub" };
  }
  return out;
}

/**
 * ✅ enrichPlace.ts가 기대하는 export #2
 * keywords 배열에 volume 정보를 붙여서 반환
 */
export async function attachVolumesToKeywords<T extends { keyword: string }>(
  keywords: T[],
  opts: { timeoutMs?: number } = {}
): Promise<(T & { volume?: KeywordVolumeMap[string] })[]> {
  const list = (keywords || []).filter((x) => x && typeof x.keyword === "string" && norm(x.keyword));
  const map = await getMonthlySearchVolumeMap(
    list.map((x) => x.keyword),
    opts
  );

  return list.map((x) => ({
    ...x,
    volume: map[norm(x.keyword)] ?? { monthlyPc: undefined, monthlyMobile: undefined, monthlyTotal: undefined, source: "stub" }
  }));
}
