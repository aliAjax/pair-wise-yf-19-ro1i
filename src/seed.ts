import type { AppState, HistoryEvent, Specimen } from "./types";

const now = () => new Date().toISOString().slice(0, 16);

function history(type: HistoryEvent["type"], text: string, daysAgo = 0): HistoryEvent {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return { time: d.toISOString().slice(0, 16), type, text };
}

const layers: AppState["layers"] = [
  { id: "A-1", cabinet: "A柜", floor: "第1层", capacity: 4, speciesCodes: ["ACER-PA"] },
  { id: "A-2", cabinet: "A柜", floor: "第2层", capacity: 3, speciesCodes: ["ACER-DA"] },
  { id: "B-1", cabinet: "B柜", floor: "第1层", capacity: 2, speciesCodes: ["POFR-FR"] },
  { id: "B-2", cabinet: "B柜", floor: "第2层", capacity: 5, speciesCodes: ["SOHU-HU"] },
  { id: "C-1", cabinet: "C柜", floor: "第1层", capacity: 4, speciesCodes: ["ILEX-LA"] },
  { id: "C-2", cabinet: "C柜", floor: "第2层", capacity: 3, speciesCodes: [] },
];

interface SeedSpec {
  id: string;
  code: string;
  name: string;
  collector: string;
  altitude: number;
  locality: string;
  habitat: string;
  days: number;
}

const pending: SeedSpec[] = [
  // 色木槭 ACER-PA：采集人不同 + 海拔差 >300m，整组都要复核依据
  { id: "HX-240615-01", code: "ACER-PA", name: "色木槭", collector: "李维山", altitude: 1120, locality: "天目山·西坡沟谷", habitat: "落叶阔叶林下，腐殖土", days: 6 },
  { id: "HX-240615-02", code: "ACER-PA", name: "色木槭", collector: "李维山", altitude: 1180, locality: "天目山·西坡沟谷", habitat: "林缘，与栎类混生", days: 6 },
  { id: "HX-240615-03", code: "ACER-PA", name: "色木槭", collector: "周文", altitude: 1560, locality: "天目山·仙人顶下", habitat: "山顶矮曲林边缘", days: 5 },
  { id: "HX-240615-04", code: "ACER-PA", name: "色木槭", collector: "周文", altitude: 1510, locality: "天目山·仙人顶下", habitat: "云雾带阔叶灌丛", days: 5 },
  // 元宝槭 ACER-DA：同采集人、海拔差小，无需说明
  { id: "HX-240615-11", code: "ACER-DA", name: "元宝槭", collector: "陈予安", altitude: 720, locality: "百花山·南坡", habitat: "向阳山坡，黄壤", days: 4 },
  { id: "HX-240615-12", code: "ACER-DA", name: "元宝槭", collector: "陈予安", altitude: 760, locality: "百花山·南坡", habitat: "路旁疏林", days: 4 },
  { id: "HX-240615-13", code: "ACER-DA", name: "元宝槭", collector: "陈予安", altitude: 810, locality: "百花山·南坡台地", habitat: "灌草丛边", days: 4 },
  // 水杉 POFR-FR：B-1 层容量仅 2，演示满位暂停（已上柜 1 份，再迁 3 份会有 2 份留下）
  { id: "HX-240615-21", code: "POFR-FR", name: "水杉", collector: "秦海", altitude: 980, locality: "利川·谋道溪", habitat: "沟谷水旁，人工管护林", days: 3 },
  { id: "HX-240615-22", code: "POFR-FR", name: "水杉", collector: "秦海", altitude: 1040, locality: "利川·谋道溪", habitat: "溪畔阴湿处", days: 3 },
  { id: "HX-240615-23", code: "POFR-FR", name: "水杉", collector: "方鹂", altitude: 1100, locality: "利川·小河镇", habitat: "村旁行道古树", days: 2 },
  // 湖北紫荆 SOHU-HU：其中高海拔份海拔差>300m 且采集人不同
  { id: "HX-240615-31", code: "SOHU-HU", name: "湖北紫荆", collector: "秦海", altitude: 820, locality: "神农架·木鱼镇", habitat: "山谷阔叶林缘", days: 2 },
  { id: "HX-240615-32", code: "SOHU-HU", name: "湖北紫荆", collector: "秦海", altitude: 880, locality: "神农架·木鱼镇", habitat: "溪边石缝旁", days: 2 },
  { id: "HX-240615-33", code: "SOHU-HU", name: "湖北紫荆", collector: "高岩", altitude: 1420, locality: "神农架·板壁岩", habitat: "亚高山针叶林缘", days: 1 },
  // 冬青 ILEX-LA：完全同质批次，无需说明
  { id: "HX-240615-41", code: "ILEX-LA", name: "枸骨", collector: "沈绿", altitude: 460, locality: "庐山·花径", habitat: "常绿阔叶林下", days: 1 },
  { id: "HX-240615-42", code: "ILEX-LA", name: "枸骨", collector: "沈绿", altitude: 480, locality: "庐山·花径", habitat: "林缘灌丛", days: 1 },
];

let pendingNo = 0;
function pendingPosition() {
  pendingNo += 1;
  return `暂存柜 Z-${String(pendingNo).padStart(2, "0")}`;
}

export function createSeedState(): AppState {
  const specimens: Specimen[] = pending.map((s) => ({
    id: s.id,
    code: s.code,
    speciesName: s.name,
    collector: s.collector,
    altitude: s.altitude,
    locality: s.locality,
    habitat: s.habitat,
    status: "pending" as const,
    batchId: null,
    layerId: null,
    position: pendingPosition(),
    identifier: null,
    reviewDate: null,
    reviewNote: null,
    excludeHint: null,
    history: [history("create", "录入待鉴定队列，置于暂存柜", s.days)],
  }));

  // 已复核上柜的水杉一份，占掉 B-1 层一个位
  specimens.push({
    id: "HX-240610-20",
    code: "POFR-FR",
    speciesName: "水杉",
    collector: "秦海",
    altitude: 990,
    locality: "利川·谋道溪",
    habitat: "沟谷水旁",
    status: "migrated",
    batchId: null,
    layerId: "B-1",
    position: "B柜 第1层 01位",
    identifier: "罗鉴定",
    reviewDate: new Date(Date.now() - 4 * 86400000).toISOString().slice(0, 10),
    reviewNote: "同批同质，随批次复核",
    excludeHint: null,
    history: [
      history("create", "录入待鉴定队列，置于暂存柜", 8),
      history("review", "罗鉴定 复核通过（鉴定日期 2026-09-19）", 4),
      history("move", "迁入 B柜 第1层 01位（水杉指定层 B-1）", 4),
    ],
  });

  return {
    specimens,
    batches: [],
    layers,
    identifier: "罗鉴定",
  };
}
