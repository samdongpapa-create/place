// src/services/playwrightPhotosCount.ts
import { chromium } from "playwright";

const UA_MOBILE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

export type PhotoCountResult = {
  count?: number;
  debug: any;
};

export async function fetchPhotoCountViaPlaywright(photoUrl: string): Promise<PhotoCountResult> {
  const started = Date.now();
  const browser = await chromium.launch({ args: ["--no-sandbox"] });
  const page = await browser.newPage({ userAgent: UA_MOBILE });

  try {
    await page.goto(photoUrl, { waitUntil: "domcontentloaded", timeout: 15000 });
    await page.waitForTimeout(250);

    // TS에서 document를 직접 참조하면 lib(dom) 없어서 터짐 → 문자열 eval로 회피
    const fn = `
      () => {
        const clean = (s) => String(s || "").replace(/\\s+/g, " ").trim();
        const body = clean(document.body?.innerText || "");

        // 가장 흔한 패턴: "사진 939", "사진\\n939"
        let m = body.match(/사진\\s*([0-9,]{1,7})/);
        if (m && m[1]) {
          const n = Number(String(m[1]).replace(/,/g, ""));
          if (Number.isFinite(n)) return { count: n };
        }

        // 대체 패턴(혹시 몰라서): "포토 123" / "이미지 123"
        m = body.match(/(포토|이미지)\\s*([0-9,]{1,7})/);
        if (m && m[2]) {
          const n = Number(String(m[2]).replace(/,/g, ""));
          if (Number.isFinite(n)) return { count: n };
        }

        return { count: null };
      }
    `;

    // @ts-ignore
    const data = await page.evaluate(eval(fn));

    const count =
      data && typeof data.count === "number" && Number.isFinite(data.count) ? (data.count as number) : undefined;

    return {
      count,
      debug: {
        used: true,
        targetUrl: photoUrl,
        elapsedMs: Date.now() - started,
        found: typeof count === "number"
      }
    };
  } finally {
    await page.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}
