// src/industry/autoClassify.ts
import type { Subcategory, Vertical } from "./types.js";

type PlaceLike = {
  placeUrl?: string;
  name?: string;
  category?: string;
  tags?: string[];
  description?: string;
};

export function autoClassifyIndustry(place: PlaceLike): {
  subcategory: Subcategory;
  vertical: Vertical;
  confidence: number;
  reasons: string[];
} {
  const url = (place.placeUrl || "").toLowerCase();
  const name = (place.name || "").toLowerCase();
  const category = (place.category || "").toLowerCase();
  const tags = (place.tags || []).join(" ").toLowerCase();

  // ✅ 1) URL 패턴이 제일 강력 (m.place는 업종별 path가 갈림)
  if (url.includes("/hairshop/")) {
    return {
      subcategory: "beauty_hair_salon",
      vertical: "beauty",
      confidence: 0.95,
      reasons: ["URL 경로가 hairshop"]
    };
  }
  if (url.includes("/nailshop/")) {
    return {
      subcategory: "beauty_nail_shop",
      vertical: "beauty",
      confidence: 0.95,
      reasons: ["URL 경로가 nailshop"]
    };
  }
  if (url.includes("/restaurant/") || url.includes("/food/")) {
    return {
      subcategory: "fnb_restaurant",
      vertical: "fnb",
      confidence: 0.8,
      reasons: ["URL 경로가 음식점 계열"]
    };
  }
  if (url.includes("/cafe/")) {
    return {
      subcategory: "fnb_cafe",
      vertical: "fnb",
      confidence: 0.8,
      reasons: ["URL 경로가 카페"]
    };
  }
  if (url.includes("/hospital/") || url.includes("/clinic/")) {
    return {
      subcategory: "medical_clinic",
      vertical: "medical",
      confidence: 0.8,
      reasons: ["URL 경로가 의료기관"]
    };
  }
  if (url.includes("/realestate/")) {
    return {
      subcategory: "real_estate_office",
      vertical: "real_estate",
      confidence: 0.8,
      reasons: ["URL 경로가 부동산"]
    };
  }

  // ✅ 2) 텍스트 기반 힌트 (이름/카테고리/태그)
  const blob = `${name} ${category} ${tags}`;

  if (hasAny(blob, ["미용실", "헤어", "헤어샵", "살롱", "컷", "펌", "염색"])) {
    return {
      subcategory: "beauty_hair_salon",
      vertical: "beauty",
      confidence: 0.75,
      reasons: ["이름/카테고리/태그에 미용실 단서"]
    };
  }

  if (hasAny(blob, ["네일", "젤네일", "패디", "네일샵"])) {
    return {
      subcategory: "beauty_nail_shop",
      vertical: "beauty",
      confidence: 0.75,
      reasons: ["이름/카테고리/태그에 네일 단서"]
    };
  }

  if (hasAny(blob, ["부동산", "공인중개", "중개"])) {
    return {
      subcategory: "real_estate_office",
      vertical: "real_estate",
      confidence: 0.7,
      reasons: ["이름/카테고리/태그에 부동산 단서"]
    };
  }

  if (hasAny(blob, ["병원", "의원", "클리닉", "치과", "한의원", "동물병원"])) {
    return {
      subcategory: "medical_clinic",
      vertical: "medical",
      confidence: 0.7,
      reasons: ["이름/카테고리/태그에 의료 단서"]
    };
  }

  if (hasAny(blob, ["카페", "커피", "디저트"])) {
    return {
      subcategory: "fnb_cafe",
      vertical: "fnb",
      confidence: 0.65,
      reasons: ["이름/카테고리/태그에 카페 단서"]
    };
  }

  if (hasAny(blob, ["맛집", "식당", "음식점", "레스토랑", "점심", "저녁"])) {
    return {
      subcategory: "fnb_restaurant",
      vertical: "fnb",
      confidence: 0.65,
      reasons: ["이름/카테고리/태그에 음식점 단서"]
    };
  }

  // ✅ 3) 기본값
  return {
    subcategory: "fnb_restaurant",
    vertical: "fnb",
    confidence: 0.3,
    reasons: ["기본값 적용(단서 부족)"]
  };
}

function hasAny(text: string, needles: string[]) {
  return needles.some((n) => text.includes(n));
}
