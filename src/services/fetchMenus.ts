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
  const catSeed = headings.filter(isLikelyCategory).slice(0, 20);

  // seed 카테고리 생성
  for (const c of catSeed) ensureCategory(c);

  // 컷/펌/염색은 무조건 카테고리로 확보(빈 배열이라도)
  ensureCategory("컷");
  ensureCategory("펌");
  ensureCategory("염색");

  // 블록에서 "메뉴명 + 가격" 추출
  // 예: "디자인컷(회원가) 24,000원"
  for (const block of priceTextBlocks) {
    const m = block.match(/^(.+?)\s*([0-9]{1,3}(?:,[0-9]{3})*|[0-9]+원)\s*$/);
    if (!m) continue;

    const name = m[1];
    const rawPrice = m[2].endsWith("원") ? m[2] : `${m[2]}원`;

    // 이름으로 카테고리 추정
    const guess =
      /(컷|커트)/.test(name) ? "컷"
      : /(펌|매직|셋팅|다운펌|볼륨매직)/.test(name) ? "펌"
      : /(염색|컬러|뿌리염색|탈색)/.test(name) ? "염색"
      : /(클리닉|케어|두피|스파)/.test(name) ? "클리닉"
      : "기타";

    const cat = ensureCategory(guess);
    if (cat) pushItem(cat, name, rawPrice);
  }

  // 2) fallback: DOM 파싱이 실패해 items가 거의 없으면, 정규식으로 전체에서 최소 추출
  const totalItems = categories.reduce((acc, c) => acc + c.items.length, 0);
  if (totalItems < 3) {
    const text = $.text().replace(/\s+/g, " ");
    const re = /([가-힣A-Za-z0-9()·\-\s]{2,40}?)\s*([0-9]{1,3}(?:,[0-9]{3})*|[0-9]+)원/g;
    let match: RegExpExecArray | null;
    let guard = 0;

    while ((match = re.exec(text)) && guard++ < 200) {
      const name = match[1].trim();
      const rawPrice = `${match[2]}원`;

      const guess =
        /(컷|커트)/.test(name) ? "컷"
        : /(펌|매직|셋팅|다운펌|볼륨매직)/.test(name) ? "펌"
        : /(염색|컬러|뿌리염색|탈색)/.test(name) ? "염색"
        : /(클리닉|케어|두피|스파)/.test(name) ? "클리닉"
        : "기타";

      const cat = ensureCategory(guess);
      if (cat) pushItem(cat, name, rawPrice);
    }
  }

  // 빈 카테고리 제거하되, 컷/펌/염색은 남김(필드 존재 확인용)
  const keepCore = new Set(["컷", "펌", "염색"]);
  return categories
    .filter((c) => c.items.length > 0 || keepCore.has(c.category))
    .map((c) => ({
      category: c.category,
      items: c.items,
    }));
}

export async function fetchNaverMenus(placeId: string, userAgent?: string): Promise<MenuCategory[]> {
  const url = `https://m.place.naver.com/hairshop/${placeId}/price`;

  const res = await fetch(url, {
    method: "GET",
    headers: {
      "user-agent":
        userAgent ||
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "accept-language": "ko-KR,ko;q=0.9,en;q=0.8",
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "cache-control": "no-cache",
      pragma: "no-cache",
    },
  });

  if (!res.ok) {
    // 403/429 등
    return [
      { category: "컷", items: [] },
      { category: "펌", items: [] },
      { category: "염색", items: [] },
    ];
  }

  const html = await res.text();
  return parseNaverPriceHtml(html);
}
