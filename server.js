import express from "express";
import { chromium } from "playwright";

const app = express();
app.use(express.json({ limit: "1mb" }));

// 메인 화면(입력창)
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
    </style>
  </head>
  <body>
    <h1>네이버 플레이스 분석기 (MVP)</h1>
    <p>플레이스 URL을 넣고 “조회”를 누르세요.</p>

    <input id="url" placeholder="예) https://m.place.naver.com/..." />
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

// 분석 API (Playwright로 페이지 열기)
app.post("/api/analyze", async (req, res) => {
  const { url } = req.body || {};
  if (!url || typeof url !== "string") {
    return res.status(400).json({ ok: false, error: "url을 넣어주세요" });
  }
  if (!url.startsWith("http")) {
    return res.status(400).json({ ok: false, error: "http로 시작하는 URL을 넣어주세요" });
  }

  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-dev-shm-usage"]
    });

    const page = await browser.newPage();
    page.setDefaultTimeout(30000);

    await page.goto(url, { waitUntil: "domcontentloaded" });

    const title = await page.title();
    const bodyText = await page.locator("body").innerText();
    const snippet = bodyText.replace(/\s+/g, " ").trim().slice(0, 200);

    return res.json({ ok: true, inputUrl: url, title, snippet });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log("Server listening on", port));
