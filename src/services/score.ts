import type { PlaceProfile, ScoreResult } from "../core/types.js";
import type { Vertical } from "../industry/types.js";

export function scorePlace(place: PlaceProfile, _vertical: Vertical): ScoreResult {
  // ✅ MVP: vertical 상관없이 공통 점수
  // (추후 vertical별 가중치 조정은 여기에서 분기)

  const missingFields: string[] = [];
  if (!place.description) missingFields.push("description");
  if (!place.directions) missingFields.push("directions");
  if (!place.menus || place.menus.length === 0) missingFields.push("menus");
  if (!place.photos?.count) missingFields.push("photos");

  let discover = 0;
  discover += place.category ? 6 : 2;
  discover += place.address ? 6 : 0;
  discover += (place.tags?.length ?? 0) >= 3 ? 8 : (place.tags?.length ?? 0) >= 1 ? 5 : 0;
  discover += place.description ? 6 : 0;
  discover += place.reviews?.visitorCount ? 4 : 2;

  let convert = 0;
  convert += place.description ? scoreStructure(place.description) : 0;
  convert += place.directions ? scoreDirections(place.directions) : 0;
  convert += (place.menus?.length ?? 0) >= 3 ? 8 : (place.menus?.length ?? 0) >= 1 ? 5 : 0;
  convert += place.phone ? 4 : 1;

  let trust = 0;
  trust += (place.reviews?.visitorCount ?? 0) >= 30 ? 10 : (place.reviews?.visitorCount ?? 0) >= 5 ? 6 : 2;
  trust += (place.photos?.count ?? 0) >= 20 ? 8 : (place.photos?.count ?? 0) >= 5 ? 5 : 2;
  trust += place.reviews?.rating ? 4 : 1;
  trust += (place.tags?.length ?? 0) >= 3 ? 3 : 1;

  // risk는 추천 단계에서 subcategory 금칙어로 더 정확히 처리할 거라 MVP에선 간단히
  let risk = 15;
  const stuffing = detectKeywordStuffing(`${place.description ?? ""}\n${place.directions ?? ""}`);
  if (stuffing) risk -= 6;
  risk = clamp(risk, 0, 15);

  const total = clamp(discover + convert + trust + risk, 0, 100);
  const grade = total >= 90 ? "A" : total >= 80 ? "B" : total >= 70 ? "C" : total >= 60 ? "D" : "F";

  return {
    total,
    grade,
    breakdown: {
      discover: clamp(discover, 0, 30),
      convert: clamp(convert, 0, 30),
      trust: clamp(trust, 0, 25),
      risk
    },
    signals: {
      missingFields,
      keywordStuffingRisk: stuffing,
      stalenessRisk: (place.photos?.count ?? 0) < 5
    }
  };
}

function scoreStructure(desc: string) {
  let s = 0;
  const lines = desc.split("\n").filter((l) => l.trim().length > 0);
  if (lines.length >= 8) s += 5;
  if (desc.includes("- ")) s += 3;
  if (desc.length >= 300) s += 2;
  return clamp(s, 0, 10);
}

function scoreDirections(dir: string) {
  let s = 0;
  if (dir.match(/출구|번 출구/)) s += 3;
  if (dir.match(/도보|m|분/)) s += 3;
  if (dir.match(/주차/)) s += 2;
  if (dir.length >= 150) s += 2;
  return clamp(s, 0, 10);
}

function detectKeywordStuffing(text: string) {
  const cleaned = text.replace(/[^\p{L}\p{N}\s]/gu, " ").toLowerCase();
  const words = cleaned.split(/\s+/).filter((w) => w.length >= 2);
  const freq = new Map<string, number>();
  for (const w of words) freq.set(w, (freq.get(w) ?? 0) + 1);
  const max = Math.max(0, ...freq.values());
  return max >= 12;
}

function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n));
}
