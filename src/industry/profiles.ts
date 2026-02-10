import type { Industry } from "../core/types.js";
import { hairSalonProfile } from "./hair_salon.js";
import { cafeProfile } from "./cafe.js";
import { realEstateProfile } from "./real_estate.js";

export type IndustryProfile = {
  id: Industry;
  coreIntents: string[];          // 전환 의도 템플릿
  serviceKeywords: string[];      // 업종 서비스 키워드(추천/검증)
  bannedPhrases: string[];        // 리스크 문구
  descriptionTemplate: (ctx: {
    name: string;
    region: string;
    servicesTop: string[];
    trustPoints: string[];
    cta: string;
  }) => string;
  directionsTemplate: (ctx: { region: string }) => string;
};

export function getIndustryProfile(industry: Industry): IndustryProfile {
  if (industry === "hair_salon") return hairSalonProfile;
  if (industry === "cafe") return cafeProfile;
  return realEstateProfile;
}
