// src/services/playwrightBasicFields.ts
import { chromium } from "playwright";

export type BasicFields = {
  name?: string;
  category?: string;
  address?: string; // 지번 or 통합 주소
  roadAddress?: string; // 도로명(있으면)
  description?: string; // ✅ "소개/상세설명" (진짜 설명)
  directions?: string; // 찾아가는길
  photoCount?: number; // 업체등록사진(대략)
};

export type BasicFieldsResult = {
  fields: BasicFields;
  debug: any;
};

/**
 * ✅ 안정형 기본필드 추출
 * 우선순위:
 * 1) __NEXT_DATA__ JSON 파싱 (가장 안정적)
 * 2) meta/og description
 * 3) DOM 휴리스틱(라벨 기반)
 *
 * + 사진 수는 /photo 탭을 한 번 더 열어서 __NEXT_DATA__/DOM에서 카운트만 뽑음
 */
export async function fetchBasicFieldsViaPlaywright(
  homeUrl: string,
  opts: { timeoutMs?: number; photo?: boolean; debug?: boolean } = {}
): Promise<BasicFieldsResult> {
  const timeoutMs = typeof opts.timeoutMs === "number" ? opts.timeoutMs : 12000;
  const withPhoto = opts.photo !== false; // default true
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

    // ✅ HOME에서 기본 필드 추출
    const extracted = await page.evaluate(() => {
      const out: any = {};

      const getNextData = () => {
        const el = document.querySelector("#__NEXT_DATA__") as any;
        const txt = el?.textContent || "";
        if (!txt) return null;
        try {
          return JSON.parse(txt);
        } catch {
          return null;
        }
      };

      const pickString = (...xs: any[]) => {
        for (const v of xs) {
          if (typeof v === "string" && v.trim()) return v.trim();
        }
        return undefined;
      };

      // 1) __NEXT_DATA__
      const nd = getNextData();
      if (nd) out._nextData = true;

      // title/name/category (fallback: document.title)
      out.name =
        pickString(
          nd?.props?.pageProps?.page?.name,
          nd?.props?.pageProps?.name,
          nd?.props?.pageProps?.initialState?.place?.name
        ) || pickString(document.querySelector("h1")?.textContent, document.title?.replace(" : 네이버", ""));

      out.category = pickString(
        nd?.props?.pageProps?.page?.category,
        nd?.props?.pageProps?.page?.categoryName,
        nd?.props?.pageProps?.initialState?.place?.category
      );

      // address/roadAddress/directions/description: NEXT_DATA 구조가 케이스별로 달라서 “그럴듯한 후보”를 최대한 모아서 pickString
      // ✅ description(소개/상세설명): meta(og/description) + NEXT_DATA 후보 + DOM “소개” 영역 휴리스틱
      const metaDesc =
        (document.querySelector('meta[property="og:description"]') as any)?.content ||
        (document.querySelector('meta[name="description"]') as any)?.content ||
        "";

      const nextCandidates = [
        nd?.props?.pageProps?.page?.description,
        nd?.props?.pageProps?.page?.businessSummary,
        nd?.props?.pageProps?.page?.intro,
        nd?.props?.pageProps?.page?.introduction,
        nd?.props?.pageProps?.initialState?.place?.description,
        nd?.props?.pageProps?.initialState?.place?.introduction,
        nd?.props?.pageProps?.initialState?.place?.bizDescription
      ];

      // DOM 휴리스틱: "소개" 라벨 주변 텍스트(모바일 플레이스는 섹션이 여러 형태)
      const findByLabel = (label: string) => {
        const nodes = Array.from(document.querySelectorAll("*"));
        for (const n of nodes) {
          const t = (n as any)?.textContent?.trim?.() || "";
          if (t === label) {
            // 같은 블록에서 길게 나오는 텍스트를 찾음
            const box = (n as any).closest("section, div") || (n as any).parentElement;
            const txt = (box as any)?.innerText || "";
            if (txt && txt.length > 30) return txt;
          }
        }
        return "";
      };

      const introDom = findByLabel("소개") || findByLabel("업체소개") || "";

      out.description = pickString(...nextCandidates, metaDesc, introDom);

      // ✅ 리뷰 카운트 문구(“방문자리뷰 …”)가 description으로 들어가는 실수를 방지
      if (out.description && /방문\s*자리뷰|블로그\s*리뷰/.test(out.description) && out.description.length < 80) {
        out.description = undefined;
      }

      // directions: “찾아가는길” 라벨 주변
      const dirDom = findByLabel("찾아가는길") || findByLabel("오시는길") || "";

      const dirCandidates = [
        nd?.props?.pageProps?.page?.directions,
        nd?.props?.pageProps?.page?.wayToCome,
        nd?.props?.pageProps?.initialState?.place?.directions,
        nd?.props?.pageProps?.initialState?.place?.wayToCome
      ];

      out.directions = pickString(...dirCandidates, dirDom);

      // address / roadAddress: “주소” 라벨 주변
      const addrDom = findByLabel("주소") || "";
      const addrCandidates = [
        nd?.props?.pageProps?.page?.address,
        nd?.props?.pageProps?.page?.roadAddress,
        nd?.props?.pageProps?.initialState?.place?.address,
        nd?.props?.pageProps?.initialState?.place?.roadAddress
      ];

      const addrPicked = pickString(...addrCandidates, addrDom);
      if (addrPicked) {
        // DOM에서 “주소서울 종로구 …” 같이 붙어오는 경우 정리
        out.address = addrPicked.replace(/^주소\s*/g, "").trim();
      }

      // roadAddress 별도 후보
      const roadCandidates = [
        nd?.props?.pageProps?.page?.roadAddress,
        nd?.props?.pageProps?.initialState?.place?.roadAddress
      ];
      out.roadAddress = pickString(...roadCandidates);

      return out;
    });

    // merge
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

    // ✅ PHOTO COUNT
    if (withPhoto) {
      const photoUrl = homeUrl.replace(/\/home(\?.*)?$/i, "/photo");
      const t1 = Date.now();
      try {
        await page.goto(photoUrl, { waitUntil: "domcontentloaded", timeout: timeoutMs });
        await page.waitForTimeout(900);

        const photoCount = await page.evaluate(() => {
          // 1) NEXT_DATA에서 카운트 후보
          const el = document.querySelector("#__NEXT_DATA__") as any;
          const txt = el?.textContent || "";
          let nd: any = null;
          if (txt) {
            try {
              nd = JSON.parse(txt);
            } catch {
              nd = null;
            }
          }

          const pickNum = (...xs: any[]) => {
            for (const v of xs) {
              if (typeof v === "number" && Number.isFinite(v)) return v;
            }
            return undefined;
          };

          const n1 = pickNum(
            nd?.props?.pageProps?.page?.photoCount,
            nd?.props?.pageProps?.initialState?.place?.photoCount,
            nd?.props?.pageProps?.initialState?.photo?.count
          );

          if (typeof n1 === "number") return n1;

          // 2) DOM에서 “사진 123” 패턴
          const body = document.body?.innerText || "";
          const m = body.match(/사진\s*([0-9,]+)/);
          if (m && m[1]) return parseInt(m[1].replace(/,/g, ""), 10);

          return undefined;
        });

        if (typeof photoCount === "number") fields.photoCount = photoCount;
        debug.steps.push({ step: "goto.photo", elapsedMs: Date.now() - t1, found: typeof photoCount === "number" });
      } catch (e: any) {
        debug.steps.push({ step: "goto.photo", elapsedMs: Date.now() - t1, error: e?.message || "photo failed" });
      }
    }

    if (debugOn) debug.fields = fields;

    return { fields, debug: { ...debug, elapsedMs: debug.steps.reduce((s: number, x: any) => s + (x.elapsedMs || 0), 0) } };
  } finally {
    await page.close().catch(() => {});
    await ctx.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}
