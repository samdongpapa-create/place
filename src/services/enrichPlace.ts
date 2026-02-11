// src/services/enrichPlace.ts
import { fetchMenusViaPlaywright, type Menu } from "./playwrightMenus.js";
import { fetchExistingKeywordsViaPlaywright } from "./playwrightKeywords.js";
import { fetchRepresentativeKeywords5ByFrameSource } from "./playwrightKeywordList.js";
import { fetchBasicFieldsViaPlaywright } from "./playwrightBasicFields.js";
import { scorePlace } from "./scorePlace.js";
import { chromium } from "playwright";

type Competitor = {
  placeId: string;
  placeUrl: string;
  keywords5?: string[];
  debug?: any;
};

type PlaceProfileLike = {
  placeId?: string;
  placeUrl: string;

  // 기본필드
  name?: string;
  category?: string;
  address?: string;
  roadAddress?: string;
  description?: string;
  directions?: string;

  // 키워드
  keywords?: string[];
  keywords5?: string[];

  // 메뉴
  menus?: Menu[];

  // 사진
  photoCount?: number;
  photos?: { count?: number };

  // 경쟁사
  competitors?: Competitor[];

  // 점수/리포트
  audit?: any;

  // 디버그
  _basicDebug?: any;
  _keywordDebug?: any;
  _menuDebug?: any;
  _competitorDebug?: any;

  [k: string]: any;
};

export async function enrichPlace(place: PlaceProfileLike): Promise<PlaceProfileLike> {
  const base = basePlaceUrl(place.placeUrl);
  const homeUrl = `${base}/home`;

  // =========================================================
  // 1) ✅ 기본필드(이름/카테고리/주소/오시는길/상세설명/사진수)
  // - 상세설명은 여기서 “진짜 소개”를 최대한 안정적으로 잡는다
  // =========================================================
  try {
    const b = await fetchBasicFieldsViaPlaywright(homeUrl, { timeoutMs: 12000, photo: true, debug: true });

    place.name = place.name || b.fields.name;
    place.category = place.category || b.fields.category;
    place.address = normalizeAddr(place.address || b.fields.address);
    place.roadAddress = place.roadAddress || b.fields.roadAddress;

    // ✅ 진짜 상세설명
    place.description = place.description || b.fields.description;

    // ✅ 오시는길(너무 길거나 UI 찌꺼기 섞이면 정리)
    place.directions = cleanDirections(place.directions || b.fields.directions);

    // ✅ 사진수
    if (typeof b.fields.photoCount === "number") place.photoCount = b.fields.photoCount;

    place._basicDebug = b.debug;
  } catch (e: any) {
    place._basicDebug = { used: true, error: e?.message ?? "basic fields failed", targetUrl: homeUrl };
  }

  // =========================================================
  // 2) ✅ 대표키워드(최우선)
  //    1) frame source keywordList (정답)
  //    2) 실패 시 GraphQL/DOM 휴리스틱 폴백
  // =========================================================
  if (!place.keywords || place.keywords.length === 0) {
    // (A) frame keywordList
    try {
      const kw = await fetchRepresentativeKeywords5ByFrameSource(homeUrl);
      if (kw.raw?.length) {
        place.keywords = kw.raw.slice(0, 15);
        place.keywords5 = (kw.keywords5?.length ? kw.keywords5 : kw.raw).slice(0, 5);
      }
      place._keywordDebug = { via: "frame-keywordList", ...kw.debug };
    } catch (e: any) {
      place._keywordDebug = { via: "frame-keywordList", used: true, error: e?.message ?? "keywordList parse failed" };
    }

    // (B) fallback
    if (!place.keywords || place.keywords.length === 0) {
      try {
        const kw2 = await fetchExistingKeywordsViaPlaywright(homeUrl);
        if (kw2.keywords?.length) {
          place.keywords = kw2.keywords.slice(0, 15);
          place.keywords5 = kw2.keywords.slice(0, 5);
        }
        place._keywordDebug = { ...(place._keywordDebug || {}), fallback: { via: "graphql-dom-heuristic", ...kw2.debug } };
      } catch (e: any) {
        place._keywordDebug = { ...(place._keywordDebug || {}), fallback: { via: "graphql-dom-heuristic", error: e?.message ?? "keyword fallback failed" } };
      }
    }
  } else if (!place.keywords5 || place.keywords5.length === 0) {
    place.keywords5 = place.keywords.slice(0, 5);
  }

  // =========================================================
  // 3) ✅ 메뉴/가격(미용실은 /price Playwright)
  // =========================================================
  const isHair = isHairSalon(place);
  if (isHair && (!place.menus || place.menus.length === 0)) {
    const priceUrl = `${base}/price`;
    try {
      const pw = await fetchMenusViaPlaywright(priceUrl);
      if (pw.menus.length) {
        place.menus = cleanMenus(pw.menus);
        place._menuDebug = { via: "hair-price-pw", used: true, targetUrl: priceUrl, ...pw.debug };
      } else {
        place._menuDebug = { via: "hair-price-pw", used: true, targetUrl: priceUrl, ...pw.debug, note: "no menus" };
      }
    } catch (e: any) {
      place._menuDebug = { via: "hair-price-pw", used: true, targetUrl: priceUrl, error: e?.message ?? "price pw failed" };
    }
  }

  // =========================================================
  // 4) ✅ 경쟁사 Top5 키워드(대표키워드 5개) 추출
  // - m.place 검색이 막히는 경우가 많아서 m.search fallback을 기본 포함
  // =========================================================
  if (!Array.isArray(place.competitors) || place.competitors.length === 0) {
    try {
      const query = buildCompetitorQuery(place);
      const comp = await fetchCompetitorsTop5(query, { excludePlaceId: place.placeId, limit: 5, timeoutMs: 20000 });
      place.competitors = comp.competitors;
      place._competitorDebug = comp.debug;
    } catch (e: any) {
      place._competitorDebug = { used: true, error: e?.message ?? "competitors failed" };
      place.competitors = [];
    }
  }

  // =========================================================
  // 5) ✅ 점수/리포트(항상 생성)
  // - free/pro를 “분리하지 않고”
  // - pro 컨텐츠는 _proRaw에 항상 생성
  // - pro.blocks는 locked 블랭크로 유지(결제 후 서버에서 풀기)
  // =========================================================
  try {
    const r = scorePlace(place);
    place.audit = r.audit;
  } catch (e: any) {
    place._scoreDebug = { error: e?.message ?? "scorePlace failed" };
  }

  return place;
}

