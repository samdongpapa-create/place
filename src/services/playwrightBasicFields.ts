// src/services/playwrightBasicFields.ts
import type { Page } from "playwright";

export type BasicFields = {
  name?: string;
  category?: string;
  address?: string;
  roadAddress?: string;
  // ✅ 네가 말하는 "오시는길"
  directions?: string;
  // ✅ 네가 말하는 "상세설명(소개글)"
  description?: string;
  photoCount?: number;
};

export type BasicFieldsResult = {
  fields: BasicFields;
  debug: any;
};

type Opts = {
  timeoutMs?: number;
};

export async function fetchBasicFieldsViaPlaywright(
  page: Page,
  homeUrl: string,
  opts: Opts = {}
): Promise<BasicFieldsResult> {
  const t0 = Date.now();
  const timeoutMs = opts.timeoutMs ?? 15000;

  const debug: any = {
    used: true,
    targetUrl: stripQuery(homeUrl),
    steps: [],
    picked: {},
  };

  const fields: BasicFields = {};

  // 1) HOME 진입
  await page.goto(homeUrl, { waitUntil: "domcontentloaded", timeout: timeoutMs });
  debug.steps.push({ step: "goto.home", elapsedMs: Date.now() - t0 });

  // 약간 기다려야 NEXT_DATA/렌더가 안정화됨
  await page.waitForTimeout(600);

  // 2) DOM + meta + nextdata 후보를 한 번에 수집
  const raw = await page.evaluate(() => {
    const d = (globalThis as any).document;

    const text = (sel: string) => {
      const el = d?.querySelector?.(sel);
      return (el?.textContent ?? "").trim();
    };

    const attr = (sel: string, name: string) => {
      const el = d?.querySelector?.(sel);
      return (el?.getAttribute?.(name) ?? "").trim();
    };

    // meta
    const ogDesc = attr('meta[property="og:description"]', "content") || "";
    const metaDesc = attr('meta[name="description"]', "content") || "";

    // NEXT_DATA (있으면 제일 강력)
    let nextJsonText = "";
    try {
      nextJsonText = text("#__NEXT_DATA__");
    } catch {}

    // 페이지 텍스트 스냅샷(최후의 후보 탐색용)
    let bodyText = "";
    try {
      bodyText = (d?.body?.innerText ?? "").slice(0, 6000);
    } catch {}

    // 이름/카테고리/주소/오시는길은 DOM에서 최대한 직접
    // (Naver DOM이 자주 바뀌어서 "후보" 여러개로 둠)
    const nameCandidates = [
      text("h1"),
      text('[data-testid="title"]'),
      text(".Fc1rA"), // (가끔 쓰이는 클래스)
    ].filter(Boolean);

    const categoryCandidates = [
      text('[class*="category"]'),
      text(".place_bluelink + span"),
    ].filter(Boolean);

    // 주소 후보: "주소" 텍스트 포함 블록 우선
    const addrCandidates = [
      text('div:has(span:has-text("주소"))'),
      text('section:has(span:has-text("주소"))'),
      text('[class*="address"]'),
    ].filter(Boolean);

    // "찾아가는길" 영역 후보
    const dirCandidates = [
      text('div:has-text("찾아가는길")'),
      text('section:has-text("찾아가는길")'),
      text('[class*="direction"]'),
    ].filter(Boolean);

    return {
      nameCandidates,
      categoryCandidates,
      addrCandidates,
      dirCandidates,
      ogDesc,
      metaDesc,
      nextJsonText,
      bodyText,
    };
  });

  // 3) name/category/address/directions 정리
  fields.name = pickFirstMeaningful(raw.nameCandidates);
  fields.category = pickFirstMeaningful(raw.categoryCandidates);

  // 주소는 "지도내비게이션거리뷰" 같은 붙은 쓰레기 텍스트가 섞이므로 정리
  fields.address = cleanAddress(pickFirstMeaningful(raw.addrCandidates) || "");

  // 오시는길: "찾아가는길" 헤더 같은 줄 제거 + 내용만 정리
  fields.directions = cleanDirections(pickFirstMeaningful(raw.dirCandidates) || "");

  // 4) ✅ 상세설명(소개글) — 후보 우선순위:
  // (A) NEXT_DATA에서 description/intro 후보 탐색
  // (B) meta/og description
  // (C) bodyText에서 "소개" 근처 스니펫(최후)
  const fromNext = extractIntroFromNextData(raw.nextJsonText);
  const fromMeta = cleanDescription(raw.ogDesc || raw.metaDesc || "");
  const fromBody = extractIntroFromBodyText(raw.bodyText);

  const desc = pickFirstMeaningful([fromNext, fromMeta, fromBody].filter(Boolean));
  fields.description = cleanDescription(desc || "");

  // “리뷰 숫자 요약”만 잡힌 경우는 상세설명 없음 처리
  if (looksLikeReviewSnippet(fields.description || "")) {
    fields.description = "";
  }

  debug.picked = {
    name: !!fields.name,
    category: !!fields.category,
    address: !!fields.address,
    directions: !!fields.directions,
    description: !!fields.description,
    descriptionSource: fromNext ? "nextData" : fromMeta ? "meta" : fromBody ? "body" : "none",
  };

  debug.elapsedMs = Date.now() - t0;
  debug.raw = {
    ogDesc: raw.ogDesc,
    metaDesc: raw.metaDesc,
    hasNextData: !!raw.nextJsonText,
  };

  return { fields, debug };
}

