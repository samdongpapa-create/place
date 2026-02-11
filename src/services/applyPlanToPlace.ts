// src/services/applyPlanToPlace.ts
export function applyPlanToPlace(plan: string, place: any) {
  const p = (plan || "free").toLowerCase();

  if (!place?.audit?.pro) return place;

  // free/basic면 잠금 유지
  if (p !== "pro") {
    place.audit.pro.locked = true;
    // value 비우기(혹시 남아있으면)
    if (Array.isArray(place.audit.pro.blocks)) {
      for (const b of place.audit.pro.blocks) {
        b.value = b.key === "proTodo" ? [] : b.key === "competitorAnalysis" ? {} : "";
      }
    }
    return place;
  }

  // pro면 잠금 해제 + _proRaw 값을 blocks.value에 주입
  place.audit.pro.locked = false;

  const raw = place.audit._proRaw || {};
  const blocks = Array.isArray(place.audit.pro.blocks) ? place.audit.pro.blocks : [];

  for (const b of blocks) {
    if (!b?.key) continue;

    if (b.key === "descriptionRewrite") b.value = raw.descriptionRewrite || "";
    else if (b.key === "directionsRewrite") b.value = raw.directionsRewrite || "";
    else if (b.key === "proTodo") b.value = raw.proTodo || [];
    else if (b.key === "competitorAnalysis") b.value = raw.competitorAnalysis || {};
  }

  return place;
}
