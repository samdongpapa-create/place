// src/services/playwrightBasicFields.ts
import type { Page } from "playwright";

export type BasicFields = {
  name?: string;
  category?: string;
  address?: string;
  roadAddress?: string;
  directions?: string;
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
    picked: {}
  };

  const fields: BasicFields = {};
  const step = (s: any) => debug.steps.push({ at: Date.now() - t0, ...s });

  await page.goto(homeUrl, { waitUntil: "domcontentloaded", timeout: timeoutMs });
  step({ step: "goto.home" });

  await page.waitForTimeout(800);
  step({ step: "wait.800" });

  const raw = await page.evaluate(() => {
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

    const ogDesc = attr('meta[property="og:description"]', "content") || "";
    const metaDesc = attr('meta[name="description"]', "content") || "";

    let nextJsonText = "";
    try {
      nextJsonText = text("#__NEXT_DATA__");
    } catch {}

    let bodyText = "";
    try {
      bodyText = (d?.body?.innerText ?? "").slice(0, 9000);
    } catch {}

    const pickNearLabel = (label: string) => {
      const all = Array.from(d.querySelectorAll("dt, span, div, strong, em, h1, h2, h3"));
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
      for (let i = 0; i < 6; i++) {
        const next = cur?.nextElementSibling;
        const v = textOf(next);
        if (v) return v;
        cur = cur?.parentElement;
        if (!cur) break;
      }

      return "";
    };

    const nameCandidates = [text("h1"), text('[data-testid="title"]'), text(".Fc1rA")].filter(Boolean);

    const categoryCandidates = [
      text("h1 + div"),
      text("h1 + span"),
      text('[class*="category"]'),
      text(".place_bluelink + span")
    ].filter(Boolean);

    const addrCandidates = [pickNearLabel("주소"), pickNearLabel("위치"), text('[class*="address"]')].filter(Boolean);

    const dirCandidates = [pickNearLabel("오시는길"), pickNearLabel("찾아오는길"), pickNearLabel("길안내")].filter(Boolean);

    const descCandidates = [pickNearLabel("소개"), pickNearLabel("상세설명")].filter(Boolean);

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

  step({ step: "evaluate.collected" });

  fields.name = pickFirstMeaningful(raw.nameCandidates);
  fields.category = pickFirstMeaningful(raw.categoryCandidates);
  fields.address = cleanAddress(pickFirstMeaningful(raw.addrCandidates) || "");
  fields.directions = cleanDirections(pickFirstMeaningful(raw.dirCandidates) || "");

  const fromDom = cleanDescription(pickFirstMeaningful(raw.descCandidates) || "");
  const fromNext = extractIntroFromNextData(raw.nextJsonText);
  const fromMeta = cleanDescription(raw.ogDesc || raw.metaDesc || "");
  const fromBody = extractIntroFromBodyText(raw.bodyText);

  const desc = pickFirstMeaningful([fromDom, fromNext, fromMeta, fromBody].filter(Boolean));
  fields.description = cleanDescription(desc || "");

  if (looksLikeReviewSnippet(fields.description || "")) fields.description = "";

  debug.picked = {
    name: !!fields.name,
    category: !!fields.category,
    address: !!fields.address,
    directions: !!fields.directions,
    description: !!fields.description,
    descriptionSource: fromDom ? "dom" : fromNext ? "nextData" : fromMeta ? "meta" : fromBody ? "body" : "none"
  };

  debug.elapsedMs = Date.now() - t0;
  debug.raw = { ogDesc: raw.ogDesc, metaDesc: raw.metaDesc, hasNextData: !!raw.nextJsonText };

  return { fields, debug };
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

function cleanAddress(s: string) {
  let x = (s || "").trim();
  if (!x) return "";
  x = x.replace(/지도내비게이션거리뷰/g, " ").replace(/\s+/g, " ").trim();
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
      const m = s.match(new RegExp(`"${key}"\\s*:\\s*"([^"]{10,600})"`));
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

  const slice = t.slice(idx, idx + 280);
  if (slice.includes("리뷰") && slice.includes("사진") && slice.length < 60) return "";

  return slice;
}
