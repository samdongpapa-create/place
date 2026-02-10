// src/services/playwrightMenus.ts
import { chromium } from "playwright";

// ✅ 이 줄이 핵심: Menu를 export 해야 enrichPlace에서 type import 가능
export type Menu = { name: string; price?: number; durationMin?: number; note?: string };

// ... 이하 기존 코드 그대로 ...

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
  for (const c of scored.slice(0, 6)) {
    for (const it of c.arr) {
      const name = asString(it?.name ?? it?.title ?? it?.menuName ?? it?.serviceName ?? it?.productName ?? it?.itemName);
      if (!name) continue;

      const rawPrice = it?.price ?? it?.minPrice ?? it?.maxPrice ?? it?.amount ?? it?.value ?? it?.cost ?? it?.priceValue;
      const price = asNumber(rawPrice) ?? undefined;

      const durationMin = asNumber(it?.durationMin ?? it?.duration ?? it?.time ?? it?.leadTime) ?? undefined;
      const note = asString(it?.note ?? it?.desc ?? it?.description ?? it?.memo) ?? undefined;

      if (typeof price === "number" && (price < 5000 || price > 2000000)) continue;

      out.push({ name, ...(typeof price === "number" ? { price } : {}), ...(durationMin ? { durationMin } : {}), ...(note ? { note } : {}) });
      if (out.length >= 60) break;
    }
    if (out.length >= 60) break;
  }

  // dedup
  const seen = new Set<string>();
  const dedup: Menu[] = [];
  for (const m of out) {
    const key = `${m.name}:${m.price ?? "na"}`;
    if (seen.has(key)) continue;
    seen.add(key);
    dedup.push(m);
  }
  return dedup.slice(0, 30);
}

/**
 * ✅ Playwright로 /price 열고 XHR JSON 응답에서 menus 추출
 * - “가격표 API는 JS로만 호출되는” 케이스 100% 대응
 */
export async function fetchMenusViaPlaywright(priceUrl: string) {
  const debug = {
    used: true,
    capturedUrls: [] as string[],
    jsonResponses: 0,
    menusFound: 0
  };

  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"]
  });

  try {
    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
      locale: "ko-KR"
    });

    const page = await context.newPage();

    const menus: Menu[] = [];

    page.on("response", async (res) => {
      try {
        const url = res.url();
        const ct = (res.headers()["content-type"] || "").toLowerCase();

        // JSON류 + 메뉴/가격 힌트 URL만 캡처
        const urlHit = /price|menu|product|booking|service|treatment|graphql|api/i.test(url);
        const jsonHit = ct.includes("application/json") || ct.includes("application/graphql-response+json");

        if (!urlHit || !jsonHit) return;

        debug.capturedUrls.push(url);
        if (debug.capturedUrls.length > 40) return;

        const data = await res.json().catch(() => null);
        if (!data) return;

        debug.jsonResponses++;

        const found = extractMenusFromJson(data);
        if (found.length) {
          for (const m of found) menus.push(m);
        }
      } catch {
        // ignore
      }
    });

    await page.goto(priceUrl, { waitUntil: "networkidle", timeout: 20000 });

    // networkidle 이후에도 추가 호출이 있을 수 있어서 짧게 버퍼
    await page.waitForTimeout(1200);

    // dedup
    const seen = new Set<string>();
    const out: Menu[] = [];
    for (const m of menus) {
      const key = `${m.name}:${m.price ?? "na"}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(m);
      if (out.length >= 30) break;
    }

    debug.menusFound = out.length;
    return { menus: out, debug };
  } finally {
    await browser.close();
  }
}
