import type { AppState, Batch, Layer, Specimen } from "./types";
import { createSeedState } from "./seed";

const STORAGE_KEY = "herbarium-review-v1";

export function loadState(): AppState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as AppState;
      if (parsed && Array.isArray(parsed.specimens) && Array.isArray(parsed.layers)) {
        return parsed;
      }
    }
  } catch {
    /* 数据损坏时回退到演示数据 */
  }
  const seeded = createSeedState();
  saveState(seeded);
  return seeded;
}

export function saveState(state: AppState) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function resetState(): AppState {
  const seeded = createSeedState();
  saveState(seeded);
  return seeded;
}

/* ---------------- 派生数据 ---------------- */

export function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

export function timestamp(): string {
  const p = (n: number) => String(n).padStart(2, "0");
  const d = new Date();
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** 物种代码指定到哪个柜层（一个代码只取第一个匹配层） */
export function targetLayerOf(code: string, layers: Layer[]): Layer | undefined {
  return layers.find((l) => l.speciesCodes.includes(code));
}

/** 柜层当前占用（以已迁入该层的标本计数） */
export function occupiedIn(layerId: string, specimens: Specimen[]): Specimen[] {
  return specimens.filter((s) => s.status === "migrated" && s.layerId === layerId);
}

export function freeCount(layer: Layer, specimens: Specimen[]): number {
  return layer.capacity - occupiedIn(layer.id, specimens).length;
}

/** 该层下一个可用位号（腾空后的位号会被复用） */
export function nextSlotIndex(layer: Layer, specimens: Specimen[]): number {
  const used = new Set(
    occupiedIn(layer.id, specimens).map((s) => parseSlotIndex(s.position)),
  );
  for (let i = 1; i <= layer.capacity; i++) {
    if (!used.has(i)) return i;
  }
  return layer.capacity + 1;
}

export function parseSlotIndex(position: string): number {
  const m = position.match(/(\d+)位/);
  return m ? Number(m[1]) : 0;
}

export function formatPosition(layer: Layer, slotIndex: number): string {
  return `${layer.cabinet} ${layer.floor} ${String(slotIndex).padStart(2, "0")}位`;
}

/* ---------------- 复核规则：组内差异标记 ---------------- */

export interface FlagInfo {
  specimenId: string;
  reasons: string[];
}

/**
 * 组内任一对比标本满足以下任一条件，该份标本即「需写明复核依据」：
 *  1. 采集人不同
 *  2. 海拔差超过 300 米
 */
export function computeFlags(members: Specimen[]): Map<string, FlagInfo> {
  const result = new Map<string, FlagInfo>();
  members.forEach((s) => result.set(s.id, { specimenId: s.id, reasons: [] }));

  for (let i = 0; i < members.length; i++) {
    for (let j = i + 1; j < members.length; j++) {
      const a = members[i];
      const b = members[j];
      if (a.collector.trim() !== b.collector.trim()) {
        addReason(result, a.id, `采集人与「${b.id}」(${b.collector})不同`);
        addReason(result, b.id, `采集人与「${a.id}」(${a.collector})不同`);
      }
      const diff = Math.abs(a.altitude - b.altitude);
      if (diff > 300) {
        addReason(result, a.id, `与「${b.id}」海拔差 ${diff}m（>300m）`);
        addReason(result, b.id, `与「${a.id}」海拔差 ${diff}m（>300m）`);
      }
    }
  }
  return result;
}

function addReason(map: Map<string, FlagInfo>, id: string, reason: string) {
  map.get(id)?.reasons.push(reason);
}

/* ---------------- 统计 ---------------- */

export type FilterKey =
  | "all"
  | "pending"
  | "batching"
  | "reviewed"
  | "ready"
  | "held"
  | "nomap"
  | "migrated";

export const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "all", label: "全部" },
  { key: "pending", label: "待鉴定" },
  { key: "batching", label: "批内" },
  { key: "reviewed", label: "已复核待迁" },
  { key: "ready", label: "可迁移" },
  { key: "held", label: "满位暂留" },
  { key: "nomap", label: "未指定柜层" },
  { key: "migrated", label: "已上柜" },
];

export function isHeld(s: Specimen, state: AppState): boolean {
  if (s.status !== "reviewed") return false;
  const layer = targetLayerOf(s.code, state.layers);
  if (!layer) return false;
  return freeCount(layer, state.specimens) === 0;
}