/* ----------------------------- competitors (inline) ----------------------------- */

async function fetchCompetitorsTop5(
  query: string,
  opts: { excludePlaceId?: string; limit?: number; timeoutMs?: number } = {}
): Promise<{ competitors: Competitor[]; debug: any }> {
  const limit = typeof opts.limit === "number" ? opts.limit : 5;
  const timeoutMs = typeof opts.timeoutMs === "number" ? opts.timeoutMs : 20000;

  const debug: any = { used: true, query, limit, excludePlaceId: opts.excludePlaceId, steps: [] as any[] };

  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  const ctx = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
    locale: "ko-KR"
  });
  const page = await ctx.newPage();

  try {
    // 1) m.place search (종종 403/빈 html)
    const placeSearchUrl = `https://m.place.naver.com/search?query=${encodeURIComponent(query)}`;
    const t0 = Date.now();
    let html = "";
    let ok = false;

    try {
      const res = await page.goto(placeSearchUrl, { waitUntil: "domcontentloaded", timeout: timeoutMs });
      await page.waitForTimeout(800);
      html = await page.content();
      ok = !!res?.ok();
      debug.steps.push({ step: "m.place.search", url: placeSearchUrl, ok, htmlLen: html.length, elapsedMs: Date.now() - t0 });
    } catch (e: any) {
      debug.steps.push({ step: "m.place.search", url: placeSearchUrl, ok: false, error: e?.message ?? "goto failed", elapsedMs: Date.now() - t0 });
      html = "";
    }

    // 2) fallback: m.search
    if (!html || html.length < 5000) {
      const t1 = Date.now();
      const fallbackUrl = `https://m.search.naver.com/search.naver?query=${encodeURIComponent(query)}&where=m`;
      await page.goto(fallbackUrl, { waitUntil: "domcontentloaded", timeout: timeoutMs });
      await page.waitForTimeout(900);
      html = await page.content();
      debug.steps.push({ step: "fallback.m.search", url: fallbackUrl, ok: true, htmlLen: html.length, elapsedMs: Date.now() - t1 });
    }

    // html에서 placeId 후보 수집
    const ids = collectPlaceIdsFromHtml(html);
    const dedup = Array.from(new Set(ids)).filter((id) => id && id !== opts.excludePlaceId).slice(0, limit);

    debug.foundCandidates = dedup.length;

    // 각 competitor의 대표키워드5 뽑기
    const competitors: Competitor[] = [];
    for (const id of dedup) {
      const url = `https://m.place.naver.com/place/${id}/home`;
      try {
        const kw = await fetchRepresentativeKeywords5ByFrameSource(url);
        competitors.push({
          placeId: id,
          placeUrl: url,
          keywords5: (kw.keywords5?.length ? kw.keywords5 : kw.raw || []).slice(0, 5),
          debug: kw.debug
        });
      } catch (e: any) {
        competitors.push({ placeId: id, placeUrl: url, keywords5: [], debug: { used: true, error: e?.message ?? "kw failed" } });
      }
    }

    return { competitors, debug: { ...debug, fallbackUsed: debug.steps.some((x: any) => x.step === "fallback.m.search") } };
  } finally {
    await page.close().catch(() => {});
    await ctx.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

function collectPlaceIdsFromHtml(html: string) {
  const out: string[] = [];
  const re = /m\.place\.naver\.com\/(?:hairshop|place)\/([0-9]{5,})/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    if (m[1]) out.push(m[1]);
  }
  return out;
}

