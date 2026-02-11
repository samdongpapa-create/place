// src/services/keywordVolume.ts
// ✅ 네이버 키워드광고(검색량) 연동용
// - 현재는 "shape 고정 + 빌드 통과" 목적의 스텁
// - 나중에 SearchAd API를 붙이면 getMonthlySearchVolumeMap 내부만 교체하면 됨

export type KeywordVolume = {
  monthlyPc?: number;
  monthlyMobile?: number;
  monthlyTotal?: number;
  source?: "stub" | "naver-searchad";
};

export type KeywordVolumeMap = Record<string, KeywordVolume>;

export type VolumeOpts = {
  timeoutMs?: number;
  batchSize?: number; // ✅ enrichPlace에서 쓰는 옵션(현재는 스텁이라 미사용)
};

function norm(k: string) {
  return (k || "").trim();
}

/**
 * ✅ 키워드 배열 -> volume map
 */
export async function getMonthlySearchVolumeMap(keywords: string[], _opts: VolumeOpts = {}): Promise<KeywordVolumeMap> {
  const uniq = Array.from(new Set((keywords || []).map(norm).filter(Boolean))).slice(0, 200);

  // ✅ 현재는 실제 API 미연동: 값은 undefined 유지 (shape만 보장)
  const out: KeywordVolumeMap = {};
  for (const k of uniq) out[k] = { source: "stub" };
  return out;
}

/**
 * ✅ overload: string[] 도 받고, {keyword:string}[] 도 받는다
 */
export async function attachVolumesToKeywords(
  keywords: string[],
  opts?: VolumeOpts
): Promise<{ keyword: string; volume?: KeywordVolume }[]>;
export async function attachVolumesToKeywords<T extends { keyword: string }>(
  keywords: T[],
  opts?: VolumeOpts
): Promise<(T & { volume?: KeywordVolume })[]>;
export async function attachVolumesToKeywords<T extends { keyword: string }>(
  keywords: (T | string)[],
  opts: VolumeOpts = {}
): Promise<any[]> {
  const list = (keywords || [])
    .map((x) => (typeof x === "string" ? { keyword: x } : x))
    .filter((x) => x && typeof x.keyword === "string" && norm(x.keyword));

  const map = await getMonthlySearchVolumeMap(
    list.map((x) => x.keyword),
    opts
  );

  return list.map((x) => ({
    ...x,
    volume: map[norm(x.keyword)] ?? { source: "stub" }
  }));
}
