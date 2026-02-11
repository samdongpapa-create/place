// src/services/playwrightBasicFields.ts
import { chromium } from "playwright";

export type BasicFields = {
  name?: string;
  category?: string;
  address?: string;
  roadAddress?: string;
  description?: string;
  directions?: string;
  photoCount?: number;
};

export type BasicFieldsResult = {
  fields: BasicFields;
  debug: any;
};

/**
 * ✅ tsconfig(lib dom) 없이도 빌드되도록:
 * - page.evaluate(() => document...) 형태를 쓰지 않고,
 * - "문자열 함수"를 evaluate에 넣어 TS의 DOM 타입체크를 회피.
 */
export async function fetchBasicFieldsViaPlaywright(
  homeUrl: string,
  opts: { timeoutMs?: number; photo?: boolean; debug?: boolean } = {}
): Promise<BasicFieldsResult> {
  const timeoutMs = typeof opts.timeoutMs === "number" ? opts.timeoutMs : 12000;
  const withPhoto = opts.photo !== false;
  const debugOn = !!opts.debug;

  const debug: any = { used: true, targetUrl: homeUrl, steps: [] as any[] };
  const fields: BasicFields = {};

  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"]
  });

  const ctx = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
    locale: "ko-KR"
  });

  const page = await ctx.newPage();

  try {
    const t0 = Date.now();
    await page.goto(homeUrl, { waitUntil: "domcontentloaded", timeout: timeoutMs });
    await page.waitForTimeout(900);
    debug.steps.push({ step: "goto.home", elapsedMs: Date.now() - t0 });

    // ✅ DOM 접근은 "문자열 evaluate"로 실행
    const homeEval = `
      (() => {
        const out = {};

        const pickString = (...xs) => {
          for (const v of xs) {
            if (typeof v === "string" && v.trim()) return v.trim();
          }
          return undefined;
        };

        const getNextData = () => {
          const el = document.querySelector("#__NEXT_DATA__");
          const txt = el && el.textContent ? el.textContent : "";
          if (!txt) return null;
          try { return JSON.parse(txt); } catch { return null; }
        };

        const nd = getNextData();
        if (nd) out._nextData = true;

        const h1 = document.querySelector("h1");
        const title = document.title || "";
        out.name =
          pickString(
            nd && nd.props && nd.props.pageProps && nd.props.pageProps.page && nd.props.pageProps.page.name,
            nd && nd.props && nd.props.pageProps && nd.props.pageProps.name,
            nd && nd.props && nd.props.pageProps && nd.props.pageProps.initialState && nd.props.pageProps.initialState.place && nd.props.pageProps.initialState.place.name
          ) || pickString(h1 && h1.textContent, title.replace(" : 네이버", ""));

        out.category = pickString(
          nd && nd.props && nd.props.pageProps && nd.props.pageProps.page && (nd.props.pageProps.page.category || nd.props.pageProps.page.categoryName),
          nd && nd.props && nd.props.pageProps && nd.props.pageProps.initialState && nd.props.pageProps.initialState.place && nd.props.pageProps.initialState.place.category
        );

        const metaOg = document.querySelector('meta[property="og:description"]');
        const metaDesc = document.querySelector('meta[name="description"]');
        const metaText = (metaOg && metaOg.getAttribute("content")) || (metaDesc && metaDesc.getAttribute("content")) || "";

        const findByLabel = (label) => {
          const nodes = Array.from(document.querySelectorAll("*"));
          for (const n of nodes) {
            const t = (n.textContent || "").trim();
            if (t === label) {
              const box = n.closest("section, div") || n.parentElement;
              const txt = box && (box.innerText || box.textContent) ? (box.innerText || box.textContent) : "";
              if (txt && txt.length > 30) return txt;
            }
          }
          return "";
        };

        // description candidates
        const nextCandidates = [
          nd && nd.props && nd.props.pageProps && nd.props.pageProps.page && (nd.props.pageProps.page.description || nd.props.pageProps.page.businessSummary || nd.props.pageProps.page.intro || nd.props.pageProps.page.introduction),
          nd && nd.props && nd.props.pageProps && nd.props.pageProps.initialState && nd.props.pageProps.initialState.place && (nd.props.pageProps.initialState.place.description || nd.props.pageProps.initialState.place.introduction || nd.props.pageProps.initialState.place.bizDescription)
        ].filter(Boolean);

        const introDom = findByLabel("소개") || findByLabel("업체소개") || "";
        out.description = pickString(...nextCandidates, metaText, introDom);

        // 리뷰 카운트 문구가 짧게 들어오는 오염 방지
        if (out.description && /방문\\s*자리뷰|블로그\\s*리뷰/.test(out.description) && out.description.length < 120) {
          out.description = undefined;
        }

        // directions
        const dirDom = findByLabel("찾아가는길") || findByLabel("오시는길") || "";
        const dirCandidates = [
          nd && nd.props && nd.props.pageProps && nd.props.pageProps.page && (nd.props.pageProps.page.directions || nd.props.pageProps.page.wayToCome),
          nd && nd.props && nd.props.pageProps && nd.props.pageProps.initialState && nd.props.pageProps.initialState.place && (nd.props.pageProps.initialState.place.directions || nd.props.pageProps.initialState.place.wayToCome)
        ].filter(Boolean);

        out.directions = pickString(...dirCandidates, dirDom);

        // address
        const addrDom = findByLabel("주소") || "";
        const addrCandidates = [
          nd && nd.props && nd.props.pageProps && nd.props.pageProps.page && (nd.props.pageProps.page.address || nd.props.pageProps.page.roadAddress),
          nd && nd.props && nd.props.pageProps && nd.props.pageProps.initialState && nd.props.pageProps.initialState.place && (nd.props.pageProps.initialState.place.address || nd.props.pageProps.initialState.place.roadAddress)
        ].filter(Boolean);

        const addrPicked = pickString(...addrCandidates, addrDom);
        if (addrPicked) out.address = addrPicked.replace(/^주소\\s*/g, "").trim();

        out.roadAddress = pickString(
          nd && nd.props && nd.props.pageProps && nd.props.pageProps.page && nd.props.pageProps.page.roadAddress,
          nd && nd.props && nd.props.pageProps && nd.props.pageProps.initialState && nd.props.pageProps.initialState.place && nd.props.pageProps.initialState.place.roadAddress
        );

        return out;
      })()
    `;

    const extracted: any = await page.evaluate(homeEval);

    fields.name = extracted?.name || fields.name;
    fields.category = extracted?.category || fields.category;
    fields.address = extracted?.address || fields.address;
    fields.roadAddress = extracted?.roadAddress || fields.roadAddress;
    fields.description = extracted?.description || fields.description;
    fields.directions = extracted?.directions || fields.directions;

    debug.home = {
      nextData: !!extracted?._nextData,
      picked: {
        name: !!fields.name,
        category: !!fields.category,
        address: !!fields.address,
        roadAddress: !!fields.roadAddress,
        description: !!fields.description,
        directions: !!fields.directions
      }
    };

    // PHOTO COUNT
    if (withPhoto) {
      const photoUrl = homeUrl.replace(/\/home(\?.*)?$/i, "/photo");
      const t1 = Date.now();
      try {
        await page.goto(photoUrl, { waitUntil: "domcontentloaded", timeout: timeoutMs });
        await page.waitForTimeout(900);

        const photoEval = `
          (() => {
            const el = document.querySelector("#__NEXT_DATA__");
            const txt = el && el.textContent ? el.textContent : "";
            let nd = null;
            if (txt) { try { nd = JSON.parse(txt); } catch { nd = null; } }

            const pickNum = (...xs) => {
              for (const v of xs) {
                if (typeof v === "number" && Number.isFinite(v)) return v;
              }
              return undefined;
            };

            const n1 = pickNum(
              nd && nd.props && nd.props.pageProps && nd.props.pageProps.page && nd.props.pageProps.page.photoCount,
              nd && nd.props && nd.props.pageProps && nd.props.pageProps.initialState && nd.props.pageProps.initialState.place && nd.props.pageProps.initialState.place.photoCount,
              nd && nd.props && nd.props.pageProps && nd.props.pageProps.initialState && nd.props.pageProps.initialState.photo && nd.props.pageProps.initialState.photo.count
            );
            if (typeof n1 === "number") return n1;

            const body = document.body && (document.body.innerText || document.body.textContent) ? (document.body.innerText || document.body.textContent) : "";
            const m = body.match(/사진\\s*([0-9,]+)/);
            if (m && m[1]) return parseInt(m[1].replace(/,/g, ""), 10);
            return undefined;
          })()
        `;

        const photoCount: any = await page.evaluate(photoEval);
        if (typeof photoCount === "number") fields.photoCount = photoCount;

        debug.steps.push({ step: "goto.photo", elapsedMs: Date.now() - t1, found: typeof photoCount === "number" });
      } catch (e: any) {
        debug.steps.push({ step: "goto.photo", elapsedMs: Date.now() - t1, error: e?.message || "photo failed" });
      }
    }

    if (debugOn) debug.fields = fields;

    return { fields, debug };
  } finally {
    await page.close().catch(() => {});
    await ctx.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}
