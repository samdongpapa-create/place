import { IndustryProfile } from "./profile";

export const MEDICAL_CLINIC: IndustryProfile = {
  subcategory: "medical_clinic",
  vertical: "medical",

  coreKeywords: [
    "{region} 병원",
    "{region} 의원",
    "{region} 진료",
    "{region} 전문의",
    "{region} 예약"
  ],

  serviceKeywords: [
    "진료", "검사", "상담",
    "물리치료", "주사", "처방",
    "통증", "재활"
  ],

  descriptionTemplate: ({ name, region, services, trust, cta }) => `
${region}에서 진료와 상담을 진행하는 ${name}입니다.

진료 안내
- 증상과 상태를 먼저 확인 후 진료 방향 안내
- 불필요한 과잉 진료를 지양

주요 진료 항목
- ${services.join("\n- ")}

이용 포인트
- ${trust.join("\n- ")}

${cta}
`.trim(),

  directionsTemplate: (region) => `
${region} 기준으로 안내드립니다.

- ○○역 ○번 출구 → 도보 ○분
- ○○빌딩 ○층
- 주차 가능 여부는 방문 전 문의 권장
`.trim(),

  photoChecklist: [
    "병원 외관",
    "접수/대기 공간",
    "진료실",
    "의료 장비"
  ],

  bannedPhrases: ["완치 보장", "100% 효과"]
};
