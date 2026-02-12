// src/index.ts

import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { analyzeRouter } from "./routes/analyze.js";

const app = express();
app.use(express.json({ limit: "2mb" }));

// ESM 대응
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ✅ public 폴더 서빙
app.use(express.static(path.join(__dirname, "../public")));

// ✅ API
app.use("/api", analyzeRouter);

// SPA fallback
app.get("*", (_req, res) => {
  res.sendFile(path.join(__dirname, "../public/index.html"));
});

const port = Number(process.env.PORT || 3000);

app.listen(port, () => {
  console.log(`🚀 Server running on port ${port}`);
});
