import express from "express";
import helmet from "helmet";
import analyzeRouter from "./routes/analyze.js";

const app = express();

app.use(helmet());
app.use(express.json({ limit: "1mb" }));

/**
 * 🧪 테스트용 웹 화면
 */
app.get("/", (_req, res) => {
  res.type("html").send(`
<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8" />
  <title>Place Audit Test</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", sans-serif;
      background: #f6f7f9;
      padding: 40px;
    }
    .wrap {
      max-width: 720px;
      margin: auto;
      background: #fff;
      padding: 24px;
      border-radius: 12px;
      box-shadow: 0 10px 30px rgba(0,0,0,.08);
    }
    h1 {
      margin-bottom: 16px;
    }
    input, select, button, textarea {
      width: 100%;
      margin-top: 8px;
      padding: 10px;
      font-size: 14px;
    }
    button {
      background: #2563eb;
      color: white;
      border: none;
      border-radius: 8px;
      cursor: pointer;
      margin-top: 16px;
    }
    button:hover {
      background: #1e40af;
    }
    pre {
      margin-top: 20px;
      background: #0f172a;
      color: #e5e7eb;
      padding: 16px;
      border-radius: 8px;
      overflow-x: auto;
      font-size: 12px;
    }
    .hint {
      font-size: 12px;
      color: #666;
    }
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

    <button onclick="analyze()">Analyze</button>

    <p class="hint">
      • FREE: 키워드 3개 + 요약<br/>
      • PRO: 복붙용 상세설명 / 찾아오는길 포함
    </p>

    <pre id="result">결과가 여기에 표시됩니다.</pre>
  </div>

<script>
async function analyze() {
  const placeUrl = document.getElementById("placeUrl").value;
  const plan = document.getElementById("plan").value;
  const resultEl = document.getElementById("result");

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
        input: {
          mode: "place_url",
          placeUrl
        },
        options: {
          plan
        }
      })
    });

    const data = await res.json();
    resultEl.textContent = JSON.stringify(data, null, 2);
  } catch (e) {
    resultEl.textContent = "에러 발생: " + e.message;
  }
}
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
