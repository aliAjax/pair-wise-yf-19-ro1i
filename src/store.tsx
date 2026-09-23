import { createContext, useContext } from "react";
import type { ReactNode } from "react";
import { useEffect, useReducer } from "react";
import type { AppState, Batch, Pos, ReviewStatus, Specimen, TrailItem } from "./types";
import { seedSpecimens } from "./seed";
import {
  batchRule,
  freeSlots,
  occupiedMap,
  planMigration,
  posLabel,
  speciesOf,
  tempPos,
  today,
} from "./logic";

const STORAGE_KEY = "herbarium-batch-review-v1";

export type Action =
  | { type: "ADD_SPECIMEN"; data: NewSpecimenInput }
  | { type: "CREATE_BATCH"; speciesCode: string; ids: string[] }
  | { type: "DISMISS_BATCH"; batchId: string }
  | { type: "SET_BASIS"; batchId: string; specimenId: string; basis: string }
  | { type: "FILL_BASIS"; batchId: string; basis: string }
  | { type: "APPROVE_BATCH"; batchId: string; reviewer: string; date: string }
  | { type: "MOVE_ONE"; id: string }
  | { type: "PICK_SLOT"; id: string; slot: string }
  | { type: "RELEASE_SLOT"; id: string }
  | { type: "RESET" };

export interface NewSpecimenInput {
  id: string;
  speciesCode: string;
  collector: string;
  elevation: string;
  location: string;
  habitat: string;
  pressStatus: "已压制" | "待压制";
}

function nowIso(): string {
  return new Date().toISOString().slice(0, 16);
}

function trail(s: Specimen, item: Omit<TrailItem, "at">): TrailItem {
  return { at: nowIso(), ...item };
}

function findTarget(specimens: Specimen[], id: string): { layer: string; slot?: string } {
  const s = specimens.find((x) => x.id === id)!;
  const layer = speciesOf(s.speciesCode).layer;
  const slot = layer ? freeSlots(layer, occupiedMap(specimens))[0] : undefined;
  return { layer, slot };
}

// 将一份"已鉴定/迁柜暂停"标本尝试放入指定层指定空位
function placeInto(state: AppState, id: string, slot: string | undefined, noteMove: string, noteHold: string): AppState {
  const specimens = state.specimens.map((s) => ({ ...s, pos: { ...s.pos }, trail: [...s.trail] }));
  const s = specimens.find((x) => x.id === id);
  if (!s) return state;
  const layer = speciesOf(s.speciesCode).layer;
  const from = posLabel(s.pos);
  if (layer && slot) {
    const next: Pos = { cabinet: layer.split("-")[0], layer: layer.split("-")[1], slot };
    s.pos = next;
    s.status = "已入库";
    s.lastSkipReason = undefined;
    s.trail.push(trail(s, { from, to: posLabel(next), note: noteMove, kind: "move" }));
  } else {
    // 目标层满位：暂停迁移，鉴定结论保留，标本留在原柜
    s.status = "迁柜暂停";
    s.trail.push(trail(s, { from, to: from, note: noteHold, kind: "hold" }));
  }
  return { ...state, specimens };
}

