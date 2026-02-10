import type { IndustryProfile } from "./profiles.js";

export const hairSalonProfile: IndustryProfile = {
  id: "hair_salon",
  coreIntents: [
    "{region} 미용실",
    "{region} 헤어샵",
    "{region} 미용실 추천",
    "{region} 커트",
    "{region} 염색",
    "{region} 펌",
    "{region} 클리닉",
    "{region} 당일예약 미용실"
  ],
  serviceKeywords: [
    "커트", "염색", "뿌리염색", "탈색", "펌", "셋팅펌", "볼륨펌", "다운펌",
    "매직", "매직셋팅", "클리닉", "두피", "헤드스파", "레이어드", "허쉬컷",
    "애쉬", "발레아쥬", "옴브레"
  ],
  bannedPhrases: [
    "1등", "최고", "무조건", "완벽", "100%", "전국최저가"
  ],
  descriptionTemplate: ({ name, region, servicesTop, trustPoints, cta }) => {
    const s1 = servicesTop[0] ?? "커트/염색/펌";
    const s2 = servicesTop[1] ?? "손상 케어";
    const s3 = servicesTop[2] ?? "스타일 상담";

    return [
      `${region}에서 ${s1} 위주로 “원하는 느낌”을 빠르게 잡아주는 ${name}입니다.`,
      ``,
      `이런 분들께 잘 맞아요`,
      `- 사진처럼 표현은 되는데 내 머리에서 비슷하게 안 나오는 분`,
      `- 손상/푸석함 때문에 컬러·펌이 망설여지는 분`,
      `- 커트 한 번으로도 얼굴형/분위기 정리가 필요한 분`,
      ``,
      `우리가 집중하는 포인트`,
      `- ${trustPoints[0] ?? "상담 → 디자인 → 유지관리까지 한 흐름으로 안내"}`,
      `- ${trustPoints[1] ?? "손상도/모질에 맞춘 시술 옵션 제안"}`,
      `- ${trustPoints[2] ?? "시술 후 집에서 손질이 쉬운 스타일 설계"}`,
      ``,
      `대표 시술`,
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
      `지하철로 오시는 경우`,
      `- ○○역 ○번 출구 → 직진 ○m → ○○건물(○○간판)`,
      ``,
      `버스로 오시는 경우`,
      `- ○○정류장 하차 → 도보 ○분`,
      ``,
      `주차 안내`,
      `- 주차 가능/불가(유료/무료), 가능 시 “○○주차장” 이용 안내`,
      ``,
      `처음 방문이시면 길이 헷갈릴 수 있어요. 도착 전 전화 주시면 바로 안내드릴게요.`
    ].join("\n");
  }
};
