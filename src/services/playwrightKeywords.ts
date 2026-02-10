// src/services/playwrightKeywords.ts
import { chromium } from "playwright";

export type KeywordResult = {
  keywords: string[];
  debug: {
    used: true;
    targetUrl: string;
    elapsedMs: number;
    capturedUrls: string[];
    capturedOps: { url: string; operationName?: string; variablesKeys?: string[] }[];
    jsonResponses: number;
    keywordsFound: number;
    strategy: string;
  };
};

const UA_MOBILE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

// UI 잡음 최소 제거(대표키워드 원문을 망치지 않는 선에서)
const STOP_RE = /(마이플레이스|이미지\s*갯수|문의|소식|스타일|방문자\s*리뷰|블로그\s*리뷰|길찾기|전화|공유|저장|예약|가격|사진|리뷰)/i;
const STOP_EXACT = new Set(["홈", "메뉴", "사진", "리뷰", "예약", "가격", "지도", "정보", "더보기", "저장"]);

function safeJsonParse(s: string): any | null {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function collectStringArrays(obj: any, depth = 0): string[][] {
  if (!obj || depth > 10) return [];
  const out: string[][] = [];

  if (Array.isArray(obj)) {
    if (obj.length && obj.every((x) => typeof x === "string")) out.push(obj as string[]);
    for (const it of obj) out.push(...collectStringArrays(it, depth + 1));
    return out;
  }

  if (typeof obj === "object") {
    for (const k of Object.keys(obj)) out.push(...collectStringArrays(obj[k], depth + 1));
  }

  return out;
}

function normalizeKeyword(s: string): string | null {
  const t = (s || "").replace(/^#/, "").replace(/\s+/g, " ").trim();
  if (!t) return null;
  if (t.length < 2 || t.length > 22) return null;
  if (!/[가-힣A-Za-z]/.test(t)) return null;
  if (/^\d+$/.test(t)) return null;
  if (STOP_RE.test(t)) return null;
  if (STOP_EXACT.has(t)) return null;
  return t;
}

function pickBestKeywordArray(arrays: string[][]): string[] | null {
  if (!arrays.length) return null;

  const score = (arr: string[]) => {
    const a = arr.map((x) => normalizeKeyword(x)).filter(Boolean) as string[];
    const len = a.length;

    // 너무 짧거나 너무 길면 감점
    let s = 0;
    if (len >= 3 && len <= 20) s += 4;
    if (len >= 5 && len <= 15) s += 4;

    // 품질: 정제 후 남는 개수
    s += Math.min(len, 10);

    // 원본 배열이 너무 크면 감점(보통 키워드는 5~15개)
    if (arr.length > 30) s -= 4;

    return s;
  };

  const ranked = arrays
    .map((a) => ({ a, s: score(a) }))
    .sort((x, y) => y.s - x.s);

  const best = ranked[0]?.a ?? null;
  if (!best) return null;

  const cleaned = best.map((x) => normalizeKeyword(x)).filter(Boolean) as string[];
  return cleaned.length ? cleaned : null;
}

function dedupLimit(arr: string[], limit = 15) {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const s of arr) {
    const t = normalizeKeyword(s);
    if (!t) continue;
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(t);
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * ✅ /home을 Playwright로 열어서 GraphQL 응답에서 "대표키워드"를 휴리스틱 추출
 * - 빠르게: domcontentloaded + 짧은 대기
 * - 응답 JSON 안에 "키워드 배열(string[])" 후보를 모아서 가장 그럴듯한 1개 선택
 * - 실패 시 DOM에서 "대표키워드" 라벨 근처 칩 텍스트도 추가 폴백
 */
export async function fetchExistingKeywordsViaPlaywright(targetUrl: string): Promise<KeywordResult> {
  const t0 = Date.now();

  const debug: KeywordResult["debug"] = {
    used: true,
    targetUrl,
    elapsedMs: 0,
    capturedUrls: [],
    capturedOps: [],
    jsonResponses: 0,
    keywordsFound: 0,
    strategy: "home-graphql+dom-fallback"
  };

  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"]
  });

  try {
    const context = await browser.newContext({ userAgent: UA_MOBILE, locale: "ko-KR" });
    const page = await context.newPage();

    const candidates: string[] = [];
    const stringArrays: string[][] = [];

    page.on("request", (req) => {
      const url = req.url();
      if (!/graphql/i.test(url)) return;

      debug.capturedUrls.push(url);
      if (debug.capturedUrls.length > 120) debug.capturedUrls.shift();

      if (req.method() === "POST") {
        const post = req.postData() || "";
        const parsed = safeJsonParse(post);

        let op: string | undefined;
        let varsKeys: string[] | undefined;

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

        debug.capturedOps.push({ url, operationName: op, variablesKeys: varsKeys ?? [] });
        if (debug.capturedOps.length > 60) debug.capturedOps.shift();
      }
    });

    page.on("response", async (res) => {
      const url = res.url();
      if (!/graphql/i.test(url)) return;

      try {
        const text = await res.text();
        const parsed = safeJsonParse(text);
        debug.jsonResponses++;

        if (!parsed) return;

        // 1) string[] 후보 수집
        const arrays = collectStringArrays(parsed, 0);
        if (arrays.length) stringArrays.push(...arrays);

        // 2) object[] 안에 name/title/keyword 같은 것들을 string으로 모으는 보조(과하게 하면 오탐이 커서 제한)
        // 여기서는 생략(필요 시 추가 가능)
      } catch {
        // ignore
      }
    });

    await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(900);
    await page.waitForTimeout(900);

    // (A) GraphQL에서 가장 그럴듯한 키워드 배열 선택
    const bestArr = pickBestKeywordArray(stringArrays);
    if (bestArr?.length) candidates.push(...bestArr);

    // (B) DOM 폴백: "대표키워드" 라벨 근처 텍스트 수집(있으면)
    // 페이지 구조가 바뀌어도 최대한 안전하게: contains 기반 + 주변에서 짧은 텍스트만
    try {
      const domKeywords = await page.evaluate(() => {
        const label = "대표키워드";
        const els = Array.from(document.querySelectorAll("*"))
          .filter((el) => (el as HTMLElement).innerText?.includes(label))
          .slice(0, 6);

        const picked: string[] = [];
        for (const el of els) {
          const parent = (el as HTMLElement).parentElement || (el as HTMLElement);
          const nodes = Array.from(parent.querySelectorAll("a,button,span,div")) as HTMLElement[];
          for (const n of nodes) {
            const t = (n.innerText || "").trim();
            if (!t) continue;
            if (t === label) continue;
            if (t.length < 2 || t.length > 22) continue;
            picked.push(t);
            if (picked.length >= 30) break;
          }
          if (picked.length >= 10) break;
        }
        return picked;
      });
      if (Array.isArray(domKeywords) && domKeywords.length) candidates.push(...domKeywords);
    } catch {
      // ignore
    }

    const out = dedupLimit(candidates, 15);
    debug.elapsedMs = Date.now() - t0;
    debug.keywordsFound = out.length;

    return { keywords: out, debug };
  } finally {
    await browser.close().catch(() => {});
  }
}
