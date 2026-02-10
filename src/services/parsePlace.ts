import * as cheerio from "cheerio";
import type { PlaceProfile } from "../core/types.js";

export function parsePlaceFromHtml(html: string, placeUrl: string): PlaceProfile {
  const $ = cheerio.load(html);

  // 1) title 기반 기본값
  const title = ($("title").text() || "").trim();

  // 2) placeId 추정(URL에 숫자)
  const placeId = extractPlaceId(placeUrl);

  // 3) 가장 흔한 패턴: __NEXT_DATA__ 또는 script/json 형태
  // 네이버는 구조가 바뀔 수 있으니 "여러 후보를 탐색"하게 설계
  const candidates: string[] = [];
  $("script").each((_i, el) => {
    const t = $(el).text();
    if (!t) return;

    // 너무 길어서 필터
    if (t.includes("__NEXT_DATA__") || t.includes("application/json") || t.includes("props") || t.includes("pageProps")) {
      candidates.push(t);
    }
  });

  let extracted: any = null;
  for (const c of candidates) {
    extracted = tryExtractJsonFromScript(c);
    if (extracted) break;
  }

  // 4) 추출 실패해도 최소 profile은 반환(후속 UX에서 “텍스트 붙여넣기 모드”로)
  const base: PlaceProfile = {
    placeId,
    placeUrl,
    name: guessNameFromTitle(title) || "UNKNOWN"
  };

  if (!extracted) return base;

  // 5) extracted에서 우리가 쓸 필드만 안전하게 뽑기(방어적으로)
  // 아래는 "자주 쓰이는 키" 위주. 실제 운영하며 경로 맞춰가면 됨.
  const p = deepFind(extracted, ["name", "placeName", "bizName"]) ?? base.name;
  const category = deepFind(extracted, ["category", "bizCategory", "categoryName"]);
  const address = deepFind(extracted, ["address", "jibunAddress"]);
  const roadAddress = deepFind(extracted, ["roadAddress"]);
  const phone = deepFind(extracted, ["phone", "tel"]);
  const hoursText = deepFind(extracted, ["businessHours", "hours", "hoursText"]);
  const tags = deepFind(extracted, ["tags", "hashTags", "keywords"]);
  const description = deepFind(extracted, ["description", "introduction", "bizDescription"]);
  const directions = deepFind(extracted, ["directions", "wayToCome", "route"]);
  const rating = asNumber(deepFind(extracted, ["rating", "star", "starScore"]));
  const visitorCount = asNumber(deepFind(extracted, ["visitorReviewCount", "visitorCount"]));
  const blogCount = asNumber(deepFind(extracted, ["blogReviewCount", "blogCount"]));

  return {
    ...base,
    name: String(p),
    category: category ? String(category) : undefined,
    address: address ? String(address) : undefined,
    roadAddress: roadAddress ? String(roadAddress) : undefined,
    phone: phone ? String(phone) : undefined,
    hoursText: hoursText ? String(hoursText) : undefined,
    tags: Array.isArray(tags) ? tags.map(String) : undefined,
    description: description ? String(description) : undefined,
    directions: directions ? String(directions) : undefined,
    reviews: {
      rating: rating ?? undefined,
      visitorCount: visitorCount ?? undefined,
      blogCount: blogCount ?? undefined
    }
  };
}

function extractPlaceId(url: string) {
  const m = url.match(/place\/(\d+)/);
  return m?.[1];
}

function guessNameFromTitle(title: string) {
  // 예: "파인트리헤어살롱 : 네이버" 같은 패턴
  return title.replace(/:.*$/, "").trim();
}

function tryExtractJsonFromScript(scriptText: string): any | null {
  // case A: <script id="__NEXT_DATA__" type="application/json">{...}</script> 일 때는 cheerio에서 text가 곧 json
  const trimmed = scriptText.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return null;
    }
  }

  // case B: window.__APOLLO_STATE__=...
  const m = trimmed.match(/({.*})/s);
  if (m?.[1]) {
    try {
      return JSON.parse(m[1]);
    } catch {
      return null;
    }
  }
  return null;
}

function deepFind(obj: any, keys: string[]): any {
  // keys 중 하나라도 발견되면 반환(DFS)
  const keySet = new Set(keys);
  const stack = [obj];

  while (stack.length) {
    const cur = stack.pop();
    if (!cur || typeof cur !== "object") continue;

    for (const [k, v] of Object.entries(cur)) {
      if (keySet.has(k)) return v;
      if (v && typeof v === "object") stack.push(v);
    }
  }
  return null;
}

function asNumber(v: any): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(String(v).replace(/[^\d.]/g, ""));
  return Number.isFinite(n) ? n : null;
}
