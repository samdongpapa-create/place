// src/services/scorePlace.ts
// ✅ 네이버 플레이스 진단 점수(대표키워드 포함) + 추천키워드 + TODO 생성

export type ScoreGrade = "A" | "B" | "C" | "D" | "F";

export type AuditScores = {
  total: number;
  grade: ScoreGrade;
  breakdown: {
    keywords: number;     // 대표키워드
    description: number;  // 상세설명
    directions: number;   // 오시는길
    reviews: number;      // 리뷰
    photos: number;       // 업체등록사진
  };
  weights: {
    keywords: number;
    description: number;
    directions: number;
    reviews: number;
    photos: number;
  };
  signals: {
    missingFields: string[];
    keywordStuffingRisk: boolean;
    stalenessRisk: boolean; // (MVP) 최근성 못보면 true로 둠
  };
  reasons: Record<string, string[]>;
};

export type KeywordRecommendation = {
  existing5: string[];
  suggested5: string[];
  notes: string[];
};

export type TodoItem = { action: string; impact: "high" | "mid" | "low"; how: string };

export type AuditResult = {
  scores: AuditScores;
  recommend: {
    keywords5: { keyword: string; type: "core" | "signature" | "brand"; reason: string }[];
  };
  keyword: KeywordRecommendation;
  todoTop5: TodoItem[];
};

export type Menu = { name: string; price?: number; durationMin?: number; note?: string };

export type PlaceLike = {
  placeUrl: string;
  name?: string;
  category?: string;
  address?: string;
  roadAddress?: string;
  description?: string;
  directions?: string;
  keywords?: string[];  // 원문 대표키워드(최대 15 저장)
  keywords5?: string[]; // 대표키워드 5개
  reviews?: { visitorCount?: number; blogCount?: number; rating?: number };
  photos?: { count?: number };
  menus?: Menu[];
};

const WEIGHTS = { keywords: 25, description: 25, directions: 20, reviews: 20, photos: 10 } as const;

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}
function gradeFrom(total: number): ScoreGrade {
  if (total >= 90) return "A";
  if (total >= 80) return "B";
  if (total >= 70) return "C";
  if (total >= 60) return "D";
  return "F";
}

function normKw(s: string) {
  return (s || "").replace(/^#/, "").trim();
}
function hasKoreanOrAlpha(s: string) {
  return /[가-힣A-Za-z]/.test(s);
}
function uniq(arr: string[]) {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const x of arr) {
    const t = normKw(x);
    if (!t) continue;
    const k = t.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
  }
  return out;
}

function extractDistrict(addr?: string) {
  if (!addr) return null;
  const m = addr.match(/([가-힣]+구)/);
  return m?.[1] ?? null;
}
function extractStation(text?: string) {
  if (!text) return null;
  const m = text.match(/([가-힣A-Za-z]+역)/);
  return m?.[1] ?? null;
}
function isHairSalon(p: PlaceLike) {
  const c = (p.category || "").toLowerCase();
  const n = (p.name || "").toLowerCase();
  return c.includes("미용실") || n.includes("헤어") || n.includes("hair") || c.includes("헤어");
}

function countKeywordRepeats(text: string) {
  const words = text
    .replace(/[^\w가-힣\s]/g, " ")
    .split(/\s+/)
    .map((x) => x.trim())
    .filter(Boolean);

  const freq = new Map<string, number>();
  for (const w of words) {
    if (w.length < 2) continue;
    const k = w.toLowerCase();
    freq.set(k, (freq.get(k) ?? 0) + 1);
  }
  let max = 0;
  for (const v of freq.values()) max = Math.max(max, v);
  return max;
}

/**
 * ✅ 1) 대표키워드 점수(0~100)
 * - 존재(40)
 * - 검색의도 적합(40): 지역/업종/서비스
 * - 품질/리스크(20)
 */
