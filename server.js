import express from "express";
import { chromium } from "playwright";

const app = express();
app.use(express.json({ limit: "1mb" }));

function normalizeNaverPlaceUrl(input) {
  let url = (input || "").trim();
  if (!url) return "";

  // http 없으면 붙여주기
  if (!/^https?:\/\//i.test(url)) url = "https://" + url;

  let u;
  try {
    u = new URL(url);
  } catch {
    return "";
  }

  // naver.me 같은 단축링크도 들어올 수 있음 -> 그대로 goto해서 최종 URL을 받아 처리
  // place.naver.com 이면 m.place.naver.com 으로 바꾸기 (더 안정적)
  if (u.hostname === "place.naver.com") {
    u.hostname = "m.place.naver.com";
    return u.toString();
  }

  // 이미 m.place.naver.com 이면 그대로
  return u.toString();
}

function looksBlocked(text) {
  const t = (text || "").toLowerCase();
  // 너무 공격적으로 우회/해킹 말고, “접근 제한/비정상 페이지” 감지만 하자
  return (
    t.includes("접근이 제한") ||
    t.includes("비정상적인 접근") ||
    t.includes("captcha") ||
    t.includes("robot") ||
    t.includes("권한이 없습니다")
  );
}

app.get("/", (req, res) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.end(`
  <!doctype html>
  <html lang="ko">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>네이버 플레이스 분석기 MVP</title>
    <style>
      body{font-family:system-ui,Apple SD Gothic Neo,Malgun Gothic,sans-serif;max-width:820px;margin:40px auto;padding:16px;}
      input{width:100%;padding:12px;border:1px solid #ddd;border-radius:10px;font-size:16px;}
      button{padding:12px 16px;border:0;border-radius:10px;font-size:16px;cursor:pointer;margin-top:10px;}
      pre{white-space:pre-wrap;background:#f7f7f7;padding:12px;border-radius:12px;}
      .hint{color:#666;font-size:14px}
    </style>
  </head>
  <body>
    <h1>네이버 플레이스 분석기 (MVP)</h1>
    <p class="hint">PC/모바일 URL 둘 다 OK. (place.naver.com / m.place.naver.com)</p>

    <input id="url" placeholder="예) https://place.naver.com/restaurant/123456 / https://m.place.naver.com/..." />
    <button onclick="run()">조회</button>

    <h3>결과</h3>
    <pre id="out">대기중...</pre>

    <script>
      async function run(){
        const url = document.getElementById('url').value.trim();
        const out = document.getElementById('out');
        out.textContent = "불러오는 중...";
        try{
          const r = await fetch('/api/analyze', {
            method:'POST',
            headers:{'Content-Type':'application/json'},
            body: JSON.stringify({ url })
          });
          const data = await r.json();
          out.textContent = JSON.stringify(data, null, 2);
        }catch(e){
          out.textContent = "오류: " + (e?.message || e);
        }
      }
    </script>
  </body>
  </html>
  `);
});

app.post("/api/analyze", async (req, res) => {
  const inputUrl = req.body?.url;

  if (!inputUrl || typeof inputUrl !== "string") {
    return res.status(400).json({ ok: false, error: "url을 넣어주세요" });
  }

  const url = normalizeNaverPlaceUrl(inputUrl);
  if (!url) return res.status(400).json({ ok: false, error: "URL 형식이 올바르지 않아요" });

  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-dev-shm-usage"]
    });

    const page = await browser.newPage();
    page.setDefaultTimeout(30000);

    // 이동 (단축링크/리다이렉트 포함)
    const resp = await page.goto(url, { waitUntil: "domcontentloaded" });
    const finalUrl = page.url();
    const status = resp?.status?.() ?? null;

    // PC URL이 리다이렉트로 PC로 다시 가버리면 다시 모바일로 한번 더 정규화
    const finalNormalized = normalizeNaverPlaceUrl(finalUrl);
    if (finalNormalized && finalNormalized !== finalUrl) {
      await page.goto(finalNormalized, { waitUntil: "domcontentloaded" });
    }

    // 페이지 내용 일부
    const bodyText = await page.locator("body").innerText().catch(() => "");
    const snippet = (bodyText || "").replace(/\s+/g, " ").trim().slice(0, 250);

    // “접근 제한” 감지 (우회하지 않고 안내만)
    if (looksBlocked(bodyText)) {
      return res.status(200).json({
        ok: false,
        blocked: true,
        inputUrl,
        finalUrl: page.url(),
        status,
        message: "자동 수집이 일시적으로 제한된 페이지로 보입니다.",
        snippet
      });
    }

    // --- 여기서부터: 최대한 많이 뽑아보는 구간 ---
    // 1) 메타(title)로 기본 확보
    const title = await page.title().catch(() => "");

    // 2) 대표적인 셀렉터 후보들 (네이버가 바꾸면 일부는 깨질 수 있음)
    // 가게명(상호)
    const nameCandidates = [
      "h1",
      "[class*=place_name]",
      "[class*=Fc1rA]", // 과거에 보이던 클래스들(바뀔 수 있음)
      "[class*=GHAhO]"
    ];

    // 카테고리
    const categoryCandidates = [
      "[class*=place_category]",
      "[class*=DJJvD]",
      "[class*=category]"
    ];

    async function pickFirstText(selectors) {
      for (const sel of selectors) {
        try {
          const el = page.locator(sel).first();
          const t = (await el.innerText({ timeout: 1500 })).trim();
          if (t) return t;
        } catch {}
      }
      return "";
    }

    const name = await pickFirstText(nameCandidates);
    const category = await pickFirstText(categoryCandidates);

    // 별점/리뷰수는 구조가 자주 변해서 “텍스트에서 패턴 검색”도 같이 함
    // (정확도 100%는 아니지만 MVP에서 유용)
    const text = bodyText || "";

    // 별점 패턴: "별점 4.35" 같은 형태가 있으면 잡음
    let rating = "";
    const ratingMatch =
      text.match(/별점\s*([0-9]\.[0-9]{1,2})/) ||
      text.match(/평점\s*([0-9]\.[0-9]{1,2})/);
    if (ratingMatch) rating = ratingMatch[1];

    // 리뷰수(방문자/블로그)
    let visitorReviews = "";
    let blogReviews = "";

    const vMatch = text.match(/방문자\s*리뷰\s*([0-9,]+)/);
    if (vMatch) visitorReviews = vMatch[1].replace(/,/g, "");

    const bMatch = text.match(/블로그\s*리뷰\s*([0-9,]+)/);
    if (bMatch) blogReviews = bMatch[1].replace(/,/g, "");

    // 결과
    return res.json({
      ok: true,
      inputUrl,
      usedUrl: url,
      finalUrl: page.url(),
      status,
      title,
      extracted: {
        name: name || "",
        category: category || "",
        rating: rating || "",
        visitorReviews: visitorReviews || "",
        blogReviews: blogReviews || ""
      },
      snippet
    });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      error: String(e?.message || e)
    });
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log("Server listening on", port));

