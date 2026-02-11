// src/services/scorePlace.ts

type AnyObj = Record<string, any>;

type ScoreBreakdown = {
  keywords: number;
  description: number;
  directions: number;
  reviews: number;
  photos: number;
};

type ScoreWeights = {
  keywords: number;
  description: number;
  directions: number;
  reviews: number;
  photos: number;
};

export function scorePlace(place: AnyObj) {
  const breakdown: ScoreBreakdown = {
    keywords: scoreKeywords(place),
    description: scoreDescription(place),
    directions: scoreDirections(place),
    reviews: scoreReviews(place),
    photos: scorePhotos(place),
  };

  const weights: ScoreWeights = {
    keywords: 25,
    description: 25,
    directions: 20,
    reviews: 20,
    photos: 10,
  };

  const total =
    Math.round(
      (breakdown.keywords * weights.keywords +
        breakdown.description * weights.description +
        breakdown.directions * weights.directions +
        breakdown.reviews * weights.reviews +
        breakdown.photos * weights.photos) / 100
    ) || 0;

  const grade = total >= 90 ? "A" : total >= 80 ? "B" : total >= 70 ? "C" : total >= 60 ? "D" : "F";

  const reasons: AnyObj = {
    keywords: [],
    description: [],
    directions: [],
    reviews: [],
    photos: [],
  };

  // 키워드 진단
  const kw5 = Array.isArray(place.keywords5) ? place.keywords5 : [];
  if (kw5.length === 5) reasons.keywords.push("대표키워드 5개가 정상적으로 설정되어 있습니다.");
  if (!kw5.some((k: string) => /역|동|구|시|군|읍|면/.test(k))) {
    reasons.keywords.push("대표키워드에 지역/역 키워드가 없어 검색 매칭 이점이 약합니다.");
  }

  // 상세설명 진단
  const desc = (place.description || "").trim();
  if (!desc) reasons.description.push("상세설명이 비어 있습니다.");
  if (desc && desc.length < 150) reasons.description.push("상세설명이 너무 짧습니다(150자 미만).");
  if (desc && !/(커트|컷|펌|염색|클리닉|매직|셋팅|다운펌)/.test(desc)) {
    reasons.description.push("상세설명에 핵심 서비스(커트/펌/염색 등)가 문장으로 부족합니다.");
  }

  // 오시는길 진단
  const dir = (place.directions || "").trim();
  if (!dir) reasons.directions.push("오시는 길 안내가 비어 있습니다.");
  if (dir && !/(출구|도보|m|분|층)/.test(dir)) reasons.directions.push("오시는길에 출구/도보/층 정보가 부족합니다.");
  if (dir && !/(주차|주차장)/.test(dir)) reasons.directions.push("주차 가능/불가/유료 여부를 명시하면 문의 부담이 줄어듭니다.");

  // 리뷰 진단(지금은 네가 리뷰 상세를 안 긁으니 count 기반)
  const visitCount = toNumber(place?.reviews?.visitCount ?? place?.reviews?.visitor ?? null);
  const blogCount = toNumber(place?.reviews?.blogCount ?? place?.reviews?.blog ?? null);

  if (visitCount !== null && visitCount < 30) reasons.reviews.push("방문자 리뷰가 적어 신뢰/노출에서 불리할 수 있습니다(방문 직후 요청 루틴 권장).");
  if (blogCount !== null && blogCount < 10) reasons.reviews.push("블로그 리뷰가 적어 검색 신뢰 요소가 약합니다(체험단/고객 후기 유도 권장).");
  if (visitCount === null && blogCount === null) {
    reasons.reviews.push("리뷰 수 데이터가 없어 정확한 진단이 제한됩니다(추후 리뷰 탭에서 count 파싱 권장).");
  }

  // 사진 진단
  const photoCount = toNumber(place?.photos?.count ?? place?.photoCount ?? null);
  if (photoCount === null) reasons.photos.push("업체등록사진 수를 확인하지 못했습니다(사진 탭 파싱 보강 필요).");
  if (photoCount !== null && photoCount < 15) reasons.photos.push("업체등록사진이 적어 클릭/전환에서 불리합니다(외관/내부/가격표/시술 결과 세트 권장).");

  // 추천 키워드 5 (기본 룰: 지역2 + 업종1 + 서비스2)
  const suggested5 = buildSuggested5(place);

  const keywordPack = buildKeywordPack(place, suggested5);

  const todoTop5 = buildTodoTop5(place);

  // ✅ PRO raw(잠금 전 “원본 생성”)
  const proRaw = {
    descriptionRewrite: buildDescriptionRewrite(place, keywordPack),
    directionsRewrite: buildDirectionsRewrite(place),
    proTodo: todoTop5,
    competitorAnalysis: buildCompetitorAnalysis(place),
  };

  // ✅ 노출은 locked 블랭크
  const pro = {
    locked: true,
    blocks: [
      { key: "descriptionRewrite", label: "상세설명 복붙 완성본", value: "" },
      { key: "directionsRewrite", label: "오시는길 복붙 완성본", value: "" },
      { key: "proTodo", label: "등급 상승 체크리스트", value: [] },
      { key: "competitorAnalysis", label: "경쟁사 Top5 키워드 분석", value: {} },
    ],
  };

  return {
    audit: {
      scores: { total, grade, breakdown, weights, signals: buildSignals(place, breakdown), reasons },
      keyword: { existing5: kw5, suggested5, notes: ["추천 키워드는 ‘지역 2 + 업종 1 + 서비스 2’ 원칙으로 구성했습니다."] },
      keywordPack,
      todoTop5,
      _proRaw: proRaw,
      pro,
    },
  };
}

