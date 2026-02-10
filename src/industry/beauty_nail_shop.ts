import { IndustryProfile } from "./profile";

export const BEAUTY_NAIL_SHOP: IndustryProfile = {
  subcategory: "beauty_nail_shop",
  vertical: "beauty",

  coreKeywords: [
    "{region} 네일샵",
    "{region} 젤네일",
    "{region} 네일아트",
    "{region} 네일 추천"
  ],

  serviceKeywords: [
    "젤네일", "아트", "프렌치", "원컬러",
    "케어", "패디큐어", "속눈썹"
  ],

  descriptionTemplate: ({ name, region, services, trust, cta }) => `
${region}에서 네일 케어와 디자인을 함께 받을 수 있는 ${name}입니다.

추천 대상
- 손/발 케어가 필요한 분
- 디자인 상담을 함께 받고 싶은 분
- 예약제로 조용한 시술을 원하는 분

주요 서비스
- ${services.join("\n- ")}

매장 포인트
- ${trust.join("\n- ")}

${cta}
`.trim(),

  directionsTemplate: (region) => `
${region} 기준으로 안내드립니다.

- ○○역 ○번 출구 → 도보 ○분
- ○○빌딩 ○층
- 예약 시간 5분 전 도착 권장
`.trim(),

  photoChecklist: [
    "외관",
    "시술 공간",
    "아트 샘플",
    "전/후 비교",
    "가격표"
  ],

  bannedPhrases: ["100% 만족", "절대 안 벗겨짐"]
};
