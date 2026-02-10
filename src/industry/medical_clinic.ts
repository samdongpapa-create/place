import type { IndustryProfile } from "./profile.js";

export const MEDICAL_CLINIC: IndustryProfile = {
  subcategory: "medical_clinic",
  vertical: "medical",

  coreKeywords: [
    "{region} 병원",
    "{region} 의원",
    "{region} 진료",
    "{region} 예약",
    "{region} 전문의"
  ],

  serviceKeywords: [
    "진료", "검사", "상담",
    "물리치료", "주사", "처방",
    "재활", "통증"
  ],

  descriptionTemplate: (ctx) => {
    const { name, region, services, trust, cta } = ctx;
    const s = services.length ? services : ["진료", "검사", "상담"];
    const t = trust.length ? trust : ["과장 표현 없이 안내", "진료 항목/시간/예약 안내 정리", "주차/동선 정보 제공"];

    return `
${region}에서 진료와 상담을 진행하는 ${name}입니다.

진료 안내
- 증상과 상태를 확인한 뒤 진료 방향을 안내합니다.
- 불필요한 과잉 진료를 지양합니다.

주요 진료 항목
- ${s.join("\n- ")}

이용 포인트
- ${t.join("\n- ")}

${cta}
`.trim();
  },

  directionsTemplate: (region: string) => `
${region} 기준으로 안내드립니다.

- ○○역 ○번 출구 → 도보 ○분
- ○○빌딩 ○층
- 주차 가능 여부는 방문 전 문의 권장
`.trim(),

  photoChecklist: ["병원 외관", "접수/대기 공간", "진료실", "의료 장비"],
  bannedPhrases: ["완치 보장", "100% 효과", "부작용 없음"]
};
