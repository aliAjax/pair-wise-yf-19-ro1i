import type { Batch, LayerDef, Pos, Specimen, SpeciesDef } from "./types";

// 物种代码 -> 指定柜层
export const SPECIES: SpeciesDef[] = [
  { code: "AC001", name: "色木槭", latin: "Acer pictum", layer: "A-01" },
  { code: "AC002", name: "青榨槭", latin: "Acer davidii", layer: "A-01" },
  { code: "PT001", name: "蕨菜", latin: "Pteridium revolutum", layer: "A-02" },
  { code: "TG001", name: "蒲公英", latin: "Taraxacum mongolicum", layer: "B-01" },
  { code: "HP001", name: "金丝桃", latin: "Hypericum monogynum", layer: "B-02" },
  { code: "CR001", name: "露珠草", latin: "Circaea cordata", layer: "C-01" },
];

export const LAYERS: LayerDef[] = [
  { cabinet: "A", layer: "01", capacity: 4, title: "槭树科层" },
  { cabinet: "A", layer: "02", capacity: 5, title: "蕨类层" },
  { cabinet: "A", layer: "03", capacity: 6, title: "杂类草本层" },
  { cabinet: "B", layer: "01", capacity: 5, title: "菊科层" },
  { cabinet: "B", layer: "02", capacity: 4, title: "藤黄科层" },
  { cabinet: "C", layer: "01", capacity: 6, title: "柳叶菜科层" },
];

export const layerKey = (cabinet: string, layer: string) => `${cabinet}-${layer}`;
export const layerKeyOf = (p: Pos) => layerKey(p.cabinet, p.layer);

export function speciesOf(code: string): SpeciesDef {
  return (
    SPECIES.find((s) => s.code === code) ?? {
      code,
      name: code,
      latin: "未配置物种",
      layer: "",
    }
  );
}

export function layerOf(key: string): LayerDef | undefined {
  const [cabinet, layer] = key.split("-");
  return LAYERS.find((l) => l.cabinet === cabinet && l.layer === layer);
}

export const tempPos = (id: string): Pos => ({ cabinet: "T", layer: "暂存", slot: id });

export function posLabel(p: Pos): string {
  return p.cabinet === "T" ? `暂存·${p.slot}` : `${p.cabinet}-${p.layer}-${p.slot}`;
}

export const slotLabel = (n: number) => String(n).padStart(2, "0");

// 各层当前占用：layerKey -> (位号 -> 标本采集号)
export function occupiedMap(specimens: Specimen[]): Map<string, Map<string, string>> {
  const map = new Map<string, Map<string, string>>();
  for (const s of specimens) {
    if (s.status !== "已入库" || s.pos.cabinet === "T") continue;
    const key = layerKeyOf(s.pos);
    if (!map.has(key)) map.set(key, new Map());
    map.get(key)!.set(s.pos.slot, s.id);
  }
  return map;
}

export function freeSlots(key: string, occupied: Map<string, Map<string, string>>): string[] {
  const def = layerOf(key);
  if (!def) return [];
  const used = occupied.get(key);
  const free: string[] = [];
  for (let n = 1; n <= def.capacity; n++) {
    const label = slotLabel(n);
    if (!used?.has(label)) free.push(label);
  }
  return free;
}

export interface BatchRule {
  collectors: string[];
  elevMin: number | null;
  elevMax: number | null;
  elevSpan: number | null;
  collectorDiff: boolean; // 组内采集人不同
  elevDiff: boolean; // 海拔差超过 300 米
  needBasis: boolean; // 必须在批次里写明复核依据
}

// 组批复核规则：采集人不同 或 海拔差 > 300m 时需复核依据
export function batchRule(members: Specimen[]): BatchRule {
  const collectors = Array.from(new Set(members.map((m) => m.collector).filter(Boolean)));
  const elevs = members.map((m) => m.elevation).filter((v): v is number => v != null);
  const elevMin = elevs.length ? Math.min(...elevs) : null;
  const elevMax = elevs.length ? Math.max(...elevs) : null;
  const elevSpan = elevMin != null && elevMax != null ? elevMax - elevMin : null;
  const collectorDiff = collectors.length > 1;
  const elevDiff = elevSpan != null && elevSpan > 300;
  return {
    collectors,
    elevMin,
    elevMax,
    elevSpan,
    collectorDiff,
    elevDiff,
    needBasis: collectorDiff || elevDiff,
  };
}

export function ruleOfBatch(batch: Batch, specimens: Specimen[]): BatchRule {
  const map = new Map(specimens.map((s) => [s.id, s]));
  return batchRule(batch.ids.map((id) => map.get(id)!).filter(Boolean));
}

// 批量迁柜预演：按目标层逐份占位，满位则该份暂停（结论保留，留在原柜）
export interface MigrationPlanItem {
  id: string;
  layer: string;
  slot?: string;
  move: boolean;
}

export function planMigration(specimens: Specimen[]): MigrationPlanItem[] {
  const used = occupiedMap(specimens);
  const ready = specimens
    .filter((s) => s.status === "已鉴定")
    .sort((a, b) => (a.reviewDate ?? "").localeCompare(b.reviewDate ?? "") || a.id.localeCompare(b.id));
  const result: MigrationPlanItem[] = [];
  for (const s of ready) {
    const layer = speciesOf(s.speciesCode).layer;
    const free = layer ? freeSlots(layer, used)[0] : undefined;
    if (layer && free) {
      used.get(layer)?.set(free, s.id) ?? used.set(layer, new Map([[free, s.id]]));
      result.push({ id: s.id, layer, slot: free, move: true });
    } else {
      result.push({ id: s.id, layer, move: false });
    }
  }
  return result;
}

export const today = () => new Date().toISOString().slice(0, 10);

export function fmtDateTime(iso: string): string {
  return iso.replace("T", " ").slice(0, 16);
}
