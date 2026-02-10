import type { PlaceProfile } from "../core/types.js";
import type { Subcategory, Vertical } from "./types.js";
import { SUBCATEGORY_TO_VERTICAL } from "./map.js";

export type AutoIndustry = {
  subcategory: Subcategory;
  vertical: Vertical;
  confidence: number;   // 0~1
  reasons: string[];
};

const RULES: Array<{
  subcategory: Subcategory;
  patterns: RegExp[];
  weight: number;
  reason: string;
}> = [
  // F&B
  { subcategory: "fnb_cafe", weight: 3, reason: "카페/커피/디저트", patterns: [/카페|커피|디저트|브런치|베이커리|원두|라떼|아메리카노/i] },
  { subcategory: "fnb_pub_bar", weight: 3, reason: "주점/술집", patterns: [/술집|주점|이자카야|포차|호프|바|와인바|펍|칵테일|하이볼/i] },
  { subcategory: "fnb_delivery_takeout", weight: 2, reason: "배달/포장", patterns: [/배달|포장|테이크아웃/i] },
  { subcategory: "fnb_restaurant", weight: 2, reason: "식당/음식점", patterns: [/음식점|식당|맛집|정식|한식|양식|중식|일식|분식|고기|초밥|회|국밥|찌개/i] },

  // Beauty
  { subcategory: "beauty_hair_salon", weight: 3, reason: "미용실/헤어", patterns: [/미용실|헤어샵|커트|염색|펌|매직|클리닉|두피|레이어드|허쉬컷/i] },
  { subcategory: "beauty_nail_shop", weight: 3, reason: "네일", patterns: [/네일|젤네일|패디|아트|케어/i] },
  { subcategory: "beauty_skin_care", weight: 3, reason: "피부관리", patterns: [/피부관리|에스테틱|관리샵|페이셜|바디관리|마사지/i] },
  { subcategory: "beauty_waxing", weight: 3, reason: "왁싱/속눈썹", patterns: [/왁싱|브라질리언|속눈썹|래쉬|연장|펌(속눈썹)/i] },

  // Medical
  { subcategory: "medical_dental", weight: 3, reason: "치과", patterns: [/치과|교정|임플란트|스케일링|보철/i] },
  { subcategory: "medical_oriental", weight: 3, reason: "한의원", patterns: [/한의원|한방|추나|침|뜸/i] },
  { subcategory: "medical_vet", weight: 3, reason: "동물병원", patterns: [/동물병원|반려동물|강아지|고양이/i] },
  { subcategory: "medical_clinic", weight: 2, reason: "병원/의원", patterns: [/병원|의원|진료|검사|처방|재활|물리치료|통증/i] },

  // Real estate
  { subcategory: "real_estate_office", weight: 3, reason: "부동산", patterns: [/부동산|공인중개사|전세|월세|매매|임대|원룸|오피스텔|상가/i] }
];

export function autoClassifyIndustry(place: PlaceProfile): AutoIndustry {
  const text = [
    place.name,
    place.category,
    place.address,
    place.roadAddress,
    place.tags?.join(" "),
    place.menus?.map(m => m.name).join(" "),
    place.description,
    place.directions
  ].filter(Boolean).join(" ");

  const scoreMap = new Map<Subcategory, { score: number; reasons: string[] }>();

  for (const r of RULES) {
    for (const p of r.patterns) {
      if (p.test(text)) {
        const cur = scoreMap.get(r.subcategory) ?? { score: 0, reasons: [] };
        cur.score += r.weight;
        if (!cur.reasons.includes(r.reason)) cur.reasons.push(r.reason);
        scoreMap.set(r.subcategory, cur);
        break;
      }
    }
  }

  // ✅ 기본값: fnb_restaurant (단서 없을 때)
  let best: Subcategory = "fnb_restaurant";
  let bestScore = 0;
  let reasons: string[] = ["기본값 적용(단서 부족)"];

  for (const [k, v] of scoreMap.entries()) {
    if (v.score > bestScore) {
      bestScore = v.score;
      best = k;
      reasons = v.reasons;
    }
  }

  const confidence = Math.max(0.3, Math.min(0.95, bestScore / 8));
  const vertical = SUBCATEGORY_TO_VERTICAL[best];

  return { subcategory: best, vertical, confidence, reasons };
}
