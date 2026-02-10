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

const router = Router();

router.post("/analyze", async (req, res) => {
  const parsed = analyzeRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "INVALID_REQUEST",
      details: parsed.error.flatten()
    });
  }

  const { input, options } = parsed.data;
  const requestId = `req_${Date.now().toString(36)}`;

  try {
    const resolved = await resolvePlace(input as any, options as any);

    const fetched = await fetchPlaceHtml(resolved.placeUrl);
    const rawPlace = parsePlaceFromHtml(fetched.html, fetched.finalUrl);

    let place = normalizePlace({
      ...rawPlace,
      placeUrl: fetched.finalUrl
    });

    // ✅ 추가 보강: /photo, /price(/menu)에서 더 채움 + directions 자동 생성
    place = (await enrichPlace(place as any)) as any;

    const industry = autoClassifyIndustry(place);

    const scores = scorePlace(place, industry.vertical);
    const recommendRaw = recommendForPlace(place, scores, industry.subcategory);
    const recommend = applyPlanToRecommend(options.plan, recommendRaw);

    return res.json({
      meta: {
        requestId,
        mode: input.mode,
        plan: options.plan,
        placeUrl: fetched.finalUrl,
        resolvedFrom: resolved.placeUrl,
        resolvedConfidence: resolved.confidence ?? null,
        fetchedAt: new Date().toISOString()
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
      message: e?.message ?? "unknown error"
    });
  }
});

export default router;
