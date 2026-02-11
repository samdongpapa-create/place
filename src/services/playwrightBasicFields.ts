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
  const timeoutMs = opts.timeoutMs ?? 20000;

  const debug: any = {
    used: true,
    targetUrl: stripQuery(homeUrl),
    steps: [],
    picked: {},
    actions: [],
  };

  const fields: BasicFields = {};
  const step = (s: any) => debug.steps.push({ at: Date.now() - t0, ...s });

  // 1) HOME 진입
  await page.goto(homeUrl, { waitUntil: "domcontentloaded", timeout: timeoutMs });
  step({ step: "goto.home" });

  // 렌더 안정화
  await page.waitForTimeout(900);
  step({ step: "wait.900" });

  // =========================================================
  // ✅ 카테고리 7 핵심: 스크롤/더보기 클릭으로 숨은 텍스트 로딩
  // =========================================================
  await warmUpForHiddenSections(page, debug);
  step({ step: "warmup.done" });

  // 2) 수집(1차)
  let raw = await collect(page);
  step({ step: "collect.1", snapshot: summarizeRaw(raw) });

  // 3) 소개/오시는길이 비어있으면 더 강하게 클릭/스크롤 후 재수집
  const needMore =
    !pickFirstMeaningful(raw.descCandidates) ||
    !pickFirstMeaningful(raw.dirCandidates);

  if (needMore) {
    await warmUpForHiddenSections(page, debug, true);
    step({ step: "warmup.strong.done" });

    raw = await collect(page);
    step({ step: "collect.2", snapshot: summarizeRaw(raw) });
  }

  // 4) 필드 정리
  fields.name = pickFirstMeaningful(raw.nameCandidates);
  fields.category = cleanCategory(pickFirstMeaningful(raw.categoryCandidates));

  const addr = pickFirstMeaningful(raw.addrCandidates) || "";
  fields.address = cleanAddress(addr);

  const dir = pickFirstMeaningful(raw.dirCandidates) || "";
  fields.directions = cleanDirections(dir);

  // 소개/상세설명 우선순위: DOM 후보 -> NEXT_DATA -> meta -> body
  const fromDom = cleanDescription(pickFirstMeaningful(raw.descCandidates) || "");
  const fromNext = extractIntroFromNextData(raw.nextJsonText);
  const fromMeta = cleanDescription(raw.ogDesc || raw.metaDesc || "");
  const fromBody = extractIntroFromBodyText(raw.bodyText);

  const desc = pickFirstMeaningful([fromDom, fromNext, fromMeta, fromBody].filter(Boolean));
  fields.description = cleanDescription(desc || "");

  // “리뷰 스니펫”이면 상세설명 아님 처리
  if (looksLikeReviewSnippet(fields.description || "")) fields.description = "";

  debug.picked = {
    name: !!fields.name,
    category: !!fields.category,
    address: !!fields.address,
    directions: !!fields.directions,
    description: !!fields.description,
    descriptionSource: fromDom ? "dom" : fromNext ? "nextData" : fromMeta ? "meta" : fromBody ? "body" : "none",
  };

  debug.elapsedMs = Date.now() - t0;
  debug.raw = {
    ogDesc: raw.ogDesc,
    metaDesc: raw.metaDesc,
    hasNextData: !!raw.nextJsonText,
  };

  return { fields, debug };
}

/* =========================================================
 * ✅ 액션: 스크롤 + 더보기 클릭
 * ========================================================= */