export function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case "ADD_SPECIMEN": {
      const d = action.data;
      if (state.specimens.some((s) => s.id === d.id)) return state;
      const sp = speciesOf(d.speciesCode);
      const elev = d.elevation.trim() === "" ? null : Number(d.elevation);
      const pos = tempPos(d.id);
      const specimen: Specimen = {
        id: d.id,
        speciesCode: d.speciesCode,
        speciesName: sp.name,
        latinName: sp.latin,
        collector: d.collector,
        elevation: Number.isFinite(elev) ? elev : null,
        location: d.location,
        habitat: d.habitat,
        pressStatus: d.pressStatus,
        status: "待鉴定",
        pos,
        trail: [],
      };
      specimen.trail.push(trail(specimen, { from: "—", to: posLabel(pos), note: "入库登记，进入待鉴定", kind: "in" }));
      return { ...state, specimens: [...state.specimens, specimen] };
    }

    case "CREATE_BATCH": {
      const inBatch = new Set(state.batches.flatMap((b) => b.ids));
      const ids = action.ids.filter(
        (id) =>
          !inBatch.has(id) &&
          state.specimens.some((s) => s.id === id && s.status === "待鉴定" && s.speciesCode === action.speciesCode),
      );
      if (ids.length === 0) return state;
      const batch: Batch = {
        id: "B" + Date.now(),
        speciesCode: action.speciesCode,
        ids,
        reviewer: "",
        date: today(),
        basisById: {},
        createdAt: nowIso(),
      };
      return { ...state, batches: [...state.batches, batch] };
    }

    case "DISMISS_BATCH":
      return { ...state, batches: state.batches.filter((b) => b.id !== action.batchId) };

    case "SET_BASIS": {
      return {
        ...state,
        batches: state.batches.map((b) =>
          b.id === action.batchId
            ? { ...b, basisById: { ...b.basisById, [action.specimenId]: action.basis } }
            : b,
        ),
      };
    }

    case "FILL_BASIS": {
      return {
        ...state,
        batches: state.batches.map((b) => {
          if (b.id !== action.batchId) return b;
          const basisById: Record<string, string> = {};
          for (const id of b.ids) basisById[id] = action.basis;
          return { ...b, basisById };
        }),
      };
    }

    case "APPROVE_BATCH": {
      const batch = state.batches.find((b) => b.id === action.batchId);
      const reviewer = action.reviewer.trim();
      const date = action.date || today();
      if (!batch || !reviewer) return state;

      const memberMap = new Map(state.specimens.map((s) => [s.id, s]));
      const members = batch.ids
        .map((id) => memberMap.get(id))
        .filter((s): s is Specimen => !!s && s.status === "待鉴定");
      if (members.length === 0) {
        return { ...state, batches: state.batches.filter((b) => b.id !== batch.id) };
      }

      const rule = batchRule(members);
      const passed: Specimen[] = [];
      const skipped: Specimen[] = [];
      for (const m of members) {
        const basis = (batch.basisById[m.id] ?? "").trim();
        if (rule.needBasis && !basis) skipped.push(m);
        else passed.push({ ...m, basis: basis || m.basis });
      }

      let specimens = state.specimens.map((s) => ({ ...s, pos: { ...s.pos }, trail: [...s.trail] }));

      // 缺说明的标本不进入本次结论，继续留在待鉴定
      const passedIds = new Set(passed.map((p) => p.id));
      const basisMap = new Map(passed.map((p) => [p.id, p.basis ?? ""]));
      specimens = specimens.map((s) => {
        if (passedIds.has(s.id)) {
          s.status = "已鉴定";
          s.reviewer = reviewer;
          s.reviewDate = date;
          s.basis = basisMap.get(s.id) || undefined;
          s.lastSkipReason = undefined;
          s.trail.push(
            trail(s, {
              from: posLabel(s.pos),
              to: posLabel(s.pos),
              note: `同物种批量复核通过（批次共 ${members.length} 份，通过 ${passed.length} 份），鉴定人/日期已写入`,
              kind: "in",
            }),
          );
        } else if (skipped.some((x) => x.id === s.id)) {
          s.lastSkipReason = rule.collectorDiff && rule.elevDiff
            ? "组内采集人不同且海拔差超过300米，缺复核依据，未进入本次结论"
            : rule.collectorDiff
              ? "组内采集人不同，缺复核依据，未进入本次结论"
              : "组内海拔差超过300米，缺复核依据，未进入本次结论";
        }
        return s;
      });

      let next: AppState = {
        ...state,
        specimens,
        batches: state.batches.filter((b) => b.id !== batch.id),
      };

      // 复核通过后，按物种代码统一迁移到指定柜层；目标层满位则暂停
      for (const item of planMigration(next.specimens)) {
        if (!passedIds.has(item.id)) continue;
        next = placeInto(
          next,
          item.id,
          item.slot,
          `按物种代码 ${memberMap.get(item.id)!.speciesCode} 迁至指定柜层 ${item.layer}`,
          `目标层 ${item.layer} 满位，迁移暂停；鉴定结论保留，标本留在原柜，可在该层空位中逐份重选`,
        );
      }
      return next;
    }

    case "MOVE_ONE": {
      const s = state.specimens.find((x) => x.id === action.id);
      if (!s || (s.status !== "已鉴定" && s.status !== "迁柜暂停")) return state;
      const { layer, slot } = findTarget(state.specimens, action.id);
      return placeInto(
        state,
        action.id,
        slot,
        s.status === "迁柜暂停"
          ? `目标层 ${layer} 空位补迁（满位暂停后重选）`
          : `按物种代码 ${s.speciesCode} 迁至指定柜层 ${layer}`,
        `目标层 ${layer} 满位，迁移暂停；鉴定结论保留，标本留在原柜，可在该层空位中逐份重选`,
      );
    }

    case "PICK_SLOT": {
      const s = state.specimens.find((x) => x.id === action.id);
      if (!s || s.status !== "迁柜暂停") return state;
      const layer = speciesOf(s.speciesCode).layer;
      const occupied = occupiedMap(state.specimens).get(layer);
      if (occupied?.has(action.slot)) return state;
      return placeInto(
        state,
        action.id,
        action.slot,
        `目标层 ${layer} 空位补迁（满位暂停后手动选择 ${action.slot} 号位）`,
        `目标层 ${layer} 满位，迁移暂停`,
      );
    }

    case "RELEASE_SLOT": {
      const s = state.specimens.find((x) => x.id === action.id);
      if (!s || s.status !== "已入库") return state;
      const from = posLabel(s.pos);
      const pos = tempPos(s.id);
      const status: ReviewStatus = "已鉴定";
      const specimens = state.specimens.map((x) =>
        x.id === s.id
          ? {
              ...x,
              pos,
              status,
              trail: [
                ...x.trail,
                trail(x, {
                  from,
                  to: posLabel(pos),
                  note: `柜位整理退架，释放 ${from}；鉴定结论保留，待重新上柜`,
                  kind: "back",
                }),
              ],
            }
          : x,
      );
      return { ...state, specimens };
    }

    case "RESET":
      return freshState();

    default:
      return state;
  }
}

export function freshState(): AppState {
  return { specimens: seedSpecimens(), batches: [] };
}

function loadState(): AppState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return freshState();
    const parsed = JSON.parse(raw) as AppState;
    if (!Array.isArray(parsed.specimens)) return freshState();
    return { specimens: parsed.specimens, batches: Array.isArray(parsed.batches) ? parsed.batches : [] };
  } catch {
    return freshState();
  }
}

interface Store {
  state: AppState;
  dispatch: React.Dispatch<Action>;
}

const StoreContext = createContext<Store | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, loadState);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // 存储空间不足等情况静默处理，内存中的操作不受影响
    }
  }, [state]);

  return <StoreContext.Provider value={{ state, dispatch }}>{children}</StoreContext.Provider>;
}

export function useStore(): Store {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStore must be used within StoreProvider");
  return ctx;
}

export { STORAGE_KEY };
