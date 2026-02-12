// src/services/playwrightBasicFields.ts
import type { Page } from "playwright";

export type BasicFields = {
  name?: string;
  category?: string;
  address?: string;
  roadAddress?: string;
  directions?: string;   // 오시는길
  description?: string;  // 소개/상세설명
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
  const timeoutMs = opts.timeoutMs ?? 22000;

  const debug: any = {
    used: true,
    targetUrl: stripQuery(homeUrl),
    steps: [],
    picked: {},
    actions: [],
  };

  const fields: BasicFields = {};
  const step = (s: any) => debug.steps.push({ at: Date.now() - t0, ...s });

  await page.goto(homeUrl, { waitUntil: "domcontentloaded", timeout: timeoutMs });
  step({ step: "goto.home" });

  await page.waitForTimeout(900);
  step({ step: "wait.900" });

  // 1) warmup (스크롤/더보기)
  await warmUpForHiddenSections(page, debug);
  step({ step: "warmup.done" });

  // 2) 수집 1차
  let raw = await collect(page);
  step({ step: "collect.1", snapshot: summarizeRaw(raw) });

  // 3) 주소/오시는길이 비면 "지도/길찾기/오시는길" 클릭 시도 후 재수집
  const needAddress = !pickFirstMeaningful(raw.addrCandidates);
  const needDir = !pickFirstMeaningful(raw.dirCandidates);

  if (needAddress || needDir) {
    await tryOpenDirectionsLayer(page, debug);
    await page.waitForTimeout(650);
    raw = await collect(page);
    step({ step: "collect.after.openDirections", snapshot: summarizeRaw(raw) });
  }

  // 4) 그래도 비면 strong warmup 한 번 더
  const stillNeed =
    !pickFirstMeaningful(raw.addrCandidates) || !pickFirstMeaningful(raw.dirCandidates);

  if (stillNeed) {
    await warmUpForHiddenSections(page, debug, true);
    step({ step: "warmup.strong.done" });
    raw = await collect(page);
    step({ step: "collect.2", snapshot: summarizeRaw(raw) });
  }

  // =========================
  // 필드 정리
  // =========================
  fields.name = pickFirstMeaningful(raw.nameCandidates);
  fields.category = cleanCategory(pickFirstMeaningful(raw.categoryCandidates));

  // ✅ 주소: DOM 후보 -> ld+json -> body 정규식
  const addrFromDom = cleanAddress(pickFirstMeaningful(raw.addrCandidates) || "");
  const addrFromLd = cleanAddress(extractAddressFromLdJson(raw.ldJsonText) || "");
  const addrFromBody = cleanAddress(extractKoreanAddressFromText(raw.bodyText) || "");
  fields.address = pickFirstMeaningful([addrFromDom, addrFromLd, addrFromBody].filter(Boolean));

  // 도로명은 ldjson에 따로 있을 수 있음
  fields.roadAddress = cleanAddress(extractRoadAddressFromLdJson(raw.ldJsonText) || "");

  // ✅ 오시는길: DOM 후보 -> body에서 “출구/도보/주차” 포함 문장 추출
  const dirFromDom = cleanDirections(pickFirstMeaningful(raw.dirCandidates) || "");
  const dirFromBody = cleanDirections(extractDirectionsFromText(raw.bodyText) || "");
  fields.directions = pickFirstMeaningful([dirFromDom, dirFromBody].filter(Boolean));

  // ✅ 소개/상세설명: DOM 후보 -> NEXT_DATA -> meta -> body
  const fromDom = cleanDescription(pickFirstMeaningful(raw.descCandidates) || "");
  const fromNext = extractIntroFromNextData(raw.nextJsonText);
  const fromMeta = cleanDescription(raw.ogDesc || raw.metaDesc || "");
  const fromBody = extractIntroFromBodyText(raw.bodyText);

  const desc = pickFirstMeaningful([fromDom, fromNext, fromMeta, fromBody].filter(Boolean));
  fields.description = cleanDescription(desc || "");

  // “접기” 제거(너 결과에 붙어있었음)
  if (fields.description) fields.description = fields.description.replace(/접기\s*$/g, "").trim();

  if (looksLikeReviewSnippet(fields.description || "")) fields.description = "";

  debug.picked = {
    name: !!fields.name,
    category: !!fields.category,
    address: !!fields.address,
    roadAddress: !!fields.roadAddress,
    directions: !!fields.directions,
    description: !!fields.description,
    descriptionSource: fromDom ? "dom" : fromNext ? "nextData" : fromMeta ? "meta" : fromBody ? "body" : "none",
  };

  debug.elapsedMs = Date.now() - t0;
  debug.raw = {
    ogDesc: raw.ogDesc,
    metaDesc: raw.metaDesc,
    hasNextData: !!raw.nextJsonText,
    hasLdJson: !!raw.ldJsonText,
  };

  return { fields, debug };
}

