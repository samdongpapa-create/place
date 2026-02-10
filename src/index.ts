import express from "express";
import helmet from "helmet";
import { analyzeRouter } from "./routes/analyze.js"; // ✅ named import

const app = express();

/**
 * ✅ 테스트 화면에서 인라인 스크립트가 막히는 문제(CSP) 방지
 * - 운영 전환 때는 다시 CSP 설정을 제대로 잡으면 됨
 */
app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false
  })
);

// ✅ 테스트 중 캐시로 인해 결과가 안 바뀐 것처럼 보이는 상황 방지
app.use((_req, res, next) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  next();
});

app.use(express.json({ limit: "1mb" }));

app.get("/", (_req, res) => {
  res.type("html").send(`
<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8" />
  <title>Place Audit Test</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", sans-serif; background:#f6f7f9; padding:40px; }
    .wrap { max-width:760px; margin:auto; background:#fff; padding:24px; border-radius:12px; box-shadow:0 10px 30px rgba(0,0,0,.08); }
    h1 { margin:0 0 16px; }
    label { font-weight:600; display:block; margin-top:12px; }
    input, select, button { width:100%; margin-top:8px; padding:10px; font-size:14px; }
    button { background:#2563eb; color:#fff; border:none; border-radius:8px; cursor:pointer; margin-top:16px; }
    button:hover { background:#1e40af; }
    pre { margin-top:20px; background:#0f172a; color:#e5e7eb; padding:16px; border-radius:8px; overflow-x:auto; font-size:12px; min-height:140px; }
    .hint { font-size:12px; color:#666; margin-top:8px; line-height:1.6; }
  </style>
</head>
<body>
  <div class="wrap">
    <h1>🧪 네이버 플레이스 진단 테스트</h1>

    <label>네이버 플레이스 URL</label>
    <input id="placeUrl" placeholder="https://m.place.naver.com/place/1234567890/home" />

    <label>요금제</label>
    <select id="plan">
      <option value="free">FREE (미리보기)</option>
      <option value="pro">PRO (전체 결과)</option>
    </select>

    <button id="analyzeBtn">Analyze</button>

    <p class="hint">
      • FREE: 점수 + 대표 키워드 3개<br/>
      • PRO: 복붙용 상세설명 / 찾아오는 길 포함
    </p>

    <pre id="result">결과가 여기에 표시됩니다.</pre>
  </div>

<script>
(function () {
  const btn = document.getElementById("analyzeBtn");
  const resultEl = document.getElementById("result");

  btn.addEventListener("click", async () => {
    const placeUrl = document.getElementById("placeUrl").value.trim();
    const plan = document.getElementById("plan").value;

    if (!placeUrl) {
      alert("플레이스 URL을 입력하세요");
      return;
    }

    resultEl.textContent = "분석 중...";

    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          input: { mode: "place_url", placeUrl },
          options: { plan }
        })
      });

      const text = await res.text();
      resultEl.textContent = text || "(빈 응답)";
    } catch (e) {
      resultEl.textContent = "❌ 요청 실패: " + (e && e.message ? e.message : String(e));
    }
  });
})();
</script>
</body>
</html>
  `);
});

app.get("/health", (_req, res) => res.json({ ok: true }));

app.use("/api", analyzeRouter);

const port = Number(process.env.PORT || 3000);
app.listen(port, () => {
  console.log(`✅ place-audit running on :${port}`);
});
