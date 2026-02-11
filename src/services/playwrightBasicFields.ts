// src/services/playwrightBasicFields.ts
import { chromium } from "playwright";

type BasicFieldsResult = {
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

    const data = await page.evaluate(() => {
      const text = (el: Element | null) => (el ? (el.textContent || "").trim() : "");
      const pickFirst = (sels: string[]) => {
        for (const s of sels) {
          const el = document.querySelector(s);
          const t = text(el);
          if (t) return t;
        }
        return "";
      };

      // 이름/카테고리(가끔 meta로도 존재)
      const name =
        (document.querySelector('meta[property="og:title"]') as HTMLMetaElement | null)?.content?.trim() ||
        pickFirst(["h1", "[data-testid='store-name']", ".place_title"]);

      const category = pickFirst([".place_category", "[data-testid='category']", "span.category"]);

      // 주소: 네이버 플레이스는 “주소/도로명”이 섞여 나올 수 있어 다중 셀렉터
      const address = pickFirst([
        "a[href*='map.naver.com']",
        "span.addr",
        ".place_detail_info .addr",
        "[data-testid='address']"
      ]);

      const roadAddress = pickFirst([
        "span.road_addr",
        ".place_detail_info .road_addr",
        "[data-testid='roadAddress']"
      ]);

      // 오시는길: “찾아오는길/오시는 길” 섹션이 있으면 텍스트를 긁음
      const directions = (() => {
        const candidates = Array.from(document.querySelectorAll("section,div"))
          .map((el) => (el.textContent || "").trim())
          .filter((t) => t.includes("오시는") || t.includes("찾아오는") || t.includes("도보"));
        // 너무 긴 건 컷
        const best = candidates.sort((a, b) => b.length - a.length)[0] || "";
        return best.length > 0 ? best.slice(0, 400) : "";
      })();

      // 사진 수: UI마다 다르니 숫자 패턴으로 추정
      const bodyText = (document.body?.innerText || "").replace(/\s+/g, " ");
      const m = bodyText.match(/사진\s*([0-9,]{1,7})/);
      const photoCount = m?.[1] ? Number(m[1].replace(/,/g, "")) : null;

      return {
        name,
        category,
        address,
        roadAddress,
        directions,
        photoCount
      };
    });

    return {
      name: data.name || undefined,
      category: data.category || undefined,
      address: data.address || undefined,
      roadAddress: data.roadAddress || undefined,
      directions: data.directions || undefined,
      photoCount: typeof data.photoCount === "number" && Number.isFinite(data.photoCount) ? data.photoCount : undefined,
      debug: { used: true, targetUrl: homeUrl, elapsedMs: Date.now() - started }
    };
  } finally {
    await page.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}