/* ---------------- helpers ---------------- */

function stripQuery(url: string) {
  return url.replace(/\?.*$/, "");
}

function pickFirstMeaningful(arr: string[]) {
  for (const s of arr || []) {
    const x = (s || "").trim();
    if (!x) continue;
    if (x.length < 2) continue;
    return x;
  }
  return "";
}

function cleanAddress(s: string) {
  let x = (s || "").trim();
  if (!x) return "";
  x = x
    .replace(/지도내비게이션거리뷰/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  // "서대문역 4번 출구에서 90m" 같은 안내문이 붙는 경우 잘라내기
  x = x.replace(/서대문역.*?m\s*미터.*$/i, "").trim();
  return x;
}

function cleanDirections(s: string) {
  let x = (s || "").trim();
  if (!x) return "";
  x = x.replace(/^찾아가는길\s*/g, "").trim();
  x = x.replace(/\s*\.\.\.\s*내용 더보기\s*$/g, "").trim();
  x = x.replace(/\s+/g, " ").trim();
  return x;
}

function cleanDescription(s: string) {
  let x = (s || "").trim();
  if (!x) return "";
  x = x.replace(/\s+/g, " ").trim();
  return x;
}

function looksLikeReviewSnippet(s: string) {
  const x = (s || "").trim();
  if (!x) return false;
  // 네 로그처럼 “방문자리뷰/블로그리뷰” 스니펫은 상세설명 아님
  return /방문자리뷰|블로그리뷰/.test(x) && x.length < 80;
}

function extractIntroFromNextData(nextJsonText: string) {
  const t = (nextJsonText || "").trim();
  if (!t) return "";

  try {
    const json = JSON.parse(t);

    // 구조가 자주 바뀌어서 "문자열 탐색" 위주로 안전하게
    const candidates: string[] = [];
    const s = JSON.stringify(json);

    // 흔한 키들: description, intro, introduction, summary 등
    // 너무 길면 잘라냄
    for (const key of ["description", "intro", "introduction", "summary", "storeDescription"]) {
      const m = s.match(new RegExp(`"${key}"\\s*:\\s*"([^"]{10,600})"`));
      if (m?.[1]) candidates.push(unescapeJsonString(m[1]));
    }

    return pickFirstMeaningful(candidates);
  } catch {
    return "";
  }
}

function unescapeJsonString(s: string) {
  // JSON 문자열 escape 최소 복원
  return (s || "")
    .replace(/\\"/g, '"')
    .replace(/\\n/g, "\n")
    .replace(/\\t/g, "\t")
    .replace(/\\u003c/g, "<")
    .replace(/\\u003e/g, ">")
    .replace(/\\u0026/g, "&")
    .trim();
}

function extractIntroFromBodyText(bodyText: string) {
  const t = (bodyText || "").trim();
  if (!t) return "";

  // “소개”라는 단어 주변에서 1~2줄 뽑기 (최후의 수단)
  const idx = t.indexOf("소개");
  if (idx === -1) return "";

  const slice = t.slice(idx, idx + 280);
  // 너무 잡다한 메뉴 네비 텍스트 섞이면 컷
  if (slice.includes("리뷰") && slice.includes("사진") && slice.length < 60) return "";

  return slice;
}
