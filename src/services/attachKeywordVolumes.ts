// src/services/keywordVolume.ts
type VolumeMap = Record<string, number | null>;

type GetVolumeOptions = {
  timeoutMs?: number;
  // 네이버 광고 API가 한번에 받을 수 있는 키워드 수 제한이 있을 수 있어서 배치 처리
  batchSize?: number; // 기본 50
  debug?: boolean;
};

const cache = new Map<string, { v: number | null; at: number }>();
const CACHE_TTL_MS = 1000 * 60 * 60 * 12; // 12시간 캐시

function now() {
  return Date.now();
}

function normalizeKeyword(s: string) {
  return (s || "").replace(/\s+/g, " ").trim();
}

function uniqNormalized(list: string[]) {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const x of list || []) {
    const k = normalizeKeyword(x);
    if (!k) continue;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(k);
  }
  return out;
}

async function withTimeout<T>(p: Promise<T>, timeoutMs: number) {
  let t: any;
  const timeout = new Promise<never>((_, rej) => {
    t = setTimeout(() => rej(new Error(`keywordVolume timeout (${timeoutMs}ms)`)), timeoutMs);
  });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    clearTimeout(t);
  }
}

/**
 * ✅ 여기만 “너가 이미 만든 네이버 광고 API 호출 함수”로 연결하면 됨.
 * 반환 형태만 Record<string, number|null> 로 맞춰줘.
 *
 * 예시:
 * - input: ["서대문역 미용실", "아베다 염색"]
 * - output: { "서대문역 미용실": 1200, "아베다 염색": 3400 }
 */
async function fetchMonthlySearchVolumeFromNaverAds(keywords: string[]): Promise<VolumeMap> {
  // TODO: 너 프로젝트의 실제 함수로 교체
  // 예) return await getMonthlySearchVolumeMap(keywords);
  // 예) return await fetchNaverKeywordVolumeMap(keywords);

  // 안전 기본값 (연동 전이라도 서비스가 죽지 않게)
  const out: VolumeMap = {};
  for (const k of keywords) out[k] = null;
  return out;
}

/**
 * ✅ 공개 함수: 월간검색량 맵
 * - 캐시 적용
 * - 배치 적용
 * - timeout 적용
 */
export async function getMonthlySearchVolumeMap(
  keywords: string[],
  opts: GetVolumeOptions = {}
): Promise<{ volumes: VolumeMap; debug?: any }> {
  const timeoutMs = typeof opts.timeoutMs === "number" ? opts.timeoutMs : 8000;
  const batchSize = typeof opts.batchSize === "number" ? opts.batchSize : 50;

  const list = uniqNormalized(keywords);
  const volumes: VolumeMap = {};
  const debug: any = { used: true, input: keywords?.length ?? 0, unique: list.length, batches: [] as any[] };

  // 1) 캐시 히트 먼저 채움
  const need: string[] = [];
  const ts = now();
  for (const k of list) {
    const c = cache.get(k);
    if (c && ts - c.at < CACHE_TTL_MS) {
      volumes[k] = c.v;
    } else {
      need.push(k);
    }
  }

  // 2) 배치로 API 조회
  for (let i = 0; i < need.length; i += batchSize) {
    const batch = need.slice(i, i + batchSize);
    const t0 = now();

    try {
      const r = await withTimeout(fetchMonthlySearchVolumeFromNaverAds(batch), timeoutMs);
      for (const k of batch) {
        const v = typeof r?.[k] === "number" ? (r[k] as number) : null;
        volumes[k] = v;
        cache.set(k, { v, at: now() });
      }
      debug.batches.push({ ok: true, size: batch.length, elapsedMs: now() - t0 });
    } catch (e: any) {
      // 실패해도 서비스는 계속
      for (const k of batch) {
        volumes[k] = null;
        cache.set(k, { v: null, at: now() });
      }
      debug.batches.push({ ok: false, size: batch.length, elapsedMs: now() - t0, error: e?.message ?? "volume failed" });
    }
  }

  return { volumes, debug: opts.debug ? debug : undefined };
}

export function attachVolumesToKeywords(keywords: string[], volumes: VolumeMap) {
  const out: { keyword: string; monthly?: number | null }[] = [];
  for (const k of uniqNormalized(keywords)) {
    out.push({ keyword: k, monthly: (k in volumes ? volumes[k] : null) });
  }
  return out;
}