function scoreKeywords(p: PlaceLike): { score: number; reasons: string[]; stuffingRisk: boolean } {
  const reasons: string[] = [];
  const existing = uniq((p.keywords5?.length ? p.keywords5 : (p.keywords ?? [])).slice(0, 10));

  if (existing.length === 0) {
    return { score: 0, reasons: ["대표키워드(keywordList)가 확인되지 않습니다."], stuffingRisk: false };
  }

  // A) 기본(40)
  let s = 0;
  s += existing.length >= 5 ? 30 : 15;
  const tooLong = existing.filter((k) => k.length > 18).length;
  const nonMeaning = existing.filter((k) => !hasKoreanOrAlpha(k)).length;
  if (tooLong === 0 && nonMeaning === 0) s += 10;
  else s += Math.max(0, 10 - tooLong * 2 - nonMeaning * 3);

  // B) 검색 의도(40)
  const district = extractDistrict(p.roadAddress || p.address || "");
  const station = extractStation(p.directions || "") || extractStation(p.name || "");
  const nameLower = (p.name || "").toLowerCase();

  const hasRegion = existing.some((k) => {
    const x = k.toLowerCase();
    return (district && x.includes(district.toLowerCase())) || (station && x.includes(station.toLowerCase())) || /광화문|시청|종로|서대문/.test(k);
  });

  const hasIndustry = existing.some((k) => /미용실|헤어|헤어샵|살롱/i.test(k)) || nameLower.includes("헤어");
  const hasService = existing.some((k) => /(커트|컷|펌|염색|클리닉|두피|뿌리|매직|볼륨|드라이|셋팅|탈색|컬러|다운펌|헤드스파)/i.test(k));

  if (hasRegion) s += 15; else reasons.push("대표키워드에 지역/역 키워드가 없어 검색 매칭 이점이 약합니다.");
  if (hasIndustry) s += 10; else reasons.push("대표키워드에 업종(미용실/헤어샵) 키워드가 부족합니다.");
  if (hasService) s += 15; else reasons.push("대표키워드에 핵심 서비스(커트/펌/염색 등)가 부족합니다.");

  // C) 품질/리스크(20)
  let q = 20;
  const mismatch = existing.filter((k) => /(네일|왁싱|피부|성형|웨딩|촬영|학원|카페|맛집)/i.test(k)).length;
  if (mismatch >= 1) q -= 10;
  if (tooLong >= 2) q -= 6;
  if (existing.length < 5) q -= 5;

  const stuffingRisk = existing.join(" ").includes("  "); // (약한 신호) placeholder
  q = clamp(q, 0, 20);
  s += q;

  s = clamp(Math.round(s), 0, 100);

  if (existing.length >= 5) reasons.push("대표키워드 5개가 정상적으로 설정되어 있습니다.");
  if (mismatch >= 1) reasons.push("대표키워드 일부가 업종과 불일치할 수 있어 교체를 권장합니다.");

  return { score: s, reasons, stuffingRisk };
}

/**
 * ✅ 2) 상세설명 점수(0~100)
 */
