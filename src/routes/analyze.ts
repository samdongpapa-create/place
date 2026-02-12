// src/routes/analyze.ts
import { Router } from "express";
import { analyzeRequestSchema } from "../core/validate.js";

import { resolvePlace } from "../services/resolvePlace.js";
import { fetchPlaceHtml } from "../services/fetchPlace.js";
import { parsePlaceFromHtml } from "../services/parsePlace.js";
import { normalizePlace } from "../services/normalize.js";
import { enrichPlace } from "../services/enrichPlace.js";

import { autoClassifyIndustry } from "../industry/autoClassify.js";
import { scorePlace } from "../services/score.js";
import { recommendForPlace } from "../services/recommend.js";
import { applyPlanToRecommend } from "../services/applyPlan.js";

import { chromium } from "playwright";

export const analyzeRouter = Router();

const hasNext = (html: string) => /id="__NEXT_DATA__"/i.test(html);

analyzeRouter.post("/analyze", async (req, res) => {
  const parsed = analyzeRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "INVALID_REQUEST",
      details: parsed.error.flatten()
    });
  }

  const { input, options } = parsed.data;
  const requestId = `req_${Date.now().toString(36)}`;

  const debug: any = {
    resolved: {},
    home: {},
    priceProbe: {},
    playwright: {}
  };

  let browser: any = null;
  let page: any = null;

  try {
    const resolved = await resolvePlace(input as any, options as any);
    debug.resolved = {
      placeUrl: resolved.placeUrl,
      confidence: resolved.confidence,
      placeId: resolved.placeId ?? null
    };

    const fetchedHome = await fetchPlaceHtml(resolved.placeUrl, {
      minLength: 120,
      retries: 1,
      timeoutMs: 9000,
      debug: true
    });

    debug.home = {
      finalUrl: fetchedHome.finalUrl,
      len: fetchedHome.html.length,
      hasNextData: hasNext(fetchedHome.html)
    };

    const rawPlace = parsePlaceFromHtml(fetchedHome.html, fetchedHome.finalUrl);

    let place = normalizePlace({
      ...rawPlace,
      placeUrl: fetchedHome.finalUrl
    }) as any;

    // price probe (판정용)
    try {
      const placeId = place?.placeId || resolved.placeId;
      const priceUrl = placeId
        ? `https://m.place.naver.com/hairshop/${placeId}/price`
        : `${(resolved.placeUrl || "").replace(
            /\/(home|photo|review|price|menu|booking)(\?.*)?$/i,
            ""
          )}/price`;

      const fetchedPrice = await fetchPlaceHtml(priceUrl, {
        minLength: 120,
        retries: 1,
        timeoutMs: 9000,
        debug: true
      });

      debug.priceProbe = {
        url: priceUrl,
        finalUrl: fetchedPrice.finalUrl,
        len: fetchedPrice.html.length,
        hasNextData: hasNext(fetchedPrice.html)
      };
    } catch (e: any) {
      debug.priceProbe = { error: e?.message ?? String(e) };
    }

    // Playwright
    const t0 = Date.now();
    browser = await chromium.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu"
      ]
    });

    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      locale: "ko-KR",
      userAgent:
        "Mozilla/5.0 (Linux; Android 13; SM-G991N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Mobile Safari/537.36"
    });

    await context.route("**/*", (route: any) => {
      const rt = route.request().resourceType();
      if (rt === "image" || rt === "font" || rt === "media") return route.abort();
      return route.continue();
    });

    page = await context.newPage();

    debug.playwright = { used: true, headless: true };
    place = await enrichPlace(place, { page });
    debug.playwright.elapsedMs = Date.now() - t0;

    // 점수/추천
    const industry = autoClassifyIndustry(place);
    const scores = scorePlace(place, industry.vertical);
    const recommendRaw = recommendForPlace(place, scores, industry.subcategory);
    const recommend = applyPlanToRecommend(options.plan, recommendRaw);

    // ✅ 여기서 "상용화용 슬림 응답"으로 변환
    const safe = pruneForClient({ place, scores, recommend, debug }, {
      plan: options.plan,
      includeDebug: !!options.debug // 디버그 옵션 있을 때만 원본 debug 크게 내려줌
    });

    return res.json({
      meta: {
        requestId,
        mode: input.mode,
        plan: options.plan,
        placeUrl: fetchedHome.finalUrl,
        resolvedFrom: resolved.placeUrl,
        resolvedConfidence: resolved.confidence ?? null,
        fetchedAt: new Date().toISOString(),
        debug: safe.debug
      },
      industry,
      place: safe.place,
      scores: safe.scores,
      recommend: safe.recommend
    });
  } catch (e: any) {
    console.error("❌ ANALYZE ERROR", e);
    return res.status(500).json({
      error: "ANALYZE_FAILED",
      message: e?.message ?? "unknown error",
      debug
    });
  } finally {
    try { if (page) await page.close(); } catch {}
    try { if (browser) await browser.close(); } catch {}
  }
});

/* =========================
 * ✅ 응답 슬림화
 * ========================= */

function pruneForClient(
  payload: { place: any; scores: any; recommend: any; debug: any },
  opts: { plan: "free" | "pro"; includeDebug: boolean }
) {
  const { place, scores, recommend, debug } = payload;

  // 1) place는 필요한 키만 남기기
  const placeOut: any = {
    placeId: place.placeId,
    placeUrl: stripQuery(place.placeUrl),
    name: place.name,
    category: place.category,
    address: place.address,
    roadAddress: place.roadAddress,
    description: place.description,
    directions: place.directions,
    keywords5: Array.isArray(place.keywords5) ? place.keywords5.slice(0, 5) : [],
    // 상용화에서 메뉴는 보여줄지 말지 선택 (일단 20개 제한)
    menus: Array.isArray(place.menus) ? place.menus.slice(0, 20) : [],
    // 경쟁사는 PRO에서만
    competitors:
      opts.plan === "pro" && Array.isArray(place.competitors)
        ? place.competitors.slice(0, 5).map((c: any) => ({
            placeId: c.placeId,
            placeUrl: stripQuery(c.placeUrl),
            keywords5: Array.isArray(c.keywords5) ? c.keywords5.slice(0, 5) : []
          }))
        : []
  };

  // 2) 추천도 과한 덩어리 제거 (필요한 블록만)
  const recOut: any = {
    keywords5: recommend?.keywords5 ?? [],
    todoTop5: recommend?.todoTop5 ?? [],
    rewrite: recommend?.rewrite ?? {}
  };

  // 3) scores는 그대로 OK (가볍다)
  const scoresOut = scores;

  // 4) debug는 기본 OFF, 켜면 “핵심만” (raw bodyText 같은 거 내려주지마)
  const debugOut = opts.includeDebug
    ? {
        resolved: debug?.resolved,
        home: debug?.home,
        priceProbe: debug?.priceProbe,
        playwright: debug?.playwright,
        // 내부 디버그도 raw 통째로 말고 요약만
        basic: slimDebug(place?._basicDebug),
        keyword: slimDebug(place?._keywordDebug),
        menu: slimDebug(place?._menuDebug),
        competitor: slimDebug(place?._competitorDebug)
      }
    : null;

  return { place: placeOut, scores: scoresOut, recommend: recOut, debug: debugOut };
}

function slimDebug(d: any) {
  if (!d) return null;
  // raw/bodyText/nextJson 같은 초대형 키 제거
  const { raw, bodyText, nextJsonText, ...rest } = d;
  return rest;
}

function stripQuery(url: string) {
  return (url || "").replace(/\?.*$/, "");
}

