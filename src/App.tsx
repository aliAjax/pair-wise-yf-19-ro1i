import { useMemo, useState, type ChangeEvent } from "react";
import type { AppState, Batch, Specimen } from "./types";
import {
  FILTERS,
  addSpecimen,
  computeFlags,
  createBatch,
  dissolveBatch,
  freeCount,
  isHeld,
  loadState,
  matchesFilter,
  migrateOne,
  occupiedIn,
  passReview,
  resetState,
  saveState,
  setLayerCapacity,
  setLayerCode,
  targetLayerOf,
  todayStr,
  vacateSlot,
  type FilterKey,
} from "./store";
import { SpecimenDetail, StatusBadge, STATUS_LABEL } from "./ui";

type Tab = "review" | "migrate" | "cabinet" | "ledger";

interface Share {
  state: AppState;
  apply: (next: AppState, msg?: string) => void;
  open: (s: Specimen) => void;
}

function pendingGroups(state: AppState) {
  const map = new Map<string, Specimen[]>();
  for (const s of state.specimens) {
    if (s.status !== "pending") continue;
    const arr = map.get(s.code) ?? [];
    arr.push(s);
    map.set(s.code, arr);
  }
  return [...map.entries()]
    .map(([code, members]) => ({ code, name: members[0].speciesName, members }))
    .sort((a, b) => a.code.localeCompare(b.code));
}

function groupByLayer(reviewed: Specimen[], state: AppState) {
  const groups = new Map<string, Specimen[]>();
  const unmapped: Specimen[] = [];
  for (const s of reviewed) {
    const layer = targetLayerOf(s.code, state.layers);
    if (!layer) unmapped.push(s);
    else {
      const arr = groups.get(layer.id) ?? [];
      arr.push(s);
      groups.set(layer.id, arr);
    }
  }
  return { groups, unmapped };
}

/* ============================ 批量鉴定复核 ============================ */