function scoreDescription(p: PlaceLike): { score: number; reasons: string[]; keywordStuffingRisk: boolean } {
  const reasons: string[] = [];
  const text = (p.description || "").trim();
  if (!text) return { score: 0, reasons: ["상세설명이 비어 있습니다."], keywordStuffingRisk: false };

  const len = text.length;
  let s = 0;

  // 길이 25
  if (len <= 80) s += 5;
  else if (len <= 200) s += 12;
  else if (len <= 500) s += 20;
  else if (len <= 900) s += 25;
  else s += 18;

  // 구성 요소 35
  const hasService = /(커트|컷|펌|염색|클리닉|두피|뿌리|매직|볼륨|드라이|셋팅|탈색|컬러|다운펌|헤드스파)/i.test(text);
  const hasTarget = /(직장인|학생|초보|손질|손상|탈색|곱슬|두상|모질|라이프스타일)/i.test(text);
  const hasDifferentiator = /(아베다|정품|1:1|맞춤|컨설팅|손상\s*최소|전문|디플로마|Diploma|Colorlist)/i.test(text);
  const hasReservation = /(예약|네이버\s*예약|전화\s*예약|문의)/i.test(text);
  const hasLocation = /(도보|출구|역|인근|근처|광화문|시청|종로|서대문)/i.test(text);

  s += hasService ? 10 : 0;
  s += hasTarget ? 8 : 0;
  s += hasDifferentiator ? 8 : 0;
  s += hasReservation ? 4 : 0;
  s += hasLocation ? 5 : 0;

  // 자연스러움 20 (나열/반복 감점)
  let nat = 20;
  const commaHeavy = (text.match(/,|#|·/g)?.length ?? 0) >= 10;
  if (commaHeavy) nat -= 8;

  const maxRepeat = countKeywordRepeats(text);
  if (maxRepeat >= 8) nat -= 10;
  else if (maxRepeat >= 6) nat -= 6;

  nat = clamp(nat, 0, 20);
  s += nat;

  // 신뢰/리스크 20
  let trust = 20;
  if (/(무조건|최고|100%|완벽|유일)/i.test(text)) trust -= 6;
  if (/방문자리뷰|블로그리뷰/.test(text) && len < 120) trust -= 6;
  trust = clamp(trust, 0, 20);
  s += trust;

  const keywordStuffingRisk = maxRepeat >= 8 || commaHeavy;

  s = clamp(Math.round(s), 0, 100);

  if (!hasService) reasons.push("상세설명에 핵심 서비스(커트/펌/염색 등)가 문장으로 부족합니다.");
  if (!hasTarget) reasons.push("상세설명에 추천 대상(손상/손질/직장인 등)이 부족합니다.");
  if (!hasDifferentiator) reasons.push("상세설명에 차별점(제품/상담/전문성)이 약합니다.");
  if (keywordStuffingRisk) reasons.push("키워드 나열/반복이 감점 요인이 될 수 있습니다(문장형으로 정리 권장).");

  return { score: s, reasons, keywordStuffingRisk };
}

/**
 * ✅ 3) 오시는길 점수(0~100)
 */
function scoreDirections(p: PlaceLike): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  const text = (p.directions || "").trim();
  if (!text) return { score: 0, reasons: ["오시는 길 안내가 비어 있습니다."] };

  let s = 0;

  // 존재/길이 20
  const lines = text.split("\n").map((x) => x.trim()).filter(Boolean);
  if (lines.length <= 2) s += 8;
  else if (lines.length <= 5) s += 15;
  else s += 20;

  // 필수 정보 60 (각 10)
  const hasExit = /(번\s*출구|출구)/.test(text);
  const hasWalk = /(도보|분\s*거리|\d+\s*분)/.test(text);
  const hasLandmark = /(건물|사거리|교차로|은행|약국|스타벅스|GS|CU|올리브영)/.test(text);
  const hasFloor = /(\d+층|지하|엘리베이터|계단|입구)/.test(text);
  const hasParking = /(주차|발렛|유료주차|주차장)/.test(text);
  const hasNaverGuide = /(네이버|길찾기|지도)/.test(text);

  s += hasExit ? 10 : 0;
  s += hasWalk ? 10 : 0;
  s += hasLandmark ? 10 : 0;
  s += hasFloor ? 10 : 0;
  s += hasParking ? 10 : 0;
  s += hasNaverGuide ? 10 : 0;

  // 모호문구 감점(20)
  let amb = 20;
  const vagueOnly = /(인근|근처|확인|참고|권장)/.test(text) && !(hasExit || hasWalk || hasFloor);
  if (vagueOnly) amb -= 15;
  amb = clamp(amb, 0, 20);
  s += amb;

  s = clamp(Math.round(s), 0, 100);

  if (!(hasExit && hasWalk)) reasons.push("출구/도보 시간(예: 4번 출구 도보 1분)을 넣으면 전환이 좋아집니다.");
  if (!hasFloor) reasons.push("층/입구(예: 2층, 엘리베이터) 안내가 있으면 방문 이탈이 줄어듭니다.");
  if (!hasParking) reasons.push("주차 가능/불가/유료 여부를 명시하면 문의 부담이 줄어듭니다.");

  return { score: s, reasons };
}

/**
 * ✅ 4) 리뷰 점수(0~100)
 */
function scoreReviews(p: PlaceLike): { score: number; reasons: string[]; stalenessRisk: boolean } {
  const reasons: string[] = [];
  const v = typeof p.reviews?.visitorCount === "number" ? p.reviews!.visitorCount! : 0;
  const b = typeof p.reviews?.blogCount === "number" ? p.reviews!.blogCount! : 0;
  const rating = typeof p.reviews?.rating === "number" ? p.reviews!.rating! : undefined;

  let s = 0;

  // 방문자 45
  if (v === 0) s += 0;
  else if (v <= 29) s += 10;
  else if (v <= 99) s += 20;
  else if (v <= 299) s += 30;
  else if (v <= 999) s += 40;
  else s += 45;

  // 블로그 25
  if (b === 0) s += 0;
  else if (b <= 9) s += 8;
  else if (b <= 49) s += 15;
  else if (b <= 199) s += 20;
  else s += 25;

  // 평점 10
  if (typeof rating === "number") {
    if (rating >= 4.8) s += 10;
    else if (rating >= 4.5) s += 8;
    else if (rating >= 4.2) s += 6;
    else if (rating >= 4.0) s += 4;
    else s += 2;
  } else {
    s += 5; // 평점 미확인 시 중립
  }

  // 최근성/활동성 20 -> MVP는 데이터 없으니 보수적으로 10 + stalenessRisk true
  const stalenessRisk = true;
  s += 10;

  s = clamp(Math.round(s), 0, 100);

  if (v < 30) reasons.push("방문자 리뷰가 적어 신뢰/노출에서 불리할 수 있습니다(방문 직후 요청 루틴 권장).");
  if (b < 10) reasons.push("블로그 리뷰가 적어 검색 신뢰 요소가 약합니다(체험단/고객 후기 유도 권장).");
  if (stalenessRisk) reasons.push("최근성(최근 리뷰/활동성)은 추가 데이터가 있으면 더 정확히 진단할 수 있습니다.");

  return { score: s, reasons, stalenessRisk };
}

/**
 * ✅ 5) 사진 점수(0~100)
 */
function scorePhotos(p: PlaceLike): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  const c = typeof p.photos?.count === "number" ? p.photos!.count! : 0;

  let s = 0;

  // 개수 50
  if (c <= 4) s += 10;
  else if (c <= 14) s += 25;
  else if (c <= 39) s += 40;
  else s += 50;

  // 필수세트 40: MVP는 자동 판별 어려우니 "메뉴(가격) 추출 성공"을 가격표 대체 신호로 사용
  // (향후 업그레이드: 이미지 alt/메타로 외관/내부/가격표/전후 판별)
  const hasMenuSignal = Array.isArray(p.menus) && p.menus.length >= 5;
  s += hasMenuSignal ? 20 : 10; // 가격표/메뉴 신뢰(간접)
  s += 20; // 내부/외관은 사용자가 체크하는 방식으로 유료에 넣기 좋음

  // 최근 업로드 10: MVP에서는 미확인
  s += 5;

  s = clamp(Math.round(s), 0, 100);

  if (c < 15) reasons.push("업체등록사진이 적어 클릭/전환에서 불리합니다(외관/내부/가격표/시술 결과 세트 권장).");
  if (!hasMenuSignal) reasons.push("가격표/메뉴 관련 사진 또는 정보가 부족하면 신뢰 점수가 떨어질 수 있습니다.");

  return { score: s, reasons };
}