export function matchesFilter(s: Specimen, key: FilterKey, state: AppState): boolean {
  switch (key) {
    case "all":
      return true;
    case "pending":
      return s.status === "pending";
    case "batching":
      return s.status === "batching";
    case "reviewed":
      return s.status === "reviewed";
    case "ready":
      return s.status === "reviewed" && !isHeld(s, state) && !!targetLayerOf(s.code, state.layers);
    case "held":
      return isHeld(s, state);
    case "nomap":
      return s.status === "reviewed" && !targetLayerOf(s.code, state.layers);
    case "migrated":
      return s.status === "migrated";
  }
}

/* ---------------- 操作 ---------------- */

let batchSeq = 0;
export function nextBatchId(existing: Batch[]): string {
  const n = Math.max(batchSeq, existing.length) + 1;
  batchSeq = n;
  return `PC-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${String(n).padStart(2, "0")}`;
}

function addEvent(s: Specimen, type: Specimen["history"][number]["type"], text: string) {
  s.history.push({ time: timestamp(), type, text });
}

function clone<T>(v: T): T {
  return structuredClone(v);
}

/**
 * 复核通过：
 *  - 标记了差异且未写说明的标本 → 排除出本次结论，回到待鉴定
 *  - 其余统一写入鉴定人、鉴定日期与复核依据，复核结论保留
 *  - 随后逐份尝试按物种代码迁入指定柜层；满位则留在原柜，结论仍保留
 */
export function passReview(
  prev: AppState,
  batchId: string,
  identifier: string,
  reviewDate: string,
  notes: Record<string, string>,
): AppState {
  const state = clone(prev);
  const batch = state.batches.find((b) => b.id === batchId);
  if (!batch) return prev;

  const members = batch.specimenIds
    .map((id) => state.specimens.find((s) => s.id === id))
    .filter((s): s is Specimen => !!s);
  const flags = computeFlags(members);

  const passed: Specimen[] = [];
  const excluded: Specimen[] = [];

  for (const s of members) {
    const needNote = (flags.get(s.id)?.reasons.length ?? 0) > 0;
    const note = (notes[s.id] ?? "").trim();
    if (needNote && !note) {
      excluded.push(s);
      continue;
    }
    passed.push(s);
  }

  for (const s of passed) {
    s.status = "reviewed";
    s.batchId = null;
    s.identifier = identifier;
    s.reviewDate = reviewDate;
    s.reviewNote = (notes[s.id] ?? "").trim() || null;
    s.excludeHint = null;
    addEvent(
      s,
      "review",
      `${identifier} 复核通过（鉴定日期 ${reviewDate}）${s.reviewNote ? "，依据：" + s.reviewNote : ""}`,
    );
  }

  for (const s of excluded) {
    s.status = "pending";
    s.batchId = null;
    s.excludeHint = "组内存在采集人/海拔差异但未写明复核依据，未进入本次结论";
    addEvent(s, "exclude", s.excludeHint);
  }

  // 逐份按物种代码迁移，目标层满位时暂停，该份留在原柜、结论保留
  let movedCount = 0;
  for (const s of passed) {
    const layer = targetLayerOf(s.code, state.layers);
    if (!layer) {
      addEvent(s, "hold", `物种代码 ${s.code} 未指定柜层，暂留 ${s.position}`);
      continue;
    }
    if (freeCount(layer, state.specimens) === 0) {
      addEvent(s, "hold", `指定层 ${layer.id}（${layer.cabinet}${layer.floor}）满位，暂停迁移，鉴定结论保留，暂留 ${s.position}`);
      continue;
    }
    const slot = nextSlotIndex(layer, state.specimens);
    const target = formatPosition(layer, slot);
    addEvent(s, "move", `迁入 ${target}（${s.speciesName} 指定层 ${layer.id}）`);
    s.position = target;
    s.layerId = layer.id;
    s.status = "migrated";
    movedCount += 1;
  }

  batch.status = "passed";
  batch.identifier = identifier;
  batch.reviewDate = reviewDate;
  batch.passedCount = passed.length;
  batch.excludedCount = excluded.length;
  batch.movedCount = movedCount;

  return state;
}

/** 解散批次：标本全部回到待鉴定 */
export function dissolveBatch(prev: AppState, batchId: string): AppState {
  const state = clone(prev);
  const batch = state.batches.find((b) => b.id === batchId);
  if (!batch || batch.status !== "active") return prev;
  state.batches = state.batches.filter((b) => b.id !== batchId);
  for (const id of batch.specimenIds) {
    const s = state.specimens.find((x) => x.id === id);
    if (s && s.status === "batching") {
      s.status = "pending";
      s.batchId = null;
      addEvent(s, "batch", `批次 ${batchId} 解散，退回待鉴定`);
    }
  }
  return state;
}