function buildCompetitorQuery(place: PlaceProfileLike) {
  // 우선 역/지역+업종을 쓰고, 없으면 이름+업종
  const base = `${place.name || ""} ${place.address || ""}`;
  const geo = pickFirstMatch(base, [/서대문역/, /광화문/, /종로구/, /마포구/, /충정로/, /시청/]) || "해당 지역";
  const 업종 = isHairSalon(place) ? "미용실" : "가게";
  return `${geo} ${업종}`;
}

function pickFirstMatch(text: string, regs: RegExp[]) {
  for (const r of regs) {
    const m = text.match(r);
    if (m && m[0]) return m[0];
  }
  return "";
}

/* ----------------------------- helpers ----------------------------- */

function isHairSalon(place: PlaceProfileLike) {
  const c = (place.category || "").toLowerCase();
  const n = (place.name || "").toLowerCase();
  return c.includes("미용실") || n.includes("헤어") || n.includes("hair");
}

function basePlaceUrl(url: string) {
  return url.replace(/\/(home|photo|review|price|menu|booking)(\?.*)?$/i, "");
}

function normalizeAddr(addr?: string) {
  const t = (addr || "").trim();
  if (!t) return undefined;
  // "주소서울 ..." 같이 붙어오면 제거
  return t.replace(/^주소\s*/g, "").trim();
}

function cleanDirections(dir?: string) {
  const t = (dir || "").trim();
  if (!t) return undefined;
  // 플레이스 UI 텍스트가 섞이면 길이 제한 + “내용 더보기” 제거
  const cleaned = t.replace(/\.\.\.\s*내용\s*더보기/g, "").trim();
  // 너무 길면 앞부분만
  if (cleaned.length > 500) return cleaned.slice(0, 500).trim();
  return cleaned;
}

function looksLikeParkingFee(name: string) {
  const x = name.toLowerCase();
  return (
    x.includes("주차") ||
    x.includes("분당") ||
    x.includes("초과") ||
    x.includes("최초") ||
    x.includes("시간") ||
    x.includes("요금") ||
    /^[0-9]+$/.test(name.trim())
  );
}

function cleanMenus(menus: Menu[]): Menu[] {
  const out: Menu[] = [];
  const seen = new Set<string>();

  for (const it of menus || []) {
    const name = (it?.name || "").trim();
    const price = typeof it?.price === "number" ? it.price : undefined;

    if (!name) continue;
    if (!/[가-힣A-Za-z]/.test(name)) continue;
    if (looksLikeParkingFee(name)) continue;

    if (typeof price === "number") {
      if (price < 5000) continue;
      if (price > 2000000) continue;
    }

    const key = `${name}:${price ?? "na"}`;
    if (seen.has(key)) continue;
    seen.add(key);

    out.push({
      name,
      ...(typeof price === "number" ? { price } : {}),
      ...(typeof it.durationMin === "number" ? { durationMin: it.durationMin } : {}),
      ...(it.note ? { note: it.note } : {})
    });
  }

  return out.slice(0, 30);
}