/**
 * ✅ 추천 키워드 5개 (미용실 우선 규칙)
 * - 지역 2 + 업종 1 + 서비스 2
 */
function suggestKeywords5(p: PlaceLike): { suggested5: string[]; objects: AuditResult["recommend"]["keywords5"]; notes: string[] } {
  const notes: string[] = [];
  const objs: AuditResult["recommend"]["keywords5"] = [];

  const existing = uniq((p.keywords5?.length ? p.keywords5 : (p.keywords ?? [])).slice(0, 10)).slice(0, 5);

  const district = extractDistrict(p.roadAddress || p.address || "");
  const station = extractStation(p.directions || "") || extractStation(p.name || "");

  const isHair = isHairSalon(p);

  // 서비스 후보: 메뉴/설명에서 뽑기
  const menuText = (p.menus || []).map((m) => m.name).join(" ");
  const descText = p.description || "";

  const serviceCandidates = [
    { k: "아베다 염색", re: /아베다.*염색|염색.*아베다/i, type: "signature" as const, reason: "매장 강점/브랜드형 서비스로 전환에 유리" },
    { k: "볼륨매직", re: /볼륨매직|매직/i, type: "signature" as const, reason: "검색 수요가 큰 대표 시술 키워드" },
    { k: "다운펌", re: /다운펌/i, type: "signature" as const, reason: "남성 전환 키워드로 효율적" },
    { k: "레이어드컷", re: /레이어드|디자인컷|커트|컷/i, type: "signature" as const, reason: "컷 전환 키워드(예약으로 이어짐)" },
    { k: "두피/헤드스파", re: /두피|헤드스파|스파/i, type: "signature" as const, reason: "차별화/고객 고민 해결형" }
  ];

  const pickedServices: { keyword: string; type: "signature"; reason: string }[] = [];
  for (const c of serviceCandidates) {
    if (c.re.test(menuText) || c.re.test(descText) || existing.some((x) => x.includes(c.k.replace(/\s/g, "")) || x.includes(c.k))) {
      pickedServices.push({ keyword: c.k, type: "signature", reason: c.reason });
    }
  }

  // 부족하면 기본값 채우기(미용실)
  while (pickedServices.length < 2) {
    const fallback = ["디자인컷", "볼륨매직", "다운펌", "염색", "클리닉"];
    const k = fallback.find((x) => !pickedServices.some((p) => p.keyword === x));
    if (!k) break;
    pickedServices.push({ keyword: k, type: "signature", reason: "검색 전환형 기본 서비스 키워드" });
  }

  // 지역 2개
  const region1 = station ? `${station} ${isHair ? "미용실" : "맛집"}` : (district ? `${district} ${isHair ? "미용실" : "가게"}` : (isHair ? "근처 미용실" : "근처 가게"));
  const region2 = district && station ? `${district} ${isHair ? "헤어샵" : "가게"}` : (station ? `${station} 헤어샵` : (district ? `${district} 헤어샵` : (isHair ? "헤어샵 추천" : "추천")));

  const industry = isHair ? "아베다 헤어살롱" : ((p.category || "업체") + "");

  const suggested = uniq([region1, region2, industry, pickedServices[0]?.keyword, pickedServices[1]?.keyword].filter(Boolean) as string[]).slice(0, 5);

  // 추천 객체화
  // core: 지역/업종, signature: 서비스, brand: 브랜드/차별점
  const pushObj = (keyword: string, type: "core" | "signature" | "brand", reason: string) => {
    objs.push({ keyword, type, reason });
  };

  pushObj(region1, "core", "지역+업종 조합은 검색 매칭에 가장 직접적");
  if (region2) pushObj(region2, "core", "상권 확장(구/역)로 노출 범위를 넓힘");
  pushObj(industry, isHair ? "brand" : "core", isHair ? "브랜드/정체성 키워드로 차별화" : "업종 정체성 명확화");
  if (pickedServices[0]) pushObj(pickedServices[0].keyword, "signature", pickedServices[0].reason);
  if (pickedServices[1]) pushObj(pickedServices[1].keyword, "signature", pickedServices[1].reason);

  notes.push("추천 키워드는 ‘지역 2 + 업종 1 + 서비스 2’ 원칙으로 구성했습니다.");
  if (!station) notes.push("역 키워드가 불명확해 ‘구(행정구)’ 기반으로 구성했습니다(오시는길에 역/출구를 넣으면 더 좋아집니다).");

  return { suggested5: suggested, objects: objs.slice(0, 5), notes };
}

