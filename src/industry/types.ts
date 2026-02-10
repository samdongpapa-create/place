export type Plan = "free" | "pro";

export type Vertical =
  | "fnb"
  | "beauty"
  | "medical"
  | "education"
  | "fitness"
  | "real_estate";

export type Subcategory =
  // F&B
  | "fnb_restaurant"
  | "fnb_cafe"
  | "fnb_pub_bar"
  | "fnb_delivery_takeout"

  // Beauty
  | "beauty_hair_salon"
  | "beauty_nail_shop"
  | "beauty_skin_care"
  | "beauty_waxing"

  // Medical
  | "medical_clinic"
  | "medical_dental"
  | "medical_oriental"
  | "medical_vet"

  // Education
  | "edu_academy"
  | "edu_music_art"
  | "edu_sports"

  // Fitness
  | "fitness_gym"
  | "fitness_pilates"
  | "fitness_yoga"

  // Real estate
  | "real_estate_office";
