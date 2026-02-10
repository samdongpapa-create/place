import { Router } from "express";
import { analyzeRequestSchema } from "../core/validate.js";
import { resolvePlace } from "../services/resolvePlace.js";
import { fetchPlaceHtml } from "../services/fetchPlace.js";
import { parsePlaceFromHtml } from "../services/parsePlace.js";
import { normalizePlace } from "../services/normalize.js";
import { scorePlace } from "../services/score.js";
import { recommendForPlace } from "../services/recommend.js";

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
    // 1) placeId / canonical url 확보
    const resolved = await resolvePlace(input, options);

    // 2) place_url 모드면 HTML fetch + parse
    let rawPlace = resolved.rawPlace ?? null;

    if (!rawPlace) {
      const html = await fetchPlaceHtml(resolved.placeUrl);
      rawPlace = parsePlaceFromHtml(html, resolved.placeUrl);
    }

    // 3) normalize
    const place = normalizePlace(rawPlace);

    // 4) score
    const scores = scorePlace(place, options.industry);

    // 5) recommend (업종 프로필 기반)
    const recommend = recommendForPlace(place, scores, options.industry);

    return res.json({
      meta: {
        requestId,
        mode: input.mode,
        industry: options.industry,
        confidence: resolved.confidence,
        fetchedAt: new Date().toISOString()
      },
      place,
      scores,
      recommend
    });
  } catch (e: any) {
    console.error(e);
    return res.status(500).json({
      error: "ANALYZE_FAILED",
      message: e?.message ?? "unknown error"
    });
  }
});

export default router;
