import { IndustryProfile } from "./profile";

export const REAL_ESTATE_OFFICE: IndustryProfile = {
  subcategory: "real_estate_office",
  vertical: "real_estate",

  coreKeywords: [
    "{region} 부동산",
    "{region} 공인중개사",
    "{region} 전세",
    "{region} 월세",
    "{region} 매매"
  ],

  serviceKeywords: [
    "전세", "월세", "매매",
    "원룸", "투룸", "오피스텔",
    "아파트", "상가", "사무실"
  ],

  descriptionTemplate: ({ name, region, services, trust, cta }) => `
${region} 지역 위주로 전월세 및 매매 상담을 진행하는 ${name}입니다.

상담 방식
- 조건(예산/입주일/우선순위)을 먼저 정리
- 허위·미끼 매물 없이 실제 매물만 안내

주요 중개 유형
- ${services.join("\n- ")}

신뢰 포인트
- ${trust.join("\n- ")}

${cta}
`.trim(),

  directionsTemplate: (region) => `
${region} 기준으로 안내드립니다.

- ○○역 ○번 출구 인근
- ○○빌딩 ○층
- 방문 전 전화 예약 시 상담 대기 없음
`.trim(),

  photoChecklist: [
    "사무실 외관",
    "상담 공간",
    "중개 등록증",
    "내부 전경"
  ],

  bannedPhrases: ["확정 수익", "무조건 가능"]
};
