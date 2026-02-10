// src/services/playwrightKeywordList.ts
import { chromium } from "playwright";

export type KeywordListResult = {
  raw: string[];
  keywords5: string[];
  address?: string;
  roadAddress?: string;
  debug: any;
};

const UA_MOBILE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

function uniq(arr: string[]) {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const s of arr) {
    const x = (s || "").trim();
    if (!x) continue;
    if (seen.has(x)) continue;
    seen.add(x);
    out.push(x);
  }
  return out;
}

// HTML 안에서 keywordList 배열을 최대한 안전하게 뽑기
function extractKeywordListFromHtml(html: string): string[] {
  // 1) "keywordList":[...]
  const m1 = html.match(/"keywordList"\s*:\s*\[(.*?)\]/s);
  if (m1?.[1]) {
    const inside = m1[1];
    const items = [...inside.matchAll(/"([^"]+)"/g)].map((x) => x[1]);
    return uniq(items);
  }

  // 2) keywordList = [...]
  const m2 = html.match(/keywordList\s*[:=]\s*\[(.*?)\]/s);
  if (m2?.[1]) {
    const inside = m2[1];
    const items = [...inside.matchAll(/"([^"]+)"/g)].map((x) => x[1]);
    return uniq(items);
  }

  return [];
}

function extractAddressFromHtml(html: string): { roadAddress?: string; address?: string } {
  // 네이버 플레이스 프레임 소스에는 대개 roadAddress / jibunAddress가 같이 있음
  const road =
    html.match(/"roadAddress"\s*:\s*"([^"]+)"/)?.[1] ||
    html.match(/"roadAddr"\s*:\s*"([^"]+)"/)?.[1] ||
    undefined;

  const jibun =
    html.match(/"jibunAddress"\s*:\s*"([^"]+)"/)?.[1] ||
    html.match(/"address"\s*:\s*"([^"]+)"/)?.[1] ||
    undefined;

  return {
    roadAddress: road ? decodeEscaped(road) : undefined,
    address: jibun ? decodeEscaped(jibun) : undefined
  };
}

function decodeEscaped(s: string) {
  // JSON 문자열에 들어있는 \uXXXX 등 처리용(가벼운 수준)
  try {
    return JSON.parse(`"${s.replace(/"/g, '\\"')}"`);
  } catch {
    return s;
  }
}

export async function fetchRepresentativeKeywords5ByFrameSource(homeUrl: string): Promise<KeywordListResult> {
  const started = Date.now();
  const debug: any = {
    used: true,
    targetUrl: homeUrl,
    finalUrl: "",
    frameUrls: [] as string[],
    foundIn: "",
    elapsedMs: 0
  };

  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"]
  });

  try {
    const context = await browser.newContext({ userAgent: UA_MOBILE, locale: "ko-KR" });
    const page = await context.newPage();

    // 프레임 URL 수집(있으면)
    page.on("frameattached", (frame) => {
      try {
        const u = frame.url();
        if (u) debug.frameUrls.push(u);
      } catch {}
    });

    await page.goto(homeUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    debug.finalUrl = page.url();

    // 1) 메인 HTML에서 바로 시도
    const mainHtml = await page.content();
    let raw = extractKeywordListFromHtml(mainHtml);
    let addr = extractAddressFromHtml(mainHtml);

    if (raw.length) {
      debug.foundIn = "main-html";
      debug.elapsedMs = Date.now() - started;
      return {
        raw,
        keywords5: raw.slice(0, 5),
        address: addr.address,
        roadAddress: addr.roadAddress,
        debug
      };
    }

    // 2) 프레임들에서 시도 (frame.source처럼 따로 못 보는 경우가 많아서, frame.evaluate는 TS DOM 이슈도 있어)
    // 대신 frame.url()을 /?xxx 형태로 한번 더 GET해서 HTML을 직접 받아오는 전략
    const frames = page.frames();
    for (const f of frames) {
      const u = (f.url() || "").trim();
      if (!u || u === "about:blank") continue;
      // 플레이스 도메인 프레임만(너무 많이 긁지 않게)
      if (!/place\.naver\.com/i.test(u)) continue;

      try {
        const res = await page.request.get(u, { timeout: 12000 });
        const html = await res.text();

        const k = extractKeywordListFromHtml(html);
        if (k.length) {
          debug.foundIn = "frame-fetch";
          debug.elapsedMs = Date.now() - started;
          const a = extractAddressFromHtml(html);
          return {
            raw: k,
            keywords5: k.slice(0, 5),
            address: a.address,
            roadAddress: a.roadAddress,
            debug
          };
        }
      } catch {}
    }

    debug.foundIn = "none";
    debug.elapsedMs = Date.now() - started;
    return { raw: [], keywords5: [], debug };
  } finally {
    await browser.close();
  }
}
