export type InputMode = "place_url" | "biz_search";

export type Industry =
  | "hair_salon"
  | "cafe"
  | "real_estate";

export type AnalyzeInput =
  | { mode: "place_url"; placeUrl: string }
  | { mode: "biz_search"; name: string; address: string; phone?: string };

export type AnalyzeOptions = {
  industry: Industry;
  language: "ko";
  depth: "standard" | "deep";
};

export type PlaceProfile = {
  placeId?: string;
  placeUrl: string;

  name: string;
  category?: string;

  address?: string;
  roadAddress?: string;

  lat?: number;
  lng?: number;

  phone?: string;
  hoursText?: string;

  amenities?: string[];
  tags?: string[];

  description?: string;
  directions?: string;

  menus?: Array<{ name: string; price?: number; durationMin?: number; note?: string }>;

  reviews?: {
    visitorCount?: number;
    blogCount?: number;
    rating?: number;
  };

  photos?: {
    count?: number;
    hasExterior?: boolean;
    hasInterior?: boolean;
    hasService?: boolean;
    hasMenu?: boolean;
  };
};

export type ScoreResult = {
  total: number;
  grade: "A" | "B" | "C" | "D" | "F";
  breakdown: {
    discover: number; // 0-30
    convert: number;  // 0-30
    trust: number;    // 0-25
    risk: number;     // 0-15 (감점형이 아니라 '좋을수록 높음'으로 환산)
  };
  signals: {
    missingFields: string[];
    keywordStuffingRisk: boolean;
    stalenessRisk: boolean;
  };
};

export type RecommendResult = {
  keywords5: Array<{ keyword: string; type: "core" | "signature" | "conversion"; reason: string }>;
  rewrite: { description: string; directions: string };
  todoTop5: Array<{ action: string; impact: "high" | "mid" | "low"; how: string }>;
  complianceNotes: string[];
};
