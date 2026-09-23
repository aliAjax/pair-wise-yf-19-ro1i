import { useMemo, useState } from "react";
import type { Batch, Specimen } from "../types";
import { useStore } from "../store";
import {
  batchRule,
  freeSlots,
  occupiedMap,
  posLabel,
  ruleOfBatch,
  speciesOf,
} from "../logic";
import { Badge, useOpenDetail } from "./ui";

// —— 待鉴定：按物种代码组批 ——

function PendingGroups() {
  const { state, dispatch } = useStore();
  const openDetail = useOpenDetail();

  const groups = useMemo(() => {
    const inBatch = new Set(state.batches.flatMap((b) => b.ids));
    const pending = state.specimens.filter((s) => s.status === "待鉴定" && !inBatch.has(s.id));
    const map = new Map<string, Specimen[]>();
    for (const s of pending) {
      if (!map.has(s.speciesCode)) map.set(s.speciesCode, []);
      map.get(s.speciesCode)!.push(s);
    }
    return Array.from(map.values())
      .map((members) => ({ members: [...members].sort((a, b) => a.id.localeCompare(b.id)), rule: batchRule(members) }))
      .sort((a, b) => a.members[0].speciesCode.localeCompare(b.members[0].speciesCode));
  }, [state.specimens, state.batches]);

  const [selected, setSelected] = useState<Record<string, Set<string>>>({});

  const toggle = (code: string, id: string) => {
    setSelected((prev) => {
      const next = new Set(prev[code] ?? new Set());
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { ...prev, [code]: next };
    });
  };

  if (groups.length === 0) {
    return <p className="empty">暂待鉴定标本均已组批或完成复核。</p>;
  }

  return (
    <div className="groups">
      {groups.map(({ members, rule }) => {
        const sp = speciesOf(members[0].speciesCode);
        const key = sp.code;
        const sel = selected[key] ?? new Set<string>();
        return (
          <article className="group-card" key={key}>
            <header className="group-head">
              <div>
                <span className="species-code">{sp.code}</span>
                <h3>
                  {sp.name} <em>{sp.latin}</em>
                </h3>
                <p>
                  {members.length} 份待鉴定 · 指定柜层 <code>{sp.layer || "未配置"}</code>
                </p>
              </div>
              <button
                className="primary small"
                disabled={sel.size === 0}
                onClick={() => {
                  dispatch({ type: "CREATE_BATCH", speciesCode: key, ids: Array.from(sel) });
                  setSelected((prev) => ({ ...prev, [key]: new Set() }));
                }}
              >
                组批（{sel.size} 份）
              </button>
            </header>

            <div className={`rule-banner ${rule.needBasis ? "rule-warn" : "rule-ok"}`}>
              {rule.needBasis ? (
                <>
                  <b>本批须写明复核依据：</b>
                  {rule.collectorDiff && (
                    <span>
                      采集人不同（{rule.collectors.join("、")}）
                      {rule.elevDiff ? "；" : "。"}
                    </span>
                  )}
                  {rule.elevDiff && (
                    <span>
                      海拔差 {rule.elevSpan}m（{rule.elevMin}–{rule.elevMax}m）超过 300m。
                    </span>
                  )}
                  <i>缺说明的标本不进入本次结论，保留在待鉴定。</i>
                </>
              ) : (
                <>
                  <b>同组条件一致：</b>
                  <span>
                    采集人均为「{rule.collectors.join("、")}」
                    {rule.elevMin != null && <>，海拔 {rule.elevMin}–{rule.elevMax}m（差 {rule.elevSpan}m，≤300m）</>}
                    ，无须强制复核依据。
                  </span>
                </>
              )}
            </div>

            <table className="spec-table">
              <thead>
                <tr>
                  <th className="col-check">选择</th>
                  <th>采集号</th>
                  <th>采集人</th>
                  <th>海拔</th>
                  <th>采集地点</th>
                  <th>压制</th>
                </tr>
              </thead>
              <tbody>
                {members.map((s) => (
                  <tr key={s.id} className={sel.has(s.id) ? "row-selected" : ""}>
                    <td className="col-check">
                      <input
                        type="checkbox"
                        checked={sel.has(s.id)}
                        onChange={() => toggle(key, s.id)}
                      />
                    </td>
                    <td>
                      <button className="link-btn" onClick={() => openDetail(s.id)}>
                        {s.id}
                      </button>
                      {s.lastSkipReason && <span className="skip-tag" title={s.lastSkipReason}>上次缺说明</span>}
                    </td>
                    <td>{s.collector}</td>
                    <td>{s.elevation == null ? "—" : `${s.elevation}m`}</td>
                    <td>
                      {s.location}
                      <small>{s.habitat}</small>
                    </td>
                    <td>{s.pressStatus}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </article>
        );
      })}
    </div>
  );
}

// —— 进行中的批次：逐份写复核依据，统一通过 ——

function BatchCard({ batch }: { batch: Batch }) {
  const { state, dispatch } = useStore();
  const openDetail = useOpenDetail();
  const [reviewer, setReviewer] = useState(batch.reviewer);
  const [date, setDate] = useState(batch.date);
  const [bulkBasis, setBulkBasis] = useState("");

  const members = batch.ids
    .map((id) => state.specimens.find((s) => s.id === id))
    .filter((s): s is Specimen => !!s);
  const rule = ruleOfBatch(batch, state.specimens);
  const sp = speciesOf(batch.speciesCode);

  const missing = rule.needBasis
    ? members.filter((m) => !(batch.basisById[m.id] ?? "").trim())
    : [];
  const occupied = occupiedMap(state.specimens).get(sp.layer)?.size ?? 0;
  const capacity = freeSlots(sp.layer, occupiedMap(state.specimens)).length + occupied;
  const freeNow = freeSlots(sp.layer, occupiedMap(state.specimens));

  return (
    <article className="batch-card">
      <header className="group-head">
        <div>
          <span className="species-code">{sp.code} · 批次 {batch.id.slice(-4)}</span>
          <h3>
            {sp.name} 同物种批量复核 <em>{members.length} 份</em>
          </h3>
          <p>
            目标柜层 <code>{sp.layer}</code>，当前空位 {freeNow.length}/{capacity}
            {freeNow.length === 0 && <b className="warn-text">（层已满，通过后该批将暂停迁移）</b>}
          </p>
        </div>
        <button className="ghost-btn" onClick={() => dispatch({ type: "DISMISS_BATCH", batchId: batch.id })}>
          解散批次
        </button>
      </header>

      <div className={`rule-banner ${rule.needBasis ? "rule-warn" : "rule-ok"}`}>
        {rule.needBasis ? (
          <>
            <b>组批规则触发，须逐份写明复核依据：</b>
            {rule.collectorDiff && <span>采集人不同；</span>}
            {rule.elevDiff && <span>海拔差 {rule.elevSpan}m 超过 300m；</span>}
            <i>留空的标本本次不进入结论。</i>
          </>
        ) : (
          <span>
            <b>组内条件一致</b>（采集人相同{rule.elevSpan != null && <>、海拔差 {rule.elevSpan}m ≤ 300m</>}），复核依据选填。
          </span>
        )}
      </div>

      {rule.needBasis && (
        <div className="bulk-basis">
          <input
            placeholder="批量填写同一复核依据后点应用（仍可逐份修改）"
            value={bulkBasis}
            onChange={(e) => setBulkBasis(e.target.value)}
          />
          <button
            className="ghost-btn small"
            disabled={!bulkBasis.trim()}
            onClick={() => dispatch({ type: "FILL_BASIS", batchId: batch.id, basis: bulkBasis.trim() })}
          >
            应用到全批
          </button>
        </div>
      )}

      <table className="spec-table">
        <thead>
          <tr>
            <th>采集号 / 采集人 / 海拔</th>
            <th className="col-basis">复核依据{rule.needBasis && <em className="required"> *必填</em>}</th>
          </tr>
        </thead>
        <tbody>
          {members.map((s) => {
            const val = batch.basisById[s.id] ?? "";
            return (
              <tr key={s.id} className={rule.needBasis && !val.trim() ? "row-missing" : ""}>
                <td>
                  <button className="link-btn" onClick={() => openDetail(s.id)}>
                    {s.id}
                  </button>
                  <small>
                    {s.collector} · {s.elevation == null ? "海拔—" : `${s.elevation}m`} · {s.location} · 当前{" "}
                    <code>{posLabel(s.pos)}</code>
                  </small>
                </td>
                <td>
                  <input
                    value={val}
                    placeholder={rule.needBasis ? "缺说明则不进入本次结论" : "选填：形态比对、参考标本等"}
                    onChange={(e) =>
                      dispatch({
                        type: "SET_BASIS",
                        batchId: batch.id,
                        specimenId: s.id,
                        basis: e.target.value,
                      })
                    }
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <div className="approve-bar">
        <label className="inline-field">
          <span>鉴定人</span>
          <input value={reviewer} placeholder="必填" onChange={(e) => setReviewer(e.target.value)} />
        </label>
        <label className="inline-field">
          <span>鉴定日期</span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <div className="approve-info">
          {rule.needBasis && missing.length > 0 ? (
            <span className="warn-text">
              {missing.length} 份缺复核依据，将不进入本次结论（保留待鉴定）；通过 {members.length - missing.length} 份
            </span>
          ) : (
            <span className="ok-text">{members.length} 份全部满足复核条件</span>
          )}
        </div>
        <button
          className="primary"
          disabled={!reviewer.trim() || members.length === 0}
          onClick={() =>
            dispatch({ type: "APPROVE_BATCH", batchId: batch.id, reviewer: reviewer.trim(), date })
          }
        >
          复核通过并统一写入、迁移
        </button>
      </div>
    </article>
  );
}

export default function ReviewWorkbench() {
  const { state } = useStore();
  return (
    <div className="workbench">
      <section className="panel">
        <div className="panel-head">
          <h2>进行中的复核批次</h2>
          <span className="muted">{state.batches.length} 批</span>
        </div>
        {state.batches.length === 0 ? (
          <p className="empty">暂无进行中批次，请从下方待鉴定标本中按物种组批。</p>
        ) : (
          <div className="batches">{state.batches.map((b) => <BatchCard key={b.id} batch={b} />)}</div>
        )}
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>待鉴定标本 · 按物种组批</h2>
          <span className="muted">
            待鉴定 {state.specimens.filter((s) => s.status === "待鉴定").length} 份
          </span>
        </div>
        <PendingGroups />
      </section>
    </div>
  );
}

// 供其他面板复用的轻量徽章导出
export { Badge };
