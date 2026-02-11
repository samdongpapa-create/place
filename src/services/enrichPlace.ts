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

  name?: string;
  category?: string;
  address?: string;
  roadAddress?: string;
  description?: string;
  directions?: string;

  keywords?: string[];
  keywords5?: string[];

  menus?: Menu[];

  photoCount?: number;
  photos?: { count?: number };

  competitors?: Competitor[];

  audit?: any;

  _basicDebug?: any;
  _keywordDebug?: any;
  _menuDebug?: any;
  _competitorDebug?: any;
  _scoreDebug?: any;

  [k: string]: any;
};

export async function enrichPlace(place: PlaceProfileLike): Promise<PlaceProfileLike> {
  const base = basePlaceUrl(place.placeUrl);
  const homeUrl = `${base}/home`;

  // 1) BASIC FIELDS
  try {
    const b = await fetchBasicFieldsViaPlaywright(homeUrl, { timeoutMs: 12000, photo: true, debug: true });

    place.name = place.name || b.fields.name;
    place.category = place.category || b.fields.category;
    place.address = normalizeAddr(place.address || b.fields.address);
    place.roadAddress = place.roadAddress || b.fields.roadAddress;
    place.description = place.description || b.fields.description;
    place.directions = cleanDirections(place.directions || b.fields.directions);

    if (typeof b.fields.photoCount === "number") place.photoCount = b.fields.photoCount;

    place._basicDebug = b.debug;
  } catch (e: any) {
    place._basicDebug = { used: true, targetUrl: homeUrl, error: e?.message ?? "basic fields failed" };
  }

  // 2) KEYWORDS5 (대표키워드)
  if (!place.keywords || place.keywords.length === 0) {
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

  // 3) MENUS
  const isHair = isHairSalon(place);
  if (isHair && (!place.menus || place.menus.length === 0)) {
    const priceUrl = `${base}/price`;
    try {
      const pw = await fetchMenusViaPlaywright(priceUrl);
      if (pw.menus.length) {
        place.menus = cleanMenus(pw.menus);
      }
      // ✅ 중복키 방지: pw.debug를 pwDebug로 감싸기
      place._menuDebug = { used: true, targetUrl: priceUrl, via: "hair-price-pw", pwDebug: pw.debug };
    } catch (e: any) {
      place._menuDebug = { used: true, targetUrl: priceUrl, via: "hair-price-pw", error: e?.message ?? "price pw failed" };
    }
  }

  // 4) COMPETITORS
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

  // 5) SCORE/AUDIT (항상 생성 -> pro는 locked 블랭크)
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
    const placeSearchUrl = `https://m.place.naver.com/search?query=${encodeURIComponent(query)}`;
    const t0 = Date.now();
    let html = "";

    try {
      await page.goto(placeSearchUrl, { waitUntil: "domcontentloaded", timeout: timeoutMs });
      await page.waitForTimeout(800);
      html = await page.content();
      debug.steps.push({ step: "m.place.search", url: placeSearchUrl, ok: true, htmlLen: html.length, elapsedMs: Date.now() - t0 });
    } catch (e: any) {
      debug.steps.push({ step: "m.place.search", url: placeSearchUrl, ok: false, error: e?.message ?? "goto failed", elapsedMs: Date.now() - t0 });
      html = "";
    }

    if (!html || html.length < 5000) {
      const t1 = Date.now();
      const fallbackUrl = `https://m.search.naver.com/search.naver?query=${encodeURIComponent(query)}&where=m`;
      await page.goto(fallbackUrl, { waitUntil: "domcontentloaded", timeout: timeoutMs });
      await page.waitForTimeout(900);
      html = await page.content();
      debug.steps.push({ step: "fallback.m.search", url: fallbackUrl, ok: true, htmlLen: html.length, elapsedMs: Date.now() - t1 });
    }

    const ids = collectPlaceIdsFromHtml(html);
    const dedup = Array.from(new Set(ids)).filter((id) => id && id !== opts.excludePlaceId).slice(0, limit);
    debug.foundCandidates = dedup.length;

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
  while ((m = re.exec(html))) if (m[1]) out.push(m[1]);
  return out;
}

function buildCompetitorQuery(place: PlaceProfileLike) {
  const base = `${place.name || ""} ${place.address || ""} ${place.roadAddress || ""}`;
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
  return t.replace(/^주소\s*/g, "").trim();
}

function cleanDirections(dir?: string) {
  const t = (dir || "").trim();
  if (!t) return undefined;
  const cleaned = t.replace(/\.\.\.\s*내용\s*더보기/g, "").trim();
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
