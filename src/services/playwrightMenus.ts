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

  // ✅ 디자이너/프로필 제거
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

  // ✅ 서비스 키워드도 없고 price/time도 없으면 버림(오탐 방지)
  if (!looksHairService(name) && typeof price !== "number" && typeof durationMin !== "number") return null;

  return {
    name,
    ...(typeof price === "number" ? { price } : {}),
    ...(durationMin ? { durationMin } : {}),
    ...(note ? { note } : {})
  };
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

function extractMenusHeuristic(json: any): Menu[] {
  const candidates: Menu[] = [];
  const arrays = collectArrays(json, 0);

  for (const arr of arrays) {
    if (!Array.isArray(arr) || arr.length < 2) continue;

    const sample = arr.slice(0, 6);
    const hasName = sample.some((it) => asString(it?.name ?? it?.title ?? it?.menuName ?? it?.serviceName ?? it?.productName ?? it?.itemName));
    if (!hasName) continue;

    const hasAnyNumber = sample.some((it) => hasNumberDeep(it));
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

function keysPreview(x: any): string[] {
  if (Array.isArray(x)) {
    const first = x[0];
    if (first && typeof first === "object" && !Array.isArray(first)) return Object.keys(first).slice(0, 30);
    return ["__array__"];
  }
  if (x && typeof x === "object") return Object.keys(x).slice(0, 30);
  return [`__${typeof x}__`];
}

function safeJsonParse(s: string): any | null {
  try { return JSON.parse(s); } catch { return null; }
}

// ✅ 배치 응답([ {data...}, {data...} ])에서도 data 유무 판단
function batchHasData(parsed: any): boolean {
  if (Array.isArray(parsed)) return parsed.some((x) => x && typeof x === "object" && !!x.data);
  if (parsed && typeof parsed === "object") return !!parsed.data;
  return false;
}

// ✅ 배치 응답이면 각 요소도 같이 훑어서 메뉴를 찾음
function extractMenusFromParsed(parsed: any): Menu[] {
  const all: Menu[] = [];
  if (Array.isArray(parsed)) {
    for (const el of parsed) all.push(...extractMenusHeuristic(el));
    // 전체 배열 자체에서도 훑기(중첩 구조 케이스)
    all.push(...extractMenusHeuristic(parsed));
  } else {
    all.push(...extractMenusHeuristic(parsed));
  }
  return dedup(all);
}

// ✅ 가격탭에서 “가격표 요청”을 유발하는 클릭/스크롤 시퀀스
async function triggerPriceRequests(page: any) {
  // 1) 조금 기다렸다가
  await page.waitForTimeout(1200);

  // 2) “더보기/펼치기/가격표” 류 버튼 클릭 시도
  const clickTexts = [
    /더보기/i,
    /펼치기/i,
    /가격표/i,
    /가격/i,
    /시술/i,
    /상품/i
  ];

  for (const re of clickTexts) {
    try {
      const loc = page.getByText(re).first();
      if (await loc.count().catch(() => 0)) {
        await loc.click({ timeout: 1200 }).catch(() => {});
        await page.waitForTimeout(900);
      }
    } catch {}
  }

  // 3) 스크롤을 더 공격적으로 (lazy load 유도)
  try {
    for (let i = 0; i < 5; i++) {
      await page.mouse.wheel(0, 1800);
      await page.waitForTimeout(900);
    }
  } catch {}

  // 4) 마지막으로 조금 더 대기
  await page.waitForTimeout(1200);
}

export async function fetchMenusViaPlaywright(targetUrl: string) {
  const debug = {
    used: true,
    targetUrl,
    capturedUrls: [] as string[],
    capturedOps: [] as { url: string; operationName?: string; variablesKeys?: string[]; rawPostDataHead?: string }[],
    jsonResponses: 0,
    menusFound: 0,
    capturedGraphqlSamples: [] as {
      url: string;
      contentType?: string;
      topKeys: string[];
      hasDataKey: boolean;
      arraysFound: number;
      rawResponseHead?: string;
    }[]
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
      if (!/graphql/i.test(url)) return;

      debug.capturedUrls.push(url);
      if (debug.capturedUrls.length > 120) return;

      if (req.method() === "POST") {
        const post = req.postData() || "";
        const head = post.slice(0, 280);

        let op: string | undefined;
        let varsKeys: string[] | undefined;

        const parsed = safeJsonParse(post);
        if (parsed) {
          if (Array.isArray(parsed)) {
            const p0 = parsed[0];
            op = p0?.operationName;
            varsKeys = p0?.variables && typeof p0.variables === "object" ? Object.keys(p0.variables) : [];
          } else {
            op = parsed?.operationName;
            varsKeys = parsed?.variables && typeof parsed.variables === "object" ? Object.keys(parsed.variables) : [];
          }
        }

        debug.capturedOps.push({
          url,
          operationName: op,
          variablesKeys: varsKeys ?? [],
          rawPostDataHead: head
        });
      }
    });

    page.on("response", async (res) => {
      const url = res.url();
      if (!/graphql/i.test(url)) return;

      const ct = (res.headers()["content-type"] || "").toLowerCase();

      try {
        // ✅ 무조건 text로 받고 JSON을 우리가 파싱
        const text = await res.text();
        const head = text.slice(0, 320);
        const parsed = safeJsonParse(text);

        debug.jsonResponses++;

        const topKeys = keysPreview(parsed ?? text);
        const hasDataKey = batchHasData(parsed);
        const arraysFound = parsed ? collectArrays(parsed, 0).length : 0;

        debug.capturedGraphqlSamples.push({
          url,
          contentType: ct,
          topKeys,
          hasDataKey,
          arraysFound,
          rawResponseHead: head
        });

        if (parsed) {
          const found = extractMenusFromParsed(parsed);
          if (found.length) menus.push(...found);
        }
      } catch {}
    });

    // ✅ 여기 중요: networkidle로 바로 끝내지 말고, domcontentloaded 후 액션으로 호출 유도
    await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 30000 });

    // ✅ 가격탭은 클릭/스크롤로 요청이 터지는 케이스가 많음
    await triggerPriceRequests(page);

    // ✅ 추가 대기(뒤늦게 호출되는 graphql 잡기)
    await page.waitForTimeout(1500);

    const out = dedup(menus);
    debug.menusFound = out.length;

    return { menus: out.slice(0, 30), debug };
  } finally {
    await browser.close();
  }
}
