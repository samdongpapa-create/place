import type { IndustryProfile } from "./profile.js";

export const FNB_CAFE: IndustryProfile = {
  subcategory: "fnb_cafe",
  vertical: "fnb",

  coreKeywords: [
    "{region} 카페",
    "{region} 커피",
    "{region} 디저트 카페",
    "{region} 분위기 좋은 카페",
    "{region} 작업하기 좋은 카페"
  ],

  serviceKeywords: [
    "아메리카노", "라떼", "핸드드립", "디카페인",
    "케이크", "쿠키", "스콘", "디저트",
    "콘센트", "와이파이", "좌석"
  ],

  descriptionTemplate: (ctx) => {
    const { name, region, services, trust, cta } = ctx;
    const s = services.length ? services : ["아메리카노", "라떼", "디저트"];
    const t = trust.length ? trust : ["좌석/동선이 편함", "메뉴 구성이 직관적", "체류 정보(콘센트/와이파이) 안내"];

    return `
${region}에서 커피와 디저트를 편하게 즐길 수 있는 ${name}입니다.

이런 분들께 추천드려요
- 잠깐 쉬거나 대화하기 좋은 카페를 찾는 분
- 작업/공부가 가능한 카페가 필요한 분
- 디저트도 함께 즐기고 싶은 분

주요 메뉴
- ${s.join("\n- ")}

매장 특징
- ${t.join("\n- ")}

${cta}
`.trim();
  },

  directionsTemplate: (region: string) => `
${region} 기준으로 안내드립니다.

- ○○역 ○번 출구 → 도보 ○분
- ○○건물 1층 / 간판 확인
- 주차 가능 여부는 방문 전 확인 권장
`.trim(),

  photoChecklist: ["외관", "내부 전경", "대표 음료", "디저트", "좌석 구성"],
  bannedPhrases: ["전국최고", "무조건 맛있음"]
};
