// src/services/extractKeywordsFromHtml.ts

/**
 * 네이버 플레이스(모바일) HTML에서 "기존 대표키워드"를 최대한 그대로 추출
 * 우선순위:
 *  1) __NEXT_DATA__ JSON 내부에서 키워드 배열 찾기
 *  2) 실패 시: HTML 텍스트에서 "대표키워드" 섹션 주변을 휴리스틱 추출
 *
 * 반환은 "원문 기준(existing)"이므로 잡음 제거를 최소화.
 * (단, '마이플레이스/문의/소식/이미지 갯수' 같은 UI 잡음은 기본 제거)
 */
export function extractExistingKeywordsFromHtml(html: string): string[] {
  const out =
    extractFromNextData(html) ||
    extractFromEmbeddedJson(html) ||
    extractFromSectionText(html) ||
    [];

  return normalizeExistingKeywords(out);
}

function extractFromNextData(html: string): string[] | null {
  // <script id="__NEXT_DATA__" type="application/json">...</script>
  const m = html.match(/<script[^>]+id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i);
  if (!m) return null;

  const raw = m[1]?.trim();
  if (!raw) return null;

  const data = safeJsonParse(raw);
  if (!data) return null;

  const found = findKeywordArraysDeep(data);
  if (!found.length) return null;

  // 가장 그럴듯한 배열 선택: (1) 한글/영문 섞인 짧은 토큰 위주 (2) 길이 3~20
  const best = pickBestKeywordArray(found);
  return best ?? null;
}

function extractFromEmbeddedJson(html: string): string[] | null {
  // 일부 페이지는 다른 JSON blob 형태로도 있음: window.__APOLLO_STATE__ / __PLACE_STATE__ 등
  // 너무 공격적으로 하면 오탐이 많아서, "keywords" 문자열이 있는 script만 후보로 잡음
  const scripts = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)].map((x) => x[1] || "");
  const candidates = scripts
    .filter((s) => /keywords?|keywordList|대표키워드/i.test(s))
    .slice(0, 8); // 제한

  for (const s of candidates) {
    // JSON처럼 보이는 덩어리만 파싱 시도
    const jsonLike = extractFirstJsonObjectOrArray(s);
    if (!jsonLike) continue;

    const parsed = safeJsonParse(jsonLike);
    if (!parsed) continue;

    const found = findKeywordArraysDeep(parsed);
    const best = pickBestKeywordArray(found);
    if (best?.length) return best;
  }

  return null;
}

function extractFromSectionText(html: string): string[] | null {
  // 최후의 폴백: "대표키워드" 주변 텍스트에서 토큰 뽑기
  // HTML 태그 제거 후, "대표키워드" 다음 일정 범위에서 단어 후보를 추출
  const text = stripTags(html);
  const idx = text.indexOf("대표키워드");
  if (idx < 0) return null;

  const slice = text.slice(idx, idx + 400); // 대표키워드 영역 근처만
  // 해시태그/중간점/구분자 기준으로 토큰화
  const tokens = slice
    .split(/[\n\r\t•·|,/]+/)
    .map((t) => t.trim())
    .filter(Boolean);

  // "대표키워드" 자체 제거 + 너무 긴 문장 제거
  const cleaned = tokens
    .filter((t) => t !== "대표키워드")
    .filter((t) => t.length >= 2 && t.length <= 20);

  return cleaned.length ? cleaned : null;
}

function normalizeExistingKeywords(arr: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  for (const raw of arr) {
    const t = (raw || "")
      .replace(/\s+/g, " ")
      .trim();

    if (!t) continue;

    // 대표키워드 "원문"이지만, 아래 UI 잡음은 제거하는 게 맞음
    if (/(마이플레이스|이미지\s*갯수|문의|소식|스타일|방문자\s*리뷰|블로그\s*리뷰)/i.test(t)) continue;
    if (/^\d+$/.test(t)) continue;

    // 너무 긴 문장 제거
    if (t.length > 24) continue;

    if (seen.has(t)) continue;
    seen.add(t);
    out.push(t);
    if (out.length >= 20) break; // existing은 최대 20개 정도만
  }

  return out;
}

/** ✅ Deep search: string[] 형태 키워드 배열 후보 모두 수집 */
function findKeywordArraysDeep(obj: any, depth = 0): string[][] {
  if (!obj || depth > 10) return [];
  const out: string[][] = [];

  if (Array.isArray(obj)) {
    // 문자열 배열이면 후보
    if (obj.length && obj.every((x) => typeof x === "string")) {
      out.push(obj as string[]);
    }
    // 중첩 탐색
    for (const it of obj) out.push(...findKeywordArraysDeep(it, depth + 1));
    return out;
  }

  if (typeof obj === "object") {
    for (const k of Object.keys(obj)) {
      const v = obj[k];
      // 키 이름이 keyword 계열이면 가중(하지만 여기서는 수집만)
      out.push(...findKeywordArraysDeep(v, depth + 1));
    }
  }

  return out;
}

function pickBestKeywordArray(cands: string[][]): string[] | null {
  if (!cands.length) return null;

  const scored = cands
    .map((arr) => {
      const a = arr.map((x) => (x || "").trim()).filter(Boolean);
      const len = a.length;

      // 길이 점수: 3~20 선호
      let score = 0;
      if (len >= 3 && len <= 20) score += 3;
      if (len >= 5 && len <= 15) score += 3;

      // 토큰 품질: 한글/영문 포함 + 너무 길지 않음
      const good = a.filter((t) => /[가-힣A-Za-z]/.test(t) && t.length <= 20).length;
      score += Math.min(good, 10);

      // UI 잡음이 많이 섞이면 감점
      const noise = a.filter((t) => /(마이플레이스|이미지|문의|소식|리뷰)/i.test(t)).length;
      score -= noise * 2;

      return { arr: a, score };
    })
    .sort((x, y) => y.score - x.score);

  const best = scored[0];
  return best?.score >= 4 ? best.arr : scored[0]?.arr ?? null;
}

function safeJsonParse(s: string): any | null {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function extractFirstJsonObjectOrArray(s: string): string | null {
  // script 내용에서 첫 번째 { ... } 또는 [ ... ] 덩어리 뽑기(대충)
  const startObj = s.indexOf("{");
  const startArr = s.indexOf("[");
  const start = startObj >= 0 && startArr >= 0 ? Math.min(startObj, startArr) : Math.max(startObj, startArr);
  if (start < 0) return null;

  const chunk = s.slice(start).trim();

  // 아주 거친 밸런스 추적
  const open = chunk[0];
  const close = open === "{" ? "}" : "]";
  let depth = 0;

  for (let i = 0; i < chunk.length; i++) {
    const ch = chunk[i];
    if (ch === open) depth++;
    if (ch === close) depth--;
    if (depth === 0) return chunk.slice(0, i + 1);
  }
  return null;
}

function stripTags(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
