import { createContext, useContext } from "react";
import type { ReactNode } from "react";
import type { ReviewStatus, Specimen } from "../types";
import { fmtDateTime, posLabel, speciesOf } from "../logic";
import { useStore } from "../store";

export const STATUS_LABEL: Record<ReviewStatus, string> = {
  待鉴定: "待鉴定",
  已鉴定: "已鉴定·待迁柜",
  已入库: "已入库",
  迁柜暂停: "迁柜暂停",
};

export function Badge({ status }: { status: ReviewStatus }) {
  return <span className={`badge badge-${status}`}>{STATUS_LABEL[status]}</span>;
}

export const DetailContext = createContext<(id: string) => void>(() => {});
export const useOpenDetail = () => useContext(DetailContext);

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="detail-row">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

export function SpecimenDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const { state } = useStore();
  const s = state.specimens.find((x) => x.id === id);
  if (!s) return null;
  const sp = speciesOf(s.speciesCode);

  return (
    <div className="modal-mask" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <small>标本详情</small>
            <h2>{s.id}</h2>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="关闭">
            ×
          </button>
        </div>

        <div className="detail-title">
          <strong>{s.speciesName}</strong>
          <em>{s.latinName || sp.latin}</em>
          <Badge status={s.status} />
        </div>

        <dl className="detail-grid">
          <Row label="物种代码">{s.speciesCode}</Row>
          <Row label="目标柜层">{sp.layer ? <code>{sp.layer}</code> : "未配置"}</Row>
          <Row label="当前柜位">
            <code>{posLabel(s.pos)}</code>
          </Row>
          <Row label="压制状态">{s.pressStatus}</Row>
          <Row label="采集人">{s.collector}</Row>
          <Row label="海拔">{s.elevation == null ? "—" : `${s.elevation} 米`}</Row>
          <Row label="采集地点">{s.location || "—"}</Row>
          <Row label="生境描述">{s.habitat || "—"}</Row>
          <Row label="鉴定人">{s.reviewer || "—"}</Row>
          <Row label="鉴定日期">{s.reviewDate || "—"}</Row>
          <div className="detail-row detail-row-wide">
            <dt>复核依据</dt>
            <dd>{s.basis?.trim() ? s.basis : "—"}</dd>
          </div>
          {s.lastSkipReason && (
            <div className="detail-row detail-row-wide">
              <dt>最近排除</dt>
              <dd className="warn-text">{s.lastSkipReason}</dd>
            </div>
          )}
        </dl>

        <h3 className="trail-title">柜位轨迹</h3>
        <ol className="trail">
          {[...s.trail].reverse().map((t, i) => (
            <li key={s.trail.length - i} className={`trail-${t.kind}`}>
              <span className="trail-time">{fmtDateTime(t.at)}</span>
              <span className="trail-route">
                <code>{t.from}</code> → <code>{t.to}</code>
              </span>
              <span className="trail-note">{t.note}</span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
