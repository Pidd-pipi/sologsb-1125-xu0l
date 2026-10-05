// 集成测试（不入包，仅本地验证）：node --import tsx scripts/scheduler.test.ts
import 'fake-indexeddb/auto';
import { db } from '../src/db/index.ts';
import {
  assertAnalysisBinding,
  AnalysisBindingError,
  cancelSchedule,
  completeSchedule,
  failSchedule,
  submitSectionPreparation,
} from '../src/services/scheduler.ts';
import type { MeteoriteSample } from '../src/types/sample.ts';
import type { ScheduleSubmitInput } from '../src/types/schedule.ts';

let passed = 0;
let failed = 0;
function assert(cond: unknown, msg: string) {
  if (cond) {
    passed += 1;
    console.log(`  ✓ ${msg}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${msg}`);
  }
}
async function expectThrow(fn: () => Promise<unknown>, msg: string) {
  try {
    await fn();
    assert(false, `${msg}（期望抛错但成功了）`);
  } catch (e) {
    assert(e instanceof AnalysisBindingError, msg);
  }
}

const minerals = { olivine: 40, pyroxene: 30, feldspar: 15, metal: 15 };
const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);

function input(sampleId: string, date = tomorrow, overrides: Partial<ScheduleSubmitInput> = {}): ScheduleSubmitInput {
  return {
    sampleId,
    preparation: 'resin',
    date,
    sectionNo: `TS-T-${Math.random().toString(36).slice(2, 7)}`,
    thickness: 30,
    minerals,
    micrographs: [],
    quality: 'unrated',
    ...overrides,
  };
}

async function makeSample(id: string, storage: MeteoriteSample['storage'] = 'cabinet-a') {
  const now = Date.now();
  await db.samples.add({
    id,
    sampleNo: id.toUpperCase(),
    totalWeight: 100,
    category: 'chondrite',
    chemicalGroup: 'H',
    weathering: 'W0',
    fallOrFind: 'find',
    storage,
    createdAt: now,
    updatedAt: now,
  });
}

async function reset() {
  await db.delete();
  await db.open();
}

// ---- 1. 容量：树脂 3 个，第 4 个排队 ----
await reset();
console.log('容量占用与排队：');
await makeSample('s1');
await makeSample('s2');
await makeSample('s3');
await makeSample('s4');
const r1 = await submitSectionPreparation(input('s1'));
const r2 = await submitSectionPreparation(input('s2'));
const r3 = await submitSectionPreparation(input('s3'));
const r4 = await submitSectionPreparation(input('s4'));
assert(r1.outcome === 'scheduled', '第 1 个占名额');
assert(r2.outcome === 'scheduled', '第 2 个占名额');
assert(r3.outcome === 'scheduled', '第 3 个占名额（树脂上限 3）');
assert(r4.outcome === 'queued' && r4.schedule.queuePosition === 1, '第 4 个排队第 1 位');

// ---- 2. 同一样本当天不能重复排 ----
console.log('同日重复：');
const dup = await submitSectionPreparation(input('s1', tomorrow, { preparation: 'epoxy' }));
assert(dup.outcome === 'rejected' && dup.reason === 'duplicate-day', '同一样本当天换方式也拒绝');

// ---- 3. 外借直接拒绝 ----
console.log('外借拒绝：');
await makeSample('s5', 'loan-out');
const loan = await submitSectionPreparation(input('s5'));
assert(loan.outcome === 'rejected' && loan.reason === 'sample-loan-out', '外借样本直接拒绝');
assert((await db.schedules.where('sampleId').equals('s5').count()) === 0, '外借不产生排程');
assert((await db.sections.where('sampleId').equals('s5').count()) === 0, '外借不产生切片');

// ---- 4. 取消已排定 → 排队前移 ----
console.log('取消后前移：');
if (r1.outcome === 'scheduled') await cancelSchedule(r1.schedule.id);
const s4sch = await db.schedules.get(r4.outcome !== 'rejected' ? r4.schedule.id : '');
assert(s4sch?.status === 'scheduled', '取消后排队第 1 位自动提升为已排定');
assert(s4sch?.queuePosition === 0, '提升后排队序号清零');
const s4sec = await db.sections.get(s4sch!.sectionId);
assert(s4sec?.prepStatus === 'in-progress', '切片进度同步为制样中');

