import type { IndustryProfile } from "./profiles.js";

export const cafeProfile: IndustryProfile = {
  id: "cafe",
  coreIntents: [
    "{region} 카페",
    "{region} 디저트 카페",
    "{region} 분위기 좋은 카페",
    "{region} 브런치",
    "{region} 작업하기 좋은 카페",
    "{region} 주차 가능한 카페"
  ],
  serviceKeywords: [
    "아메리카노", "라떼", "핸드드립", "원두", "디카페인",
    "케이크", "쿠키", "스콘", "디저트", "브런치",
    "조용한", "콘센트", "와이파이"
  ],
  bannedPhrases: ["1등", "최고", "100%"],
  descriptionTemplate: ({ name, region, servicesTop, trustPoints, cta }) => {
    const s1 = servicesTop[0] ?? "커피";
    const s2 = servicesTop[1] ?? "디저트";
    const s3 = servicesTop[2] ?? "좌석/분위기";

    return [
      `${region}에서 ${s1}와 ${s2}를 중심으로, 편하게 머물 수 있는 ${name}입니다.`,
      ``,
      `이런 분들께 추천드려요`,
      `- 잠깐 들러도 좋고, 오래 앉아 있어도 부담 없는 곳을 찾는 분`,
      `- 디저트도 함께 먹고 싶은 분`,
      ``,
      `매장 특징`,
      `- ${trustPoints[0] ?? "메뉴 선택이 쉬운 구성 + 기본이 탄탄한 맛"}`,
      `- ${trustPoints[1] ?? "좌석/동선이 편해서 대화·작업 모두 무난"}`,
      `- ${trustPoints[2] ?? "방문 시간대별 분위기 안내(조용/활기)"}`,
      ``,
      `추천 포인트`,
      `- ${s1}`,
      `- ${s2}`,
      `- ${s3}`,
      ``,
      `${cta}`
    ].join("\n");
  },
  directionsTemplate: ({ region }) => {
    return [
      `${region} 기준으로 안내드립니다.`,
      ``,
      `- ○○역 ○번 출구 → ○○방향 ○m → ○○건물 1층`,
      `- 주차: 가능/불가 및 대체 주차장 안내`,
      `- 단체/유모차/반려동물 동반 가능 여부는 편의시설 항목에 맞춰 안내`,
      ``,
      `처음 오시면 “○○간판/○○건물”을 기준으로 찾아오시면 가장 쉬워요.`
    ].join("\n");
  }
};
