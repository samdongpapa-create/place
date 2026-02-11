// src/services/scorePlace.ts
type PlaceLike = {
  name?: string;
  category?: string;
  address?: string;
  roadAddress?: string;
  description?: string;
  directions?: string;
  keywords5?: string[];
  keywords?: string[];
  photos?: { count?: number };
  photoCount?: number; // from basic fields
  reviews?: any; // (확장용)
  competitors?: { placeId: string; placeUrl: string; keywords5?: string[] }[];
  [k: string]: any;
};

type ScoreBreakdown = {
  keywords: number;
  description: number;
  directions: number;
  reviews: number;
  photos: number;
};

export function scorePlace(place: PlaceLike) {
  // -------------------------
  // 1) 키워드(대표키워드 5) 점수
  // -------------------------
  const kw5 = (place.keywords5 || []).filter(Boolean).slice(0, 5);
  const kwScore = scoreKeywords(kw5, place);

  // -------------------------
  // 2) 상세설명 점수
  // -------------------------
  const descScore = scoreDescription(place.description || "", kw5);

  // -------------------------
  // 3) 오시는길 점수
  // -------------------------
  const dirScore = scoreDirections(place.directions || "");

  // -------------------------
  // 4) 리뷰 점수 (지금은 count만 없어서 “보수적”으로 처리)
  // - later: 방문자/블로그 리뷰 수 + 최근성/답글 여부 등 추가 가능
  // -------------------------
  const reviewScore = scoreReviews(place);

  // -------------------------
  // 5) 사진 점수
  // -------------------------
  const photoCount = pickPhotoCount(place);
  const photosScore = scorePhotos(photoCount);

  const breakdown: ScoreBreakdown = {
    keywords: kwScore.score,
    description: descScore.score,
    directions: dirScore.score,
    reviews: reviewScore.score,
    photos: photosScore.score
  };

  const weights = { keywords: 25, description: 25, directions: 20, reviews: 20, photos: 10 };

  const total =
    Math.round(
      (breakdown.keywords * weights.keywords +
        breakdown.description * weights.description +
        breakdown.directions * weights.directions +
        breakdown.reviews * weights.reviews +
        breakdown.photos * weights.photos) /
        100
    ) || 0;

  const grade = gradeFrom(total);

  // -------------------------
  // 추천키워드(5) + 경쟁사 키워드 top5
  // -------------------------
  const suggested5 = suggestKeywords5(place, kw5);
  const competitorTopKeywords5 = topCompetitorKeywords(place);

  const keywordPack = {
    suggested5,
    competitorTopKeywords5,
    merged10: [...competitorTopKeywords5, ...suggested5].slice(0, 10),
    notes: ["경쟁사 키워드(빈도 상위) + 추천키워드(전환용) 조합입니다."]
  };

  // -------------------------
  // PRO 컨텐츠(항상 생성)
  // -------------------------
  const proRaw = buildProRaw(place, keywordPack);

  // -------------------------
  // FREE 화면에는 locked 블랭크(항상)
  // 실제 결제 후에는 서버/클라이언트에서 pro.locked=false로 바꾸고 pro.blocks.value에 proRaw를 채워주면 됨
  // -------------------------
  const pro = {
    locked: true,
    blocks: [
      { key: "descriptionRewrite", label: "상세설명 복붙 완성본", value: "" },
      { key: "directionsRewrite", label: "오시는길 복붙 완성본", value: "" },
      { key: "proTodo", label: "등급 상승 체크리스트", value: [] as any[] },
      { key: "competitorAnalysis", label: "경쟁사 Top5 키워드 분석", value: {} as any }
    ]
  };

  const reasons = {
    keywords: kwScore.reasons,
    description: descScore.reasons,
    directions: dirScore.reasons,
    reviews: reviewScore.reasons,
    photos: photosScore.reasons
  };

  const signals = {
    missingFields: [
      ...(place.description ? [] : ["description"]),
      ...(place.directions ? [] : ["directions"]),
      ...(photoCount ? [] : ["photos"])
    ],
    keywordStuffingRisk: descScore.keywordStuffingRisk,
    stalenessRisk: true
  };

  const todoTop5 = proRaw.proTodo.slice(0, 5);

  return {
    audit: {
      scores: { total, grade, breakdown, weights, signals, reasons },
      keyword: {
        existing5: kw5,
        suggested5,
        notes: ["추천 키워드는 ‘지역 2 + 업종 1 + 서비스 2’ 원칙으로 구성했습니다."]
      },
      keywordPack,
      todoTop5,
      // ✅ 실제 pro 컨텐츠는 여기(항상 생성)
      _proRaw: proRaw,
      // ✅ 노출은 locked 블랭크
      pro
    }
  };
}