/* ---------------- internal scorers ---------------- */

function scoreKeywords(place: AnyObj) {
  const kw5 = Array.isArray(place.keywords5) ? place.keywords5 : [];
  if (kw5.length !== 5) return 40;
  const hasRegion = kw5.some((k: string) => /역|동|구|시|군|읍|면/.test(k));
  return hasRegion ? 85 : 70;
}

function scoreDescription(place: AnyObj) {
  const desc = (place.description || "").trim();
  if (!desc) return 0;
  let s = 30;
  if (desc.length >= 150) s += 30;
  if (desc.length >= 300) s += 20;
  if (/(커트|컷|펌|염색|클리닉|매직|셋팅|다운펌)/.test(desc)) s += 10;
  if (/(아베다|상담|컨설팅|두피|손상|케어)/.test(desc)) s += 10;
  return clamp(s, 0, 100);
}

function scoreDirections(place: AnyObj) {
  const dir = (place.directions || "").trim();
  if (!dir) return 0;
  let s = 40;
  if (/(출구|도보|m|분)/.test(dir)) s += 25;
  if (/(층|입구|건물)/.test(dir)) s += 20;
  if (/(주차|주차장)/.test(dir)) s += 15;
  return clamp(s, 0, 100);
}

function scoreReviews(place: AnyObj) {
  const visitCount = toNumber(place?.reviews?.visitCount ?? place?.reviews?.visitor ?? null);
  const blogCount = toNumber(place?.reviews?.blogCount ?? place?.reviews?.blog ?? null);

  // 없으면 보수적으로 15
  if (visitCount === null && blogCount === null) return 15;

  let s = 10;
  if (visitCount !== null) {
    if (visitCount >= 30) s += 30;
    if (visitCount >= 100) s += 20;
    if (visitCount >= 300) s += 10;
  }
  if (blogCount !== null) {
    if (blogCount >= 10) s += 15;
    if (blogCount >= 50) s += 15;
  }
  return clamp(s, 0, 100);
}

function scorePhotos(place: AnyObj) {
  const photoCount = toNumber(place?.photos?.count ?? place?.photoCount ?? null);
  if (photoCount === null) return 0;
  let s = 20;
  if (photoCount >= 10) s += 30;
  if (photoCount >= 15) s += 20;
  if (photoCount >= 30) s += 30;
  return clamp(s, 0, 100);
}

/* ---------------- packs / pro builders ---------------- */

function buildSuggested5(place: AnyObj) {
  const base = ["서대문역", "서대문", "종로구", "광화문", "시청"];
  const service = ["염색", "아베다염색", "볼륨매직", "레이어드컷", "클리닉"];

  const addr = (place.address || "").toString();
  const region =
    addr.includes("종로") ? "종로구" : addr.includes("서대문") ? "서대문" : base[0];

  const suggested = [
    `${region} 미용실`,
    `${region} 헤어샵`,
    "아베다 헤어살롱",
    "아베다염색",
    "레이어드컷",
  ];

  // 5개 보장
  return suggested.slice(0, 5);
}

