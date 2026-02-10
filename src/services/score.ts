import type { PlaceProfile, ScoreResult, Industry } from "../core/types.js";
import { getIndustryProfile } from "../industry/profiles.js";

export function scorePlace(place: PlaceProfile, industry: Industry): ScoreResult {
  const prof = getIndustryProfile(industry);

  const missingFields: string[] = [];
  if (!place.description) missingFields.push("description");
  if (!place.directions) missingFields.push("directions");
  if (!place.menus || place.menus.length === 0) missingFields.push("menus");
  if (!place.photos?.count) missingFields.push("photos");

  // discover (0-30)
  let discover = 0;
  discover += place.category ? 6 : 2;
  discover += place.address ? 6 : 0;
  discover += (place.tags?.length ?? 0) >= 3 ? 8 : (place.tags?.length ?? 0) >= 1 ? 5 : 0;
  discover += place.description ? 6 : 0;
  discover += place.reviews?.visitorCount ? 4 : 2;

  // convert (0-30)
  let convert = 0;
  convert += place.description ? scoreStructure(place.description) : 0;
  convert += place.directions ? scoreDirections(place.directions) : 0;
  convert += (place.menus?.length ?? 0) >= 3 ? 8 : (place.menus?.length ?? 0) >= 1 ? 5 : 0;
  convert += place.phone ? 4 : 1;

  // trust (0-25)
  let trust = 0;
  trust += (place.reviews?.visitorCount ?? 0) >= 30 ? 10 : (place.reviews?.visitorCount ?? 0) >= 5 ? 6 : 2;
  trust += (place.photos?.count ?? 0) >= 20 ? 8 : (place.photos?.count ?? 0) >= 5 ? 5 : 2;
  trust += place.reviews?.rating ? 4 : 1;
  trust += (place.tags?.length ?? 0) >= 3 ? 3 : 1;

  // risk (0-15, 좋을수록 높음)
  const text = `${place.description ?? ""}\n${place.directions ?? ""}`;
  const stuffing = detectKeywordStuffing(text);
  const banned = detectBanned(text, prof.bannedPhrases);

  let risk = 15;
  if (stuffing) risk -= 6;
  if (banned) risk -= 6;
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
      stalenessRisk: isStale(place)
    }
  };
}

function scoreStructure(desc: string) {
  // 줄바꿈/소제목/리스트가 있으면 가독성 점수 ↑
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
  // 같은 토큰이 과도 반복되면 stuffing으로 간주(간단 버전)
  const cleaned = text.replace(/[^\p{L}\p{N}\s]/gu, " ").toLowerCase();
  const words = cleaned.split(/\s+/).filter((w) => w.length >= 2);
  const freq = new Map<string, number>();
  for (const w of words) freq.set(w, (freq.get(w) ?? 0) + 1);
  const max = Math.max(0, ...freq.values());
  return max >= 12; // 임계값은 운영하며 조정
}

function detectBanned(text: string, banned: string[]) {
  return banned.some((b) => text.includes(b));
}

function isStale(place: any) {
  // 현재는 단순 플래그(소식/업데이트 날짜를 못 뽑으면 추정)
  // 추후: 소식 최신일/리뷰 최신일을 파싱해서 계산 추천
  const count = place.photos?.count ?? 0;
  return count < 5;
}

function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n));
}