function gradeFrom(total: number) {
  if (total >= 90) return "S";
  if (total >= 80) return "A";
  if (total >= 70) return "B";
  if (total >= 60) return "C";
  if (total >= 50) return "D";
  return "F";
}

function scoreKeywords(kw5: string[], place: PlaceLike) {
  const reasons: string[] = [];
  let s = 0;

  if (kw5.length >= 5) s += 60;
  else if (kw5.length >= 3) s += 35;
  else if (kw5.length >= 1) s += 15;

  // “지역/역” 키워드가 5개 안에 최소 1개는 있어야 검색매칭이 유리하다고 가정
  const hasGeo = kw5.some((k) => /역|동|구|시|군|로|길|광화문|서대문|종로|마포|충정로|시청|서울/.test(k));
  if (hasGeo) s += 25;
  else reasons.push("대표키워드에 지역/역 키워드가 없어 검색 매칭 이점이 약합니다.");

  // 브랜드/시그니처 포함 가산
  const hasBrand = kw5.some((k) => /아베다|AVEDA/.test(k));
  if (hasBrand) s += 10;

  if (kw5.length === 5) reasons.push("대표키워드 5개가 정상적으로 설정되어 있습니다.");

  return { score: clamp(s, 0, 100), reasons };
}

function scoreDescription(desc: string, kw5: string[]) {
  const reasons: string[] = [];
  const t = (desc || "").trim();
  if (!t) return { score: 0, reasons: ["상세설명이 비어 있습니다."], keywordStuffingRisk: false };

  let s = 20;

  // 길이
  const len = t.length;
  if (len >= 600) s += 35;
  else if (len >= 300) s += 25;
  else if (len >= 150) s += 15;
  else reasons.push("상세설명이 너무 짧습니다(150자 미만).");

  // 서비스 키워드(미용실 기준 간단 룰)
  const hasService = /(커트|컷|펌|염색|클리닉|두피|헤어스파|매직|셋팅)/.test(t);
  if (hasService) s += 20;
  else reasons.push("상세설명에 핵심 서비스(커트/펌/염색 등)가 문장으로 부족합니다.");

  // 추천 대상
  const hasPersona = /(직장인|손상|손질|스타일|상담|맞춤|퍼스널)/.test(t);
  if (hasPersona) s += 10;
  else reasons.push("상세설명에 추천 대상(손상/손질/직장인 등)이 부족합니다.");

  // 차별점(브랜드/전문성/제품 등)
  const hasDiffer = /(아베다|AVEDA|전문|경력|상담|진단|맞춤)/.test(t);
  if (hasDiffer) s += 10;
  else reasons.push("상세설명에 차별점(제품/상담/전문성)이 약합니다.");

  // 키워드 나열 감지(대충)
  const keywordStuffingRisk = /[,/·•]/.test(t) && (t.match(/미용실|헤어샵|염색|펌|커트/g)?.length || 0) > 6;

  if (keywordStuffingRisk) {
    s -= 10;
    reasons.push("키워드 나열형 문장(쉼표/구분자)이 많으면 감점될 수 있습니다.");
  }

  // 대표키워드가 문장 속에 자연 포함되면 가산
  const included = kw5.filter((k) => k && t.includes(k)).length;
  if (included >= 2) s += 5;

  return { score: clamp(s, 0, 100), reasons, keywordStuffingRisk };
}

