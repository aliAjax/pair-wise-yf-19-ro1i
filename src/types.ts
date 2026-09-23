export type Status = "pending" | "batching" | "reviewed" | "migrated";

export type HistoryType =
  | "create" // 录入 / 入待鉴定队列
  | "batch" // 组批 / 解散
  | "review" // 复核通过
  | "exclude" // 缺说明，未进入本次结论
  | "move" // 迁入柜位 / 腾空
  | "hold"; // 目标层满位，暂停迁移

export interface HistoryEvent {
  time: string;
  type: HistoryType;
  text: string;
}

export interface Specimen {
  /** 采集号 */
  id: string;
  /** 物种代码，决定指定柜层 */
  code: string;
  speciesName: string;
  /** 采集人 */
  collector: string;
  /** 海拔（米） */
  altitude: number;
  /** 采集地点 */
  locality: string;
  /** 生境描述 */
  habitat: string;
  status: Status;
  batchId: string | null;
  /** 已上柜时所在柜层 */
  layerId: string | null;
  /** 当前柜位描述，如「B柜 第1层 01位」「暂存柜 Z-03」 */
  position: string;
  identifier: string | null;
  reviewDate: string | null;
  /** 该份标本本次复核所依据的说明 */
  reviewNote: string | null;
  /** 最近一次因缺说明被排除的提示 */
  excludeHint: string | null;
  history: HistoryEvent[];
}

export interface Batch {
  id: string;
  code: string;
  speciesName: string;
  specimenIds: string[];
  createdAt: string;
  status: "active" | "passed";
  identifier?: string | null;
  reviewDate?: string | null;
  passedCount?: number;
  excludedCount?: number;
  movedCount?: number;
}

export interface Layer {
  /** 如 A-1 */
  id: string;
  cabinet: string;
  floor: string;
  capacity: number;
  /** 指定存放的物种代码（一个代码只指定到一个柜层） */
  speciesCodes: string[];
}

export interface AppState {
  specimens: Specimen[];
  batches: Batch[];
  layers: Layer[];
  /** 默认鉴定人 */
  identifier: string;
}