function GroupBoard({ state, apply }: Share) {
  const groups = pendingGroups(state);
  const [picks, setPicks] = useState<Record<string, Set<string>>>({});

  const toggle = (code: string, id: string) => {
    setPicks((prev) => {
      const next = new Set(prev[code] ?? []);
      next.has(id) ? next.delete(id) : next.add(id);
      return { ...prev, [code]: next };
    });
  };

  if (groups.length === 0) {
    return <div className="empty">待鉴定队列为空。所有标本都已进入批次或完成复核。</div>;
  }

  return (
    <div className="group-board">
      {groups.map((g) => {
        const selected = picks[g.code] ?? new Set<string>();
        const useIds = selected.size > 0 ? [...selected] : g.members.map((m) => m.id);
        const previewMembers = g.members.filter((m) => useIds.includes(m.id));
        const flags = computeFlags(previewMembers);
        const layer = targetLayerOf(g.code, state.layers);
        const flaggedCount = [...flags.values()].filter((f) => f.reasons.length > 0).length;
        return (
          <article key={g.code} className="group-card">
            <header>
              <div>
                <h3>
                  {g.name} <em className="code-chip">{g.code}</em>
                </h3>
                <p>
                  {g.members.length} 份待鉴定
                  {layer ? (
                    <>
                      {" "}
                      · 指定层 <b>{layer.id}</b>（空位 {freeCount(layer, state.specimens)}/
                      {layer.capacity}）
                    </>
                  ) : (
                    <>
                      {" "}
                      · <span className="warn-text">该物种代码尚未指定柜层</span>
                    </>
                  )}
                </p>
              </div>
              <button
                className="primary small"
                onClick={() => {
                  apply(
                    createBatch(state, g.code, useIds),
                    `已按物种 ${g.code} 组批（${useIds.length} 份）`,
                  );
                  setPicks((prev) => ({ ...prev, [g.code]: new Set() }));
                }}
              >
                组批复核（{useIds.length}）
              </button>
            </header>

            <table className="mini-table">
              <thead>
                <tr>
                  <th className="col-pick"></th>
                  <th>采集号</th>
                  <th>采集人</th>
                  <th>海拔</th>
                  <th>采集地点</th>
                  <th>组内复核规则预判</th>
                </tr>
              </thead>
              <tbody>
                {g.members.map((m) => {
                  const reasons = flags.get(m.id)?.reasons ?? [];
                  const inPreview = useIds.includes(m.id);
                  return (
                    <tr key={m.id}>
                      <td className="col-pick">
                        <input
                          type="checkbox"
                          checked={selected.has(m.id)}
                          onChange={() => toggle(g.code, m.id)}
                          title="勾选可只取部分组批；不勾则整组"
                        />
                      </td>
                      <td className="mono">{m.id}</td>
                      <td>{m.collector}</td>
                      <td>{m.altitude}m</td>
                      <td>{m.locality}</td>
                      <td>
                        {inPreview && reasons.length > 0 ? (
                          <span className="tag tag-warn" title={reasons.join("；")}>
                            需写依据 · {reasons.length} 条差异
                          </span>
                        ) : inPreview ? (
                          <span className="tag tag-ok">同质，免说明</span>
                        ) : (
                          <span className="tag tag-muted">未选入</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {flaggedCount > 0 && (
              <p className="rule-hint">
                ⚠ 拟组批次中有 {flaggedCount} 份存在「采集人不同或海拔差 &gt; 300m」，组批后必须逐份写明复核依据，
                缺说明的标本不进入本次结论。
              </p>
            )}
          </article>
        );
      })}
    </div>
  );
}

function BatchWorkspace({ state, apply, open, batch }: Share & { batch: Batch }) {
  const members = batch.specimenIds
    .map((id) => state.specimens.find((s) => s.id === id)!)
    .filter(Boolean);
  const flags = useMemo(() => computeFlags(members), [members]);
  const [identifier, setIdentifier] = useState(state.identifier);
  const [reviewDate, setReviewDate] = useState(todayStr());
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [batchBasis, setBatchBasis] = useState("");

  const setNote = (id: string, v: string) => setNotes((p) => ({ ...p, [id]: v }));
  const fillEmpty = () =>
    setNotes((p) => {
      const next = { ...p };
      for (const f of flags.values()) {
        if (f.reasons.length && !(next[f.specimenId] ?? "").trim()) {
          next[f.specimenId] = batchBasis;
        }
      }
      return next;
    });

  const missing = [...flags.values()].filter(
    (f) => f.reasons.length > 0 && !(notes[f.specimenId] ?? "").trim(),
  );

  return (
    <article className="batch-card">
      <header className="batch-head">
        <div>
          <span className="batch-id mono">{batch.id}</span>
          <h3>
            {batch.speciesName} <em className="code-chip">{batch.code}</em>
          </h3>
          <p>
            组批时间 {batch.createdAt.replace("T", " ")} · 共 {members.length} 份 ·{" "}
            {[...flags.values()].filter((f) => f.reasons.length).length} 份需写复核依据
          </p>
        </div>
        <button className="ghost" onClick={() => apply(dissolveBatch(state, batch.id), "批次已解散，标本退回待鉴定")}>
          解散批次
        </button>
      </header>

      <div className="batch-specs">
        {members.map((s) => {
          const reasons = flags.get(s.id)?.reasons ?? [];
          const need = reasons.length > 0;
          return (
            <div key={s.id} className={"batch-spec " + (need ? "need-note" : "")}>
              <div className="batch-spec-main" onClick={() => open(s)}>
                <span className="mono">{s.id}</span>
                <span>
                  {s.collector} · {s.altitude}m
                </span>
                <span className="loc">{s.locality}</span>
                {need ? (
                  <span className="tag tag-warn">需依据（{reasons.length}）</span>
                ) : (
                  <span className="tag tag-ok">免说明</span>
                )}
              </div>
              {need && (
                <div className="note-area">
                  <ul className="reason-list">
                    {reasons.map((r, i) => (
                      <li key={i}>{r}</li>
                    ))}
                  </ul>
                  <textarea
                    rows={2}
                    placeholder="写明本份复核依据（如：叶形/果序形态核对一致，海拔差异系坡向导致，鉴定为同物种…）"
                    value={notes[s.id] ?? ""}
                    onChange={(e) => setNote(s.id, e.target.value)}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="batch-foot">
        <label className="basis-input">
          <span>批次通用复核依据（可作为各份说明模板）</span>
          <div className="basis-row">
            <input
              value={batchBasis}
              onChange={(e) => setBatchBasis(e.target.value)}
              placeholder="如：经比对模式标本描述与馆藏同物种子实体，形态一致"
            />
            <button type="button" className="ghost small" onClick={fillEmpty} disabled={!batchBasis.trim()}>
              填入未写依据的标本
            </button>
          </div>
        </label>

        <div className="review-sign">
          <label>
            <span>鉴定人</span>
            <input value={identifier} onChange={(e) => setIdentifier(e.target.value)} />
          </label>
          <label>
            <span>鉴定日期</span>
            <input type="date" value={reviewDate} onChange={(e) => setReviewDate(e.target.value)} />
          </label>
          <button
            className="primary"
            disabled={!identifier.trim() || !reviewDate}
            onClick={() =>
              apply(
                passReview(state, batch.id, identifier.trim(), reviewDate, notes),
                missing.length > 0
                  ? `复核完成：${members.length - missing.length} 份通过，${missing.length} 份因缺依据未进入本次结论`
                  : `批次 ${batch.id} 全部 ${members.length} 份复核通过`,
              )
            }
          >
            复核通过{missing.length > 0 ? `（${missing.length} 份缺说明将不入结论）` : ""}
          </button>
        </div>
      </div>
    </article>
  );
}

function PassedBatches({ state }: { state: AppState }) {
  const passed = state.batches.filter((b) => b.status === "passed").reverse();
  if (passed.length === 0) return null;
  return (
    <section className="sub-panel">
      <h2>已完成批次（鉴定结论留档）</h2>
      <div className="passed-list">
        {passed.map((b) => (
          <article key={b.id} className="passed-card">
            <div>
              <span className="mono">{b.id}</span>
              <b>
                {b.speciesName} <em className="code-chip">{b.code}</em>
              </b>
            </div>
            <p>
              {b.identifier} · {b.reviewDate}
            </p>
            <p className="counts">
              通过 {b.passedCount ?? 0} · 即时迁入 {b.movedCount ?? 0} · 缺依据排除 {b.excludedCount ?? 0}
            </p>
          </article>
        ))}
      </div>
    </section>
  );
}

function ReviewTab(share: Share) {
  const active = share.state.batches.find((b) => b.status === "active");
  return (
    <div className="stack">
      <section className="sub-panel">
        <div className="sub-head">
          <h2>① 待鉴定组批台</h2>
          <p className="sub-desc">鉴定员从待鉴定标本里按物种组批；可勾选部分组批，不勾默认整组。</p>
        </div>
        {active ? (
          <BatchWorkspace key={active.id} {...share} batch={active} />
        ) : (
          <GroupBoard {...share} />
        )}
      </section>
      <PassedBatches state={share.state} />
    </div>
  );
}

/* ============================ 迁移调度 ============================ */

function MigrateTab({ state, apply, open }: Share) {
  const reviewed = state.specimens.filter((s) => s.status === "reviewed");
  const { groups, unmapped } = groupByLayer(reviewed, state);

  if (reviewed.length === 0) {
    return <div className="empty">暂无已复核待迁移标本。先到「批量鉴定复核」完成批次复核。</div>;
  }

  const layerIds = [...groups.keys()].sort();

  return (
    <div className="stack">
      <section className="sub-panel">
        <div className="sub-head">
          <h2>② 按物种代码迁入指定柜层</h2>
          <p className="sub-desc">
            目标层满位时暂停迁移，<b>鉴定结论仍保留，标本留在原柜</b>；腾空产生空位后，可从该层空位中逐份重新选择。
          </p>
        </div>

        <div className="migrate-groups">
          {layerIds.map((lid) => {
            const layer = state.layers.find((l) => l.id === lid)!;
            const list = groups.get(lid)!;
            const free = freeCount(layer, state.specimens);
            const full = free === 0;
            return (
              <article key={lid} className={"migrate-card " + (full ? "is-full" : "")}>
                <header>
                  <div>
                    <h3>
                      {layer.cabinet} · {layer.floor}{" "}
                      <em className="code-chip">{layer.speciesCodes.join(" / ") || "—"}</em>
                    </h3>
                    <p>
                      容量 {layer.capacity} · 已占 {layer.capacity - free} · 空位{" "}
                      <b className={full ? "warn-text" : "ok-text"}>{free}</b>
                    </p>
                  </div>
                  {full ? (
                    <span className="pause-banner">⛔ 层满位 · 迁移已暂停，可去「柜层总览」腾空空位</span>
                  ) : (
                    <span className="go-banner">有空位，可逐份迁入</span>
                  )}
                </header>
                <table className="mini-table">
                  <tbody>
                    {list.map((s) => {
                      const held = isHeld(s, state);
                      return (
                        <tr key={s.id}>
                          <td className="mono">{s.id}</td>
                          <td>{s.speciesName}</td>
                          <td>{s.identifier} · {s.reviewDate}</td>
                          <td>现位：{s.position}</td>
                          <td>
                            {held ? (
                              <span className="tag tag-warn">满位暂留</span>
                            ) : (
                              <span className="tag tag-ok">可迁入</span>
                            )}
                          </td>
                          <td className="row-actions">
                            <button className="link-btn" onClick={() => open(s)}>
                              详情
                            </button>
                            <button
                              className="primary small"
                              disabled={held}
                              onClick={() => apply(migrateOne(state, s.id), `${s.id} 已迁入 ${layer.id} 空位`)}
                            >
                              {held ? "等待空位" : "选入空位"}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </article>
            );
          })}

          {unmapped.length > 0 && (
            <article className="migrate-card is-nomap">
              <header>
                <h3>⚠ 未指定柜层的物种代码</h3>
                <p>请到「柜层总览」把物种代码指定到某一柜层后再迁移；鉴定结论已保留。</p>
              </header>
              {unmapped.map((s) => (
                <div key={s.id} className="nomap-row">
                  <span className="mono">{s.id}</span>
                  <span>
                    {s.speciesName} <em className="code-chip">{s.code}</em>
                  </span>
                  <span>{s.position}</span>
                  <button className="link-btn" onClick={() => open(s)}>
                    详情
                  </button>
                </div>
              ))}
            </article>
          )}
        </div>
      </section>
    </div>
  );
}

/* ============================ 柜层总览 ============================ */

function CabinetTab({ state, apply, open }: Share) {
  return (
    <div className="stack">
      <section className="sub-panel">
        <div className="sub-head">
          <h2>③ 馆藏柜层总览</h2>
          <p className="sub-desc">
            每个物种代码指定唯一柜层；「腾空」可把已上柜标本退回待迁移（结论保留），空出的位号可在「迁移调度」逐份重选。
          </p>
        </div>
        <div className="layer-grid">
          {state.layers.map((layer) => {
            const occupants = occupiedIn(layer.id, state.specimens);
            const free = freeCount(layer, state.specimens);
            const full = free === 0;
            return (
              <article key={layer.id} className={"layer-card " + (full ? "is-full" : "")}>
                <header>
                  <h3>{layer.id}</h3>
                  <span className="layer-name">
                    {layer.cabinet} · {layer.floor}
                  </span>
                </header>

                <div className="slot-bar">
                  {Array.from({ length: layer.capacity }, (_, i) => i + 1).map((slot) => {
                    const occ = occupants.find((o) => Number(o.position.match(/(\d+)位/)?.[1]) === slot);
                    return (
                      <div
                        key={slot}
                        className={"slot " + (occ ? "slot-on" : "slot-free")}
                        title={occ ? `${occ.id} ${occ.speciesName}` : `空位 ${slot}`}
                        onClick={() => occ && open(occ)}
                      >
                        {slot}
                      </div>
                    );
                  })}
                </div>
                <p className="slot-count">
                  已占 {occupants.length}/{layer.capacity}
                  {full && <span className="warn-text"> · 已满，迁移暂停</span>}
                </p>

                <label className="code-edit">
                  <span>指定物种代码</span>
                  <input
                    value={layer.speciesCodes.join("")}
                    placeholder="如 ACER-PA"
                    onChange={(e) => apply(setLayerCode(state, layer.id, e.target.value))}
                  />
                </label>
                <label className="cap-edit">
                  <span>层容量</span>
                  <input
                    type="number"
                    min={occupants.length}
                    max={50}
                    value={layer.capacity}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      if (Number.isFinite(v)) apply(setLayerCapacity(state, layer.id, Math.floor(v)));
                    }}
                  />
                </label>

                {occupants.length > 0 && (
                  <ul className="occupant-list">
                    {occupants.map((o) => (
                      <li key={o.id}>
                        <div>
                          <span className="mono">{o.id}</span>
                          <span>
                            {o.speciesName} · {o.identifier} · {o.reviewDate}
                          </span>
                        </div>
                        <button
                          className="link-btn danger"
                          onClick={() => apply(vacateSlot(state, o.id), `已腾空 ${o.position}，可在迁移调度重新选择`)}
                        >
                          腾空
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}

/* ============================ 标本台账 ============================ */

function IntakeForm({ state, apply }: Share) {
  const [form, setForm] = useState({
    id: "",
    code: "",
    speciesName: "",
    collector: "",
    altitude: "",
    locality: "",
    habitat: "",
  });
  const [err, setErr] = useState("");

  const codes = useMemo(() => {
    const map = new Map<string, string>();
    state.specimens.forEach((s) => map.set(s.code, s.speciesName));
    return [...map.entries()];
  }, [state.specimens]);

  const upd = (k: keyof typeof form) => (e: ChangeEvent<HTMLInputElement>) =>
    setForm((p) => ({ ...p, [k]: e.target.value }));

  const submit = () => {
    if (!form.id.trim() || !form.code.trim() || !form.speciesName.trim() || !form.collector.trim()) {
      setErr("采集号、物种代码、物种名称、采集人为必填");
      return;
    }
    if (state.specimens.some((s) => s.id === form.id.trim())) {
      setErr("采集号已存在");
      return;
    }
    const alt = Number(form.altitude);
    if (!Number.isFinite(alt) || alt < 0) {
      setErr("海拔需为非负数字（米）");
      return;
    }
    apply(
      addSpecimen(state, {
        id: form.id.trim(),
        code: form.code.trim().toUpperCase(),
        speciesName: form.speciesName.trim(),
        collector: form.collector.trim(),
        altitude: Math.round(alt),
        locality: form.locality.trim() || "—",
        habitat: form.habitat.trim() || "—",
      }),
      `已录入 ${form.id.trim()}，进入待鉴定队列`,
    );
    setForm({ id: "", code: "", speciesName: "", collector: "", altitude: "", locality: "", habitat: "" });
    setErr("");
  };

  const fields: { k: keyof typeof form; label: string; ph?: string; list?: string }[] = [
    { k: "id", label: "采集号", ph: "HX-240620-01" },
    { k: "code", label: "物种代码", ph: "ACER-PA", list: "code-list" },
    { k: "speciesName", label: "物种名称" },
    { k: "collector", label: "采集人" },
    { k: "altitude", label: "海拔（米）", ph: "1200" },
    { k: "locality", label: "采集地点" },
    { k: "habitat", label: "生境描述" },
  ];

  return (
    <section className="sub-panel intake">
      <div className="sub-head">
        <h2>④ 录入待鉴定标本</h2>
      </div>
      <div className="intake-grid">
        {fields.map((f) => (
          <label key={f.k} className={f.k === "locality" || f.k === "habitat" ? "wide" : ""}>
            <span>{f.label}</span>
            <input
              value={form[f.k]}
              placeholder={f.ph}
              list={f.list}
              onChange={upd(f.k)}
            />
          </label>
        ))}
      </div>
      <datalist id="code-list">
        {codes.map(([c, n]) => (
          <option key={c} value={c}>
            {n}
          </option>
        ))}
      </datalist>
      <div className="intake-foot">
        {err && <span className="warn-text">{err}</span>}
        <button className="primary" onClick={submit}>
          录入并进入待鉴定
        </button>
      </div>
    </section>
  );
}

function LedgerTab(share: Share) {
  const { state, open } = share;
  const [filter, setFilter] = useState<FilterKey>("all");
  const [q, setQ] = useState("");

  const list = state.specimens.filter((s) => {
    if (!matchesFilter(s, filter, state)) return false;
    if (!q.trim()) return true;
    const t = q.trim().toLowerCase();
    return [s.id, s.code, s.speciesName, s.collector, s.locality, s.position, s.identifier ?? ""]
      .join(" ")
      .toLowerCase()
      .includes(t);
  });

  const counts = useMemo(() => {
    const c: Record<FilterKey, number> = {
      all: state.specimens.length,
      pending: 0,
      batching: 0,
      reviewed: 0,
      ready: 0,
      held: 0,
      nomap: 0,
      migrated: 0,
    };
    for (const s of state.specimens) {
      (Object.keys(c) as FilterKey[]).forEach((k) => {
        if (matchesFilter(s, k, state)) c[k] += 1;
      });
    }
    return c;
  }, [state]);

  return (
    <div className="stack">
      <IntakeForm {...share} />
      <section className="sub-panel">
        <div className="sub-head">
          <h2>标本台账 · 状态筛选</h2>
          <input
            className="search"
            placeholder="搜索采集号 / 物种 / 采集人 / 地点 / 柜位…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <div className="filter-bar">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              className={"filter-chip " + (filter === f.key ? "on" : "")}
              onClick={() => setFilter(f.key)}
            >
              {f.label}
              <em>{counts[f.key]}</em>
            </button>
          ))}
        </div>

        <table className="ledger-table">
          <thead>
            <tr>
              <th>采集号</th>
              <th>物种</th>
              <th>采集人</th>
              <th>海拔</th>
              <th>采集地点</th>
              <th>鉴定人/日期</th>
              <th>当前柜位</th>
              <th>状态</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {list.map((s) => (
              <tr key={s.id} className={"st-" + s.status}>
                <td className="mono">{s.id}</td>
                <td>
                  {s.speciesName}
                  <em className="code-chip">{s.code}</em>
                </td>
                <td>{s.collector}</td>
                <td>{s.altitude}m</td>
                <td>{s.locality}</td>
                <td>
                  {s.identifier ? (
                    <>
                      {s.identifier}
                      <br />
                      <small>{s.reviewDate}</small>
                    </>
                  ) : (
                    "—"
                  )}
                </td>
                <td>{s.position}</td>
                <td>
                  <StatusBadge s={s} state={state} />
                </td>
                <td>
                  <button className="link-btn" onClick={() => open(s)}>
                    详情
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {list.length === 0 && <div className="empty">没有符合筛选条件的标本。</div>}
      </section>
    </div>
  );
}

/* ============================ App ============================ */

export default function App() {
  const [state, setState] = useState<AppState>(() => loadState());
  const [tab, setTab] = useState<Tab>("review");
  const [detailId, setDetailId] = useState<string | null>(null);
  const [toast, setToast] = useState("");

  const apply = (next: AppState, msg?: string) => {
    setState(next);
    saveState(next);
    if (msg) {
      setToast(msg);
      window.setTimeout(() => setToast(""), 3200);
    }
  };

  const detail = detailId ? state.specimens.find((s) => s.id === detailId) ?? null : null;
  const activeBatch = state.batches.find((b) => b.status === "active");

  const pendingCount = state.specimens.filter((s) => s.status === "pending").length;
  const reviewedCount = state.specimens.filter((s) => s.status === "reviewed").length;
  const heldCount = state.specimens.filter((s) => isHeld(s, state)).length;
  const migratedCount = state.specimens.filter((s) => s.status === "migrated").length;
  const fullLayers = state.layers.filter((l) => freeCount(l, state.specimens) === 0).length;

  const share: Share = {
    state,
    apply,
    open: (s) => setDetailId(s.id),
  };

  const tabs: { key: Tab; label: string; badge?: number }[] = [
    { key: "review", label: "批量鉴定复核", badge: pendingCount + (activeBatch ? 1 : 0) },
    { key: "migrate", label: "迁移调度", badge: reviewedCount },
    { key: "cabinet", label: "柜层总览" },
    { key: "ledger", label: "标本台账" },
  ];

  return (
    <main className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">葉</span>
          <div>
            <h1>馆藏柜位批量鉴定复核台</h1>
            <p>同物种组批复核 · 按物种代码定层迁入 · 满位暂停留柜 · 空位逐份重选</p>
          </div>
        </div>
        <div className="top-actions">
          <label className="mini-field">
            <span>默认鉴定人</span>
            <input
              value={state.identifier}
              onChange={(e) => apply({ ...state, identifier: e.target.value })}
            />
          </label>
          <button
            className="ghost"
            onClick={() => {
              if (window.confirm("重置为演示数据？当前浏览器内数据将被覆盖。")) {
                apply(resetState(), "已重置为演示数据");
              }
            }}
          >
            重置演示数据
          </button>
        </div>
      </header>

      <section className="metrics">
        <article>
          <small>待鉴定</small>
          <strong>{pendingCount}</strong>
        </article>
        <article>
          <small>批内复核中</small>
          <strong>{activeBatch ? activeBatch.specimenIds.length : 0}</strong>
        </article>
        <article>
          <small>已复核待迁</small>
          <strong>{reviewedCount}</strong>
          {heldCount > 0 && <em className="metric-warn">其中 {heldCount} 份满位暂留</em>}
        </article>
        <article>
          <small>已上柜</small>
          <strong>{migratedCount}</strong>
        </article>
        <article>
          <small>满位柜层</small>
          <strong className={fullLayers ? "warn-text" : ""}>{fullLayers}</strong>
        </article>
      </section>

      <nav className="tabs">
        {tabs.map((t) => (
          <button
            key={t.key}
            className={"tab " + (tab === t.key ? "on" : "")}
            onClick={() => setTab(t.key)}
          >
            {t.label}
            {t.badge ? <em className="tab-badge">{t.badge}</em> : null}
          </button>
        ))}
      </nav>

      {tab === "review" && <ReviewTab {...share} />}
      {tab === "migrate" && <MigrateTab {...share} />}
      {tab === "cabinet" && <CabinetTab {...share} />}
      {tab === "ledger" && <LedgerTab {...share} />}

      <footer className="footer">
        所有数据仅保存在本浏览器（localStorage），重开页面仍可查询；不上传服务器。
        {"  "}当前 {state.specimens.length} 份标本 · {state.layers.length} 个柜层 · 状态字典：
        {(["pending", "batching", "reviewed", "migrated"] as const).map((k) => (
          <span key={k} className="footer-badge">
            {STATUS_LABEL[k]}
          </span>
        ))}
      </footer>

      {detail && <SpecimenDetail s={detail} state={state} onClose={() => setDetailId(null)} />}
      {toast && <div className="toast">{toast}</div>}
    </main>
  );
}
