// src/services/playwrightBasicFields.ts
import { chromium } from "playwright";

export type BasicFieldsResult = {
  name?: string;
  category?: string;
  address?: string;      // 지번/대표주소
  roadAddress?: string;  // 도로명(있으면)
  directions?: string;   // 오시는길/찾아가는길만
  photoCount?: number;   // home에서 못잡히면 undefined (photo 탭에서 보강 권장)
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

    // ✅ selector 의존 최소화: innerText 기반 파싱
    const fn = `
      () => {
        const clean = (s) => String(s || "").replace(/\\s+/g, " ").trim();

        const ogTitle = (() => {
          const m = document.querySelector('meta[property="og:title"]');
          const c = m && m.content ? String(m.content).trim() : "";
          return c;
        })();

        const name = clean(ogTitle) || clean(document.querySelector("h1")?.textContent || "");
        const category = clean(document.querySelector(".place_category")?.textContent || "");

        const body = clean(document.body?.innerText || "");

        // --- 주소 파싱: "주소" 라벨 이후를 우선 ---
        // 예: "주소 서울 종로구 새문안로 15-1 2층 지도 내비게이션 거리뷰"
        const pickAddress = () => {
          const m = body.match(/주소\\s*([^]+?)\\s*(지도|내비게이션|거리뷰|찾아가는길|영업시간|전화번호|안내|홈페이지)/);
          if (m && m[1]) {
            const v = clean(m[1]);
            // 너무 짧거나 버튼텍스트면 버림
            if (v && v.length >= 6 && !/(거리뷰|지도|내비게이션)$/i.test(v)) return v;
          }
          return "";
        };

        // 도로명/지번 분리: 지금은 데이터가 섞여 들어오는 경우가 많아서
        // 일단 같은 값으로 채우고, 추후 고도화(지번/도로명 패턴) 가능
        const address = pickAddress();
        const roadAddress = ""; // 필요하면 추후 "도로명" 라벨을 추가로 탐색

        // --- 오시는길/찾아가는길 파싱: 해당 구간만 컷 ---
        // 예: "서대문역 4번 출구에서 90m ... 찾아가는길 ... (설명) ... 영업시간"
        const pickDirections = () => {
          // 1) "찾아가는길" 블록 우선
          let m =
            body.match(/찾아가는길\\s*([^]+?)\\s*(영업시간|휴무일|전화번호|홈페이지|블로그|인스타그램|편의|정보더보기|이용약관)/);
          if (m && m[1]) {
            const v = clean(m[1]);
            if (v && v.length >= 10) return v.slice(0, 400);
          }

          // 2) "오시는 길" 문구가 있으면 그 블록
          m = body.match(/오시는\\s*길\\s*([^]+?)\\s*(영업시간|휴무일|전화번호|홈페이지|블로그|인스타그램|편의|정보더보기|이용약관)/);
          if (m && m[1]) {
            const v = clean(m[1]);
            if (v && v.length >= 10) return v.slice(0, 400);
          }

          // 3) 역/출구/도보 패턴 한 줄이라도 잡기
          m = body.match(/([가-힣A-Za-z0-9]+역\\s*\\d+번\\s*출구[^.]{0,80})/);
          if (m && m[1]) return clean(m[1]).slice(0, 120);

          return "";
        };

        // --- 사진 개수: home에 "사진 939"가 있으면 잡고, 아니면 null ---
        const pickPhotoCount = () => {
          const mm = body.match(/사진\\s*([0-9,]{1,7})/);
          if (!mm || !mm[1]) return null;
          const n = Number(String(mm[1]).replace(/,/g, ""));
          return Number.isFinite(n) ? n : null;
        };

        const directions = pickDirections();
        const photoCount = pickPhotoCount();

        return { name, category, address, roadAddress, directions, photoCount };
      }
    `;

    // @ts-ignore
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