function scoreDirections(dir: string) {
  const reasons: string[] = [];
  const t = (dir || "").trim();
  if (!t) return { score: 0, reasons: ["오시는 길 안내가 비어 있습니다."] };

  let s = 20;
  const len = t.length;

  if (len >= 180) s += 35;
  else if (len >= 90) s += 25;
  else if (len >= 40) s += 15;

  const hasExit = /출구/.test(t);
  const hasMin = /도보|분|m|미터/.test(t);
  const hasFloor = /층|입구|건물|옆|맞은편/.test(t);
  const hasParking = /주차/.test(t);

  if (hasExit) s += 15;
  if (hasMin) s += 10;
  if (hasFloor) s += 10;
  if (hasParking) s += 10;
  else reasons.push("주차 가능/불가/유료 여부를 명시하면 문의 부담이 줄어듭니다.");

  return { score: clamp(s, 0, 100), reasons };
}

function scoreReviews(_place: PlaceLike) {
  // 지금은 리뷰 상세를 아직 안정적으로 못 뽑는 단계라고 보고 “보수적”
  const reasons = [
    "방문자 리뷰가 적어 신뢰/노출에서 불리할 수 있습니다(방문 직후 요청 루틴 권장).",
    "블로그 리뷰가 적어 검색 신뢰 요소가 약합니다(체험단/고객 후기 유도 권장).",
    "최근성(최근 리뷰/활동성)은 추가 데이터가 있으면 더 정확히 진단할 수 있습니다."
  ];
  return { score: 15, reasons };
}

function pickPhotoCount(place: PlaceLike) {
  const n1 = place.photos?.count;
  if (typeof n1 === "number" && Number.isFinite(n1)) return n1;
  const n2 = place.photoCount;
  if (typeof n2 === "number" && Number.isFinite(n2)) return n2;
  return 0;
}

function scorePhotos(photoCount: number) {
  const reasons: string[] = [];
  let s = 0;

  if (photoCount >= 30) s = 100;
  else if (photoCount >= 20) s = 85;
  else if (photoCount >= 15) s = 70;
  else if (photoCount >= 8) s = 55;
  else if (photoCount >= 1) s = 35;

  if (photoCount < 15) reasons.push("업체등록사진이 적어 클릭/전환에서 불리합니다(외관/내부/가격표/시술 결과 세트 권장).");

  return { score: clamp(s, 0, 100), reasons };
}

function suggestKeywords5(place: PlaceLike, existing5: string[]) {
  // ✅ 원칙: 지역 2 + 업종/정체성 1 + 서비스 2
  // 지역: 주소/가게명에서 추정
  const base = `${place.name || ""} ${place.address || ""} ${place.roadAddress || ""}`;

  const geo1 =
    pickFirstMatch(base, [/서대문역/, /광화문/, /종로구/, /마포구/, /충정로/, /시청/, /서울역/, /경복궁/, /서대문/, /종로/, /마포/]) ||
    "해당 지역";

  const geo2 =
    pickFirstMatch(base, [/서대문/, /광화문/, /종로/, /마포/, /충정로/, /시청/]) ||
    (geo1 !== "해당 지역" ? geo1 : "해당 지역");

  const 업종 = /(미용실|헤어샵|헤어살롱)/.test(base) ? (base.match(/미용실|헤어샵|헤어살롱/)?.[0] as string) : "미용실";
  const brand = /아베다|AVEDA/.test(base) || existing5.some((k) => /아베다|AVEDA/.test(k)) ? "아베다 헤어살롱" : `${geo2} ${업종}`;
  const svc1 = existing5.find((k) => /(염색|뿌리염색|새치염색)/.test(k)) || "아베다 염색";
  const svc2 = existing5.find((k) => /(볼륨매직|레이어드|단발|펌|클리닉)/.test(k)) || "볼륨매직";

  const out = [
    `${geo1} 미용실`,
    `${geo2} 헤어샵`,
    brand,
    svc1,
    svc2
  ].map((x) => x.replace(/\s+/g, " ").trim());

  // 중복 제거
  const seen = new Set<string>();
  return out.filter((x) => x && !seen.has(x) && (seen.add(x), true)).slice(0, 5);
}

