// src/services/playwrightMenus.ts
import { chromium } from "playwright";

export type Menu = { name: string; price?: number; durationMin?: number; note?: string };

function asString(v: any): string | null {
  if (typeof v === "string") {
    const s = v.trim();
    return s ? s : null;
  }
  return null;
}
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

function looksHairService(name: string) {
  return /(커트|컷|펌|염색|클리닉|두피|뿌리|매직|볼륨|드라이|셋팅|탈색|톤다운|컬러|다운펌|열펌|디자인)/i.test(name);
}

function hasNumberDeep(obj: any, depth = 0): boolean {
  if (!obj || depth > 6) return false;
  if (typeof obj === "number" && Number.isFinite(obj)) return true;
  if (typeof obj === "string") return /\d/.test(obj);
  if (Array.isArray(obj)) return obj.some((x) => hasNumberDeep(x, depth + 1));
  if (typeof obj === "object") return Object.values(obj).some((x) => hasNumberDeep(x, depth + 1));
  return false;
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

function normalizeFromItem(it: any): Menu | null {
  const name =
    asString(
      it?.name ??
        it?.title ??
        it?.menuName ??
        it?.serviceName ??
        it?.productName ??
        it?.itemName ??
        it?.displayName ??
        it
    ) ?? null;

  if (!name) return null;

  const rawPrice =
    it?.price ??
    it?.minPrice ??
    it?.maxPrice ??
    it?.amount ??
    it?.value ??
    it?.cost ??
    it?.priceValue ??
    it?.salePrice ??
    it?.discountPrice ??
    it?.originPrice ??
    it?.priceInfo?.price ??
    it?.priceInfo?.amount ??
    it?.price?.value;

  const price = asNumber(rawPrice) ?? undefined;
  const durationMin = asNumber(it?.durationMin ?? it?.duration ?? it?.time ?? it?.leadTime) ?? undefined;
  const note = asString(it?.note ?? it?.desc ?? it?.description ?? it?.memo) ?? undefined;

  return { name, ...(typeof price === "number" ? { price } : {}), ...(durationMin ? { durationMin } : {}), ...(note ? { note } : {}) };
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
  return out.slice(0, 40);
}

/**
 * ✅ 응답 JSON에서 “메뉴로 보이는 배열”을 키 이름에 의존하지 않고 찾아냄
 * - hair 키워드 포함된 name 우선
 * - price가 깊숙이 있어도 ok (hasNumberDeep)
 */
function extractMenusHeuristic(json: any): Menu[] {
  const out: Menu[] = [];

  const arrays = collectArrays(json, 0);
  for (const arr of arrays) {
    if (!Array.isArray(arr) || arr.length < 2) continue;

    // 샘플 기반: name 비슷한 필드가 있고, 숫자가 어딘가에 존재하면 메뉴 후보
    const sample = arr.slice(0, 5);
    const hasName = sample.some((it) => asString(it?.name ?? it?.title ?? it?.menuName ?? it?.serviceName ?? it?.productName ?? it?.itemName));
    const hasAnyNumber = sample.some((it) => hasNumberDeep(it));
    if (!hasName || !hasAnyNumber) continue;

    for (const it of arr) {
      const m = normalizeFromItem(it);
      if (m) out.push(m);
    }
  }

  // hair 관련 name 우선
  const hair = out.filter((m) => looksHairService(m.name));
  if (hair.length >= 3) return dedup(hair);

  return dedup(out);
}

function topKeys(obj: any): string[] {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return [];
  return Object.keys(obj).slice(0, 30);
}

export async function fetchMenusViaPlaywright(targetUrl: string) {
  const debug = {
    used: true,
    targetUrl,
    capturedUrls: [] as string[],
    capturedOps: [] as { url: string; operationName?: string; variablesKeys?: string[] }[],
    jsonResponses: 0,
    menusFound: 0,
    // ✅ 응답 구조 힌트(상위 키/배열 후보 수)
    capturedGraphqlSamples: [] as { url: string; topKeys: string[]; hasDataKey: boolean; arraysFound: number }[]
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

    page.on("request", (req) => {
      const url = req.url();
      if (!/graphql|api|booking|reserve|price|menu/i.test(url)) return;

      debug.capturedUrls.push(url);
      if (debug.capturedUrls.length > 80) return;

      if (/graphql/i.test(url) && req.method() === "POST") {
        const post = req.postData();
        if (post) {
          try {
            const parsed = JSON.parse(post);
            const op = parsed?.operationName;
            const vars = parsed?.variables && typeof parsed.variables === "object" ? Object.keys(parsed.variables) : [];
            debug.capturedOps.push({ url, operationName: op, variablesKeys: vars });
          } catch {
            // ignore
          }
        }
      }
    });

    page.on("response", async (res) => {
      try {
        const url = res.url();
        const ct = (res.headers()["content-type"] || "").toLowerCase();

        const urlHit = /graphql/i.test(url);
        const jsonHit = ct.includes("application/json") || ct.includes("application/graphql-response+json");
        if (!urlHit || !jsonHit) return;

        const data = await res.json().catch(() => null);
        if (!data) return;

        debug.jsonResponses++;

        // 구조 힌트 저장(너가 다음 단계에서 “내부 API 콜”로 갈 때 결정적)
        debug.capturedGraphqlSamples.push({
          url,
          topKeys: topKeys(data),
          hasDataKey: !!data?.data,
          arraysFound: collectArrays(data, 0).length
        });

        const found = extractMenusHeuristic(data);
        if (found.length) menus.push(...found);
      } catch {
        // ignore
      }
    });

    await page.goto(targetUrl, { waitUntil: "networkidle", timeout: 25000 });

    // 예약 페이지는 스크롤로 추가 호출이 잘 일어남
    try {
      await page.mouse.wheel(0, 1400);
      await page.waitForTimeout(1200);
      await page.mouse.wheel(0, 1400);
      await page.waitForTimeout(1200);
    } catch {}

    const out = dedup(menus);
    debug.menusFound = out.length;

    return { menus: out.slice(0, 30), debug };
  } finally {
    await browser.close();
  }
}
