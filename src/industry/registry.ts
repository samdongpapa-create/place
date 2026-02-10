import type { Subcategory } from "./types.js";
import type { IndustryProfile } from "./profile.js";

import { FNB_RESTAURANT } from "./fnb_restaurant.js";
import { FNB_PUB_BAR } from "./fnb_pub_bar.js";
import { FNB_CAFE } from "./fnb_cafe.js";

import { BEAUTY_HAIR_SALON } from "./beauty_hair_salon.js";
import { BEAUTY_NAIL_SHOP } from "./beauty_nail_shop.js";

import { MEDICAL_CLINIC } from "./medical_clinic.js";
import { REAL_ESTATE_OFFICE } from "./real_estate_office.js";

export const INDUSTRY_PROFILES: Record<Subcategory, IndustryProfile> = {
  // F&B
  fnb_restaurant: FNB_RESTAURANT,
  fnb_pub_bar: FNB_PUB_BAR,
  fnb_cafe: FNB_CAFE,
  fnb_delivery_takeout: FNB_RESTAURANT,

  // Beauty
  beauty_hair_salon: BEAUTY_HAIR_SALON,
  beauty_nail_shop: BEAUTY_NAIL_SHOP,
  beauty_skin_care: BEAUTY_HAIR_SALON,
  beauty_waxing: BEAUTY_HAIR_SALON,

  // Medical
  medical_clinic: MEDICAL_CLINIC,
  medical_dental: MEDICAL_CLINIC,
  medical_oriental: MEDICAL_CLINIC,
  medical_vet: MEDICAL_CLINIC,

  // Education (MVP 임시: 추후 전용 템플릿 추천)
  edu_academy: REAL_ESTATE_OFFICE,
  edu_music_art: REAL_ESTATE_OFFICE,
  edu_sports: REAL_ESTATE_OFFICE,

  // Fitness (MVP 임시: 추후 전용 템플릿 추천)
  fitness_gym: BEAUTY_HAIR_SALON,
  fitness_pilates: BEAUTY_HAIR_SALON,
  fitness_yoga: BEAUTY_HAIR_SALON,

  // Real estate
  real_estate_office: REAL_ESTATE_OFFICE
};
