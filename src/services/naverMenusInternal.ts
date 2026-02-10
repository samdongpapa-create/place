// src/services/naverMenusInternal.ts
import { fetchPlaceJson } from "./fetchPlace.js";

type Menu = { name: string; price?: number; durationMin?: number; note?: string };

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
      asString(it?.name ?? it?.title ?? it?.menuName ?? it?.serviceName ?? it?.productName ?? it?.itemName) ??
      null;
    if (!name) continue;

    const rawPrice =
      it?.price ?? it?.minPrice ?? it?.maxPrice ?? it?.amount ?? it?.value ?? it?.cost ?? it?.priceValue;
    const price = asNumber(rawPrice) ?? undefined;

    const durationMin = asNumber(it?.durationMin ?? it?.duration ?? it?.time ?? it?.leadTime) ?? undefined;
    const note = asString(it?.note ?? it?.desc ?? it?.description ?? it?.memo) ?? undefined;

    // 살롱 기준 가격 필터(너무 이상한 값 제거)
    if (typeof price === "number") {
      if (price < 5000 || price > 2000000) continue;
    }

    out.push({ name, ...(price ? { price } : {}), ...(durationMin ? { durationMin } : {}), ...(note ? { note } : {}) });
    if (out.length >= 50) break;
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
 * price/home HTML에서 persisted query 단서 뽑기
 * - "operationName":"...","sha256Hash":"..." 형태를 긁어옴
 */
function extractPersistedOps(html: string) {
  const ops: { operationName: string; sha256Hash: string }[] = [];
  const re = /"operationName"\s*:\s*"([^"]+)"[\s\S]{0,300}?"sha256Hash"\s*:\s*"([a-f0-9]{32,64})"/gi;
  let m: RegExpExecArray | null;
  const seen = new Set<string>();
  while ((m = re.exec(html))) {
    const op = m[1];
    const hash = m[2];
    const key = `${op}:${hash}`;
    if (seen.has(key)) continue;
    seen.add(key);

    // menu/price 관련만 우선
    if (!/menu|price|product|booking|service|treatment/i.test(op)) continue;

    ops.push({ operationName: op, sha256Hash: hash });
    if (ops.length >= 15) break;
  }
  return ops;
}

function extractMenusFromJson(obj: any): Menu[] {
  const arrays = collectArrays(obj, 0);
  const scored: { arr: any[]; score: number }[] = [];

  for (const arr of arrays) {
    if (!Array.isArray(arr) || arr.length < 3 || arr.length > 2000) continue;

    const sample = arr.slice(0, 30);
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
  for (const c of scored.slice(0, 6)) {
    out.push(...menuFromAny(c.arr));
    if (out.length >= 60) break;
  }
  return dedup(out);
}

/**
 * ✅ 핵심: 내부 GraphQL persisted query로 메뉴 시도
 */
export async function tryFetchMenusInternal(placeId: string, htmlHints: string): Promise<Menu[]> {
  if (!placeId) return [];

  const ops = extractPersistedOps(htmlHints || "");
  if (!ops.length) return [];

  // 가장 흔한 엔드포인트 (mobile place graphql)
  const endpoint = "https://m.place.naver.com/graphql";

  for (const op of ops) {
    try {
      const body = {
        operationName: op.operationName,
        variables: { placeId }, // 🔥 placeId 주입 (operation마다 무시될 수도 있음)
        extensions: {
          persistedQuery: { version: 1, sha256Hash: op.sha256Hash }
        }
      };

      const json = await fetchPlaceJson<any>(endpoint, { method: "POST", body }, { timeoutMs: 12000, retries: 0 });

      // GraphQL 표준 형태: { data, errors }
      if (json?.errors?.length) continue;

      const menus = extractMenusFromJson(json);
      if (menus.length > 0) return menus;
    } catch {
      // 다음 op 시도
    }
  }

  return [];
}
