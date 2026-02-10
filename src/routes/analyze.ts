import { Router } from "express";
import { analyzeRequestSchema } from "../core/validate.js";
import { resolvePlace } from "../services/resolvePlace.js";
import { fetchPlaceHtml } from "../services/fetchPlace.js";
import { parsePlaceFromHtml } from "../services/parsePlace.js";
import { normalizePlace } from "../services/normalize.js";
import { scorePlace } from "../services/score.js";
import { recommendForPlace } from "../services/recommend.js";
import { autoClassifyIndustry } from "../industry/autoClassify.js";
import { applyPlanToRecommend } from "../services/applyPlan.js";

const router = Router();

router.post("/analyze", async (req, res) => {
  const parsed = analyzeRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "INVALID_REQUEST", details: parsed.error.flatten() });
  }

  const input = parsed.data.input;
  const options = parsed.data.options;
  const requestId = `req_${Date.now().toString(36)}`;

  try {
    // 1) URL 확정
    const resolved = await resolvePlace(input as any, options as any);

    // 2) Place fetch & parse
    const html = await fetchPlaceHtml(resolved.placeUrl);
    const rawPlace = parsePlaceFromHtml(html, resolved.placeUrl);
    const place = normalizePlace(rawPlace);

    // 3) 자동 업종 분류
    const auto = autoClassifyIndustry(place);

    // 4) 점수(Vertical 기준)
    const scores = scorePlace(place, auto.vertical);

    // 5) 추천(세부 업종 기준)
    const recommendRaw = recommendForPlace(place, scores, auto.subcategory);

    // 6) 무료/유료 마스킹 적용
    const recommend = applyPlanToRecommend(options.plan, recommendRaw);

    return res.json({
      meta: {
        requestId,
        mode: input.mode,
        plan: options.plan,
        placeUrl: resolved.placeUrl,
        confidence: resolved.confidence,
        fetchedAt: new Date().toISOString()
      },
      industry: {
        vertical: auto.vertical,
        subcategory: auto.subcategory,
        confidence: auto.confidence,
        reasons: auto.reasons
      },
      place,
      scores,
      recommend
    });
} catch (e: any) {
  console.error("❌ ANALYZE ERROR", e);

  return res.status(500).json({
    error: "ANALYZE_FAILED",
    message: e?.message ?? "unknown error",
    stack: process.env.NODE_ENV === "production" ? undefined : e?.stack
  });
}

export default router;

