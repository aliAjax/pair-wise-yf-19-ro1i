import type { AppState, Specimen } from "./types";
import { freeCount, isHeld, targetLayerOf } from "./store";

export const STATUS_LABEL: Record<Specimen["status"], string> = {
  pending: "待鉴定",
  batching: "批内复核中",
  reviewed: "已复核待迁",
  migrated: "已上柜",
};

export function StatusBadge({ s, state }: { s: Specimen; state: AppState }) {
  let cls = "badge";
  let text = STATUS_LABEL[s.status];
  if (s.status === "pending") cls += " badge-pending";
  else if (s.status === "batching") cls += " badge-batching";
  else if (s.status === "migrated") cls += " badge-migrated";
  else {
    const layer = targetLayerOf(s.code, state.layers);
    if (!layer) {
      cls += " badge-nomap";
      text = "未指定柜层";
    } else if (isHeld(s, state)) {
      cls += " badge-held";
      text = `满位暂留·${layer.id}`;
    } else {
      cls += " badge-ready";
      text = `可迁移·${layer.id}`;
    }
  }
  return <span className={cls}>{text}</span>;
}

const HISTORY_LABEL: Record<string, { label: string; cls: string }> = {
  create: { label: "录入", cls: "timeline-dot dot-create" },
  batch: { label: "组批", cls: "timeline-dot dot-batch" },
  review: { label: "复核", cls: "timeline-dot dot-review" },
  exclude: { label: "未入结论", cls: "timeline-dot dot-exclude" },
  move: { label: "柜位", cls: "timeline-dot dot-move" },
  hold: { label: "暂停迁移", cls: "timeline-dot dot-hold" },
};

export function SpecimenDetail({ s, state, onClose }: { s: Specimen; state: AppState; onClose: () => void }) {
  const layer = targetLayerOf(s.code, state.layers);
  return (
    <div className="modal-mask" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <span className="mono">{s.id}</span>
            <h2>
              {s.speciesName}
              <em className="code-chip">{s.code}</em>
            </h2>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="关闭">
            ✕
          </button>
        </div>

        <div className="detail-grid">
          <div>
            <small>采集人</small>
            <b>{s.collector}</b>
          </div>
          <div>
            <small>海拔</small>
            <b>{s.altitude} m</b>
          </div>
          <div>
            <small>当前状态</small>
            <b>
              <StatusBadge s={s} state={state} />
            </b>
          </div>
          <div>
            <small>当前柜位</small>
            <b>{s.position}</b>
          </div>
          <div className="span-2">
            <small>采集地点</small>
            <b>{s.locality}</b>
          </div>
          <div className="span-2">
            <small>生境描述</small>
            <b>{s.habitat}</b>
          </div>
          <div>
            <small>鉴定人</small>
            <b>{s.identifier ?? "—"}</b>
          </div>
          <div>
            <small>鉴定日期</small>
            <b>{s.reviewDate ?? "—"}</b>
          </div>
          <div>
            <small>指定柜层</small>
            <b>
              {layer ? (
                <>
                  {layer.id}（{layer.cabinet}
                  {layer.floor}，空位 {freeCount(layer, state.specimens)}）
                </>
              ) : (
                <span className="warn-text">未指定</span>
              )}
            </b>
          </div>
          <div>
            <small>所属批次</small>
            <b className="mono">{s.batchId ?? "—"}</b>
          </div>
          {s.reviewNote && (
            <div className="span-2">
              <small>复核依据</small>
              <b>{s.reviewNote}</b>
            </div>
          )}
          {s.excludeHint && (
            <div className="span-2">
              <small>最近提示</small>
              <b className="warn-text">{s.excludeHint}</b>
            </div>
          )}
        </div>

        <h3 className="timeline-title">柜位轨迹 / 操作记录</h3>
        <ol className="timeline">
          {s.history.map((h, i) => {
            const meta = HISTORY_LABEL[h.type] ?? { label: h.type, cls: "timeline-dot" };
            return (
              <li key={i}>
                <span className={meta.cls}>{meta.label}</span>
                <div>
                  <p>{h.text}</p>
                  <time>{h.time.replace("T", " ")}</time>
                </div>
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}
