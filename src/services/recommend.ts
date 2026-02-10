import type { PlaceProfile, ScoreResult, RecommendResult } from "../core/types.js";
import type { Subcategory } from "../industry/types.js";
import { INDUSTRY_PROFILES } from "../industry/registry.js";

export function recommendForPlace(place: PlaceProfile, scores: ScoreResult, subcategory: Subcategory): RecommendResult {
  const profile = INDUSTRY_PROFILES[subcategory];

  const region = inferRegion(place.address ?? place.roadAddress ?? "") || "해당 지역";
  const services = pickServices(place, profile.serviceKeywords);
  const trust = pickTrust(place, subcategory);

  const cta =
    subcategory.startsWith("real_estate")
      ? "방문 상담은 예약하시면 대기 없이 진행됩니다. (방문 전 연락 추천)"
      : "예약/문의는 네이버 플레이스 버튼을 이용하시면 가장 빠릅니다.";

  const description = profile.descriptionTemplate({
    name: place.name,
    region,
    services: services.length ? services : ["대표 메뉴/서비스 1", "대표 메뉴/서비스 2", "대표 메뉴/서비스 3"],
    trust,
    cta
  });

  const directions = profile.directionsTemplate(region);

  const keywords5 = buildKeywords5(region, profile.coreKeywords, services);

  const todoTop5 = buildTodo(place, scores);

  // subcategory 금칙어 체크
  const complianceNotes = buildCompliance(profile.bannedPhrases, place);

  return {
    keywords5,
    rewrite: { description, directions },
    todoTop5,
    complianceNotes
  };
}

function inferRegion(addr: string) {
  const m = addr.match(/([가-힣]+구|[가-힣]+동|[가-힣]+역)/);
  return m?.[1] ?? "";
}

function pickServices(place: PlaceProfile, dict: string[]) {
  const text = [
    place.description,
    place.tags?.join(" "),
    place.menus?.map(m => m.name).join(" ")
  ].filter(Boolean).join(" ");

  const hits = dict.filter(k => text.includes(k));
  return Array.from(new Set(hits)).slice(0, 3);
}

function pickTrust(place: PlaceProfile, sub: string) {
  const t: string[] = [];
  if ((place.reviews?.visitorCount ?? 0) >= 30) t.push("리뷰 기반으로 꾸준히 찾는 매장");
  if ((place.photos?.count ?? 0) >= 20) t.push("사진 정보가 충분해 첫 방문도 편함");
  if (sub.includes("pub") || sub.includes("bar")) t.push("분위기/좌석 정보 안내가 명확하면 전환이 좋아요");
  if (sub.includes("cafe")) t.push("좌석/콘센트/와이파이 등 이용 정보를 정리하면 체류 고객이 늘어요");
  if (sub.includes("medical")) t.push("진료 안내 문구는 과장 표현 없이 깔끔하게 구성하는 게 좋아요");
  if (sub.includes("real_estate")) t.push("조건 기반으로 빠르게 매물을 좁혀 안내하면 만족도가 높아요");
  return t.length ? t.slice(0, 3) : ["기본 정보(가격/시간/예약)를 명확히 제공"];
}

function buildKeywords5(region: string, coreTemplates: string[], services: string[]) {
  const core = coreTemplates.map(k => k.replace("{region}", region));
  const core1 = core[0] ?? `${region} 추천`;
  const core2 = core[1] ?? `${region} 인기`;

  const sig1 = services[0] ? `${region} ${services[0]}` : (core[2] ?? `${region} 대표서비스`);
  const sig2 = services[1] ? `${region} ${services[1]}` : (core[3] ?? `${region} 추천`);

  const conv = core.find(k => k.includes("예약") || k.includes("당일") || k.includes("작업")) ?? `${region} 예약`;

  return [
    { keyword: core1, type: "core" as const, reason: "지역 기반 대표 키워드" },
    { keyword: core2, type: "core" as const, reason: "탐색 의도 키워드" },
    { keyword: sig1, type: "signature" as const, reason: "서비스/메뉴 기반 전환" },
    { keyword: sig2, type: "signature" as const, reason: "추가 니즈 커버" },
    { keyword: conv, type: "conversion" as const, reason: "행동 유도" }
  ];
}

function buildTodo(place: PlaceProfile, scores: ScoreResult) {
  const todo: Array<{ action: string; impact: "high" | "mid" | "low"; how: string }> = [];

  if (!place.directions) todo.push({ action: "찾아오는 길 보강", impact: "high", how: "출구/거리/랜드마크/주차/입구까지 5~8줄" });
  if (!place.description) todo.push({ action: "상세설명 보강", impact: "high", how: "대상→강점→대표→예약 CTA 흐름" });
  if ((place.photos?.count ?? 0) < 10) todo.push({ action: "사진 세트 추가", impact: "high", how: "외관/내부/대표메뉴(또는 전후)/가격표" });
  if ((place.menus?.length ?? 0) < 3) todo.push({ action: "메뉴/가격 정리", impact: "mid", how: "상위 5개 메뉴에 가격/소요/옵션 표기" });
  if ((place.reviews?.visitorCount ?? 0) < 10) todo.push({ action: "리뷰 운영", impact: "mid", how: "방문 직후 요청 + 답글 24시간 내" });

  while (todo.length < 5) todo.push({ action: "소식 주 1회", impact: "low", how: "이달 포인트 1개(이벤트/신메뉴/시즌)" });

  return todo.slice(0, 5);
}

function buildCompliance(banned: string[], place: PlaceProfile) {
  const text = `${place.description ?? ""}\n${place.directions ?? ""}`;
  const hits = banned.filter(b => text.includes(b));
  const out = ["키워드 나열만 있는 문장은 감점 요인입니다(문장 안에 자연스럽게 포함)."];
  if (hits.length) out.push(`리스크 문구 주의: ${hits.join(", ")}`);
  return out;
}
