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

export async function fetchBasicFieldsViaPlaywright(homeUrl: string): Promise<BasicFieldsResult> {
  const started = Date.now();
  const browser = await chromium.launch({ args: ["--no-sandbox"] });
  const page = await browser.newPage({
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
  });

  try {
    await page.goto(homeUrl, { waitUntil: "domcontentloaded", timeout: 15000 });
    await page.waitForTimeout(250);

    // ✅ TS 레벨에서는 document/Element/HTMLMetaElement를 절대 쓰지 않는다.
    const data = await page.evaluate(() => {
      const text = (el: any) => (el ? String(el.textContent || "").trim() : "");

      const q = (sel: string) => (typeof document !== "undefined" ? document.querySelector(sel) : null);

      const pickFirstText = (sels: string[]) => {
        for (const s of sels) {
          const el = q(s);
          const t = text(el);
          if (t) return t;
        }
        return "";
      };

      const ogTitle = (() => {
        const m: any = q('meta[property="og:title"]');
        const c = m && m.content ? String(m.content).trim() : "";
        return c;
      })();

      const name = ogTitle || pickFirstText(["h1", ".place_title", "[data-testid='store-name']"]);
      const category = pickFirstText([".place_category", "span.category", "[data-testid='category']"]);

      // 주소/도로명주소(셀렉터는 계속 튜닝 가능)
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

      // 오시는길: 섹션 텍스트 중 키워드 포함하는 블록을 찾는다
      const directions = (() => {
        const nodes = Array.from(document.querySelectorAll("section,div")) as any[];
        const cands = nodes
          .map((el) => String(el?.textContent || "").trim())
          .filter((t) => t && (t.includes("오시는") || t.includes("찾아오는") || t.includes("도보")));
        const best = cands.sort((a, b) => b.length - a.length)[0] || "";
        return best ? best.slice(0, 500) : "";
      })();

      // 사진 수 추정(정확하지 않아도 score에 쓰기엔 충분)
      const photoCount = (() => {
        const bodyText = String(document.body?.innerText || "").replace(/\s+/g, " ");
        const m = bodyText.match(/사진\s*([0-9,]{1,7})/);
        if (!m?.[1]) return null;
        const n = Number(String(m[1]).replace(/,/g, ""));
        return Number.isFinite(n) ? n : null;
      })();

      return { name, category, address, roadAddress, directions, photoCount };
    });

    return {
      name: data?.name || undefined,
      category: data?.category || undefined,
      address: data?.address || undefined,
      roadAddress: data?.roadAddress || undefined,
      directions: data?.directions || undefined,
      photoCount: typeof data?.photoCount === "number" ? data.photoCount : undefined,
      debug: { used: true, targetUrl: homeUrl, elapsedMs: Date.now() - started }
    };
  } finally {
    await page.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}
