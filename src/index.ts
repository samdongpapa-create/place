import express from "express";
import path from "path";
import analyzeRouter from "./routes/analyze.js";

const app = express();

app.use(express.json());

// 🔥 public 경로 절대경로로 잡기
const publicDir = path.join(process.cwd(), "public");

app.use(express.static(publicDir));

app.get("/", (_req, res) => {
  res.sendFile(path.join(publicDir, "index.html"));
});

app.use("/api", analyzeRouter);

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("Server running on port", PORT);
});
