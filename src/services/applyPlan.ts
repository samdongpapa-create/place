import type { RecommendResult } from "../core/types.js";
import type { Plan } from "../industry/types.js";

export function applyPlanToRecommend(plan: Plan, r: RecommendResult): RecommendResult {
  if (plan === "pro") return r;

  return {
    ...r,
    keywords5: r.keywords5.slice(0, 3),
    rewrite: {
      description: "🔒 PRO에서 ‘상세설명 복붙 완성본’이 제공됩니다.",
      directions: "🔒 PRO에서 ‘찾아오는 길 복붙 완성본’이 제공됩니다."
    },
    todoTop5: r.todoTop5.slice(0, 2),
    complianceNotes: r.complianceNotes.slice(0, 1)
  };
}
