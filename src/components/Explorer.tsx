import { useMemo, useState } from "react";
import type { ReviewStatus } from "../types";
import { useStore } from "../store";
import type { NewSpecimenInput } from "../store";
import { posLabel, speciesOf, SPECIES } from "../logic";
import { Badge, useOpenDetail } from "./ui";

const FILTERS: { key: ReviewStatus | "全部" | "待鉴定+"; label: string }[] = [
  { key: "全部", label: "全部" },
  { key: "待鉴定+", label: "待鉴定" },
  { key: "待鉴定", label: "仅未组批" },
  { key: "已鉴定", label: "已鉴定·待迁柜" },
  { key: "迁柜暂停", label: "迁柜暂停" },
  { key: "已入库", label: "已入库" },
];

function AddSpecimenForm() {
  const { state, dispatch } = useStore();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<NewSpecimenInput>({
    id: "",
    speciesCode: SPECIES[0].code,
    collector: "",
    elevation: "",
    location: "",
    habitat: "",
    pressStatus: "已压制",
  });
  const [error, setError] = useState("");

  const set = (patch: Partial<NewSpecimenInput>) => setForm((f) => ({ ...f, ...patch }));

  const submit = () => {
    if (!form.id.trim()) return setError("请填写采集号");
    if (state.specimens.some((s) => s.id === form.id.trim())) return setError("该采集号已存在");
    if (!form.collector.trim()) return setError("请填写采集人");
    if (form.elevation.trim() && !Number.isFinite(Number(form.elevation))) return setError("海拔需为数字");
    dispatch({ type: "ADD_SPECIMEN", data: { ...form, id: form.id.trim() } });
    setError("");
    setForm({
      id: "",
      speciesCode: form.speciesCode,
      collector: "",
      elevation: "",
      location: "",
      habitat: "",
      pressStatus: "已压制",
    });
    setOpen(false);
  };

  if (!open) {
    return (
      <button className="primary small" onClick={() => setOpen(true)}>
        + 录入新标本（进入待鉴定）
      </button>
    );
  }

  return (
    <div className="add-form">
      <div className="field-grid">
        <label>
          <span>采集号 *</span>
          <input value={form.id} onChange={(e) => set({ id: e.target.value })} placeholder="如 HX-240906-01" />
        </label>
        <label>
          <span>物种代码 *</span>
          <select value={form.speciesCode} onChange={(e) => set({ speciesCode: e.target.value })}>
            {SPECIES.map((s) => (
              <option key={s.code} value={s.code}>
                {s.code} · {s.name} → {s.layer}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>采集人 *</span>
          <input value={form.collector} onChange={(e) => set({ collector: e.target.value })} />
        </label>
        <label>
          <span>海拔（米）</span>
          <input value={form.elevation} onChange={(e) => set({ elevation: e.target.value })} />
        </label>
        <label>
          <span>采集地点</span>
          <input value={form.location} onChange={(e) => set({ location: e.target.value })} />
        </label>
        <label>
          <span>压制状态</span>
          <select
            value={form.pressStatus}
            onChange={(e) => set({ pressStatus: e.target.value as NewSpecimenInput["pressStatus"] })}
          >
            <option>已压制</option>
            <option>待压制</option>
          </select>
        </label>
        <label className="field-wide">
          <span>生境描述</span>
          <input value={form.habitat} onChange={(e) => set({ habitat: e.target.value })} />
        </label>
      </div>
      <div className="form-actions">
        {error && <span className="warn-text">{error}</span>}
        <span className="spacer" />
        <button className="ghost-btn" onClick={() => setOpen(false)}>
          取消
        </button>
        <button className="primary small" onClick={submit}>
          保存并入待鉴定
        </button>
      </div>
    </div>
  );
}

export default function Explorer() {
  const { state } = useStore();
  const openDetail = useOpenDetail();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["key"]>("全部");
  const [query, setQuery] = useState("");

  const inBatch = new Set(state.batches.flatMap((b) => b.ids));

  const counts = useMemo(() => {
    const c: Record<string, number> = { 全部: state.specimens.length };
    for (const s of state.specimens) c[s.status] = (c[s.status] ?? 0) + 1;
    c["待鉴定+"] = c["待鉴定"] ?? 0;
    c["待鉴定"] = state.specimens.filter((s) => s.status === "待鉴定" && !inBatch.has(s.id)).length;
    return c;
  }, [state.specimens, state.batches]);

  const list = useMemo(() => {
    const q = query.trim();
    return state.specimens
      .filter((s) => {
        if (filter === "全部") return true;
        if (filter === "待鉴定+") return s.status === "待鉴定";
        if (filter === "待鉴定") return s.status === "待鉴定" && !inBatch.has(s.id);
        return s.status === filter;
      })
      .filter((s) => {
        if (!q) return true;
        return [s.id, s.speciesName, s.speciesCode, s.collector, s.location, s.reviewer ?? ""]
          .join(" ")
          .toLowerCase()
          .includes(q.toLowerCase());
      })
      .sort((a, b) => a.id.localeCompare(b.id));
  }, [state.specimens, state.batches, filter, query]);

  return (
    <div className="workbench">
      <section className="panel">
        <div className="panel-head">
          <h2>标本总览</h2>
          <AddSpecimenForm />
        </div>

        <div className="filter-bar">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              className={`filter-chip ${filter === f.key ? "active" : ""}`}
              onClick={() => setFilter(f.key)}
            >
              {f.label}
              <em>{counts[f.key] ?? 0}</em>
            </button>
          ))}
          <input
            className="filter-search"
            placeholder="搜索采集号 / 物种 / 采集人 / 地点…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        <div className="table-wrap">
          <table className="spec-table">
            <thead>
              <tr>
                <th>采集号</th>
                <th>物种</th>
                <th>采集人</th>
                <th>海拔</th>
                <th>采集地点 / 生境</th>
                <th>状态</th>
                <th>当前柜位</th>
                <th>鉴定信息</th>
              </tr>
            </thead>
            <tbody>
              {list.map((s) => (
                <tr key={s.id} className={inBatch.has(s.id) ? "row-in-batch" : ""}>
                  <td>
                    <button className="link-btn strong" onClick={() => openDetail(s.id)}>
                      {s.id}
                    </button>
                    {inBatch.has(s.id) && <span className="batch-tag">批次中</span>}
                    {s.lastSkipReason && <span className="skip-tag" title={s.lastSkipReason}>缺说明</span>}
                  </td>
                  <td>
                    {s.speciesName}
                    <small>
                      {s.speciesCode} · 目标 {speciesOf(s.speciesCode).layer}
                    </small>
                  </td>
                  <td>{s.collector}</td>
                  <td>{s.elevation == null ? "—" : `${s.elevation}m`}</td>
                  <td>
                    {s.location || "—"}
                    <small>{s.habitat}</small>
                  </td>
                  <td>
                    <Badge status={s.status} />
                    <small>{s.pressStatus}</small>
                  </td>
                  <td>
                    <code>{posLabel(s.pos)}</code>
                  </td>
                  <td>
                    {s.reviewer ? (
                      <>
                        {s.reviewer}
                        <small>{s.reviewDate}</small>
                      </>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                </tr>
              ))}
              {list.length === 0 && (
                <tr>
                  <td colSpan={8} className="empty-cell">
                    没有符合筛选条件的标本
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
