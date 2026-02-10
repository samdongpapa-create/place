// src/services/playwrightKeywordList.ts
import { chromium } from "playwright";

export type KeywordListResult = {
  keywords5: string[];
  raw: string[];
  debug: {
    used: true;
    targetUrl: string;
    finalUrl: string;
    frameUrls: string[];
    foundIn: "frame-html" | "main-html" | "none";
    elapsedMs: number;
  };
};

const UA_MOBILE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

function safeJsonParse(s: string): any | null {
  try { return JSON.parse(s); } catch { return null; }
}

function pick5(arr: string[]) {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const x of arr) {
    const t = (x || "").replace(/^#/, "").trim();
    if (!t) continue;
    if (t.length < 2 || t.length > 24) continue;
    if (!/[가-힣A-Za-z]/.test(t)) continue;
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(t);
    if (out.length >= 5) break;
  }
  return out;
}

// keywordList: [...] 형태를 최대한 안전하게 뽑기
function extractKeywordListFromHtml(html: string): string[] {
  if (!html) return [];

  // 1) keywordList": [ ... ]
  const m1 = html.match(/"keywordList"\s*:\s*(\[[\s\S]*?\])/i);
  if (m1?.[1]) {
    const parsed = safeJsonParse(m1[1]);
    if (Array.isArray(parsed)) return parsed.map(String);
  }

  // 2) keywordlist (케이스 다를 때)
  const m2 = html.match(/"keywordlist"\s*:\s*(\[[\s\S]*?\])/i);
  if (m2?.[1]) {
    const parsed = safeJsonParse(m2[1]);
    if (Array.isArray(parsed)) return parsed.map(String);
  }

  // 3) 'keywordList' : [...]
  const m3 = html.match(/keywordList["']?\s*:\s*(\[[\s\S]*?\])/i);
  if (m3?.[1]) {
    const parsed = safeJsonParse(m3[1]);
    if (Array.isArray(parsed)) return parsed.map(String);
  }

  return [];
}

export async function fetchRepresentativeKeywords5ByFrameSource(targetUrl: string): Promise<KeywordListResult> {
  const t0 = Date.now();

  const debug: KeywordListResult["debug"] = {
    used: true,
    targetUrl,
    finalUrl: targetUrl,
    frameUrls: [],
    foundIn: "none",
    elapsedMs: 0
  };

  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"]
  });

  try {
    const context = await browser.newContext({ userAgent: UA_MOBILE, locale: "ko-KR" });
    const page = await context.newPage();

    await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(1200);
    debug.finalUrl = page.url();

    // 0) 메인 HTML에서도 먼저 시도
    const mainHtml = await page.content().catch(() => "");
    let raw = extractKeywordListFromHtml(mainHtml);
    if (raw.length) {
      debug.foundIn = "main-html";
      debug.elapsedMs = Date.now() - t0;
      return { keywords5: pick5(raw), raw, debug };
    }

    // 1) 모든 frame을 돌면서 "프레임 소스 보기"에 해당하는 HTML을 직접 읽어서 keywordList 찾기
    const frames = page.frames();
    const frameUrls = frames.map((f) => f.url()).filter(Boolean);
    debug.frameUrls = frameUrls.slice(0, 30);

    for (const f of frames) {
      try {
        const html = await f.content().catch(() => "");
        raw = extractKeywordListFromHtml(html);
        if (raw.length) {
          debug.foundIn = "frame-html";
          debug.elapsedMs = Date.now() - t0;
          return { keywords5: pick5(raw), raw, debug };
        }
      } catch {}
    }

    debug.elapsedMs = Date.now() - t0;
    return { keywords5: [], raw: [], debug };
  } finally {
    await browser.close().catch(() => {});
  }
}
