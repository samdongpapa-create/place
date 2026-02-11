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

// ✅ 추가: Playwright
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

    // ✅ home fetch (HTML 기반 파싱은 유지)
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
    let place = normalizePlace({ ...rawPlace, placeUrl: fetchedHome.finalUrl }) as any;

    // ✅ price probe (유지)
    try {
      const placeId = place?.placeId || resolved.placeId;
      const priceUrl = placeId
        ? `https://m.place.naver.com/hairshop/${placeId}/price`
        : `${(resolved.placeUrl || "").replace(/\/(home|photo|review|price|menu|booking)(\?.*)?$/i, "")}/price`;

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

    // =====================================================
    // ✅ 핵심: Playwright page를 만들어 enrichPlace에 주입
    // =====================================================
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
      viewport: { width: 390, height: 844 }, // 모바일 느낌
      locale: "ko-KR",
      userAgent:
        "Mozilla/5.0 (Linux; Android 13; SM-G991N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Mobile Safari/537.36"
    });

    // ✅ 속도/안정성: 이미지/폰트 같은 무거운 리소스 차단(필요시 해제 가능)
    await context.route("**/*", (route) => {
      const rt = route.request().resourceType();
      if (rt === "image" || rt === "font" || rt === "media") return route.abort();
      return route.continue();
    });

    page = await context.newPage();

    debug.playwright = {
      used: true,
      headless: true
    };

    // ✅ enrich: 이제 ctx.page가 살아있어서
    // 상세설명/오시는길/메뉴/경쟁사/사진/리뷰 파싱이 실제로 돈다
    place = (await enrichPlace(place, { page })) as any;

    debug.playwright.elapsedMs = Date.now() - t0;

    // =====================================================
    // score + recommend
    // =====================================================
    const industry = autoClassifyIndustry(place);
    const scores = scorePlace(place, industry.vertical);
    const recommendRaw = recommendForPlace(place, scores, industry.subcategory);
    const recommend = applyPlanToRecommend(options.plan, recommendRaw);

    return res.json({
      meta: {
        requestId,
        mode: input.mode,
        plan: options.plan,
        placeUrl: fetchedHome.finalUrl,
        resolvedFrom: resolved.placeUrl,
        resolvedConfidence: resolved.confidence ?? null,
        fetchedAt: new Date().toISOString(),
        debug
      },
      industry,
      place,
      scores,
      recommend
    });
  } catch (e: any) {
    console.error("❌ ANALYZE ERROR", e);
    return res.status(500).json({
      error: "ANALYZE_FAILED",
      message: e?.message ?? "unknown error",
      debug
    });
  } finally {
    // ✅ 누수 방지: 반드시 종료
    try {
      if (page) await page.close();
    } catch {}
    try {
      if (browser) await browser.close();
    } catch {}
  }
});
