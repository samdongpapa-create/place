import type { Subcategory } from "./types.js";
import type { IndustryProfile } from "./profile.js";

// ✅ 이미 있는 것(예시)
import { FNB_RESTAURANT } from "./fnb_restaurant.js";
import { FNB_PUB_BAR } from "./fnb_pub_bar.js";

// ✅ 내가 앞에서 준 것(있으면)
import { FNB_CAFE } from "./fnb_cafe.js";
import { BEAUTY_HAIR_SALON } from "./beauty_hair_salon.js";
import { REAL_ESTATE_OFFICE } from "./real_estate_office.js";
import { MEDICAL_CLINIC } from "./medical_clinic.js";
import { BEAUTY_NAIL_SHOP } from "./beauty_nail_shop.js"; // 있으면

export const INDUSTRY_PROFILES: Record<Subcategory, IndustryProfile> = {
  // F&B
  fnb_restaurant: FNB_RESTAURANT,
  fnb_pub_bar: FNB_PUB_BAR,
  fnb_cafe: FNB_CAFE,
  fnb_delivery_takeout: FNB_RESTAURANT, // MVP: 임시로 레스토랑 템플릿 재사용(추후 별도 제작)

  // Beauty
  beauty_hair_salon: BEAUTY_HAIR_SALON,
  beauty_nail_shop: BEAUTY_NAIL_SHOP ?? BEAUTY_HAIR_SALON,
  beauty_skin_care: BEAUTY_HAIR_SALON,
  beauty_waxing: BEAUTY_HAIR_SALON,

  // Medical
  medical_clinic: MEDICAL_CLINIC,
  medical_dental: MEDICAL_CLINIC,
  medical_oriental: MEDICAL_CLINIC,
  medical_vet: MEDICAL_CLINIC,

  // Education (MVP: 템플릿 미구현이면 cafe/restaurant 같은 걸 임시로 쓰지 말고, hair_salon 템플릿처럼 "중립 템플릿"을 만들면 더 좋음)
  edu_academy: REAL_ESTATE_OFFICE,
  edu_music_art: REAL_ESTATE_OFFICE,
  edu_sports: REAL_ESTATE_OFFICE,

  // Fitness
  fitness_gym: BEAUTY_HAIR_SALON,
  fitness_pilates: BEAUTY_HAIR_SALON,
  fitness_yoga: BEAUTY_HAIR_SALON,

  // Real estate
  real_estate_office: REAL_ESTATE_OFFICE
};
