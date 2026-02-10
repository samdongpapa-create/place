export type IndustryProfile = {
  subcategory: string;
  vertical: string;

  // 대표 키워드 템플릿
  coreKeywords: string[];

  // 서비스/메뉴 키워드 사전
  serviceKeywords: string[];

  // 상세설명 생성기
  descriptionTemplate: (ctx: {
    name: string;
    region: string;
    services: string[];
    trust: string[];
    cta: string;
  }) => string;

  // 찾아오는 길 템플릿
  directionsTemplate: (region: string) => string;

  // 사진 평가 기준
  photoChecklist: string[];

  // 금칙어 / 리스크 문구
  bannedPhrases: string[];
};
