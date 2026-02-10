// 상위 업종 (점수 구조, 공통 로직 기준)
export type Vertical =
  | "fnb"          // 외식업
  | "beauty"       // 뷰티
  | "medical"      // 병원/의원
  | "education"    // 학원
  | "fitness"      // 헬스/필라테스
  | "real_estate"; // 부동산

// 세부 업종 (키워드/문구/사진/리스크 기준)
export type Subcategory =
  // 외식업
  | "fnb_restaurant"
  | "fnb_cafe"
  | "fnb_pub_bar"
  | "fnb_delivery_takeout"

  // 뷰티
  | "beauty_hair_salon"
  | "beauty_nail_shop"
  | "beauty_skin_care"
  | "beauty_waxing"

  // 의료
  | "medical_clinic"
  | "medical_dental"
  | "medical_oriental"
  | "medical_vet"

  // 교육
  | "edu_academy"
  | "edu_music_art"
  | "edu_sports"

  // 피트니스
  | "fitness_gym"
  | "fitness_pilates"
  | "fitness_yoga"

  // 부동산
  | "real_estate_office";
