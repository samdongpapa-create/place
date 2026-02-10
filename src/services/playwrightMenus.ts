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
  return /(커트|컷|펌|염색|클리닉|두피|뿌리|매직|볼륨|드라이|셋팅|탈색|톤다운|컬러|다운펌|열펌|디자인펌|헤드스파)/i.test(name);
}

// ✅ 디자이너/스태프 프로필 감지
function looksLikeStaffName(name: string) {
  return /(디자이너|원장|실장|팀장|디렉터|매니저|아티스트)/i.test(name);
}
function looksLikeProfileNote(note: string) {
  return /(Diploma|수상|경력|선정|아카데미|교육강사|ambassador|Specialist|Colorlist|Expert)/i.test(note);
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

  const note = asString(it?.note ?? it?.desc ?? it?.description ?? it?.memo) ?? undefined;

  // ✅ 스태프/프로필이면 메뉴에서 제외
  if (looksLikeStaffName(name)) return null;
  if (note && looksLikeProfileNote(note)) return null;

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

  // ✅ 미용 서비스 단어가 전혀 없고, 가격/시간도 없으면 후보에서 제외(오탐 방지)
  if (!looksHairService(name) && typeof price !== "number" && typeof durationMin !== "number") return null;

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
 * ✅ 키에 의존하지 않고 “메뉴 배열”을 찾되,
 * - staff/profiles 오탐을 강하게 제거
 * - hair keyword 있는 name 우선
 */
function extractMenusHeuristic(json: any): Menu[] {
  const candidates: Menu[] = [];
  const arrays = collectArrays(json, 0);

  for (const arr of arrays) {
    if (!Array.isArray(arr) || arr.length < 2) continue;

    const sample = arr.slice(0, 6);

    // name-like 필드가 있는지
    const hasName = sample.some((it) => asString(it?.name ?? it?.title ?? it?.menuName ?? it?.serviceName ?? it?.productName ?? it?.itemName));
    if (!hasName) continue;

    // 숫자(가격/시간 등)가 어딘가에 존재하는지
    const hasAnyNumber = sample.some((it) => hasNumberDeep(it));
    // booking 쪽은 가격이 없을 수도 있어서, 숫자가 없으면 hair 키워드로 대신 통과
    const hasHairKeyword = sample.some((it) => {
      const nm = asString(it?.name ?? it?.title ?? it?.menuName ?? it?.serviceName ?? it?.productName ?? it?.itemName);
      return nm ? looksHairService(nm) : false;
    });

    if (!hasAnyNumber && !hasHairKeyword) continue;

    for (const it of arr) {
      const m = normalizeFromItem(it);
      if (m) candidates.push(m);
    }
  }

  const hair = candidates.filter((m) => looksHairService(m.name));
  if (hair.length) return dedup(hair);

  return dedup(candidates);
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
          } catch {}
        }
      }
    });

    page.on("response", async (res) => {
      try {
        const url = res.url();
        const ct = (res.headers()["content-type"] || "").toLowerCase();
        const isGraphql = /graphql/i.test(url);
        const isJson = ct.includes("application/json") || ct.includes("application/graphql-response+json");
        if (!isGraphql || !isJson) return;

        const data = await res.json().catch(() => null);
        if (!data) return;

        debug.jsonResponses++;

        debug.capturedGraphqlSamples.push({
          url,
          topKeys: topKeys(data),
          hasDataKey: !!data?.data,
          arraysFound: collectArrays(data, 0).length
        });

        const found = extractMenusHeuristic(data);
        if (found.length) menus.push(...found);
      } catch {}
    });

    await page.goto(targetUrl, { waitUntil: "networkidle", timeout: 25000 });

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
