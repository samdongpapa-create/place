// src/services/keywordVolume.ts
// ✅ 네이버 키워드광고/검색량 연동용 (현재는 스텁)
// - 지금은 빌드 에러 방지 + 인터페이스 고정 목적
// - 추후: Naver SearchAd API 연동해서 volume 채우면 됨

export type KeywordVolumeItem = {
  keyword: string;
  monthlyPc?: number;
  monthlyMobile?: number;
  monthlyTotal?: number;
  source?: "stub" | "naver-searchad";
};

export type KeywordVolumeResult = {
  items: KeywordVolumeItem[];
  debug?: any;
};

// ✅ 추후 실제 API 붙일 때도 이 함수 시그니처 유지하면 안전함
export async function fetchKeywordVolumes(
  keywords: string[],
  _opts: { timeoutMs?: number } = {}
): Promise<KeywordVolumeResult> {
  const uniq = Array.from(new Set((keywords || []).map((k) => (k || "").trim()).filter(Boolean))).slice(0, 30);

  // 현재는 데이터 없음(스텁)
  return {
    items: uniq.map((k) => ({
      keyword: k,
      monthlyPc: undefined,
      monthlyMobile: undefined,
      monthlyTotal: undefined,
      source: "stub"
    })),
    debug: { used: true, strategy: "stub", count: uniq.length }
  };
}
