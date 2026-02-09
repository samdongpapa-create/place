import express from "express";
import { chromium } from "playwright";

const app = express();
app.use(express.json({ limit: "1mb" }));

// === 간단 캐시 (같은 URL은 일정시간 재크롤링 안 함) ===
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6시간
const cache = new Map(); // key:url -> { ts, data }

// 429 걸리면 전체적으로 잠깐 쉬기 (네이버가 IP 기준으로 막기 때문)
let globalCooldownUntil = 0;
const COOLDOWN_MS_ON_429 = 20 * 60 * 1000; // 20분

function normalizeNaverPlaceUrl(input) {
  let url = (input || "").trim();
  if (!url) return "";

  if (!/^https?:\/\//i.test(url)) url = "https://" + url;

  let u;
  try {
    u = new URL(url);
  } catch {
    return "";
  }

  // PC 플레이스 -> 모바일 플레이스
  if (u.hostname === "place.naver.com") {
    u.hostname = "m.place.naver.com";
    return u.toString();
  }

  // 지도 URL도 그대로 허용 (열면 리다이렉트됨)
  // map.naver.com, naver.me 등은 그냥 goto 해서 최종 URL을 가져오면 됨
  return u.toString();
}

function looksBlocked(text) {
  const t = (text || "").toLowerCase();
  return (
    t.includes("서비스 이용이 제한") ||
    t.includes("과도한 접근") ||
    t.includes("접근이 제한") ||
    t.includes("비정상적인 접근") ||
    t.includes("captcha") ||
    t.includes("robot") ||
    t.includes("권한이 없습니다")
  );
}

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
      .hint{color:#666;font-size:14px}
    </style>
  </head>
  <body>
    <h1>네이버 플레이스 분석기 (MVP)</h1>
    <p class="hint">지원: map.naver.com / place.naver.com / m.place.naver.com</p>

    <input id="url" placeholder="예) https://map.naver.com/p/entry/place/1443688242" />
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

// ✅ 이게 네가 말한 “/api/analyze” (분석 API)
app.post("/api/analyze", async (req, res) => {
  const inputUrl = req.body?.url;

  if (!inputUrl || typeof inputUrl !== "string") {
    return res.status(400).json({ ok: false, error: "url을 넣어주세요" });
  }

  const url = normalizeNaverPlaceUrl(inputUrl);
  if (!url) return res.status(400).json({ ok: false, error: "URL 형식이 올바르지 않아요" });

  // 전역 쿨다운 체크
  if (Date.now() < globalCooldownUntil) {
    const waitSec = Math.ceil((globalCooldownUntil - Date.now()) / 1000);
    return res.status(200).json({
      ok: false,
      blocked: true,
      reason: "cooldown",
      message: `네이버가 요청 과다로 제한 중이라 잠시 쉬는 중입니다. 약 ${waitSec}초 후 다시 시도해주세요.`
    });
  }

  // 캐시 체크
  const cached = cache.get(url);
  if (cached && (Date.now() - cached.ts) < CACHE_TTL_MS) {
    return res.status(200).json({
      ...cached.data,
      cached: true,
      cachedAt: new Date(cached.ts).toISOString()
    });
  }

  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-dev-shm-usage"]
    });

    const page = await browser.newPage();
    page.setDefaultTimeout(30000);

    // URL 이동 (지도/단축링크도 리다이렉트로 최종 URL로 바뀜)
    const resp = await page.goto(url, { waitUntil: "domcontentloaded" });
    const status = resp?.status?.() ?? null;

    // 최종 URL이 PC 플레이스면 모바일로 한번 더 이동
    const finalUrl1 = page.url();
    const finalNormalized = normalizeNaverPlaceUrl(finalUrl1);
    if (finalNormalized && finalNormalized !== finalUrl1) {
      await page.goto(finalNormalized, { waitUntil: "domcontentloaded" });
    }

    const finalUrl = page.url();

    const bodyText = await page.locator("body").innerText().catch(() => "");
    const snippet = (bodyText || "").replace(/\s+/g, " ").trim().slice(0, 250);

    // 429 처리
    if (status === 429 || looksBlocked(bodyText)) {
      globalCooldownUntil = Date.now() + COOLDOWN_MS_ON_429;
      return res.status(200).json({
        ok: false,
        blocked: true,
        reason: status === 429 ? "rate_limited" : "blocked_page",
        inputUrl,
        usedUrl: url,
        finalUrl,
        status,
        message: "요청 과다/접근 제한으로 자동 수집이 일시 제한되었습니다. 잠시 후 다시 시도해주세요.",
        snippet
      });
    }

    // MVP: 최소 정보
    const title = await page.title().catch(() => "");

    const successData = {
      ok: true,
      inputUrl,
      usedUrl: url,
      finalUrl,
      status,
      title,
      snippet
    };

    // 캐시 저장
    cache.set(url, { ts: Date.now(), data: successData });

    return res.json(successData);
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log("Server listening on", port));