function buildTodoTop5(args: {
  p: PlaceLike;
  breakdown: AuditScores["breakdown"];
  keywordNotes: string[];
}): TodoItem[] {
  const { p, breakdown } = args;
  const out: TodoItem[] = [];

  // 대표키워드
  if ((p.keywords5?.length ?? 0) < 5) {
    out.push({
      action: "대표키워드 5개 설정",
      impact: "high",
      how: "스마트플레이스 > 정보 > 대표키워드에서 ‘지역+업종+서비스’ 조합으로 5개를 채우세요."
    });
  } else if (breakdown.keywords < 70) {
    out.push({
      action: "대표키워드에 지역/업종/서비스 균형 맞추기",
      impact: "high",
      how: "현재 키워드 중 2개는 ‘역/구+미용실(헤어샵)’로 교체하고, 2개는 ‘볼륨매직/염색/다운펌’ 같은 전환 키워드로 구성하세요."
    });
  }

  // 상세설명
  if (!p.description || p.description.trim().length < 80) {
    out.push({
      action: "상세설명 300~700자로 보강",
      impact: "high",
      how: "서비스 강점 + 추천 대상 + 차별점(제품/상담) + 예약 동선을 문장으로 정리하세요(키워드 나열은 감점)."
    });
  } else if (breakdown.description < 70) {
    out.push({
      action: "상세설명 문장 구조 개선",
      impact: "mid",
      how: "‘누구에게/무엇을/왜 여기서’ 3문단 구성으로 정리하고, 반복 단어를 줄이세요."
    });
  }

  // 오시는길
  if (!p.directions || p.directions.trim().length < 20) {
    out.push({
      action: "오시는길 6~8줄로 작성",
      impact: "high",
      how: "역/출구 + 도보시간 + 랜드마크 + 층/입구 + 주차 여부를 한 번에 안내하세요."
    });
  } else if (breakdown.directions < 70) {
    out.push({
      action: "오시는길에 ‘출구/도보/층/주차’ 넣기",
      impact: "high",
      how: "‘4번 출구 도보 1분, 2층, 주차 안내’처럼 정보형 문장으로 보강하세요."
    });
  }

  // 사진
  const pc = typeof p.photos?.count === "number" ? p.photos!.count! : 0;
  if (pc < 15) {
    out.push({
      action: "업체등록사진 15장 이상 확보",
      impact: "mid",
      how: "외관/입구/내부/가격표/시술 결과(또는 제품) 5세트를 우선 업로드하세요."
    });
  }

  // 리뷰
  const v = p.reviews?.visitorCount ?? 0;
  if (v < 30) {
    out.push({
      action: "방문자 리뷰 30개 목표 운영",
      impact: "mid",
      how: "결제/시술 직후 ‘리뷰 요청 멘트’로 자연스럽게 유도하고, 24시간 내 답글을 유지하세요."
    });
  } else if ((p.reviews?.blogCount ?? 0) < 10) {
    out.push({
      action: "블로그 리뷰 10개 이상 확보",
      impact: "low",
      how: "고객 후기 콘텐츠(전후/후기)를 블로그에 누적하거나 체험 리뷰를 운영하세요."
    });
  }

  // 5개로 컷
  const impactOrder = { high: 0, mid: 1, low: 2 } as const;
  out.sort((a, b) => impactOrder[a.impact] - impactOrder[b.impact]);
  return out.slice(0, 5);
}

