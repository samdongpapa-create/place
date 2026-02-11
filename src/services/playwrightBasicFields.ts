// src/services/playwrightBasicFields.ts
import { chromium } from "playwright";

export type BasicFieldsResult = {
  name?: string;
  category?: string;
  address?: string;
  roadAddress?: string;
  directions?: string;
  photoCount?: number;
  debug: any;
};

type BasicFieldsEvalResult = {
  name: string;
  category: string;
  address: string;
  roadAddress: string;
  directions: string;
  photoCount: number | null;
};

const UA_MOBILE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

export async function fetchBasicFieldsViaPlaywright(homeUrl: string): Promise<BasicFieldsResult> {
  const started = Date.now();

  const browser = await chromium.launch({ args: ["--no-sandbox"] });
  const page = await browser.newPage({ userAgent: UA_MOBILE });

  try {
    await page.goto(homeUrl, { waitUntil: "domcontentloaded", timeout: 15000 });
    await page.waitForTimeout(250);

    // ✅ TS가 document를 못 보게: evaluate에 "문자열 함수"로 넣는다.
    const fn = `
      () => {
        const text = (el) => (el ? String(el.textContent || "").trim() : "");
        const q = (sel) => document.querySelector(sel);

        const pickFirstText = (sels) => {
          for (const s of sels) {
            const el = q(s);
            const t = text(el);
            if (t) return t;
          }
          return "";
        };

        const ogTitle = (() => {
          const m = q('meta[property="og:title"]');
          const c = m && m.content ? String(m.content).trim() : "";
          return c;
        })();

        const name = ogTitle || pickFirstText(["h1", ".place_title", "[data-testid='store-name']"]);
        const category = pickFirstText([".place_category", "span.category", "[data-testid='category']"]);

        const address = pickFirstText([
          "[data-testid='address']",
          ".place_detail_info .addr",
          "span.addr",
          "a[href*='map.naver.com']"
        ]);

        const roadAddress = pickFirstText([
          "[data-testid='roadAddress']",
          ".place_detail_info .road_addr",
          "span.road_addr"
        ]);

        const directions = (() => {
          const nodes = Array.from(document.querySelectorAll("section,div"));
          const cands = nodes
            .map((el) => String(el && el.textContent ? el.textContent : "").trim())
            .filter((t) => t && (t.includes("오시는") || t.includes("찾아오는") || t.includes("도보")));
          const best = cands.sort((a, b) => b.length - a.length)[0] || "";
          return best ? best.slice(0, 500) : "";
        })();

        const photoCount = (() => {
          const bodyText = String(document.body && document.body.innerText ? document.body.innerText : "").replace(/\\s+/g, " ");
          const m = bodyText.match(/사진\\s*([0-9,]{1,7})/);
          if (!m || !m[1]) return null;
          const n = Number(String(m[1]).replace(/,/g, ""));
          return Number.isFinite(n) ? n : null;
        })();

        return { name, category, address, roadAddress, directions, photoCount };
      }
    `;

    // @ts-ignore - 문자열 함수 실행 (TS가 내부 파싱 안 함)
    const data = (await page.evaluate(eval(fn))) as BasicFieldsEvalResult;

    return {
      name: data?.name ? data.name : undefined,
      category: data?.category ? data.category : undefined,
      address: data?.address ? data.address : undefined,
      roadAddress: data?.roadAddress ? data.roadAddress : undefined,
      directions: data?.directions ? data.directions : undefined,
      photoCount: typeof data?.photoCount === "number" ? data.photoCount : undefined,
      debug: { used: true, targetUrl: homeUrl, elapsedMs: Date.now() - started }
    };
  } finally {
    await page.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}
