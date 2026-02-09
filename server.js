import express from "express";
import { chromium } from "playwright";

const app = express();
app.use(express.json({ limit: "1mb" }));

// === 캐시 (같은 placeId는 일정 시간 재크롤링 안 함) ===
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6시간
const cache = new Map(); // key:placeId -> { ts, data }

// 429(요청 과다) 걸리면 전체적으로 잠깐 쉬기
let globalCooldownUntil = 0;
const COOLDOWN_MS_ON_429 = 20 * 60 * 1000; // 20분

function extractPlaceId(input) {
  const s = (input || "").trim();
  if (!s) return "";

  // 사용자가 URL을 넣더라도 숫자만 뽑아냄
  const m = s.match(/(\d{8,})/); // 8자리 이상 숫자를 placeId로 간주
  return m ? m[1] : "";
}

function placeUrl(placeId) {
  return `https://m.place.naver.com/place/${placeId}`;
}

function looksBlocked(text) {
  const t = (text || "").toLowerCase();
  return (
    t.includes("서비스 이용이 제한") ||
    t.includes("과도한 접근") ||
    t.includes("접근이 제한") ||
    t.includes("비정상적인 접근") ||
    t.includes("captcha") ||
    t.includes("robot")
  );
}

// ===== 메인 화면 =====
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
      .hint{color:#666;font-size:14px;line-height:1.5}
      .box{background:#fafafa;border:1px solid #eee;border-radius:12px;padding:12px;margin-top:12px}
      code{background:#f1f1f1;padding:2px 6px;border-radius:6px}
    </style>
  </head>
  <body>
    <h1>네이버 플레이스 분석기 (MVP)</h1>
    <p class="hint">
      ✅ <b>placeId 숫자만</b> 입력하면 됩니다. (예: <code>1443688242</code>)<br/>
      ✅ URL을 넣어도 숫자만 자동으로 뽑아서 처리해요.
    </p>

    <input id="pid" placeholder="placeId 또는 URL (예: 1443688242)" />
    <button onclick="run()">조회</button>

    <div class="box">
      <b>placeId는 어디서 복사해요?</b>
      <div class="hint">
        1) 네이버지도: <code>https://map.naver.com/p/entry/place/1443688242</code> → 맨 뒤 숫자 복사<br/>
        2) 모바일플레이스: <code>https://m.place.naver.com/place/1443688242</code> → 맨 뒤 숫자 복사<br/>
        3) PC플레이스: URL 안에 보이는 숫자(있으면) 복사
      </div>
    </div>

    <h3 style="margin-top:18px">결과</h3>
    <pre id="out">대기중...</pre>

    <script>
      async function run(){
        const pid = document.getElementById('pid').value.trim();
        const out = document.getElementById('out');
        out.textContent = "불러오는 중...";
        try{
          const r = await fetch('/api/analyze', {
            method:'POST',
            headers:{'Content-Type':'application/json'},
            body: JSON.stringify({ placeIdOrUrl: pid })
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

// ===== 분석 API =====
app.post("/api/analyze", async (req, res) => {
  const input = req.body?.placeIdOrUrl;

  if (!input || typeof input !== "string") {
    return res.status(400).json({ ok: false, error: "placeId 숫자를 입력해주세요" });
  }

  const placeId = extractPlaceId(input);
  if (!placeId) {
    return res.status(400).json({
      ok: false,
      error: "placeId(숫자)를 찾지 못했어요. 예: 1443688242"
    });
  }

  // 전역 쿨다운
  if (Date.now() < globalCooldownUntil) {
    const waitSec = Math.ceil((globalCooldownUntil - Date.now()) / 1000);
    return res.status(200).json({
      ok: false,
      blocked: true,
      reason: "cooldown",
      placeId,
      message: `요청 과다로 잠시 쉬는 중입니다. 약 ${waitSec}초 후 다시 시도해주세요.`
    });
  }

  // 캐시
  const cached = cache.get(placeId);
  if (cached && (Date.now() - cached.ts) < CACHE_TTL_MS) {
    return res.status(200).json({
      ...cached.data,
      cached: true,
      cachedAt: new Date(cached.ts).toISOString()
    });
  }

  const targetUrl = placeUrl(placeId);

  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-dev-shm-usage"]
    });

    const page = await browser.newPage();
    page.setDefaultTimeout(30000);

    const resp = await page.goto(targetUrl, { waitUntil: "domcontentloaded" });
    const status = resp?.status?.() ?? null;

    const bodyText = await page.locator("body").innerText().catch(() => "");
    const snippet = (bodyText || "").replace(/\s+/g, " ").trim().slice(0, 260);

    // 429 또는 차단 페이지 감지
    if (status === 429 || looksBlocked(bodyText)) {
      globalCooldownUntil = Date.now() + COOLDOWN_MS_ON_429;
      return res.status(200).json({
        ok: false,
        blocked: true,
        reason: status === 429 ? "rate_limited" : "blocked_page",
        placeId,
        targetUrl,
        status,
        message: "요청 과다/접근 제한으로 자동 수집이 일시 제한되었습니다. 잠시 후 다시 시도해주세요.",
        snippet
      });
    }

    // MVP: 일단 크롤링 성공 여부를 보여주는 최소 정보만
    const title = await page.title().catch(() => "");

    const successData = {
      ok: true,
      placeId,
      targetUrl,
      status,
      title,
      snippet
    };

    // 캐시 저장
    cache.set(placeId, { ts: Date.now(), data: successData });

    return res.json(successData);
  } catch (e) {
    return res.status(500).json({ ok: false, placeId, error: String(e?.message || e) });
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log("Server listening on", port));
