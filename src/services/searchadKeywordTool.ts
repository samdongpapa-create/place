// src/services/searchadKeywordTool.ts
import crypto from "crypto";

export type KeywordVolume = {
  relKeyword: string;
  monthlyPcQcCnt?: number;       // PC 월간 검색량
  monthlyMobileQcCnt?: number;   // MO 월간 검색량
  monthlyTotalQcCnt?: number;    // 합계(계산)
  compIdx?: string | number;     // 경쟁정도(옵션)
  debug?: any;
};

const BASE_URL = "https://api.searchad.naver.com";
const ENDPOINT_PATH = "/keywordstool";

// keywordstool 응답이 "< 10" 같은 문자열을 주는 케이스가 있어 안전 변환
function toNumberLike(v: any): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const s = v.replace(/[<>,\s]/g, "");
    const n = Number(s);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

function env(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

// message = `${timestamp}.${method}.${uri}`  (uri는 "/keywordstool" 처럼 path만)
function sign(timestamp: string, method: string, uri: string, secretKey: string) {
  const message = `${timestamp}.${method}.${uri}`;
  const h = crypto.createHmac("sha256", secretKey);
  h.update(message);
  return h.digest("base64");
}

type KeywordToolRaw = {
  keywordList?: Array<{
    relKeyword?: string;
    monthlyPcQcCnt?: any;
    monthlyMobileQcCnt?: any;
    compIdx?: any;
  }>;
};

export async function fetchKeywordVolumesFromSearchAd(
  keywords: string[],
  opts: { timeoutMs?: number; showDetail?: 0 | 1 } = {}
): Promise<Record<string, KeywordVolume>> {
  const API_KEY = env("NAVER_SEARCHAD_API_KEY");
  const SECRET_KEY = env("NAVER_SEARCHAD_SECRET_KEY");
  const CUSTOMER_ID = env("NAVER_SEARCHAD_CUSTOMER_ID");

  const showDetail = typeof opts.showDetail === "number" ? opts.showDetail : 1;

  // keywordstool hintKeywords는 “최대 5개”가 일반적이라 5개씩 잘라 호출 권장
  // (네이버 문서/예제에서 힌트키워드 최대 5개로 안내되는 케이스가 많음) :contentReference[oaicite:2]{index=2}
  const chunks: string[][] = [];
  const cleaned = (keywords || [])
    .map((k) => (k || "").trim())
    .filter(Boolean)
    .slice(0, 20);

  for (let i = 0; i < cleaned.length; i += 5) chunks.push(cleaned.slice(i, i + 5));

  const out: Record<string, KeywordVolume> = {};

  for (const chunk of chunks) {
    const hintKeywords = chunk.join(",");

    const qs = new URLSearchParams({
      hintKeywords,
      showDetail: String(showDetail)
    });

    const url = `${BASE_URL}${ENDPOINT_PATH}?${qs.toString()}`;
    const method = "GET";
    const timestamp = Date.now().toString();
    const signature = sign(timestamp, method, ENDPOINT_PATH, SECRET_KEY);

    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), typeof opts.timeoutMs === "number" ? opts.timeoutMs : 12000);

    try {
      const res = await fetch(url, {
        method,
        headers: {
          "X-Timestamp": timestamp,
          "X-API-KEY": API_KEY,
          "X-Customer": CUSTOMER_ID,
          "X-Signature": signature,
          "Content-Type": "application/json; charset=UTF-8"
        },
        signal: ctrl.signal
      });

      const text = await res.text();
      if (!res.ok) {
        throw new Error(`SearchAd keywordstool failed: ${res.status} ${res.statusText}\n${text.slice(0, 300)}`);
      }

      let json: KeywordToolRaw | null = null;
      try {
        json = JSON.parse(text);
      } catch {
        throw new Error(`SearchAd keywordstool non-json response\nhead=${text.slice(0, 300)}`);
      }

      const list = Array.isArray(json?.keywordList) ? json!.keywordList! : [];
      for (const row of list) {
        const rel = (row?.relKeyword || "").trim();
        if (!rel) continue;

        const pc = toNumberLike(row?.monthlyPcQcCnt);
        const mo = toNumberLike(row?.monthlyMobileQcCnt);
        const total = (pc ?? 0) + (mo ?? 0);

        out[rel] = {
          relKeyword: rel,
          ...(typeof pc === "number" ? { monthlyPcQcCnt: pc } : {}),
          ...(typeof mo === "number" ? { monthlyMobileQcCnt: mo } : {}),
          monthlyTotalQcCnt: total,
          ...(row?.compIdx !== undefined ? { compIdx: row.compIdx } : {})
        };
      }
    } finally {
      clearTimeout(t);
    }
  }

  return out;
}
