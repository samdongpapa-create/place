import express from "express";
import helmet from "helmet";
import analyzeRouter from "./routes/analyze.js";

const app = express();

app.use(helmet());
app.use(express.json({ limit: "1mb" }));

app.get("/health", (_req, res) => res.json({ ok: true }));

app.use("/api", analyzeRouter);

const port = Number(process.env.PORT || 3000);
app.listen(port, () => {
  console.log(`✅ place-audit running on :${port}`);
});