/* =========================================================
 * 액션: 스크롤 + 더보기 클릭
 * ========================================================= */

async function warmUpForHiddenSections(page: Page, debug: any, strong = false) {
  const t = Date.now();
  const act = (a: any) => debug.actions.push({ at: Date.now() - t, ...a });

  await scrollPage(page, strong ? 6 : 4, act);
  await clickMoreButtons(page, act, strong ? 7 : 3);

  // "정보" 탭 있으면 한 번 눌러주기
  await tryClickByText(page, ["정보", "매장정보", "가게정보"], act);

  await scrollPage(page, strong ? 4 : 2, act);
  await clickMoreButtons(page, act, strong ? 7 : 2);

  act({ step: "warmup.finish", strong });
}

async function scrollPage(page: Page, times: number, act: (a: any) => void) {
  for (let i = 0; i < times; i++) {
    try {
      await page.mouse.wheel(0, 900);
      await page.waitForTimeout(450);
      act({ step: "scroll", i });
    } catch (e: any) {
      act({ step: "scroll.fail", i, error: e?.message ?? String(e) });
      break;
    }
  }
}

async function clickMoreButtons(page: Page, act: (a: any) => void, maxClicks: number) {
  for (let i = 0; i < maxClicks; i++) {
    try {
      const btn = page.getByRole("button", { name: /더보기|펼쳐보기|자세히보기/i }).first();
      const count = await btn.count();
      if (!count) break;

      await btn.click({ timeout: 1500 });
      await page.waitForTimeout(450);
      act({ step: "click.more", clicked: i + 1 });
    } catch (e: any) {
      act({ step: "click.more.fail", error: e?.message ?? String(e) });
      break;
    }
  }
}

async function tryClickByText(page: Page, labels: string[], act: (a: any) => void) {
  for (const label of labels) {
    try {
      const el = page.getByText(label, { exact: false }).first();
      const n = await el.count();
      if (!n) continue;

      await el.click({ timeout: 1500 });
      await page.waitForTimeout(600);
      act({ step: "click.text", label, ok: true });
      return;
    } catch (e: any) {
      act({ step: "click.text.fail", label, error: e?.message ?? String(e) });
    }
  }
}

/* =========================================================
 * ✅ 오시는길/지도 레이어 열기 시도 (핵심)
 * ========================================================= */
async function tryOpenDirectionsLayer(page: Page, debug: any) {
  const t = Date.now();
  const act = (a: any) => debug.actions.push({ at: Date.now() - t, ...a });

  // 모바일 네이버플레이스에서 흔히 보이는 텍스트/버튼들
  const tries = [
    "오시는길",
    "찾아오는길",
    "길찾기",
    "지도",
    "위치",
    "주차",
  ];

  for (const label of tries) {
    try {
      const el = page.getByText(label, { exact: false }).first();
      const n = await el.count();
      if (!n) continue;

      await el.click({ timeout: 1500 });
      await page.waitForTimeout(600);
      act({ step: "open.directions.click", label, ok: true });
      return;
    } catch (e: any) {
      act({ step: "open.directions.fail", label, error: e?.message ?? String(e) });
    }
  }

  // 버튼 role 기반도 한 번 더
  try {
    const btn = page.getByRole("button", { name: /길찾기|오시는길|지도/i }).first();
    const n = await btn.count();
    if (n) {
      await btn.click({ timeout: 1500 });
      await page.waitForTimeout(600);
      act({ step: "open.directions.roleButton", ok: true });
      return;
    }
  } catch (e: any) {
    act({ step: "open.directions.roleButton.fail", error: e?.message ?? String(e) });
  }

  act({ step: "open.directions.skip" });
}

/* =========================================================
 * 수집 로직
 * ========================================================= */

