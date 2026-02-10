import type { IndustryProfile } from "./profiles.js";

export const realEstateProfile: IndustryProfile = {
  id: "real_estate",
  coreIntents: [
    "{region} 부동산",
    "{region} 공인중개사",
    "{region} 전월세",
    "{region} 원룸",
    "{region} 오피스텔",
    "{region} 상가 임대"
  ],
  serviceKeywords: [
    "전세", "월세", "매매", "원룸", "투룸", "오피스텔", "아파트",
    "상가", "사무실", "임대", "보증금", "권리금", "실거래"
  ],
  bannedPhrases: ["100% 보장", "무조건", "확정수익"],
  descriptionTemplate: ({ name, region, servicesTop, trustPoints, cta }) => {
    const s1 = servicesTop[0] ?? "전월세";
    const s2 = servicesTop[1] ?? "매매";
    const s3 = servicesTop[2] ?? "상가/사무실";

    return [
      `${region} 지역 위주로 ${s1}, ${s2} 상담을 돕는 ${name}입니다.`,
      ``,
      `상담 스타일`,
      `- 조건(예산/입주일/우선순위)을 먼저 정리하고, 맞는 매물을 빠르게 좁혀드립니다.`,
      `- 현장 상태/관리비/주차/채광 등 “나중에 문제 되는 포인트”를 미리 체크합니다.`,
      ``,
      `주로 다루는 유형`,
      `- ${s1}`,
      `- ${s2}`,
      `- ${s3}`,
      ``,
      `신뢰 포인트`,
      `- ${trustPoints[0] ?? "허위·미끼 매물 지양, 조건 기반으로만 안내"}`,
      `- ${trustPoints[1] ?? "계약 전 체크리스트(특약/관리비/하자) 안내"}`,
      `- ${trustPoints[2] ?? "방문 예약 시 동선 맞춰 현장 브리핑"}`,
      ``,
      `${cta}`
    ].join("\n");
  },
  directionsTemplate: ({ region }) => {
    return [
      `${region} 기준으로 안내드립니다.`,
      ``,
      `- ○○역 ○번 출구 → ○○방향 ○m → ○○빌딩 ○층`,
      `- 주차 가능 여부/인근 유료주차장 안내`,
      ``,
      `상담은 예약하시면 대기 없이 진행돼요(방문 전 연락 권장).`
    ].join("\n");
  }
};
