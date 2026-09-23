// 标本馆批量鉴定复核领域模型

export type PressStatus = "已压制" | "待压制";

// 待鉴定 -> 已鉴定(结论已写,待迁柜) -> 已入库；目标层满位时 -> 迁柜暂停(结论保留,留在原柜)
export type ReviewStatus = "待鉴定" | "已鉴定" | "已入库" | "迁柜暂停";

export interface Pos {
  cabinet: string; // 柜号，暂存柜为 T
  layer: string; // 层号
  slot: string; // 位号
}

export type TrailKind = "in" | "move" | "hold" | "back";

export interface TrailItem {
  at: string; // ISO 时间
  from: string;
  to: string;
  note: string;
  kind: TrailKind;
}

export interface Specimen {
  id: string; // 采集号（唯一）
  speciesCode: string; // 物种代码，决定目标柜层
  speciesName: string;
  latinName: string;
  collector: string; // 采集人
  elevation: number | null; // 海拔（米）
  location: string; // 采集地点
  habitat: string; // 生境描述
  pressStatus: PressStatus;
  status: ReviewStatus;
  pos: Pos; // 当前柜位
  reviewer?: string; // 鉴定人（复核通过后写入）
  reviewDate?: string; // 鉴定日期
  basis?: string; // 复核依据
  lastSkipReason?: string; // 最近一次未进入结论的原因
  trail: TrailItem[];
}

export interface Batch {
  id: string;
  speciesCode: string;
  ids: string[];
  reviewer: string;
  date: string;
  basisById: Record<string, string>; // 份级复核依据
  createdAt: string;
}

export interface SpeciesDef {
  code: string;
  name: string;
  latin: string;
  layer: string; // 目标柜层 key，如 A-01
}

export interface LayerDef {
  cabinet: string;
  layer: string;
  capacity: number;
  title: string;
}

export interface AppState {
  specimens: Specimen[];
  batches: Batch[];
}
