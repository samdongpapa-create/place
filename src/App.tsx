import React, { useMemo, useState } from "react";

type Plan = "free" | "pro";

type AnalyzeResponse = {
  meta?: { plan?: Plan };
  industry?: { subcategory?: string; vertical?: string };
  scores?: {
    total?: number;
    grade?: string;
    breakdown?: Record<string, number>;
    signals?: { missingFields?: string[]; keywordStuffingRisk?: boolean; stalenessRisk?: boolean };
  };
  place?: {
    placeUrl?: string;
    name?: string;
    category?: string;
    address?: string;
    roadAddress?: string;
    description?: string;
    directions?: string;
    keywords5?: string[];
    menus?: { name: string; price?: number }[];
    competitors?: { placeId: string; placeUrl: string; keywords5?: string[] }[];
  };
  recommend?: {
    keywords5?: { keyword: string; type?: string; reason?: string }[];
    todoTop5?: { action: string; impact: string; how: string }[];
    rewrite?: { description?: string; directions?: string };
    // proRaw 같은 건 백엔드에서 안 내려오게 하는게 정답
  };
  // debug는 옵션일 때만 내려오도록(백엔드에서)
  metaDebug?: any;
};

const API_BASE = ""; // same origin

export default function App() {
  const [url, setUrl] = useState("https://map.naver.com/p/entry/place/1443688242");
  const [plan, setPlan] = useState<Plan>("pro");
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<AnalyzeResponse | null>(null);
  const [error, setError] = useState<string>("");

  // ✅ 개발자용(결제와 무관): JSON/디버그는 숨겨진 토글로
  const [devMode, setDevMode] = useState(false);

  const headerTitle = useMemo(() => {
    return plan === "pro" ? "PRO 진단 리포트" : "FREE 진단 결과";
  }, [plan]);

  async function onAnalyze() {
    setError("");
    setLoading(true);
    setData(null);

    try {
      const res = await fetch(`${API_BASE}/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          input: { mode: "place_url", placeUrl: url },
          options: { plan, debug: devMode } // ✅ devMode일 때만 debug true
        })
      });

      const json = await res.json();
      if (!res.ok) throw new Error(json?.message || json?.error || "Request failed");
      setData(json);
    } catch (e: any) {
      setError(e?.message ?? "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  const grade = data?.scores?.grade ?? "-";
  const total = data?.scores?.total ?? 0;

  return (
    <div style={styles.page}>
      <div style={styles.shell}>
        {/* Header */}
        <div style={styles.header}>
          <div style={styles.titleRow}>
            <div style={styles.badge}>🧪</div>
            <div>
              <div style={styles.h1}>네이버 플레이스 진단</div>
              <div style={styles.h2}>{headerTitle}</div>
            </div>
            <div style={{ flex: 1 }} />
            {/* ✅ devMode는 결제랑 분리: 우측 상단 작은 아이콘 */}
            <button
              type="button"
              onClick={() => setDevMode(v => !v)}
              style={{ ...styles.iconBtn, opacity: 0.6 }}
              title="개발자 모드(디버그)"
            >
              ⚙️
            </button>
          </div>

          <div style={styles.form}>
            <label style={styles.label}>네이버 플레이스 URL</label>
            <input
              value={url}
              onChange={e => setUrl(e.target.value)}
              style={styles.input}
              placeholder="https://map.naver.com/p/entry/place/..."
            />

            <label style={{ ...styles.label, marginTop: 12 }}>요금제</label>
            <div style={styles.planRow}>
              <button
                type="button"
                onClick={() => setPlan("free")}
                style={{ ...styles.planBtn, ...(plan === "free" ? styles.planBtnActive : {}) }}
              >
                FREE
                <span style={styles.planSub}>핵심 점수/등급</span>
              </button>
              <button
                type="button"
                onClick={() => setPlan("pro")}
                style={{ ...styles.planBtn, ...(plan === "pro" ? styles.planBtnActive : {}) }}
              >
                PRO
                <span style={styles.planSub}>경쟁사·복붙본·전략</span>
              </button>
            </div>

            <button
              type="button"
              onClick={onAnalyze}
              disabled={loading}
              style={{ ...styles.primaryBtn, opacity: loading ? 0.7 : 1 }}
            >
              {loading ? "분석 중..." : "Analyze"}
            </button>

            {devMode && (
              <div style={styles.devHint}>
                ⚙️ 개발자 모드 ON: 디버그/원본 JSON을 추가로 표시합니다. (결제와 무관)
              </div>
            )}

            {error && <div style={styles.errorBox}>⚠️ {error}</div>}
          </div>
        </div>

        {/* Results */}
        {data && (
          <div style={styles.grid}>
            {/* Summary */}
            <Card>
              <div style={styles.cardTitle}>요약</div>
              <div style={styles.summaryRow}>
                <div style={styles.bigScore}>
                  <div style={styles.bigNum}>{total}</div>
                  <div style={styles.bigLabel}>Total</div>
                </div>

                <div style={styles.bigScore}>
                  <div style={styles.bigNum}>{grade}</div>
                  <div style={styles.bigLabel}>Grade</div>
                </div>

                <div style={{ flex: 1 }} />

                <div style={styles.metaBox}>
                  <div style={styles.metaLine}><b>{data.place?.name ?? "-"}</b></div>
                  <div style={styles.metaLine}>{data.place?.address || data.place?.roadAddress || "-"}</div>
                  <div style={styles.metaLine}>(업종) {data.industry?.subcategory ?? "-"}</div>
                </div>
              </div>

              <Divider />

              <FivePillScore data={data} />
            </Card>

            {/* FREE 핵심 개선안 */}
            <Card>
              <div style={styles.cardTitle}>무료 진단 핵심</div>
              <Section
                title="대표키워드(현재)"
                right={data.place?.keywords5?.length ? `${data.place?.keywords5?.length}/5` : "0/5"}
              >
                <Pills items={data.place?.keywords5 ?? []} emptyText="대표키워드가 없습니다." />
              </Section>

              <Section title="상세설명(현재)">
                <TextBox text={data.place?.description ?? ""} emptyText="상세설명이 비어 있습니다." />
              </Section>

              <Section title="오시는길(현재)">
                <TextBox text={data.place?.directions ?? ""} emptyText="오시는 길 안내가 비어 있습니다." />
              </Section>

              <Section title="바로 해야 할 것(Top5)">
                <TodoList items={data.recommend?.todoTop5 ?? []} />
              </Section>
            </Card>

            {/* PRO 리포트(잠금/해제 연출) */}
            <Card>
              <div style={styles.cardTitle}>PRO 리포트</div>

              {/* ✅ FREE면 잠금 화면 */}
              {plan !== "pro" ? (
                <LockedPro />
              ) : (
                <>
                  <Section title="경쟁사 Top5 대표키워드(빈도)">
                    <CompetitorKeywords competitors={data.place?.competitors ?? []} />
                  </Section>

                  <Section title="대표키워드 추천 5개">
                    <Pills items={(data.recommend?.keywords5 ?? []).map(x => x.keyword)} emptyText="추천 키워드가 없습니다." />
                    <div style={styles.miniNote}>
                      * 추천은 “지역 2 + 업종 1 + 서비스 2” 원칙 + 경쟁사 빈도 반영
                    </div>
                  </Section>

                  <Section title="상세설명 복붙본">
                    <CopyBox text={data.recommend?.rewrite?.description ?? ""} placeholder="(PRO에서 생성된 복붙본이 여기에 표시됩니다)" />
                  </Section>

                  <Section title="오시는길 복붙본">
                    <CopyBox text={data.recommend?.rewrite?.directions ?? ""} placeholder="(PRO에서 생성된 복붙본이 여기에 표시됩니다)" />
                  </Section>

                  <Section title="리뷰/사진 운영 전략">
                    <StrategyBox />
                  </Section>
                </>
              )}
            </Card>

            {/* ✅ 개발자 모드에서만 원본 JSON */}
            {devMode && (
              <Card>
                <div style={styles.cardTitle}>원본 JSON(개발자 모드)</div>
                <pre style={styles.pre}>
                  {JSON.stringify(data, null, 2)}
                </pre>
              </Card>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* ======================
 * UI Components
 * ====================== */

function Card({ children }: { children: React.ReactNode }) {
  return <div style={styles.card}>{children}</div>;
}

function Divider() {
  return <div style={styles.divider} />;
}

function Section({
  title,
  right,
  children
}: {
  title: string;
  right?: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ marginTop: 14 }}>
      <div style={styles.sectionHead}>
        <div style={styles.sectionTitle}>{title}</div>
        {right && <div style={styles.sectionRight}>{right}</div>}
      </div>
      <div style={{ marginTop: 8 }}>{children}</div>
    </div>
  );
}

function Pills({ items, emptyText }: { items: string[]; emptyText: string }) {
  if (!items?.length) return <div style={styles.empty}>{emptyText}</div>;
  return (
    <div style={styles.pillWrap}>
      {items.map((x, i) => (
        <span key={i} style={styles.pill}>
          {x}
        </span>
      ))}
    </div>
  );
}

function TextBox({ text, emptyText }: { text: string; emptyText: string }) {
  const t = (text || "").trim();
  if (!t) return <div style={styles.empty}>{emptyText}</div>;
  return <div style={styles.textBox}>{t}</div>;
}

function TodoList({ items }: { items: { action: string; impact: string; how: string }[] }) {
  if (!items?.length) return <div style={styles.empty}>추천 항목이 없습니다.</div>;
  return (
    <div style={styles.todoList}>
      {items.map((t, i) => (
        <div key={i} style={styles.todoItem}>
          <div style={styles.todoTop}>
            <b>{i + 1}. {t.action}</b>
            <span style={styles.impact}>{t.impact}</span>
          </div>
          <div style={styles.todoHow}>{t.how}</div>
        </div>
      ))}
    </div>
  );
}

function CopyBox({ text, placeholder }: { text: string; placeholder: string }) {
  const t = (text || "").trim();
  const show = !!t;

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(t);
      alert("복사 완료!");
    } catch {
      alert("복사 실패(브라우저 권한 확인)");
    }
  };

  return (
    <div style={styles.copyBox}>
      <div style={styles.copyTop}>
        <div style={styles.copyHint}>{show ? "아래 내용을 그대로 복사해서 붙여넣으세요." : placeholder}</div>
        <button type="button" onClick={onCopy} disabled={!show} style={{ ...styles.copyBtn, opacity: show ? 1 : 0.5 }}>
          복사
        </button>
      </div>
      <div style={styles.copyBody}>{show ? t : ""}</div>
    </div>
  );
}

function LockedPro() {
  return (
    <div style={styles.locked}>
      <div style={styles.lockIcon}>🔒</div>
      <div style={styles.lockTitle}>PRO 리포트는 결제 후 열립니다</div>
      <div style={styles.lockDesc}>
        경쟁사 Top5 대표키워드 분석 · 대표키워드 추천 5개 ·
        상세설명/오시는길 복붙본 · 리뷰/사진 전략까지 “보고서 형태”로 제공
      </div>
      <button type="button" style={styles.upgradeBtn}>
        PRO로 업그레이드
      </button>
      <div style={styles.lockMini}>
        * “원본 JSON 보기”는 결제가 아니라 개발자 모드 기능입니다.
      </div>
    </div>
  );
}

function CompetitorKeywords({ competitors }: { competitors: { placeId: string; placeUrl: string; keywords5?: string[] }[] }) {
  if (!competitors?.length) return <div style={styles.empty}>경쟁사 데이터가 없습니다.</div>;
  return (
    <div style={{ display: "grid", gap: 10 }}>
      {competitors.map((c, i) => (
        <div key={c.placeId || i} style={styles.compRow}>
          <div style={styles.compLeft}>
            <div style={styles.compTitle}>경쟁사 {i + 1}</div>
            <a href={c.placeUrl} target="_blank" rel="noreferrer" style={styles.compLink}>
              플레이스 열기
            </a>
          </div>
          <div style={{ flex: 1 }}>
            <Pills items={(c.keywords5 ?? []).slice(0, 5)} emptyText="대표키워드가 없습니다." />
          </div>
        </div>
      ))}
    </div>
  );
}

function StrategyBox() {
  return (
    <div style={styles.strategy}>
      <div style={styles.strategyItem}>• 리뷰: 결제 직후 “짧은 요청 멘트 + 사진 1장” 유도, 24시간 내 답글 유지</div>
      <div style={styles.strategyItem}>• 사진: 외관/입구/내부/시술결과/가격표(또는 제품) 5세트로 15장 이상</div>
      <div style={styles.strategyItem}>• 키워드: 나열 금지, 문장 안에 자연스럽게 1~2개만 포함</div>
    </div>
  );
}

function FivePillScore({ data }: { data: AnalyzeResponse }) {
  const breakdown = data?.scores?.breakdown || {};
  const items = [
    { k: "keywords", label: "대표키워드", v: breakdown["keywords"] ?? 0 },
    { k: "description", label: "상세설명", v: breakdown["description"] ?? 0 },
    { k: "directions", label: "오시는길", v: breakdown["directions"] ?? 0 },
    { k: "reviews", label: "리뷰", v: breakdown["reviews"] ?? 0 },
    { k: "photos", label: "사진", v: breakdown["photos"] ?? 0 }
  ];

  return (
    <div style={styles.score5}>
      {items.map(it => (
        <div key={it.k} style={styles.scorePill}>
          <div style={styles.scorePillTop}>{it.label}</div>
          <div style={styles.scorePillNum}>{it.v}</div>
        </div>
      ))}
    </div>
  );
}

/* ======================
 * Styles
 * ====================== */

const styles: Record<string, React.CSSProperties> = {
  page: {
    background: "#0b1220",
    minHeight: "100vh",
    padding: 24,
    color: "#e8eefc"
  },
  shell: { maxWidth: 980, margin: "0 auto" },

  header: {
    background: "rgba(255,255,255,0.06)",
    border: "1px solid rgba(255,255,255,0.10)",
    borderRadius: 16,
    padding: 18
  },

  titleRow: { display: "flex", alignItems: "center", gap: 12 },
  badge: {
    width: 42,
    height: 42,
    borderRadius: 12,
    background: "rgba(255,255,255,0.10)",
    display: "grid",
    placeItems: "center",
    fontSize: 18
  },
  h1: { fontSize: 18, fontWeight: 800, letterSpacing: -0.2 },
  h2: { marginTop: 2, fontSize: 12, opacity: 0.75 },

  iconBtn: {
    border: "1px solid rgba(255,255,255,0.14)",
    background: "rgba(255,255,255,0.06)",
    borderRadius: 10,
    padding: "8px 10px",
    cursor: "pointer",
    color: "#e8eefc"
  },

  form: { marginTop: 16 },
  label: { display: "block", fontSize: 12, opacity: 0.8, marginBottom: 6 },
  input: {
    width: "100%",
    padding: "12px 12px",
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.14)",
    background: "rgba(0,0,0,0.25)",
    color: "#e8eefc",
    outline: "none"
  },

  planRow: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 6 },
  planBtn: {
    border: "1px solid rgba(255,255,255,0.14)",
    background: "rgba(255,255,255,0.06)",
    borderRadius: 14,
    padding: 12,
    cursor: "pointer",
    color: "#e8eefc",
    textAlign: "left",
    fontWeight: 800
  },
  planBtnActive: {
    border: "1px solid rgba(120,170,255,0.55)",
    background: "rgba(120,170,255,0.12)"
  },
  planSub: { display: "block", marginTop: 4, fontSize: 12, fontWeight: 500, opacity: 0.75 },

  primaryBtn: {
    width: "100%",
    marginTop: 14,
    padding: "12px 14px",
    borderRadius: 12,
    border: "none",
    cursor: "pointer",
    fontWeight: 800,
    background: "#2b6cff",
    color: "white"
  },

  devHint: {
    marginTop: 10,
    fontSize: 12,
    opacity: 0.8,
    padding: 10,
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(255,255,255,0.05)"
  },

  errorBox: {
    marginTop: 12,
    padding: 10,
    borderRadius: 12,
    border: "1px solid rgba(255,80,80,0.35)",
    background: "rgba(255,80,80,0.10)",
    color: "#ffd5d5",
    fontSize: 13
  },

  grid: {
    display: "grid",
    gap: 14,
    marginTop: 14
  },

  card: {
    background: "rgba(255,255,255,0.06)",
    border: "1px solid rgba(255,255,255,0.10)",
    borderRadius: 16,
    padding: 16
  },
  cardTitle: { fontSize: 14, fontWeight: 900, marginBottom: 8 },

  summaryRow: { display: "flex", alignItems: "center", gap: 12 },
  bigScore: {
    width: 88,
    padding: 12,
    borderRadius: 14,
    border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(0,0,0,0.22)",
    textAlign: "center"
  },
  bigNum: { fontSize: 26, fontWeight: 900, lineHeight: 1 },
  bigLabel: { fontSize: 11, opacity: 0.7, marginTop: 6 },

  metaBox: {
    minWidth: 280,
    padding: 12,
    borderRadius: 14,
    border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(0,0,0,0.22)"
  },
  metaLine: { fontSize: 12, opacity: 0.9, marginTop: 4 },

  divider: { height: 1, background: "rgba(255,255,255,0.12)", marginTop: 14 },

  score5: { display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 10, marginTop: 14 },
  scorePill: {
    borderRadius: 14,
    border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(0,0,0,0.22)",
    padding: 10
  },
  scorePillTop: { fontSize: 12, opacity: 0.75 },
  scorePillNum: { fontSize: 18, fontWeight: 900, marginTop: 6 },

  sectionHead: { display: "flex", alignItems: "center", gap: 10 },
  sectionTitle: { fontSize: 13, fontWeight: 900 },
  sectionRight: { marginLeft: "auto", fontSize: 12, opacity: 0.7 },

  empty: {
    fontSize: 12,
    opacity: 0.7,
    padding: 10,
    borderRadius: 12,
    border: "1px dashed rgba(255,255,255,0.18)"
  },

  pillWrap: { display: "flex", flexWrap: "wrap", gap: 8 },
  pill: {
    fontSize: 12,
    padding: "6px 10px",
    borderRadius: 999,
    border: "1px solid rgba(255,255,255,0.14)",
    background: "rgba(255,255,255,0.06)"
  },

  textBox: {
    whiteSpace: "pre-wrap",
    fontSize: 13,
    lineHeight: 1.5,
    padding: 12,
    borderRadius: 14,
    border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(0,0,0,0.22)"
  },

  todoList: { display: "grid", gap: 10 },
  todoItem: {
    padding: 12,
    borderRadius: 14,
    border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(0,0,0,0.22)"
  },
  todoTop: { display: "flex", alignItems: "center", gap: 10 },
  impact: {
    marginLeft: "auto",
    fontSize: 11,
    padding: "4px 8px",
    borderRadius: 999,
    border: "1px solid rgba(120,170,255,0.40)",
    background: "rgba(120,170,255,0.12)",
    opacity: 0.9
  },
  todoHow: { marginTop: 6, fontSize: 12, opacity: 0.85, lineHeight: 1.45 },

  copyBox: {
    borderRadius: 14,
    border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(0,0,0,0.22)",
    overflow: "hidden"
  },
  copyTop: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "10px 12px",
    borderBottom: "1px solid rgba(255,255,255,0.10)"
  },
  copyHint: { fontSize: 12, opacity: 0.8, flex: 1 },
  copyBtn: {
    border: "1px solid rgba(255,255,255,0.14)",
    background: "rgba(255,255,255,0.06)",
    borderRadius: 10,
    padding: "8px 10px",
    cursor: "pointer",
    color: "#e8eefc",
    fontWeight: 800
  },
  copyBody: {
    padding: 12,
    fontSize: 13,
    lineHeight: 1.5,
    whiteSpace: "pre-wrap",
    minHeight: 110
  },

  locked: {
    padding: 18,
    borderRadius: 14,
    border: "1px dashed rgba(255,255,255,0.18)",
    background: "rgba(0,0,0,0.20)",
    textAlign: "center"
  },
  lockIcon: { fontSize: 26 },
  lockTitle: { marginTop: 8, fontSize: 14, fontWeight: 900 },
  lockDesc: { marginTop: 8, fontSize: 12, opacity: 0.8, lineHeight: 1.5 },
  upgradeBtn: {
    marginTop: 12,
    padding: "10px 14px",
    borderRadius: 12,
    border: "none",
    cursor: "pointer",
    fontWeight: 900,
    background: "#2b6cff",
    color: "white"
  },
  lockMini: { marginTop: 10, fontSize: 11, opacity: 0.65 },

  compRow: {
    display: "flex",
    gap: 12,
    alignItems: "flex-start",
    padding: 12,
    borderRadius: 14,
    border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(0,0,0,0.22)"
  },
  compLeft: { width: 140 },
  compTitle: { fontSize: 12, fontWeight: 900 },
  compLink: { fontSize: 12, opacity: 0.8, color: "#9dc1ff", textDecoration: "none" },

  miniNote: { marginTop: 8, fontSize: 11, opacity: 0.7 },

  strategy: {
    padding: 12,
    borderRadius: 14,
    border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(0,0,0,0.22)",
    fontSize: 12,
    lineHeight: 1.6,
    opacity: 0.9
  },
  strategyItem: { marginTop: 6 },

  pre: {
    margin: 0,
    padding: 12,
    borderRadius: 14,
    border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(0,0,0,0.22)",
    fontSize: 12,
    overflow: "auto",
    maxHeight: 420
  }
};