function topCompetitorKeywords(place: PlaceLike) {
  const map = new Map<string, number>();
  for (const c of place.competitors || []) {
    for (const k of (c.keywords5 || []).slice(0, 5)) {
      const kk = (k || "").trim();
      if (!kk) continue;
      map.set(kk, (map.get(kk) || 0) + 1);
    }
  }
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([k]) => k);
}

function buildProRaw(place: PlaceLike, keywordPack: { merged10: string[]; competitorTopKeywords5: string[]; suggested5: string[] }) {
  const name = place.name || "해당 매장";
  const addr = place.address || place.roadAddress || "";
  const baseKeywords = keywordPack.merged10.slice(0, 2).join(", ");

  const descriptionRewrite = [
    `${keywordPack.suggested5[0] || "지역 미용실"} 찾는 분들께 ${name}을(를) 소개합니다.`,
    `커트/펌/염색 등 스타일 상담부터 시술까지 꼼꼼하게 진행합니다.`,
    `특히 ${keywordPack.suggested5.find((k) => /아베다/.test(k)) || "맞춤 상담"} 관련 니즈가 있는 분들께 잘 맞습니다.`,
    "",
    "이런 분들께 추천해요",
    "- 손질이 쉬운 스타일을 원하시는 분",
    "- 컬러/펌 후 손상 관리가 걱정되는 분",
    "- 어떤 스타일이 맞을지 고민이라 상담이 필요한 분",
    "",
    "예약/문의는 네이버 플레이스 예약 버튼을 이용하시면 가장 빠릅니다.",
    baseKeywords ? `\n(참고 키워드: ${baseKeywords})` : ""
  ]
    .filter(Boolean)
    .join("\n");

  const directionsRewrite = [
    "- 가까운 지하철역 기준 도보 이동",
    addr ? `- 주소: ${addr}` : "- 주소: (주소를 입력/확인해주세요)",
    place.directions ? `- 길 안내: ${stripMore(place.directions)}` : "- 길 안내: (오시는길 문장을 추가해주세요)",
    "- 주차: 가능/불가/유료 여부를 함께 적어두면 문의가 줄어듭니다.",
    "- 입구/층수: 건물명/층/엘리베이터 여부를 한 줄로 추가하면 좋아요."
  ].join("\n");

  const proTodo = [
    { action: "상세설명 300~700자로 보강", impact: "high", how: "서비스 강점 + 추천 대상 + 차별점(제품/상담) + 예약 동선을 문장으로 정리하세요(키워드 나열은 감점)." },
    { action: "오시는길에 ‘출구/도보/층/주차’ 넣기", impact: "high", how: "‘4번 출구 도보 1분, 2층, 주차 안내’처럼 정보형 문장으로 보강하세요." },
    { action: "업체등록사진 15장 이상 확보", impact: "mid", how: "외관/입구/내부/가격표/시술 결과(또는 제품) 5세트를 우선 업로드하세요." },
    { action: "방문자 리뷰 30개 목표 운영", impact: "mid", how: "결제/시술 직후 ‘리뷰 요청 멘트’로 자연스럽게 유도하고, 24시간 내 답글을 유지하세요." }
  ];

  const competitorAnalysis = {
    topKeywords10: buildTop10(place),
    byCompetitor: (place.competitors || []).slice(0, 5).map((c) => ({
      placeId: c.placeId,
      placeUrl: c.placeUrl,
      keywords5: (c.keywords5 || []).slice(0, 5)
    }))
  };

  return { descriptionRewrite, directionsRewrite, proTodo, competitorAnalysis };
}

function buildTop10(place: PlaceLike) {
  const map = new Map<string, number>();
  for (const c of place.competitors || []) {
    for (const k of (c.keywords5 || []).slice(0, 5)) map.set(k, (map.get(k) || 0) + 1);
  }
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([keyword, count]) => ({ keyword, count }));
}

function stripMore(s: string) {
  return s.replace(/\.\.\.\s*내용\s*더보기/g, "").trim();
}

function pickFirstMatch(text: string, regs: RegExp[]) {
  for (const r of regs) {
    const m = text.match(r);
    if (m && m[0]) return m[0];
  }
  return "";
}

function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n));
}
