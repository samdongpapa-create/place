// src/routes/analyze.ts
import { Router } from "express";
import { analyzeRequestSchema } from "../core/validate.js";

import { resolvePlace } from "../services/resolvePlace.js";
import { fetchPlaceHtml } from "../services/fetchPlace.js";
import { parsePlaceFromHtml } from "../services/parsePlace.js";
import { normalizePlace } from "../services/normalize.js";

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
    // 1) 입력 URL 정규화(일단 place/home로 맞춤)
    const resolved = await resolvePlace(input as any, options as any);

    // 2) HTML fetch (리다이렉트 최종 URL까지 받음)
    const fetched = await fetchPlaceHtml(resolved.placeUrl);

    // 3) 파싱은 최종 URL 기준으로
    const rawPlace = parsePlaceFromHtml(fetched.html, fetched.finalUrl);

    // 4) normalize
    const place = normalizePlace({
      ...rawPlace,
      placeUrl: fetched.finalUrl
    });

    // 5) 업종 자동분류
    const industry = autoClassifyIndustry(place);

    // 6) 점수/추천
    const scores = scorePlace(place, industry.vertical);
    const recommendRaw = recommendForPlace(place, scores, industry.subcategory);
    const recommend = applyPlanToRecommend(options.plan, recommendRaw);

    return res.json({
      meta: {
        requestId,
        mode: input.mode,
        plan: options.plan,
        placeUrl: fetched.finalUrl,             // ✅ 최종 URL
        resolvedFrom: resolved.placeUrl,        // ✅ 정규화된 원본(디버그용)
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
