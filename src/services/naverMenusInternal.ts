// src/services/naverMenusInternal.ts
import { fetchPlaceJson } from "./fetchPlace.js";

export type Menu = { name: string; price?: number; durationMin?: number; note?: string };

export type MenusInternalDebug = {
  opsFound: number;
  endpointsFound: string[];
  endpointsTried: string[];
  attempts: number;
  gotAnyJson: boolean;
};

function asNumber(v: any): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const cleaned = v.replace(/[^\d.]/g, "");
    if (!cleaned) return null;
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}
function asString(v: any): string | null {
  if (typeof v === "string") {
    const s = v.trim();
    return s ? s : null;
  }
  return null;
}

function collectArrays(obj: any, depth = 0): any[][] {
  if (!obj || depth > 10) return [];
  const out: any[][] = [];
  if (Array.isArray(obj)) {
    out.push(obj);
    for (const it of obj) out.push(...collectArrays(it, depth + 1));
    return out;
  }
  if (typeof obj === "object") {
    for (const k of Object.keys(obj)) out.push(...collectArrays(obj[k], depth + 1));
  }
  return out;
}

function menuFromAny(arr: any[]): Menu[] {
  const out: Menu[] = [];
  for (const it of arr || []) {
    const name =
      asString(it?.name ?? it?.title ?? it?.menuName ?? it?.serviceName ?? it?.productName ?? it?.itemName) ?? null;
    if (!name) continue;

    const rawPrice =
      it?.price ?? it?.minPrice ?? it?.maxPrice ?? it?.amount ?? it?.value ?? it?.cost ?? it?.priceValue;
    const price = asNumber(rawPrice) ?? undefined;

    const durationMin = asNumber(it?.durationMin ?? it?.duration ?? it?.time ?? it?.leadTime) ?? undefined;
    const note = asString(it?.note ?? it?.desc ?? it?.description ?? it?.memo) ?? undefined;

    if (typeof price === "number") {
      if (price < 5000 || price > 2000000) continue;
    }

    out.push({ name, ...(price ? { price } : {}), ...(durationMin ? { durationMin } : {}), ...(note ? { note } : {}) });
    if (out.length >= 60) break;
  }
  return out;
}

function dedup(menus: Menu[]) {
  const seen = new Set<string>();
  const out: Menu[] = [];
  for (const m of menus) {
    const key = `${m.name}:${m.price ?? "na"}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(m);
  }
  return out.slice(0, 30);
}

/**
 * HTML에서 persistedQuery 단서 추출
 */
function extractPersistedOps(html: string) {
  const ops: { operationName: string; sha256Hash: string }[] = [];
  const re = /"operationName"\s*:\s*"([^"]+)"[\s\S]{0,400}?"sha256Hash"\s*:\s*"([a-f0-9]{32,64})"/gi;
  let m: RegExpExecArray | null;
  const seen = new Set<string>();
  while ((m = re.exec(html))) {
    const op = m[1];
    const hash = m[2];
    const key = `${op}:${hash}`;
    if (seen.has(key)) continue;
    seen.add(key);

    // 메뉴/가격 관련만 우선
    if (!/menu|price|product|booking|service|treatment/i.test(op)) continue;

    ops.push({ operationName: op, sha256Hash: hash });
    if (ops.length >= 30) break;
  }
  return ops;
}

/**
 * HTML에서 /graphql 엔드포인트 추출
 */
function extractGraphqlEndpoints(html: string) {
  const out: string[] = [];
  const re = /(https?:\/\/[a-z0-9\.\-]+\/graphql)/gi;
  let m: RegExpExecArray | null;
  const seen = new Set<string>();
  while ((m = re.exec(html))) {
    const u = m[1];
    if (seen.has(u)) continue;
    seen.add(u);
    out.push(u);
    if (out.length >= 10) break;
  }
  return out;
}

function extractMenusFromJson(obj: any): Menu[] {
  const arrays = collectArrays(obj, 0);
  const scored: { arr: any[]; score: number }[] = [];

  for (const arr of arrays) {
    if (!Array.isArray(arr) || arr.length < 3 || arr.length > 2000) continue;

    const sample = arr.slice(0, 40);
    let hasName = 0;
    let hasPrice = 0;

    for (const it of sample) {
      const n = asString(it?.name ?? it?.title ?? it?.menuName ?? it?.serviceName ?? it?.productName ?? it?.itemName);
      if (n) hasName++;

      const p = asNumber(it?.price ?? it?.minPrice ?? it?.maxPrice ?? it?.amount ?? it?.value ?? it?.cost ?? it?.priceValue);
      if (typeof p === "number" && p >= 5000 && p <= 2000000) hasPrice++;
    }

    if (hasName < 3 || hasPrice < 2) continue;
    scored.push({ arr, score: hasName * 2 + hasPrice * 3 });
  }

  scored.sort((a, b) => b.score - a.score);

  const out: Menu[] = [];
  for (const c of scored.slice(0, 8)) {
    out.push(...menuFromAny(c.arr));
    if (out.length >= 80) break;
  }
  return dedup(out);
}

/**
 * ✅ 최종: endpoint 후보 + variables 키 브루트포스로 menus 뽑기
 */
export async function tryFetchMenusInternal(
  placeId: string,
  htmlHints: string
): Promise<{ menus: Menu[]; debug: MenusInternalDebug }> {
  const debug: MenusInternalDebug = {
    opsFound: 0,
    endpointsFound: [],
    endpointsTried: [],
    attempts: 0,
    gotAnyJson: false
  };

  if (!placeId) return { menus: [], debug };

  const ops = extractPersistedOps(htmlHints || "");
  debug.opsFound = ops.length;

  // HTML에서 발견 + 기본 후보(PC/공용)
  const found = extractGraphqlEndpoints(htmlHints || "");
  const endpointCandidates = Array.from(
    new Set([
      ...found,
      "https://m.place.naver.com/graphql",
      "https://api.place.naver.com/graphql",
      "https://pcmap-api.place.naver.com/graphql" // 실제 사례 다수 :contentReference[oaicite:1]{index=1}
    ])
  );

  debug.endpointsFound = endpointCandidates;

  if (!ops.length) {
    // ops 단서가 없으면 여기서 더 진행해도 의미가 낮음(해시가 없으면 호출이 안 먹는 경우가 많음)
    return { menus: [], debug };
  }

  const varKeyCandidates = ["placeId", "id", "businessId", "shopId", "entryId"];

  for (const endpoint of endpointCandidates) {
    for (const op of ops) {
      for (const varKey of varKeyCandidates) {
        debug.attempts++;
        if (!debug.endpointsTried.includes(endpoint)) debug.endpointsTried.push(endpoint);

        try {
          const body = {
            operationName: op.operationName,
            variables: { [varKey]: placeId },
            extensions: {
              persistedQuery: { version: 1, sha256Hash: op.sha256Hash }
            }
          };

          const json = await fetchPlaceJson<any>(
            endpoint,
            {
              method: "POST",
              headers: {
                Origin: "https://m.place.naver.com",
                Referer: "https://m.place.naver.com/"
              },
              body
            },
            { timeoutMs: 12000, retries: 0 }
          );

          debug.gotAnyJson = true;

          if (json?.errors?.length) continue;

          const menus = extractMenusFromJson(json);
          if (menus.length > 0) return { menus, debug };
        } catch {
          // 다음 시도
        }
      }
    }
  }

  return { menus: [], debug };
}
