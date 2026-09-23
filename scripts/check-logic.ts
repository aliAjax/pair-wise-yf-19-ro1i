import assert from "node:assert";
import { createSeedState } from "../src/seed.ts";
import {
  addSpecimen,
  computeFlags,
  createBatch,
  dissolveBatch,
  freeCount,
  migrateOne,
  passReview,
  targetLayerOf,
  vacateSlot,
} from "../src/store.ts";

let s = createSeedState();
const get = (id: string) => s.specimens.find((x) => x.id === id)!;

// 1) 差异标记：ACER-PA 组（采集人不同 + 海拔差>300）全部命中
let group = s.specimens.filter((x) => x.code === "ACER-PA");
let flags = computeFlags(group);
assert.ok(group.every((x) => flags.get(x.id)!.reasons.length > 0), "ACER-PA 每份都应有差异标记");

// ILEX-LA 同质组：无标记
group = s.specimens.filter((x) => x.code === "ILEX-LA");
flags = computeFlags(group);
assert.ok(group.every((x) => flags.get(x.id)!.reasons.length === 0), "ILEX-LA 同质组免说明");

// POFR-FR：方鹂那份采集人不同 -> 标记；其余两人差 60m 不触发海拔
group = s.specimens.filter((x) => x.code === "POFR-FR" && x.status === "pending");
flags = computeFlags(group);
assert.ok(flags.get("HX-240615-23")!.reasons.length > 0, "方鹂那份应被标记");
assert.ok(flags.get("HX-240615-21")!.reasons.length > 0, "秦海那份因采集人不同也应被标记");

// 2) 组批后状态变化
s = createBatch(
  s,
  "ILEX-LA",
  s.specimens.filter((x) => x.code === "ILEX-LA").map((x) => x.id),
);
assert.equal(get("HX-240615-41").status, "batching");
const batch = s.batches[0];
assert.equal(batch.specimenIds.length, 2);

// 3) 同质批次复核通过 -> 两份都迁入 C-1（容量4）
s = passReview(s, batch.id, "测试员", "2026-09-23", {});
assert.equal(get("HX-240615-41").status, "migrated");
assert.equal(get("HX-240615-41").identifier, "测试员");
assert.equal(get("HX-240615-41").reviewDate, "2026-09-23");
assert.equal(get("HX-240615-41").position, "C柜 第1层 01位");

// 4) 解散批次：批内退回待鉴定
s = createBatch(s, "ACER-DA", s.specimens.filter((x) => x.code === "ACER-DA").map((x) => x.id));
s = dissolveBatch(s, s.batches.find((b) => b.status === "active")!.id);
assert.ok(s.specimens.filter((x) => x.code === "ACER-DA").every((x) => x.status === "pending"));

// 5) ACER-PA 复核：故意只给 2 份写依据，其余应被排除（不入结论，仍待鉴定）
s = createBatch(s, "ACER-PA", s.specimens.filter((x) => x.code === "ACER-PA").map((x) => x.id));
const ab = s.batches.find((b) => b.status === "active")!;
const notes = { "HX-240615-01": "叶形核对一致", "HX-240615-02": "果序特征一致" };
s = passReview(s, ab.id, "测试员", "2026-09-23", notes);
assert.equal(get("HX-240615-01").status, "migrated");
assert.equal(get("HX-240615-03").status, "pending", "缺说明不入结论");
assert.ok(get("HX-240615-03").excludeHint);
assert.equal(s.batches.find((b) => b.id === ab.id)!.excludedCount, 2);

// 6) 水杉：B-1 容量2 已占1（种子）+ 三份待复核；两份写齐依据
s = createBatch(s, "POFR-FR", s.specimens.filter((x) => x.code === "POFR-FR" && x.status === "pending").map((x) => x.id));
const pb = s.batches.find((b) => b.status === "active")!;
const pnotes: Record<string, string> = {};
pb.specimenIds.forEach((id) => (pnotes[id] = "球果鳞盾形态核对一致"));
s = passReview(s, pb.id, "测试员", "2026-09-23", pnotes);
const pofr = pb.specimenIds.map(get);
const moved = pofr.filter((x) => x.status === "migrated");
const held = pofr.filter((x) => x.status === "reviewed");
assert.equal(moved.length, 1, "B-1 仅剩 1 空位，仅 1 份迁入");
assert.equal(held.length, 2, "2 份满位暂留");
assert.equal(moved[0].position, "B柜 第1层 02位");
assert.ok(held.every((x) => x.identifier === "测试员"), "暂留标本鉴定结论保留");
assert.ok(held[0].position.startsWith("暂存柜"), "暂留标本留在原柜");
assert.equal(freeCount(targetLayerOf("POFR-FR", s.layers)!, s.specimens), 0);

// 7) 腾空一个位 -> 可逐份重选；位号复用 02
const occ = s.specimens.find((x) => x.position === "B柜 第1层 02位" && x.status === "migrated")!;
s = vacateSlot(s, occ.id);
assert.equal(occ ? get(occ.id).status : "reviewed", "reviewed");
const waiter = held[0];
s = migrateOne(s, waiter.id);
assert.equal(get(waiter.id).status, "migrated");
assert.equal(get(waiter.id).position, "B柜 第1层 02位", "复用腾空位号");
// 另一份仍满位暂留，再次尝试迁移只会留下 hold 记录
const stillHeld = held[1];
s = migrateOne(s, stillHeld.id);
assert.equal(get(stillHeld.id).status, "reviewed");

// 8) 新录入标本进入待鉴定，采集号唯一校验由 UI 层做，这里只验证状态
const before = s.specimens.length;
s = addSpecimen(s, {
  id: "HX-TEST-99",
  code: "NEW-SP",
  speciesName: "测试物种",
  collector: "甲",
  altitude: 100,
  locality: "测试地",
  habitat: "测试生境",
});
assert.equal(s.specimens.length, before + 1);
assert.equal(get("HX-TEST-99").status, "pending");

console.log("全部业务规则断言通过 ✓");
