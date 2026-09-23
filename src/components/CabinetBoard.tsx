import { useState } from "react";
import { useStore } from "../store";
import {
  LAYERS,
  freeSlots,
  layerKey,
  layerOf,
  occupiedMap,
  posLabel,
  slotLabel,
  speciesOf,
} from "../logic";
import { Badge, useOpenDetail } from "./ui";

// —— 迁柜队列：已鉴定待迁 + 迁柜暂停（满位） ——

function MigrationQueue() {
  const { state, dispatch } = useStore();
  const openDetail = useOpenDetail();
  const [picking, setPicking] = useState<string | null>(null);

  const queue = state.specimens.filter((s) => s.status === "已鉴定" || s.status === "迁柜暂停");
  const occupied = occupiedMap(state.specimens);

  if (queue.length === 0) {
    return <p className="empty">没有等待迁移的标本，鉴定通过的标本均已上柜。</p>;
  }

  return (
    <div className="queue">
      {queue.map((s) => {
        const layer = speciesOf(s.speciesCode).layer;
        const free = freeSlots(layer, occupied);
        const held = s.status === "迁柜暂停";
        return (
          <article key={s.id} className={`queue-card ${held ? "queue-held" : ""}`}>
            <div className="queue-main">
              <div className="queue-id">
                <Badge status={s.status} />
                <button className="link-btn strong" onClick={() => openDetail(s.id)}>
                  {s.id}
                </button>
                <span className="muted">
                  {s.speciesName}（{s.speciesCode}）
                </span>
              </div>
              <div className="queue-meta">
                <span>
                  鉴定人：{s.reviewer} · {s.reviewDate}
                </span>
                <span>
                  当前 <code>{posLabel(s.pos)}</code> → 目标层 <code>{layer}</code>
                </span>
                {s.basis?.trim() && <span className="muted">依据：{s.basis}</span>}
              </div>
              {held && (
                <p className="hold-note">
                  目标层满位，迁移已暂停；鉴定结论保留，标本仍在原柜。可从该层空位逐份重新选择：
                </p>
              )}
            </div>

            <div className="queue-actions">
              {free.length > 0 ? (
                <>
                  <button
                    className="primary small"
                    onClick={() =>
                      held
                        ? setPicking((p) => (p === s.id ? null : s.id))
                        : dispatch({ type: "MOVE_ONE", id: s.id })
                    }
                  >
                    {held ? `从空位重选（${free.length} 空）` : `迁至 ${layer}-${free[0]}`}
                  </button>
                  {held && (
                    <button
                      className="ghost-btn small"
                      onClick={() => dispatch({ type: "MOVE_ONE", id: s.id })}
                    >
                      自动补迁
                    </button>
                  )}
                </>
              ) : (
                <button className="ghost-btn small" disabled title={`${layer} 层已满位`}>
                  {layer} 满位
                </button>
              )}
            </div>

            {picking === s.id && held && (
              <div className="slot-picker">
                {free.map((slot) => (
                  <button
                    key={slot}
                    className="slot-choice"
                    onClick={() => {
                      dispatch({ type: "PICK_SLOT", id: s.id, slot });
                      setPicking(null);
                    }}
                  >
                    {layer}-{slot}
                  </button>
                ))}
                <button className="ghost-btn small" onClick={() => setPicking(null)}>
                  取消
                </button>
              </div>
            )}
          </article>
        );
      })}
    </div>
  );
}

// —— 柜格视图 ——

