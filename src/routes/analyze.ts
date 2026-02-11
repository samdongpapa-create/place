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
    // 1️⃣ 플레이스 resolve
    const resolved = await resolvePlace(input as any, options as any);

    debug.resolved = {
      placeUrl: resolved.placeUrl,
      confidence: resolved.confidence,
      placeId: resolved.placeId ?? null
    };

    // 2️⃣ 기본 HTML fetch
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

    const rawPlace = parsePlaceFromHtml(
      fetchedHome.html,
      fetchedHome.finalUrl
    );

    let place = normalizePlace({
      ...rawPlace,
      placeUrl: fetchedHome.finalUrl
    }) as any;

    // 3️⃣ price probe (단순 판정용)
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

    // =========================================================
    // 4️⃣ Playwright 실행 (상용화 핵심)
    // =========================================================

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

    // ✅ 타입 에러 방지 위해 route: any 명시
    await context.route("**/*", (route: any) => {
      const rt = route.request().resourceType();
      if (rt === "image" || rt === "font" || rt === "media") {
        return route.abort();
      }
      return route.continue();
    });

    page = await context.newPage();

    debug.playwright = {
      used: true,
      headless: true
    };

    // 🔥 enrichPlace에 page 전달 (이제 ctx.page missing 안 뜸)
    place = await enrichPlace(place, { page });

    debug.playwright.elapsedMs = Date.now() - t0;

    // =========================================================
    // 5️⃣ 점수 + 추천
    // =========================================================

    const industry = autoClassifyIndustry(place);
    const scores = scorePlace(place, industry.vertical);
    const recommendRaw = recommendForPlace(
      place,
      scores,
      industry.subcategory
    );
    const recommend = applyPlanToRecommend(
      options.plan,
      recommendRaw
    );

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
    try {
      if (page) await page.close();
    } catch {}

    try {
      if (browser) await browser.close();
    } catch {}
  }
});

