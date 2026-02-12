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

  // 1) warmup (스크롤/더보기/정보탭)
  await warmUpForHiddenSections(page, debug);
  step({ step: "warmup.done" });

  // 2) 수집 1차
  let raw = await collect(page);
  step({ step: "collect.1", snapshot: summarizeRaw(raw) });

  // 3) 주소/오시는길이 비면 "길찾기/지도/오시는길" 클릭 시도 후 재수집
  const needAddress = !pickFirstMeaningful(raw.addrCandidates);
  const needDir = !pickFirstMeaningful(raw.dirCandidates);

  if (needAddress || needDir) {
    await tryOpenDirectionsLayer(page, debug);
    await page.waitForTimeout(650);
    raw = await collect(page);
    step({ step: "collect.after.openDirections", snapshot: summarizeRaw(raw) });
  }

  // 4) 그래도 주소/오시는길이 비면 strong warmup 한 번 더
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

  // ✅ 주소(가장 중요): dt/dd -> 라벨근처 -> body 정규식
  const addrFromDom = cleanAddress(pickFirstMeaningful(raw.addrCandidates) || "");
  const addrFromPairs = cleanAddress(raw.pairs?.address || "");
  const roadFromPairs = cleanAddress(raw.pairs?.roadAddress || "");

  // body 정규식 (서울특별시/서울시/서울 등 변형 포함)
  const addrFromBody = cleanAddress(extractKoreanAddressFromText(raw.bodyText) || "");

  fields.address = pickFirstMeaningful([addrFromPairs, addrFromDom, addrFromBody].filter(Boolean));
  fields.roadAddress = pickFirstMeaningful([roadFromPairs, raw.roadCandidate || ""].filter(Boolean));

  // ✅ 오시는길: DOM 후보 + body에서 “출구/도보/주차” 문장 추출 + 주차문장 결합
  const dirFromDom = cleanDirections(pickFirstMeaningful(raw.dirCandidates) || "");
  const dirFromBody = cleanDirections(extractDirectionsFromText(raw.bodyText) || "");

  // 주차 문장만 잡히는 케이스(너 지금 이 상태) → 출구/도보 문장 우선 결합
  fields.directions = mergeDirections(dirFromBody, dirFromDom);

  // ✅ 소개/상세설명: DOM 후보 -> NEXT_DATA -> meta -> body
  const fromDom = cleanDescription(pickFirstMeaningful(raw.descCandidates) || "");
  const fromNext = extractIntroFromNextData(raw.nextJsonText);
  const fromMeta = cleanDescription(raw.ogDesc || raw.metaDesc || "");
  const fromBody = extractIntroFromBodyText(raw.bodyText);

  const desc = pickFirstMeaningful([fromDom, fromNext, fromMeta, fromBody].filter(Boolean));
  fields.description = cleanDescription(desc || "");

  // “접기” 제거
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

  // "정보" 탭 있으면 눌러주기
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
 * ✅ 오시는길/지도 레이어 열기 시도
 * ========================================================= */
