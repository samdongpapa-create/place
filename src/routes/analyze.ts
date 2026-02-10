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

  // ✅ 디버그: home/price에서 실제로 데이터가 오는지 즉시 판정
  const debug: any = {
    resolved: {},
    home: {},
    priceProbe: {}
  };

  try {
    const resolved = await resolvePlace(input as any, options as any);
    debug.resolved = {
      placeUrl: resolved.placeUrl,
      confidence: resolved.confidence,
      placeId: resolved.placeId ?? null
    };

    // ✅ home은 shell일 수 있으니 minLength 낮추고(죽지 않게) debug 켜기
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

    // ✅ price 탭 probe (실패해도 절대 throw 안 남)
    // enrichPlace 안에서도 시도하지만, 여기서 한 번 더 “확정 판정용”으로 찍어둠
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

    // ✅ enrich (photo/price/menu/booking 순회)
    place = (await enrichPlace(place)) as any;

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
        debug // ✅ 여기!
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
  }
});
