import type { Vertical, Subcategory } from "./types";

export const SUBCATEGORY_TO_VERTICAL: Record<Subcategory, Vertical> = {
  // F&B
  fnb_restaurant: "fnb",
  fnb_cafe: "fnb",
  fnb_pub_bar: "fnb",
  fnb_delivery_takeout: "fnb",

  // Beauty
  beauty_hair_salon: "beauty",
  beauty_nail_shop: "beauty",
  beauty_skin_care: "beauty",
  beauty_waxing: "beauty",

  // Medical
  medical_clinic: "medical",
  medical_dental: "medical",
  medical_oriental: "medical",
  medical_vet: "medical",

  // Education
  edu_academy: "education",
  edu_music_art: "education",
  edu_sports: "education",

  // Fitness
  fitness_gym: "fitness",
  fitness_pilates: "fitness",
  fitness_yoga: "fitness",

  // Real estate
  real_estate_office: "real_estate"
};