async function tryOpenDirectionsLayer(page: Page, debug: any) {
  const t = Date.now();
  const act = (a: any) => debug.actions.push({ at: Date.now() - t, ...a });

  const tries = ["오시는길", "찾아오는길", "길찾기", "지도", "위치", "주차"];

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
 * 수집 로직 (주소 강제 강화)
 * ========================================================= */

async function collect(page: Page) {
  return await page.evaluate(() => {
    const d = (globalThis as any).document;

    const norm = (s: string) => (s || "").replace(/\s+/g, " ").trim();
    const textOf = (el: any) => norm(el?.textContent ?? "");

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
      const el = d?.querySelector?.("#__NEXT_DATA__");
      nextJsonText = norm(el?.textContent ?? "");
    } catch {}

    // body snapshot
    let bodyText = "";
    try {
      bodyText = (d?.body?.innerText ?? "").slice(0, 25000);
    } catch {}

    // ✅ dt/dd 구조 파싱 (네이버는 여기로 주소/전화/영업시간을 많이 넣음)
    const pairs: any = { address: "", roadAddress: "", parking: "" };
    try {
      const dts = Array.from(d.querySelectorAll("dt"));
      for (const dt of dts) {
        const k = textOf(dt);
        const dd = (dt as any).nextElementSibling;
        const v = textOf(dd);

        if (!v) continue;

        if (/주소|위치|도로명주소/i.test(k)) {
          // "도로명주소"면 roadAddress로도 저장
          if (/도로명주소/i.test(k) && !pairs.roadAddress) pairs.roadAddress = v;
          if (!pairs.address) pairs.address = v;
        }

        if (/주차/i.test(k) && !pairs.parking) pairs.parking = v;
      }
    } catch {}

    // ✅ “라벨 포함(includes)” 기반으로 주변값 찾기
    const pickNearLabelIncludes = (label: string) => {
      const all = Array.from(
        d.querySelectorAll("dt, dd, span, div, strong, em, p, a, button, li")
      );

      const hit = all.find((el: any) => {
        const t = textOf(el);
        return t && t.includes(label);
      });
      if (!hit) return "";

      // dt/dd면 dd 우선
      if ((hit as any).tagName?.toLowerCase() === "dt") {
        const dd = (hit as any).nextElementSibling;
        const v = textOf(dd);
        if (v) return v;
      }

      // 같은 부모의 다음 형제
      const parent = (hit as any).parentElement;
      if (parent) {
        const children = Array.from(parent.children);
        const idx = children.indexOf(hit as any);
        for (let i = 1; i <= 3; i++) {
          const sib = children[idx + i];
          const v = textOf(sib);
          if (v) return v;
        }
      }

      // 다음 형제 몇 개
      let cur: any = hit;
      for (let i = 0; i < 8; i++) {
        const next = cur?.nextElementSibling;
        const v = textOf(next);
        if (v) return v;
        cur = cur?.parentElement;
        if (!cur) break;
      }

      return "";
    };

    const nameCandidates = [
      textOf(d.querySelector("h1")),
      textOf(d.querySelector('[data-testid="title"]')),
      textOf(d.querySelector(".Fc1rA")),
    ].filter(Boolean);

    const categoryCandidates = [
      textOf(d.querySelector("h1 + div")),
      textOf(d.querySelector("h1 + span")),
      pickNearLabelIncludes("업종"),
      pickNearLabelIncludes("카테고리"),
    ].filter(Boolean);

    // 주소 후보 우선순위: dt/dd pairs -> includes 기반 -> class
    const addrCandidates = [
      pairs.address,
      pickNearLabelIncludes("도로명주소"),
      pickNearLabelIncludes("주소"),
      pickNearLabelIncludes("위치"),
      textOf(d.querySelector('[class*="address"]')),
    ].filter(Boolean);

    const roadCandidate = pairs.roadAddress || pickNearLabelIncludes("도로명주소") || "";

    const dirCandidates = [
      pickNearLabelIncludes("오시는길"),
      pickNearLabelIncludes("찾아오는길"),
      pickNearLabelIncludes("길안내"),
      pairs.parking,
      pickNearLabelIncludes("주차"),
    ].filter(Boolean);

    const descCandidates = [
      pickNearLabelIncludes("소개"),
      pickNearLabelIncludes("상세설명"),
      pickNearLabelIncludes("매장소개"),
    ].filter(Boolean);

    return {
      nameCandidates,
      categoryCandidates,
      addrCandidates,
      dirCandidates,
      descCandidates,
      roadCandidate,
      pairs,
      ogDesc,
      metaDesc,
      nextJsonText,
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
    road: (raw?.roadCandidate || "").slice(0, 60),
    pairAddr: (raw?.pairs?.address || "").slice(0, 60),
    pairRoad: (raw?.pairs?.roadAddress || "").slice(0, 60),
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
  x = x.replace(/방문자리뷰.*$/g, "").trim();
  if (x.length > 40) x = x.slice(0, 40).trim();
  return x;
}

function cleanAddress(s: string) {
  let x = (s || "").trim();
  if (!x) return "";

  x = x.replace(/지도내비게이션거리뷰/g, " ").replace(/\s+/g, " ").trim();
  x = x.replace(/복사/g, "").trim();
  x = x.replace(/(\d)([가-힣])/g, "$1 $2");

  // "서대문역 4번 출구에서 90m" 같은 안내문 제거
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

function mergeDirections(body: string, dom: string) {
  const b = (body || "").trim();
  const d = (dom || "").trim();
  if (b && d) {
    // 같은 내용이면 하나만
    if (b.includes(d) || d.includes(b)) return (b.length >= d.length ? b : d).trim();
    // "출구/도보"가 있는 쪽을 앞으로
    const score = (s: string) => (/(출구|도보|분|미터|m)/.test(s) ? 2 : 0) + (/(주차)/.test(s) ? 1 : 0);
    const first = score(b) >= score(d) ? b : d;
    const second = first === b ? d : b;
    return `${first} / ${second}`.trim();
  }
  return (b || d || "").trim();
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

// ✅ bodyText에서 한국 주소 정규식 추출(서울특별시/서울시/서울 모두 허용)
function extractKoreanAddressFromText(bodyText: string) {
  const t = (bodyText || "").replace(/\s+/g, " ").trim();
  if (!t) return "";

  // 예: 서울(특별시|시) 종로구 새문안로 15-1 2층
  const re =
    /((서울특별시|서울시|서울|부산광역시|부산시|부산|대구광역시|대구시|대구|인천광역시|인천시|인천|광주광역시|광주시|광주|대전광역시|대전시|대전|울산광역시|울산시|울산|세종특별자치시|세종|경기도|경기|강원특별자치도|강원도|강원|충청북도|충북|충청남도|충남|전북특별자치도|전라북도|전북|전라남도|전남|경상북도|경북|경상남도|경남|제주특별자치도|제주도|제주)\s*[가-힣0-9\s]+?(구|군|시)\s*[가-힣0-9\s]+?(로|길)\s*\d{1,4}(-\d{1,4})?(\s*(층|호|번지)\s*[0-9가-힣\-]*)?)/;

  const m = t.match(re);
  return m?.[0] ? m[0].trim() : "";
}

// ✅ bodyText에서 오시는길 문장 추출(출구/도보/주차 키워드)
function extractDirectionsFromText(bodyText: string) {
  const t = (bodyText || "").replace(/\s+/g, " ").trim();
  if (!t) return "";

  // 출구/도보 우선
  const keys = ["번 출구", "출구", "도보", "분", "m", "미터"];
  for (const k of keys) {
    const idx = t.indexOf(k);
    if (idx > -1) {
      const slice = t.slice(Math.max(0, idx - 40), idx + 140);
      if (slice.length >= 12) return slice.trim();
    }
  }

  // 없으면 주차라도
  const pIdx = t.indexOf("주차");
  if (pIdx > -1) {
    const slice = t.slice(Math.max(0, pIdx - 30), pIdx + 160);
    if (slice.length >= 12) return slice.trim();
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
