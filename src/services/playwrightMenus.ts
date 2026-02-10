// src/services/playwrightMenus.ts
import { chromium } from "playwright";

export type Menu = { name: string; price?: number; durationMin?: number; note?: string };

function asString(v: any): string | null {
  if (typeof v === "string") {
    const s = v.trim();
    return s ? s : null;
  }
  return null;
}

function parsePriceToNumber(text: string): number | null {
  // 12,000원 / 12000 / 12 000 / ₩12,000 등을 숫자로 변환
  const cleaned = text.replace(/[^\d]/g, "");
  if (!cleaned) return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return null;
  return n;
}

function looksHairService(name: string) {
  return /(커트|컷|펌|염색|클리닉|두피|뿌리|매직|볼륨|드라이|셋팅|탈색|톤다운|컬러|다운펌|열펌|디자인펌|헤드스파)/i.test(
    name
  );
}

function dedup(menus: Menu[]) {
  const seen = new Set<string>();
  const out: Menu[] = [];
  for (const m of menus) {
    const key = `${m.name}:${m.price ?? "na"}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(m);
  }
  return out.slice(0, 30);
}

function cleanMenus(menus: Menu[]): Menu[] {
  const out: Menu[] = [];
  const seen = new Set<string>();

  for (const it of menus || []) {
    const name = (it?.name || "").trim();
    const price = typeof it?.price === "number" ? it.price : undefined;

    if (!name) continue;
    if (!/[가-힣A-Za-z]/.test(name)) continue;

    // 너무 짧거나 이상한 문구 컷
    if (name.length < 2) continue;

    // 가격이 있으면 현실 범위로 컷(오탐 방지)
    if (typeof price === "number") {
      if (price < 5000) continue;
      if (price > 2000000) continue;
    }

    const key = `${name}:${price ?? "na"}`;
    if (seen.has(key)) continue;
    seen.add(key);

    out.push({
      name,
      ...(typeof price === "number" ? { price } : {}),
      ...(typeof it.durationMin === "number" ? { durationMin: it.durationMin } : {}),
      ...(it.note ? { note: it.note } : {})
    });
  }

  // 헤어 키워드 있는 항목 우선
  const hair = out.filter((m) => looksHairService(m.name));
  return dedup(hair.length ? hair : out);
}

// ✅ 가격탭에서 강제 스크롤/탭 클릭으로 DOM을 최대한 렌더링
async function triggerPriceDomRender(page: any) {
  // 기본 대기 (초기 렌더)
  await page.waitForTimeout(700);

  // 모달/팝업 닫기(있으면)
  const closeSelectors = [
    'button[aria-label*="닫기"]',
    'button:has-text("닫기")',
    'button:has-text("확인")',
    'button:has-text("동의")',
    '[role="button"]:has-text("닫기")'
  ];
  for (const sel of closeSelectors) {
    try {
      await page.locator(sel).first().click({ timeout: 500 }).catch(() => {});
    } catch {}
  }

  // "가격표" 관련 텍스트가 있으면 눌러보기(없으면 스킵)
  const clickWords = ["가격표", "가격", "시술", "커트", "펌", "염색", "클리닉", "두피", "드라이", "매직", "탈색", "컬러"];
  for (const w of clickWords) {
    try {
      const loc = page.getByText(new RegExp(w)).first();
      const cnt = await loc.count().catch(() => 0);
      if (cnt > 0) {
        await loc.click({ timeout: 600 }).catch(() => {});
        await page.waitForTimeout(250);
      }
    } catch {}
  }

  // 스크롤 여러 번(렌더/지연 로딩 유도)
  try {
    for (let i = 0; i < 6; i++) {
      await page.mouse.wheel(0, 1800);
      await page.waitForTimeout(350);
    }
  } catch {}

  // 내부 스크롤 컨테이너도 내려보기 (DOM 타입 참조 없이 globalThis + any)
  try {
    await page.evaluate(() => {
      const doc: any = (globalThis as any).document;
      const win: any = (globalThis as any).window;
      if (!doc || !win) return;

      const all = Array.from(doc.querySelectorAll("*")) as any[];

      const scrollables = all.filter((el: any) => {
        const style = win.getComputedStyle?.(el);
        const oy = style?.overflowY;
        return (oy === "auto" || oy === "scroll") && el.scrollHeight > el.clientHeight + 200;
      });

      scrollables.slice(0, 2).forEach((el: any) => {
        el.scrollTop = el.scrollHeight;
      });
    });
    await page.waitForTimeout(400);
  } catch {}

  // 마지막 대기(지연 렌더)
  await page.waitForTimeout(600);
}

// ✅ DOM에서 "메뉴명 + 가격"을 최대한 빠르게 뽑는 전용 추출기
async function extractMenusFromDom(page: any): Promise<Menu[]> {
  const rows = await page.evaluate(() => {
    const doc: any = (globalThis as any).document;
    const win: any = (globalThis as any).window;
    if (!doc || !win) return [];

    const textOf = (el: any) => (el?.innerText || el?.textContent || "").trim();

    const priceRegex = /(?:₩\s*)?\d{1,3}(?:[,\s]\d{3})+\s*원?|\d+\s*원/g;

    // 가격이 포함된 "텍스트 덩어리" 찾기
    const nodes = Array.from(doc.querySelectorAll("body *")) as any[];
    const hits: any[] = [];

    for (const el of nodes) {
      const t = textOf(el);
      if (!t) continue;
      if (t.length > 120) continue; // 너무 긴 블록은 오탐 많음
      if (!priceRegex.test(t)) continue;

      // 가격표가 보통 버튼/링크에도 섞이니 아주 짧은 것만 제외
      if (t.length < 3) continue;

      hits.push({ t, el });
    }

    const out: { name: string; priceText: string }[] = [];

    const pickNameFromContainer = (el: any) => {
      // 같은 컨테이너 안에서 "가격이 아닌 텍스트"를 이름 후보로 잡음
      const container = el?.closest?.("li, article, section, div") || el?.parentElement;
      const base = container || el;
      const cand = textOf(base);

      // 한 덩어리에서 가격을 제거한 나머지를 이름으로 쓰기
      const name = cand.replace(priceRegex, "").replace(/\s+/g, " ").trim();

      // 너무 길면 줄 단위 첫 문장으로 줄이기
      if (name.length > 40) return name.split("\n")[0].slice(0, 40).trim();
      return name;
    };

    for (const h of hits.slice(0, 200)) {
      const t = h.t as string;

      // 가장 먼저 매칭되는 가격 텍스트 1개만
      const m = t.match(priceRegex);
      const priceText = (m && m[0]) ? m[0].trim() : "";
      if (!priceText) continue;

      const name = pickNameFromContainer(h.el);
      if (!name) continue;

      // 너무 일반적인 UI/라벨 제외
      if (/^(문의|예약|공유|지도|길찾기|전화|영업시간|소식)$/i.test(name)) continue;

      out.push({ name, priceText });
    }

    return out;
  });

  const menus: Menu[] = [];
  for (const r of rows as any[]) {
    const name = asString(r?.name) ?? null;
    if (!name) continue;

    const priceNum = typeof r?.priceText === "string" ? parsePriceToNumber(r.priceText) : null;

    // 헤어 서비스 키워드도 없고 가격도 없으면 제외
    if (!looksHairService(name) && typeof priceNum !== "number") continue;

    menus.push({
      name,
      ...(typeof priceNum === "number" ? { price: priceNum } : {})
    });
  }

  return cleanMenus(menus);
}

export async function fetchMenusViaPlaywright(targetUrl: string) {
  const debug = {
    used: true,
    targetUrl,
    strategy: "price-dom-fast",
    elapsedMs: 0,
    menusFound: 0
  };

  const started = Date.now();

  const browser = await chromium.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-blink-features=AutomationControlled"
    ]
  });

  try {
    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
      locale: "ko-KR",
      viewport: { width: 390, height: 844 }
    });

    // webdriver 감추기(가볍게)
    await context.addInitScript(() => {
      try {
        Object.defineProperty((globalThis as any).navigator, "webdriver", { get: () => false });
      } catch {}
    });

    const page = await context.newPage();

    // ✅ 빠르게 실패하도록 타임아웃을 줄임
    page.setDefaultTimeout(8000);

    await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 15000 });

    // ✅ 강제 렌더 유도
    await triggerPriceDomRender(page);

    // ✅ DOM 기반 메뉴 추출
    const menus = await extractMenusFromDom(page);

    debug.menusFound = menus.length;
    debug.elapsedMs = Date.now() - started;

    return { menus, debug };
  } catch (e: any) {
    debug.elapsedMs = Date.now() - started;
    return { menus: [] as Menu[], debug: { ...debug, error: e?.message ?? "pw failed" } };
  } finally {
    await browser.close().catch(() => {});
  }
}
