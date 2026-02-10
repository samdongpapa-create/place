import type { PlaceProfile, ScoreResult, RecommendResult, Industry } from "../core/types.js";
import { getIndustryProfile } from "../industry/profiles.js";

export function recommendForPlace(place: PlaceProfile, scores: ScoreResult, industry: Industry): RecommendResult {
  const prof = getIndustryProfile(industry);

  const region = inferRegion(place.address ?? place.roadAddress ?? "");
  const servicesTop = pickServices(place, prof.serviceKeywords);

  const trustPoints = pickTrustPoints(place, industry);
  const cta = industry === "real_estate"
    ? "방문 상담은 예약하시면 대기 없이 진행됩니다. (전화/톡 문의 후 방문 추천)"
    : "예약/문의는 플레이스 버튼을 이용하시면 가장 빠릅니다. 첫 방문이면 원하는 스타일 사진을 함께 공유해 주세요.";

  const description = prof.descriptionTemplate({
    name: place.name,
    region: region || "해당 지역",
    servicesTop,
    trustPoints,
    cta
  });

  const directions = prof.directionsTemplate({
    region: region || "해당 지역"
  });

  const keywords5 = buildKeywords5(region || "지역", prof.coreIntents, servicesTop);

  const todoTop5 = buildTodo(place, scores);

  const complianceNotes = buildComplianceNotes(prof);

  return {
    keywords5,
    rewrite: { description, directions },
    todoTop5,
    complianceNotes
  };
}

function inferRegion(addr: string) {
  // 예: "서울 서대문구 ..." -> "서대문구"
  const m = addr.match(/([가-힣]+구|[가-힣]+동|[가-힣]+역)/);
  return m?.[1] ?? "";
}

function pickServices(place: PlaceProfile, serviceKeywords: string[]) {
  const text = `${place.description ?? ""}\n${place.tags?.join(" ") ?? ""}\n${place.menus?.map(m => m.name).join(" ") ?? ""}`;
  const hits = serviceKeywords.filter((k) => text.includes(k));
  const uniq = Array.from(new Set(hits));
  return uniq.slice(0, 3);
}

function pickTrustPoints(place: PlaceProfile, industry: Industry) {
  const base = [];
  if ((place.reviews?.visitorCount ?? 0) >= 30) base.push("리뷰 기반으로 많이 찾는 매장");
  if ((place.photos?.count ?? 0) >= 20) base.push("사진 정보가 충분해서 첫 방문도 편함");
  if (industry === "hair_salon") base.push("상담 후 시술 방향을 먼저 잡고 진행");
  if (industry === "cafe") base.push("메뉴/좌석 정보를 미리 보고 오기 쉬움");
  if (industry === "real_estate") base.push("계약 전 체크포인트를 먼저 안내");
  return (base.length ? base : ["기본 정보와 이용 안내를 명확히 제공"]).slice(0, 3);
}

function buildKeywords5(region: string, intents: string[], servicesTop: string[]) {
  const core1 = intents[0]?.replace("{region}", region) ?? `${region} 추천`;
  const core2 = intents[2]?.replace("{region}", region) ?? `${region} 추천`;
  const sig1 = servicesTop[0] ? `${region} ${servicesTop[0]}` : intents[3]?.replace("{region}", region) ?? `${region} 인기메뉴`;
  const sig2 = servicesTop[1] ? `${region} ${servicesTop[1]}` : intents[4]?.replace("{region}", region) ?? `${region} 인기서비스`;
  const conv = intents.find((s) => s.includes("당일") || s.includes("주차") || s.includes("작업"))?.replace("{region}", region)
    ?? `${region} 당일예약`;

  return [
    { keyword: core1, type: "core" as const, reason: "지역+업종 대표 키워드" },
    { keyword: core2, type: "core" as const, reason: "탐색 의도(추천) 키워드" },
    { keyword: sig1, type: "signature" as const, reason: "서비스/메뉴 기반 전환" },
    { keyword: sig2, type: "signature" as const, reason: "추가 서비스/니즈 커버" },
    { keyword: conv, type: "conversion" as const, reason: "즉시 행동 유도" }
  ];
}

function buildTodo(place: PlaceProfile, scores: ScoreResult) {
  const todo: Array<{ action: string; impact: "high" | "mid" | "low"; how: string }> = [];

  if (!place.directions) {
    todo.push({ action: "찾아오는 길 작성", impact: "high", how: "출구/거리/랜드마크/주차/입구까지 5줄 구성" });
  }
  if (!place.description) {
    todo.push({ action: "상세설명 작성", impact: "high", how: "대상→강점→대표서비스→예약 CTA 흐름으로 10~15줄" });
  }
  if ((place.photos?.count ?? 0) < 10) {
    todo.push({ action: "사진 세트 보강", impact: "high", how: "외관/내부/대표 서비스/결과/가격표 등 12장" });
  }
  if ((place.menus?.length ?? 0) < 3) {
    todo.push({ action: "메뉴/가격표 정리", impact: "mid", how: "주요 5개 메뉴에 가격/소요시간/대상 표기" });
  }
  if ((place.reviews?.visitorCount ?? 0) < 10) {
    todo.push({ action: "리뷰 운영 강화", impact: "mid", how: "방문 직후 요청 멘트 + 답글 24시간 내 작성" });
  }

  // 부족하면 채우기
  while (todo.length < 5) {
    todo.push({ action: "소식/공지 주 1회", impact: "low", how: "이달 이벤트/신규 메뉴/시즌 포인트 1개씩" });
  }

  return todo.slice(0, 5);
}

function buildComplianceNotes(prof: any) {
  return [
    "키워드 반복/나열만 있는 문장은 감점 요인입니다(자연스럽게 문장 안에 포함).",
    `다음 표현은 리스크가 있어요: ${prof.bannedPhrases.join(", ")}`
  ];
}