// ---- 5. 失败释放名额并前移 ----
console.log('失败释放：');
await reset();
for (const id of ['f1', 'f2', 'f3', 'f4', 'f5']) await makeSample(id);
await submitSectionPreparation(input('f1'));
const fail = await submitSectionPreparation(input('f2'));
await submitSectionPreparation(input('f3'));
assert(fail.outcome === 'scheduled', '前 3 个占名额');
const q4 = await submitSectionPreparation(input('f4'));
assert(q4.outcome === 'queued', 'f4 排队等待');
if (fail.outcome === 'scheduled') await failSchedule(fail.schedule.id);
const f4sch = await db.schedules.get(q4.outcome !== 'rejected' ? q4.schedule.id : '');
assert(f4sch?.status === 'scheduled', '制样失败后排队任务前移');
const failRec = await db.schedules.get(fail.outcome === 'scheduled' ? fail.schedule.id : '');
assert(failRec?.status === 'failed', '原排程状态为失败');

// ---- 6. 完成制样后才能绑定检测 ----
console.log('检测绑定：');
const dayAfter = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
await makeSample('f6');
const p6 = await submitSectionPreparation(input('f6', dayAfter));
assert(p6.outcome === 'scheduled', 'f6 排定');
await expectThrow(
  () => assertAnalysisBinding({ sampleId: 'f6', sectionId: p6.outcome === 'scheduled' ? p6.section.id : '' }),
  '制样中的切片不能绑定检测',
);
if (p6.outcome === 'scheduled') await completeSchedule(p6.schedule.id);
await assertAnalysisBinding({
  sampleId: 'f6',
  sectionId: p6.outcome === 'scheduled' ? p6.section.id : '',
});
assert(true, '已完成切片允许绑定检测');
await expectThrow(
  () =>
    assertAnalysisBinding({
      sampleId: 'f1',
      sectionId: p6.outcome === 'scheduled' ? p6.section.id : '',
    }),
  '他人切片不能绑定',
);

// ---- 7. 并发抢最后一个名额：两个事务同时提交，只允许一方成功 ----
console.log('并发抢名额：');
await reset();
for (const id of ['a', 'b', 'c', 'd', 'e']) await makeSample(id);
await submitSectionPreparation(input('a'));
await submitSectionPreparation(input('b'));
// 还剩 1 个名额，两笔都声称自己看到了空位（optimisticSlot）
const [race1, race2] = await Promise.all([
  submitSectionPreparation(input('c', tomorrow, { optimisticSlot: true })),
  new Promise<Awaited<ReturnType<typeof submitSectionPreparation>>>((resolve) =>
    setTimeout(
      () => resolve(submitSectionPreparation(input('d', tomorrow, { optimisticSlot: true }))),
      5,
    ),
  ),
]);
assert(
  (race1.outcome === 'scheduled' && race2.outcome === 'rejected' && race2.reason === 'capacity-lost') ||
    (race2.outcome === 'scheduled' && race1.outcome === 'rejected' && race1.reason === 'capacity-lost'),
  `恰好一方成功、另一方 capacity-lost（实际：${race1.outcome} vs ${race2.outcome}）`,
);
// 不带乐观标记的并发：满了就正常排队
const overflow = await submitSectionPreparation(input('e'));
assert(overflow.outcome === 'queued', '非抢名额场景下超额自动排队');
const totalScheduled = await db.schedules
  .where('date')
  .equals(tomorrow)
  .filter((s) => s.status === 'scheduled' || s.status === 'done')
  .count();
assert(totalScheduled === 3, `名额没有超卖（实际占用 ${totalScheduled}/3）`);

// ---- 8. 队列保序：取消已排定后，第 1 位先于第 2 位前移 ----
console.log('队列保序：');
await reset();
for (const id of ['o1', 'o2', 'o3', 'q1', 'q2']) await makeSample(id);
const occ1 = await submitSectionPreparation(input('o1'));
await submitSectionPreparation(input('o2'));
await submitSectionPreparation(input('o3'));
const qq1 = await submitSectionPreparation(input('q1'));
await new Promise((r) => setTimeout(r, 10));
const qq2 = await submitSectionPreparation(input('q2'));
assert((qq1 as any).schedule.queuePosition === 1, 'q1 排队第 1');
assert((qq2 as any).schedule.queuePosition === 2, 'q2 排队第 2');
// 取消一张已排定的，释放名额；q1 前移、q2 补成第 1 位
if (occ1.outcome === 'scheduled') await cancelSchedule(occ1.schedule.id);
const q1after = await db.schedules.get((qq1 as any).schedule.id);
assert(q1after?.status === 'scheduled', 'q1 按送样顺序前移到空位');
const q2after = await db.schedules.get((qq2 as any).schedule.id);
assert(q2after?.status === 'queued' && q2after.queuePosition === 1, 'q2 顺位成为排队第 1');
// 再失败一张已排定（非 q1），q2 也前移
await failSchedule((await db.schedules.where('sampleId').equals('o2').first())!.id);
const q2final = await db.schedules.get((qq2 as any).schedule.id);
assert(q2final?.status === 'scheduled', '再次释放名额后 q2 前移');

console.log(`\n结果：${passed} 通过，${failed} 失败`);
process.exit(failed ? 1 : 0);
