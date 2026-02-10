import { IndustryProfile } from "./profile";

export const BEAUTY_HAIR_SALON: IndustryProfile = {
  subcategory: "beauty_hair_salon",
  vertical: "beauty",

  coreKeywords: [
    "{region} 미용실",
    "{region} 헤어샵",
    "{region} 커트",
    "{region} 염색",
    "{region} 펌"
  ],

  serviceKeywords: [
    "커트", "염색", "뿌리염색", "탈색",
    "펌", "셋팅펌", "매직",
    "클리닉", "두피", "레이어드", "허쉬컷"
  ],

  descriptionTemplate: ({ name, region, services, trust, cta }) => `
${region}에서 헤어 스타일 상담부터 시술까지 꼼꼼하게 진행하는 ${name}입니다.

이런 분들께 잘 맞아요
- 커트만으로도 분위기 변화를 원하시는 분
- 염색/펌 후 손상이 걱정되는 분
- 집에서도 손질 쉬운 스타일을 원하는 분

대표 시술
- ${services.join("\n- ")}

시술 포인트
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
    "내부",
    "시술 공간",
    "전/후 스타일",
    "가격표"
  ],

  bannedPhrases: ["100% 만족", "무조건 성공"]
};
