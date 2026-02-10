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
    // 1) URL 확정 (biz_search면 내부에서 placeUrl 만들어주는 구조라고 가정)
    const resolved = await resolvePlace(input as any, options as any);

    // 2) HTML fetch & parse
    const html = await fetchPlaceHtml(resolved.placeUrl);
    const rawPlace = parsePlaceFromHtml(html, resolved.placeUrl);

    // 3) normalize
    const place = normalizePlace(rawPlace);

    // 4) 업종 자동분류
    const industry = autoClassifyIndustry(place);

    // 5) 점수(Vertical)
    const scores = scorePlace(place, industry.vertical);

    // 6) 추천(세부 업종)
    const recommendRaw = recommendForPlace(place, scores, industry.subcategory);

    // 7) 무료/유료 마스킹
    const recommend = applyPlanToRecommend(options.plan, recommendRaw);

    return res.json({
      meta: {
        requestId,
        mode: input.mode,
        plan: options.plan,
        placeUrl: resolved.placeUrl,
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
