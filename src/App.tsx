import { useState } from "react";
import "./styles.css";
import { StoreProvider, useStore } from "./store";
import { LAYERS, occupiedMap } from "./logic";
import ReviewWorkbench from "./components/ReviewWorkbench";
import CabinetBoard from "./components/CabinetBoard";
import Explorer from "./components/Explorer";
import { DetailContext, SpecimenDetail } from "./components/ui";

type Tab = "review" | "cabinet" | "explorer";

const TABS: { key: Tab; label: string }[] = [
  { key: "review", label: "批量鉴定复核" },
  { key: "cabinet", label: "柜位迁移" },
  { key: "explorer", label: "标本总览" },
];

function Metrics({ onGo }: { onGo: (t: Tab) => void }) {
  const { state } = useStore();
  const inBatch = new Set(state.batches.flatMap((b) => b.ids));

  const pending = state.specimens.filter((s) => s.status === "待鉴定").length;
  const batching = inBatch.size;
  const held = state.specimens.filter((s) => s.status === "迁柜暂停").length;
  const ready = state.specimens.filter((s) => s.status === "已鉴定").length;
  const stored = state.specimens.filter((s) => s.status === "已入库").length;
  const occ = occupiedMap(state.specimens);
  const totalCap = LAYERS.reduce((sum, l) => sum + l.capacity, 0);

  const cards = [
    { label: "待鉴定", value: pending, sub: `其中 ${batching} 份已组批`, tab: "review" as Tab, alert: false },
    { label: "已鉴定·待迁柜", value: ready, sub: "结论已写入", tab: "cabinet" as Tab, alert: false },
    { label: "迁柜暂停", value: held, sub: held ? "目标层满位，待空位重选" : "无满位等待", tab: "cabinet" as Tab, alert: held > 0 },
    { label: "已入库 / 柜位", value: stored, sub: `共占用 ${Array.from(occ.values()).reduce((n, m) => n + m.size, 0)}/${totalCap} 位`, tab: "cabinet" as Tab, alert: false },
  ];

  return (
    <section className="metrics">
      {cards.map((c) => (
        <button
          key={c.label}
          className={`metric-card ${c.alert ? "metric-alert" : ""}`}
          onClick={() => onGo(c.tab)}
        >
          <small>{c.label}</small>
          <strong>{c.value}</strong>
          <span>{c.sub}</span>
        </button>
      ))}
    </section>
  );
}

function Shell() {
  const { state, dispatch } = useStore();
  const [tab, setTab] = useState<Tab>("review");
  const [detailId, setDetailId] = useState<string | null>(null);

  const queueHeld = state.specimens.some((s) => s.status === "迁柜暂停");

  return (
    <DetailContext.Provider value={setDetailId}>
      <main className="app">
        <header className="hero">
          <div>
            <p>植物标本馆 · 馆藏柜位同物种批量鉴定复核</p>
            <h1>批量复核 · 柜位迁移工作台</h1>
            <span>
              鉴定员从待鉴定标本按物种组批：组内采集人不同或海拔差超过 300 米须写明复核依据，缺说明的标本不进入本次结论；
              复核通过后统一写入鉴定人与日期，按物种代码迁至指定柜层，目标层满位则暂停迁移、结论保留、标本留原柜，可从该层空位逐份重选。
            </span>
          </div>
          <button
            className="reset-btn"
            onClick={() => {
              if (confirm("确定恢复演示数据？当前本地数据将被清空。")) dispatch({ type: "RESET" });
            }}
          >
            恢复演示数据
          </button>
        </header>

        <Metrics onGo={setTab} />

        <nav className="tabs">
          {TABS.map((t) => (
            <button key={t.key} className={tab === t.key ? "active" : ""} onClick={() => setTab(t.key)}>
              {t.label}
              {t.key === "cabinet" && queueHeld && <span className="tab-dot" title="有满位暂停" />}
            </button>
          ))}
        </nav>

        {tab === "review" && <ReviewWorkbench />}
        {tab === "cabinet" && <CabinetBoard />}
        {tab === "explorer" && <Explorer />}

        <footer className="footnote">
          所有柜位轨迹、待鉴定计数与鉴定结论仅保存在本浏览器（localStorage），重开页面仍可查询。
        </footer>
      </main>

      {detailId && <SpecimenDetail id={detailId} onClose={() => setDetailId(null)} />}
    </DetailContext.Provider>
  );
}

export default function App() {
  return (
    <StoreProvider>
      <Shell />
    </StoreProvider>
  );
}
