// src/services/fetchMenus.ts
import * as cheerio from "cheerio";

export type MenuItem = {
  name: string;
  price?: number; // 원 단위 숫자
  rawPrice?: string; // "24,000원" 같은 원문
};

export type MenuCategory = {
  category: string; // "컷", "펌", "염색" 등
  items: MenuItem[];
};

function toPriceNumber(raw: string): number | undefined {
  const m = raw.replace(/\s/g, "").match(/([0-9]{1,3}(?:,[0-9]{3})*|[0-9]+)원/);
  if (!m) return undefined;
  const n = Number(m[1].replace(/,/g, ""));
  return Number.isFinite(n) ? n : undefined;
}

/**
 * 네이버 모바일 플레이스 price 페이지는 HTML에 메뉴/가격 텍스트가 꽂혀있는 경우가 많아서
 * 우선 HTML 파싱으로 시도하고, 실패 시 정규식 fallback으로 최소 1차 메뉴라도 만든다.
 */
export function parseNaverPriceHtml(html: string): MenuCategory[] {
  const $ = cheerio.load(html);

  const categories: MenuCategory[] = [];
  let current: MenuCategory | null = null;

  const pushItem = (cat: MenuCategory, name: string, rawPrice?: string) => {
    const trimmedName = (name || "").replace(/\s+/g, " ").trim();
    if (!trimmedName) return;

    // 중복 방지(같은 이름 반복되는 케이스)
    if (cat.items.some((x) => x.name === trimmedName)) return;

    const item: MenuItem = {
      name: trimmedName,
    };
    if (rawPrice) {
      item.rawPrice = rawPrice.trim();
      item.price = toPriceNumber(rawPrice);
    }
    cat.items.push(item);
  };

  const ensureCategory = (title: string) => {
    const t = (title || "").replace(/\s+/g, " ").trim();
    if (!t) return null;
    const found = categories.find((c) => c.category === t);
    if (found) return found;
    const created: MenuCategory = { category: t, items: [] };
    categories.push(created);
    return created;
  };

  // 1) DOM 기반: "기본가격" 섹션은 보통 카테고리 헤더 + 아이템(메뉴명/가격) 형태
  // 카테고리 후보: h3/h4/strong
  const headings = $("h3, h4, strong")
    .toArray()
    .map((el) => $(el).text().trim())
    .filter(Boolean);

  // 카테고리 키워드가 섞인 헤더를 만나면 current를 바꿈
  const isLikelyCategory = (t: string) => {
    return /(컷|커트|펌|매직|셋팅|염색|컬러|클리닉|두피|드라이|스타일링|케어)/.test(t);
  };

  // 아이템 후보: 가격(원) 포함된 텍스트 블록들
  // 너무 넓게 잡으면 잡음이 많아서, "원" 포함하면서 길이 적당한 것만 추림
  const priceTextBlocks = $("*")
    .toArray()
    .map((el) => $(el).text().replace(/\s+/g, " ").trim())
    .filter((t) => /원/.test(t) && t.length <= 60);

  // 먼저, 문서 상단에서 카테고리 순서가 잡히면 그 순서로 매칭 시도
  // (실제 DOM 트리 순서를 완벽히 따라가긴 어려워서, 안전하게 “카테고리 3종”만이라도 만들도록)
  const catSeed