async function collect(page: Page) {
  return await page.evaluate(() => {
    const d = (globalThis as any).document;

    const norm = (s: string) => (s || "").replace(/\s+/g, " ").trim();
    const textOf = (el: any) => norm(el?.textContent ?? "");

    const text = (sel: string) => {
      const el = d?.querySelector?.(sel);
      return textOf(el);
    };

    const attr = (sel: string, name: string) => {
      const el = d?.querySelector?.(sel);
      return norm(el?.getAttribute?.(name) ?? "");
    };

    // meta
    const ogDesc = attr('meta[property="og:description"]', "content") || "";
    const metaDesc = attr('meta[name="description"]', "content") || "";

    // NEXT_DATA
    let nextJsonText = "";
    try {
      nextJsonText = text("#__NEXT_DATA__");
    } catch {}

    // ld+json (주소 들어있는 경우 많음)
    let ldJsonText = "";
    try {
      const nodes = Array.from(d.querySelectorAll('script[type="application/ld+json"]'));
      ldJsonText = nodes.map((n: any) => (n?.textContent ?? "").trim()).filter(Boolean).join("\n");
    } catch {}

    // body snapshot
    let bodyText = "";
    try {
      bodyText = (d?.body?.innerText ?? "").slice(0, 20000);
    } catch {}

    // label 근처 값 뽑기
    const pickNearLabel = (label: string) => {
      const all = Array.from(d.querySelectorAll("dt, span, div, strong, em, h1, h2, h3, p, a, button"));
      const hit = all.find((el: any) => textOf(el) === label);
      if (!hit) return "";

      if ((hit as any).tagName?.toLowerCase() === "dt") {
        const dd = (hit as any).nextElementSibling;
        const v = textOf(dd);
        if (v) return v;
      }

      const parent = (hit as any).parentElement;
      if (parent) {
        const children = Array.from(parent.children);
        const idx = children.indexOf(hit as any);
        if (idx >= 0 && children[idx + 1]) {
          const v = textOf(children[idx + 1]);
          if (v) return v;
        }
      }

      let cur: any = hit;
      for (let i = 0; i < 12; i++) {
        const next = cur?.nextElementSibling;
        const v = textOf(next);
        if (v) return v;
        cur = cur?.parentElement;
        if (!cur) break;
      }

      return "";
    };

    const nameCandidates = [
      text("h1"),
      text('[data-testid="title"]'),
      text(".Fc1rA"),
    ].filter(Boolean);

    const categoryCandidates = [
      text("h1 + div"),
      text("h1 + span"),
      text('[class*="category"]'),
    ].filter(Boolean);

    const addrCandidates = [
      pickNearLabel("주소"),
      pickNearLabel("위치"),
      pickNearLabel("도로명주소"),
      text('[class*="address"]'),
    ].filter(Boolean);

    const dirCandidates = [
      pickNearLabel("오시는길"),
      pickNearLabel("찾아오는길"),
      pickNearLabel("길안내"),
      pickNearLabel("주차"),
    ].filter(Boolean);

    const descCandidates = [
      pickNearLabel("소개"),
      pickNearLabel("상세설명"),
      pickNearLabel("매장소개"),
    ].filter(Boolean);

    return {
      nameCandidates,
      categoryCandidates,
      addrCandidates,
      dirCandidates,
      descCandidates,
      ogDesc,
      metaDesc,
      nextJsonText,
      ldJsonText,
      bodyText,
    };
  });
}

function summarizeRaw(raw: any) {
  const pick = (arr: any[]) => (Array.isArray(arr) && arr.length ? String(arr[0]).slice(0, 60) : "");
  return {
    name: pick(raw?.nameCandidates),
    category: pick(raw?.categoryCandidates),
    addr: pick(raw?.addrCandidates),
    dir: pick(raw?.dirCandidates),
    desc: pick(raw?.descCandidates),
    hasNext: !!raw?.nextJsonText,
    hasLd: !!raw?.ldJsonText,
    ogDesc: (raw?.ogDesc || "").slice(0, 40),
  };
}

/* ---------------- helpers ---------------- */

function stripQuery(url: string) {
  return url.replace(/\?.*$/, "");
}

function pickFirstMeaningful(arr: string[]) {
  for (const s of arr || []) {
    const x = (s || "").replace(/\s+/g, " ").trim();
    if (!x) continue;
    if (x.length < 2) continue;
    return x;
  }
  return "";
}

function cleanCategory(s: string) {
  let x = (s || "").trim();
  if (!x) return "";
  x = x.replace(/\s+/g, " ").trim();
  if (x.length > 40) x = x.slice(0, 40).trim();
  x = x.replace(/방문자리뷰.*$/g, "").trim();
  return x;
}

