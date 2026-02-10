import { IndustryProfile } from "./profile";

export const FNB_PUB_BAR: IndustryProfile = {
  subcategory: "fnb_pub_bar",
  vertical: "fnb",

  coreKeywords: [
    "{region} 술집",
    "{region} 바",
    "{region} 이자카야",
    "{region} 2차",
    "{region} 분위기 좋은 술집"
  ],

  serviceKeywords: [
    "안주", "하이볼", "칵테일", "와인",
    "맥주", "위스키", "혼술", "단체"
  ],

  descriptionTemplate: ({ name, region, services, trust, cta }) => `
${region}에서 가볍게 한잔하기 좋은 ${name}입니다.

이런 분들께 추천드려요
- 1차 이후 2차 장소를 찾는 분
- 분위기 있는 술집을 원하는 분
- 혼술 또는 소규모 모임

주요 안주/주류
- ${services.join("\n- ")}

매장 특징
- ${trust.join("\n- ")}

${cta}
`.trim(),

  directionsTemplate: (region) => `
${region} 기준으로 안내드립니다.

- ○○역 ○번 출구 → 골목 진입 ○m
- 건물 ○층 / 입구 간판 확인
- 야간 방문 시 전화 문의 추천
`.trim(),

  photoChecklist: [
    "외관(야간)",
    "바/테이블",
    "안주",
    "주류 진열",
    "조명/분위기"
  ],

  bannedPhrases: ["무제한", "최고급", "완벽한 분위기"]
};