/** 组批：从待鉴定标本里挑出同物种的若干份 */
export function createBatch(prev: AppState, code: string, specimenIds: string[]): AppState {
  const state = clone(prev);
  const id = nextBatchId(state.batches);
  const time = timestamp();
  for (const sid of specimenIds) {
    const s = state.specimens.find((x) => x.id === sid);
    if (s) {
      s.status = "batching";
      s.batchId = id;
      s.history.push({ time, type: "batch", text: `按物种 ${code} 组入批次 ${id}` });
    }
  }
  const name = state.specimens.find((s) => s.code === code)?.speciesName ?? code;
  state.batches.push({
    id,
    code,
    speciesName: name,
    specimenIds,
    createdAt: time,
    status: "active",
  });
  return state;
}

/** 从空位中逐份重新选择迁移（单份） */
export function migrateOne(prev: AppState, specimenId: string): AppState {
  const state = clone(prev);
  const s = state.specimens.find((x) => x.id === specimenId);
  if (!s || s.status !== "reviewed") return prev;
  const layer = targetLayerOf(s.code, state.layers);
  if (!layer) {
    addEvent(s, "hold", `物种代码 ${s.code} 未指定柜层，无法迁移`);
    return state;
  }
  if (freeCount(layer, state.specimens) === 0) {
    addEvent(s, "hold", `${layer.cabinet}${layer.floor}仍满位，暂停迁移，留 ${s.position}`);
    return state;
  }
  const slot = nextSlotIndex(layer, state.specimens);
  const target = formatPosition(layer, slot);
  addEvent(s, "move", `空位重选：${s.position} → ${target}`);
  s.position = target;
  s.layerId = layer.id;
  s.status = "migrated";
  return state;
}

/** 腾空柜位：标本退回「已复核」，鉴定结论保留，位号立即可供重选 */
export function vacateSlot(prev: AppState, specimenId: string): AppState {
  const state = clone(prev);
  const s = state.specimens.find((x) => x.id === specimenId);
  if (!s || s.status !== "migrated") return prev;
  const old = s.position;
  s.layerId = null;
  s.position = "暂存柜（腾空待重迁）";
  s.status = "reviewed";
  addEvent(s, "move", `腾空 ${old}，退回待迁移，鉴定结论保留`);
  return state;
}

export interface NewSpecimenInput {
  id: string;
  code: string;
  speciesName: string;
  collector: string;
  altitude: number;
  locality: string;
  habitat: string;
}

export function addSpecimen(prev: AppState, input: NewSpecimenInput): AppState {
  const state = clone(prev);
  const count = state.specimens.filter((s) => s.position.startsWith("暂存柜 Z-")).length + 1;
  const position = `暂存柜 Z-${String(count).padStart(2, "0")}`;
  state.specimens.unshift({
    id: input.id,
    code: input.code,
    speciesName: input.speciesName,
    collector: input.collector,
    altitude: input.altitude,
    locality: input.locality,
    habitat: input.habitat,
    status: "pending",
    batchId: null,
    layerId: null,
    position,
    identifier: null,
    reviewDate: null,
    reviewNote: null,
    excludeHint: null,
    history: [{ time: timestamp(), type: "create", text: `录入待鉴定队列，置于${position}` }],
  });
  return state;
}

/** 编辑柜层 ↔ 物种代码 指定关系 */
export function setLayerCode(prev: AppState, layerId: string, code: string): AppState {
  const state = clone(prev);
  const trimmed = code.trim().toUpperCase();
  // 一个代码只能指定到一个柜层：先从其它层摘除
  for (const layer of state.layers) {
    if (layer.id !== layerId && trimmed) {
      layer.speciesCodes = layer.speciesCodes.filter((c) => c !== trimmed);
    }
  }
  const layer = state.layers.find((l) => l.id === layerId);
  if (layer) {
    if (trimmed && !layer.speciesCodes.includes(trimmed)) {
      layer.speciesCodes = [trimmed];
    } else if (!trimmed) {
      layer.speciesCodes = [];
    }
  }
  return state;
}

export function setLayerCapacity(prev: AppState, layerId: string, capacity: number): AppState {
  const state = clone(prev);
  const layer = state.layers.find((l) => l.id === layerId);
  if (layer && capacity >= occupiedIn(layerId, state.specimens).length) {
    layer.capacity = capacity;
  }
  return state;
}

export function setDefaultIdentifier(prev: AppState, identifier: string): AppState {
  return { ...prev, identifier };
}
