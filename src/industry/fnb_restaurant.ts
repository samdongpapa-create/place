import { IndustryProfile } from "./profile";

export const FNB_RESTAURANT: IndustryProfile = {
  subcategory: "fnb_restaurant",
  vertical: "fnb",

  coreKeywords: [
    "{region} 맛집",
    "{region} 음식점",
    "{region} 점심",
    "{region} 저녁",
    "{region} 예약"
  ],

  serviceKeywords: [
    "정식", "런치", "디너", "단체", "회식",
    "포장", "배달", "코스", "세트메뉴"
  ],

  descriptionTemplate: ({ name, region, services, trust, cta }) => `
${region}에서 식사 고민될 때 찾기 좋은 ${name}입니다.

이런 분들께 잘 맞아요
- 점심/저녁 식사 장소를 고민 중인 분
- 메뉴 선택이 쉬운 곳을 찾는 분
- 단체/회식 장소가 필요한 분

주요 메뉴
- ${services.join("\n- ")}

이용 포인트
- ${trust.join("\n- ")}

${cta}
`.trim(),

  directionsTemplate: (region) => `
${region} 기준으로 안내드립니다.

- ○○역 ○번 출구 → 도보 ○분
- ○○건물 1층 / 간판 확인
- 주차 가능 여부는 방문 전 문의 권장
`.trim(),

  photoChecklist: [
    "외관 전경",
    "대표 메뉴",
    "테이블/좌석",
    "메뉴판",
    "실내 전경"
  ],

  bannedPhrases: ["무조건", "전국최고", "1등맛집"]
};