/**
 * ✅ 최종 진단 API
 */
export function scorePlace(place: PlaceLike): AuditResult {
  const missingFields: string[] = [];
  if (!place.description) missingFields.push("description");
  if (!place.directions) missingFields.push("directions");
  if (!place.photos?.count) missingFields.push("photos");
  if (!(place.keywords5?.length || place.keywords?.length)) missingFields.push("keywords");

  const kw = scoreKeywords(place);
  const desc = scoreDescription(place);
  const dir = scoreDirections(place);
  const rev = scoreReviews(place);
  const pho = scorePhotos(place);

  const breakdown = {
    keywords: kw.score,
    description: desc.score,
    directions: dir.score,
    reviews: rev.score,
    photos: pho.score
  };

  const weighted =
    (breakdown.keywords * WEIGHTS.keywords +
      breakdown.description * WEIGHTS.description +
      breakdown.directions * WEIGHTS.directions +
      breakdown.reviews * WEIGHTS.reviews +
      breakdown.photos * WEIGHTS.photos) / 100;

  const total = clamp(Math.round(weighted), 0, 100);
  const grade = gradeFrom(total);

  const recommended = suggestKeywords5(place);

  const reasons: Record<string, string[]> = {
    keywords: kw.reasons,
    description: desc.reasons,
    directions: dir.reasons,
    reviews: rev.reasons,
    photos: pho.reasons
  };

  const todoTop5 = buildTodoTop5({ p: place, breakdown, keywordNotes: recommended.notes });

  return {
    scores: {
      total,
      grade,
      breakdown,
      weights: { ...WEIGHTS },
      signals: {
        missingFields,
        keywordStuffingRisk: desc.keywordStuffingRisk || kw.stuffingRisk,
        stalenessRisk: rev.stalenessRisk
      },
      reasons
    },
    keyword: {
      existing5: uniq((place.keywords5?.length ? place.keywords5 : (place.keywords ?? [])).slice(0, 10)).slice(0, 5),
      suggested5: recommended.suggested5,
      notes: recommended.notes
    },
    recommend: {
      keywords5: recommended.objects
    },
    todoTop5
  };
}