function CabinetGrid() {
  const { state, dispatch } = useStore();
  const openDetail = useOpenDetail();
  const [detailLayer, setDetailLayer] = useState<string | null>(null);
  const occupied = occupiedMap(state.specimens);

  const byPos = new Map(state.specimens.map((s) => [posLabel(s.pos), s]));

  return (
    <div className="cabinets">
      {["A", "B", "C"].map((cab) => (
        <section className="cabinet" key={cab}>
          <h3>{cab} 号柜</h3>
          <div className="layers">
            {LAYERS.filter((l) => l.cabinet === cab).map((def) => {
              const key = layerKey(def.cabinet, def.layer);
              const used = occupied.get(key);
              const count = used?.size ?? 0;
              const full = count >= def.capacity;
              return (
                <div
                  key={key}
                  className={`layer-cell ${full ? "layer-full" : ""} ${detailLayer === key ? "layer-open" : ""}`}
                >
                  <button className="layer-head" onClick={() => setDetailLayer((d) => (d === key ? null : key))}>
                    <span className="layer-name">
                      <code>{key}</code>
                      <small>{def.title}</small>
                    </span>
                    <span className={`layer-count ${full ? "count-full" : ""}`}>
                      {count}/{def.capacity}
                    </span>
                  </button>
                  <div className="slots">
                    {Array.from({ length: def.capacity }, (_, i) => {
                      const slot = slotLabel(i + 1);
                      const spec = byPos.get(`${key}-${slot}`);
                      return (
                        <button
                          key={slot}
                          className={`slot ${spec ? "slot-used" : "slot-free"}`}
                          title={spec ? `${spec.id} ${spec.speciesName}` : `${key}-${slot} 空位`}
                          onClick={() => spec && openDetail(spec.id)}
                        >
                          {spec ? "■" : "□"}
                          <small>{slot}</small>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ))}

      {detailLayer && <LayerDetail layerKeyName={detailLayer} onClose={() => setDetailLayer(null)} />}
    </div>
  );
}

function LayerDetail({ layerKeyName, onClose }: { layerKeyName: string; onClose: () => void }) {
  const { state, dispatch } = useStore();
  const openDetail = useOpenDetail();
  const def = layerOf(layerKeyName);
  const occupied = occupiedMap(state.specimens);
  const used = occupied.get(layerKeyName);
  const free = freeSlots(layerKeyName, occupied);
  if (!def) return null;

  const stored = state.specimens.filter(
    (s) => s.status === "已入库" && `${s.pos.cabinet}-${s.pos.layer}` === layerKeyName,
  );

  return (
    <div className="modal-mask" onClick={onClose}>
      <div className="modal modal-narrow" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <small>柜层详情</small>
            <h2>
              {layerKeyName} · {def.title}
            </h2>
          </div>
          <button className="icon-btn" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="layer-summary">
          <span>
            占用 {used?.size ?? 0}/{def.capacity}
          </span>
          <span className={free.length ? "ok-text" : "warn-text"}>
            {free.length ? `空位：${free.join("、")}` : "该层满位"}
          </span>
        </div>

        <table className="spec-table">
          <thead>
            <tr>
              <th>位号</th>
              <th>标本</th>
              <th>物种</th>
              <th>鉴定</th>
              <th>整理</th>
            </tr>
          </thead>
          <tbody>
            {stored
              .sort((a, b) => a.pos.slot.localeCompare(b.pos.slot))
              .map((s) => (
                <tr key={s.id}>
                  <td>
                    <code>{s.pos.slot}</code>
                  </td>
                  <td>
                    <button className="link-btn" onClick={() => openDetail(s.id)}>
                      {s.id}
                    </button>
                  </td>
                  <td>
                    {s.speciesName} <small>{s.speciesCode}</small>
                  </td>
                  <td>
                    {s.reviewer} · {s.reviewDate}
                  </td>
                  <td>
                    <button
                      className="ghost-btn small danger"
                      onClick={() =>
                        dispatch({ type: "RELEASE_SLOT", id: s.id })
                      }
                      title="柜位整理：退架释放位号，鉴定结论保留，可重新上柜"
                    >
                      退架
                    </button>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function CabinetBoard() {
  return (
    <div className="workbench">
      <section className="panel">
        <div className="panel-head">
          <h2>迁移队列</h2>
          <span className="muted">满位暂停后可在空位中逐份重选</span>
        </div>
        <MigrationQueue />
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>馆藏柜位</h2>
          <span className="muted">点击层格展开详情，点击位号查看标本</span>
        </div>
        <CabinetGrid />
      </section>
    </div>
  );
}
