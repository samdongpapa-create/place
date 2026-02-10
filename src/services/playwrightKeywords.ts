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

const STOP_RE = /(마이플레이스|이미지\s*갯수|문의|소식|스타일|방문자\s*리뷰|블로그\s*리뷰|길찾기|전화|공유|저장|예약|가격|사진|리뷰)/i;
const STOP_EXACT = new Set(["홈", "메뉴", "사진", "리뷰", "예약", "가격", "지도", "정보", "더보기", "저장"]);

function safeJsonParse(s: string): any | null {
  try { return JSON.parse(s); } catch { return null; }
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
    const cleaned = arr.map((x) => normalizeKeyword(x)).filter(Boolean) as string[];
    const len = cleaned.length;

    let s = 0;
    if (len >= 3 && len <= 20) s += 4;
    if (len >= 5 && len <= 15) s += 4;
    s += Math.min(len, 10);
    if (arr.length > 30) s -= 4;
    return s;
  };

  const ranked = arrays.map((a) => ({ a, s: score(a) })).sort((x, y) => y.s - x.s);
  const best = ranked[0]?.a;
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

        const arrays = collectStringArrays(parsed, 0);
        if (arrays.length) stringArrays.push(...arrays);
      } catch {}
    });

    await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(900);
    await page.waitForTimeout(900);

    const bestArr = pickBestKeywordArray(stringArrays);
    if (bestArr?.length) candidates.push(...bestArr);

    // ✅ DOM 폴백: TS DOM 타입 에러 방지 위해 evaluate 내에서 any로만 처리
    try {
      const domKeywords = await page.evaluate(() => {
        const D: any = (globalThis as any).document;
        if (!D) return [];
        const label = "대표키워드";
        const all: any[] = Array.from(D.querySelectorAll("*") || []);
        const hits = all
          .filter((el) => (el?.innerText || "").includes(label))
          .slice(0, 6);

        const picked: string[] = [];
        for (const el of hits) {
          const parent = el?.parentElement || el;
          const nodes: any[] = Array.from(parent?.querySelectorAll?.("a,button,span,div") || []);
          for (const n of nodes) {
            const t = (n?.innerText || "").trim();
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
    } catch {}

    const out = dedupLimit(candidates, 15);
    debug.elapsedMs = Date.now() - t0;
    debug.keywordsFound = out.length;

    return { keywords: out, debug };
  } finally {
    await browser.close().catch(() => {});
  }
}
