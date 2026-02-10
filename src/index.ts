import express from "express";
import helmet from "helmet";
import analyzeRouter from "./routes/analyze.js";

const app = express();

app.use(helmet());
app.use(express.json({ limit: "1mb" }));

// ✅ 루트 추가: 브라우저로 접속했을 때 "정상" 확인용
app.get("/", (_req, res) => {
  res
    .status(200)
    .type("text")
    .send("OK - place-audit API is running. Try GET /health or POST /api/analyze");
});

app.get("/health", (_req, res) => res.json({ ok: true }));

app.use("/api", analyzeRouter);

const port = Number(process.env.PORT || 3000);
app.listen(port, () => {
  console.log(`✅ place-audit running on :${port}`);
});