async function warmUpForHiddenSections(page: Page, debug: any, strong = false) {
  const t = Date.now();
  const act = (a: any) => debug.actions.push({ at: Date.now() - t, ...a });

  // 모바일 페이지는 스크롤하면서 섹션이 늦게 로딩되는 경우가 많음
  await scrollPage(page, strong ? 6 : 4, act);

  // "더보기"가 섞여있으면 일단 여러 번 눌러서 텍스트를 펼침
  await clickMoreButtons(page, act, strong ? 6 : 3);

  // 탭/섹션 전환이 필요한 케이스 대비: "정보" 또는 "홈" 내부 정보 더보기 시도
  // (없으면 조용히 스킵)
  await tryClickByText(page, ["정보", "매장정보", "가게정보"], act);

  // 다시 한 번 스크롤/더보기
  await scrollPage(page, strong ? 4 : 2, act);
  await clickMoreButtons(page, act, strong ? 6 : 2);

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
  let clicked = 0;

  for (let i = 0; i < maxClicks; i++) {
    try {
      // Playwright text 엔진은 locator에서 사용 가능 (evaluate의 querySelector와 다름)
      const btn = page.getByRole("button", { name: /더보기|펼쳐보기|자세히보기/i }).first();
      const count = await btn.count();
      if (!count) break;

      await btn.click({ timeout: 1500 });
      await page.waitForTimeout(450);

      clicked++;
      act({ step: "click.more", clicked });
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
 * ✅ 수집 로직 (evaluate는 “순수 querySelector 기반”만 사용)
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

    // body snapshot
    let bodyText = "";
    try {
      bodyText = (d?.body?.innerText ?? "").slice(0, 12000);
    } catch {}

    // label 근처 값 뽑기(소개/오시는길/주소 등)
    const pickNearLabel = (label: string) => {
      const all = Array.from(d.querySelectorAll("dt, span, div, strong, em, h1, h2, h3, p"));
      const hit = all.find((el: any) => textOf(el) === label);
      if (!hit) return "";

      // dt -> dd 패턴
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
        if (idx >= 0 && children[idx + 1]) {
          const v = textOf(children[idx + 1]);
          if (v) return v;
        }
      }

      // 다음 요소 몇 개 탐색
      let cur: any = hit;
      for (let i = 0; i < 10; i++) {
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
      text(".Fc1rA")
    ].filter(Boolean);

    // 카테고리는 제목 근처 span/div에서 후보 뽑기
    const categoryCandidates = [
      text("h1 + div"),
      text("h1 + span"),
      text('[class*="category"]')
    ].filter(Boolean);

    const addrCandidates = [
      pickNearLabel("주소"),
      pickNearLabel("위치"),
      pickNearLabel("도로명주소"),
      text('[class*="address"]')
    ].filter(Boolean);

    const dirCandidates = [
      pickNearLabel("오시는길"),
      pickNearLabel("찾아오는길"),
      pickNearLabel("길안내")
    ].filter(Boolean);

    const descCandidates = [
      pickNearLabel("소개"),
      pickNearLabel("상세설명"),
      pickNearLabel("매장소개")
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
      bodyText
    };
  });
}

function summarizeRaw(raw: any) {
  const pick = (arr: any[]) => (Array.isArray(arr) && arr.length ? String(arr[0]).slice(0, 40) : "");
  return {
    name: pick(raw?.nameCandidates),
    category: pick(raw?.categoryCandidates),
    addr: pick(raw?.addrCandidates),
    dir: pick(raw?.dirCandidates),
    desc: pick(raw?.descCandidates),
    hasNext: !!raw?.nextJsonText,
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
  // 너무 길면 잘라내기(가끔 부가 텍스트까지 붙음)
  x = x.replace(/\s+/g, " ").trim();
  if (x.length > 40) x = x.slice(0, 40).trim();
  // 카테고리에 리뷰/별점 섞이면 제거
  x = x.replace(/방문자리뷰.*$/g, "").trim();
  return x;
}

function cleanAddress(s: string) {
  let x = (s || "").trim();
  if (!x) return "";

  x = x.replace(/지도내비게이션거리뷰/g, " ").replace(/\s+/g, " ").trim();

  // "2층 5서대문역" 처럼 붙는 경우 → 숫자/한글 경계 띄우기
  x = x.replace(/(\d)([가-힣])/g, "$1 $2");

  // "서대문역 4번 출구에서 90m미터" 같은 안내 문구 제거
  x = x.replace(/서대문역.*?(m|미터).*$/i, "").trim();
  x = x.replace(/(\d+)\s*m\s*.*$/i, "").trim();

  return x;
}

function cleanDirections(s: string) {
  let x = (s || "").trim();
  if (!x) return "";
  x = x.replace(/^찾아가는길\s*/g, "").trim();
  x = x.replace(/\s*\.\.\.\s*내용 더보기\s*$/g, "").trim();
  x = x.replace(/\s+/g, " ").trim();
  // 너무 짧으면 사실상 없음 처리
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

  // “소개” 주변 스니펫 (최후의 수단)
  const idx = t.indexOf("소개");
  if (idx === -1) return "";

  const slice = t.slice(idx, idx + 400);
  if (slice.includes("리뷰") && slice.includes("사진") && slice.length < 80) return "";

  return slice;
}