function buildKeywordPack(place: AnyObj, suggested5: string[]) {
  const competitors = Array.isArray(place.competitors) ? place.competitors : [];
  const all = competitors.flatMap((c: any) => (Array.isArray(c.keywords5) ? c.keywords5 : []));
  const freq = new Map<string, number>();
  for (const k of all) freq.set(k, (freq.get(k) || 0) + 1);

  const competitorTop = [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .map((x) => x[0])
    .slice(0, 5);

  const merged10 = [...competitorTop, ...suggested5].slice(0, 10);

  return {
    suggested5,
    competitorTopKeywords5: competitorTop,
    merged10,
    notes: ["경쟁사 키워드(빈도 상위) + 추천키워드(전환용) 조합입니다."],
  };
}

function buildTodoTop5(place: AnyObj) {
  const out: any[] = [];

  const desc = (place.description || "").trim();
  if (!desc || desc.length < 300) {
    out.push({
      action: "상세설명 300~700자로 보강",
      impact: "high",
      how: "서비스 강점 + 추천 대상 + 차별점(제품/상담) + 예약 동선을 문장으로 정리하세요(키워드 나열은 감점).",
    });
  }

  const dir = (place.directions || "").trim();
  if (!dir || !/(출구|도보|층)/.test(dir) || !/(주차|주차장)/.test(dir)) {
    out.push({
      action: "오시는길에 ‘출구/도보/층/주차’ 넣기",
      impact: "high",
      how: "‘4번 출구 도보 1분, 2층, 주차 안내’처럼 정보형 문장으로 보강하세요.",
    });
  }

  out.push({
    action: "업체등록사진 15장 이상 확보",
    impact: "mid",
    how: "외관/입구/내부/가격표/시술 결과(또는 제품) 5세트를 우선 업로드하세요.",
  });

  out.push({
    action: "방문자 리뷰 30개 목표 운영",
    impact: "mid",
    how: "결제/시술 직후 ‘리뷰 요청 멘트’로 자연스럽게 유도하고, 24시간 내 답글을 유지하세요.",
  });

  return out.slice(0, 5);
}

function buildDescriptionRewrite(place: AnyObj, keywordPack: any) {
  const name = place.name || "해당 매장";
  const kw2 = (keywordPack?.competitorTopKeywords5 || []).slice(0, 2);
  const tail = kw2.length ? `\n\n(참고 키워드: ${kw2.join(", ")})` : "";

  return (
    `${name}입니다.\n` +
    `커트/펌/염색 등 스타일 상담부터 시술까지 꼼꼼하게 진행합니다.\n` +
    `특히 상담 기반 시술(두상/모질/라이프스타일)을 원하시는 분들께 잘 맞습니다.\n\n` +
    `이런 분들께 추천해요\n` +
    `- 손질이 쉬운 스타일을 원하시는 분\n` +
    `- 컬러/펌 후 손상 관리가 걱정되는 분\n` +
    `- 어떤 스타일이 맞을지 고민이라 상담이 필요한 분\n\n` +
    `예약/문의는 네이버 플레이스 예약 버튼을 이용하시면 가장 빠릅니다.` +
    tail
  );
}

function buildDirectionsRewrite(place: AnyObj) {
  const addr = (place.address || "").toString().trim();
  const dir = (place.directions || "").toString().trim();

  return (
    `- 주소: ${addr || "주소 정보 확인 필요"}\n` +
    `- 길 안내: ${dir || "오시는길 정보 확인 필요"}\n` +
    `- 주차: 가능/불가/유료 여부를 함께 적어두면 문의가 줄어듭니다.\n` +
    `- 입구/층수: 건물명/층/엘리베이터 여부를 한 줄로 추가하면 좋아요.`
  );
}

function buildCompetitorAnalysis(place: AnyObj) {
  const competitors = Array.isArray(place.competitors) ? place.competitors : [];
  const all = competitors.flatMap((c: any) => (Array.isArray(c.keywords5) ? c.keywords5 : []));

  const freq = new Map<string, number>();
  for (const k of all) freq.set(k, (freq.get(k) || 0) + 1);

  const topKeywords10 = [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([keyword, count]) => ({ keyword, count }));

  const byCompetitor = competitors.map((c: any) => ({
    placeId: c.placeId,
    placeUrl: c.placeUrl,
    keywords5: c.keywords5 || [],
  }));

  return { topKeywords10, byCompetitor };
}

function buildSignals(place: AnyObj, breakdown: ScoreBreakdown) {
  const missingFields: string[] = [];
  if (!place.directions) missingFields.push("directions");
  if (!place.description) missingFields.push("description");
  const photoCount = toNumber(place?.photos?.count ?? place?.photoCount ?? null);
  if (photoCount === null || photoCount === 0) missingFields.push("photos");

  return {
    missingFields,
    keywordStuffingRisk: false,
    stalenessRisk: true,
  };
}

/* ---------------- utils ---------------- */

function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n));
}

function toNumber(x: any): number | null {
  if (x === null || x === undefined) return null;
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}