function cleanAddress(s: string) {
  let x = (s || "").trim();
  if (!x) return "";

  x = x.replace(/지도내비게이션거리뷰/g, " ").replace(/\s+/g, " ").trim();
  x = x.replace(/(\d)([가-힣])/g, "$1 $2");

  // 역/거리 안내 제거
  x = x.replace(/서대문역.*?(m|미터).*$/i, "").trim();
  x = x.replace(/(\d+)\s*m\s*.*$/i, "").trim();

  // 너무 짧으면 무효
  if (x.length < 6) return "";
  return x;
}

function cleanDirections(s: string) {
  let x = (s || "").trim();
  if (!x) return "";
  x = x.replace(/^찾아가는길\s*/g, "").trim();
  x = x.replace(/\s*\.\.\.\s*내용 더보기\s*$/g, "").trim();
  x = x.replace(/\s+/g, " ").trim();
  if (x.length < 6) return "";
  return x;
}

function cleanDescription(s: string) {
  let x = (s || "").trim();
  if (!x) return "";
  x = x.replace(/\s+/g, " ").trim();
  if (x.length < 10) return "";
  return x;
}

function looksLikeReviewSnippet(s: string) {
  const x = (s || "").trim();
  if (!x) return false;
  return /방문자리뷰|블로그리뷰/.test(x) && x.length < 80;
}

// ✅ ld+json에서 address 꺼내기
function extractAddressFromLdJson(ldJsonText: string) {
  const t = (ldJsonText || "").trim();
  if (!t) return "";
  try {
    // 여러 개일 수 있어서 대충 문자열 탐색
    const s = t;
    // addressLocality / streetAddress 조합
    const m1 = s.match(/"streetAddress"\s*:\s*"([^"]{4,200})"/);
    const m2 = s.match(/"addressLocality"\s*:\s*"([^"]{2,100})"/);
    const m3 = s.match(/"addressRegion"\s*:\s*"([^"]{2,100})"/);

    const parts = [m3?.[1], m2?.[1], m1?.[1]].filter(Boolean);
    return parts.join(" ").trim();
  } catch {
    return "";
  }
}

// ✅ ld+json에서 도로명만 따로
function extractRoadAddressFromLdJson(ldJsonText: string) {
  const t = (ldJsonText || "").trim();
  if (!t) return "";
  try {
    const m = t.match(/"streetAddress"\s*:\s*"([^"]{4,200})"/);
    return m?.[1] ? m[1].trim() : "";
  } catch {
    return "";
  }
}

// ✅ bodyText에서 한국 주소 정규식 추출
function extractKoreanAddressFromText(bodyText: string) {
  const t = (bodyText || "").replace(/\s+/g, " ").trim();
  if (!t) return "";

  // “서울 종로구 새문안로 15-1” 같은 형태
  const re =
    /(서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주)\s*[가-힣0-9\s]+?(구|군|시)\s*[가-힣0-9\s]+?(로|길)\s*\d{1,4}(-\d{1,4})?/;

  const m = t.match(re);
  return m?.[0] ? m[0].trim() : "";
}

// ✅ bodyText에서 오시는길 문장 추출(출구/도보/주차 키워드)
function extractDirectionsFromText(bodyText: string) {
  const t = (bodyText || "").replace(/\s+/g, " ").trim();
  if (!t) return "";

  const keys = ["출구", "도보", "주차", "가까", "m", "미터", "분"];
  for (const k of keys) {
    const idx = t.indexOf(k);
    if (idx > -1) {
      const slice = t.slice(Math.max(0, idx - 30), idx + 120);
      if (slice.length >= 12) return slice.trim();
    }
  }
  return "";
}

function extractIntroFromNextData(nextJsonText: string) {
  const t = (nextJsonText || "").trim();
  if (!t) return "";

  try {
    const json = JSON.parse(t);
    const candidates: string[] = [];
    const s = JSON.stringify(json);

    for (const key of ["description", "intro", "introduction", "summary", "storeDescription"]) {
      const m = s.match(new RegExp(`"${key}"\\s*:\\s*"([^"]{10,800})"`));
      if (m?.[1]) candidates.push(unescapeJsonString(m[1]));
    }

    return pickFirstMeaningful(candidates);
  } catch {
    return "";
  }
}

function unescapeJsonString(s: string) {
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

  const idx = t.indexOf("소개");
  if (idx === -1) return "";

  const slice = t.slice(idx, idx + 400);
  if (slice.includes("리뷰") && slice.includes("사진") && slice.length < 80) return "";

  return slice;
}

