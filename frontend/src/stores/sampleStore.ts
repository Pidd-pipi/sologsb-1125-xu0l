import { create } from 'zustand';
import { db, makeId, seedIfEmpty } from '../db';
import type { AnalysisRecord } from '../types/analysis';
import type { FindRecord } from '../types/find';
import type { MeteoriteSample } from '../types/sample';
import type { ThinSection } from '../types/section';
import type { PreparationMethod } from '../types/section';
import {
  PREPARATION_CAPACITY,
  isActiveSchedule,
  type PreparationSchedule,
} from '../types/schedule';
import {
  ScheduleConflictError,
  ScheduleRejectedError,
} from '../utils/schedule';

/** 新建排程入参 */
export interface CreateScheduleInput {
  sampleId: string;
  method: PreparationMethod;
  scheduledDate: string;
}

/** 新建排程返回：scheduled 已排期 / queued 排队中 */
export interface CreateScheduleResult {
  status: 'scheduled' | 'queued';
  id: string;
}

/** 完成制样时登记的切片信息 */
export type CompleteSectionInput = Omit<ThinSection, 'id' | 'sampleId' | 'scheduleId' | 'createdAt'>;

export interface SampleState {
  samples: MeteoriteSample[];
  finds: FindRecord[];
  sections: ThinSection[];
  analysis: AnalysisRecord[];
  schedules: PreparationSchedule[];
  loading: boolean;
  loaded: boolean;
  loadAll: () => Promise<void>;
  addSample: (input: Omit<MeteoriteSample, 'id' | 'createdAt' | 'updatedAt'>) => Promise<string>;
  updateSample: (id: string, patch: Partial<MeteoriteSample>) => Promise<void>;
  removeSample: (id: string) => Promise<void>;
  addFind: (input: Omit<FindRecord, 'id' | 'createdAt'>) => Promise<string>;
  addSection: (input: Omit<ThinSection, 'id' | 'createdAt'>) => Promise<string>;
  updateSection: (id: string, patch: Partial<ThinSection>) => Promise<void>;
  addAnalysis: (input: Omit<AnalysisRecord, 'id' | 'createdAt'>) => Promise<string>;
  createSchedule: (
    input: CreateScheduleInput,
    observed: { occupied: number },
  ) => Promise<CreateScheduleResult>;
  cancelSchedule: (id: string) => Promise<void>;
  failSchedule: (id: string, reason?: string) => Promise<void>;
  completeSchedule: (id: string, section: CompleteSectionInput) => Promise<string>;
  nextSampleSeq: () => number;
}

/**
 * 事务内把排队中最早的任务前移补位（取消 / 失败后调用）。
 * 返回被提升的排程记录（已更新状态）。
 */
async function promoteQueued(
  method: PreparationMethod,
  date: string,
): Promise<PreparationSchedule[]> {
  const all = await db.schedules
    .where('[method+scheduledDate]')
    .equals([method, date])
    .toArray();
  const scheduled = all.filter((s) => s.status === 'scheduled');
  const queued = all
    .filter((s) => s.status === 'queued')
    .sort((a, b) => a.createdAt - b.createdAt);
  const capacity = PREPARATION_CAPACITY[method];
  const free = capacity - scheduled.length;
  const promoted: PreparationSchedule[] = [];
  for (let i = 0; i < free && i < queued.length; i++) {
    const q = queued[i];
    const now = Date.now();
    await db.schedules.update(q.id, { status: 'scheduled', updatedAt: now, version: q.version + 1 });
    promoted.push({ ...q, status: 'scheduled', updatedAt: now, version: q.version + 1 });
  }
  return promoted;
}

export const useSampleStore = create<SampleState>((set, get) => ({
  samples: [],
  finds: [],
  sections: [],
  analysis: [],
  schedules: [],
  loading: false,
  loaded: false,

  loadAll: async () => {
    set({ loading: true });
    await seedIfEmpty();
    const [samples, finds, sections, analysis, schedules] = await Promise.all([
      db.samples.toArray(),
      db.finds.toArray(),
      db.sections.toArray(),
      db.analysis.toArray(),
      db.schedules.toArray(),
    ]);
    samples.sort((a, b) => b.createdAt - a.createdAt);
    finds.sort((a, b) => b.createdAt - a.createdAt);
    sections.sort((a, b) => b.createdAt - a.createdAt);
    analysis.sort((a, b) => b.createdAt - a.createdAt);
    schedules.sort((a, b) => b.createdAt - a.createdAt);
    set({ samples, finds, sections, analysis, schedules, loading: false, loaded: true });
  },

  addSample: async (input) => {
    const now = Date.now();
    const record: MeteoriteSample = { ...input, id: makeId('sample'), createdAt: now, updatedAt: now };
    await db.samples.add(record);
    set({ samples: [record, ...get().samples] });
    return record.id;
  },

  updateSample: async (id, patch) => {
    const updatedAt = Date.now();
    await db.samples.update(id, { ...patch, updatedAt });
    set({
      samples: get().samples.map((s) => (s.id === id ? { ...s, ...patch, updatedAt } : s)),
    });
  },

  removeSample: async (id) => {
    await db.transaction(
      'rw',
      db.samples,
      db.finds,
      db.sections,
      db.analysis,
      db.schedules,
      async () => {
        await db.samples.delete(id);
        await db.finds.where('sampleId').equals(id).delete();
        await db.sections.where('sampleId').equals(id).delete();
        await db.analysis.where('sampleId').equals(id).delete();
        await db.schedules.where('sampleId').equals(id).delete();
      },
    );
    set({
      samples: get().samples.filter((s) => s.id !== id),
      finds: get().finds.filter((f) => f.sampleId !== id),
      sections: get().sections.filter((s) => s.sampleId !== id),
      analysis: get().analysis.filter((a) => a.sampleId !== id),
      schedules: get().schedules.filter((s) => s.sampleId !== id),
    });
  },

  addFind: async (input) => {
    const record: FindRecord = { ...input, id: makeId('find'), createdAt: Date.now() };
    await db.finds.add(record);
    set({ finds: [record, ...get().finds] });
    return record.id;
  },

  addSection: async (input) => {
    // 直接登记的旧切片没有排程 → 标记「待排」
    const record: ThinSection = { ...input, id: makeId('section'), createdAt: Date.now() };
    await db.sections.add(record);
    set({ sections: [record, ...get().sections] });
    return record.id;
  },

  updateSection: async (id, patch) => {
    await db.sections.update(id, patch);
    set({ sections: get().sections.map((s) => (s.id === id ? { ...s, ...patch } : s)) });
  },

  addAnalysis: async (input) => {
    // 未完成制样前，检测记录不能绑定切片
    if (input.target === 'section') {
      if (!input.sectionId) {
        throw new ScheduleRejectedError('检测对象为切片时必须选择一张切片');
      }
      const section = get().sections.find((s) => s.id === input.sectionId);
      if (!section) {
        throw new ScheduleRejectedError('所选切片不存在');
      }
      if (!section.scheduleId) {
        throw new ScheduleRejectedError('该切片尚未排程（待排），完成制样后才能绑定检测记录');
      }
      const schedule = get().schedules.find((s) => s.id === section.scheduleId);
      if (!schedule || schedule.status !== 'completed') {
        throw new ScheduleRejectedError('该切片制样尚未完成，不能绑定检测记录');
      }
    }
    const record: AnalysisRecord = { ...input, id: makeId('analysis'), createdAt: Date.now() };
    await db.analysis.add(record);
    set({ analysis: [record, ...get().analysis] });
    return record.id;
  },

  createSchedule: async (input, observed) => {
    const { sampleId, method, scheduledDate } = input;
    const capacity = PREPARATION_CAPACITY[method];

    const result = await db.transaction('rw', db.samples, db.schedules, async () => {
      const sample = await db.samples.get(sampleId);
      if (!sample) throw new ScheduleRejectedError('样本不存在');
      if (sample.storage === 'loan-out') {
        throw new ScheduleRejectedError('外借样本不接受制样排程，请先归还或调整存放位置');
      }

      // 同一样本当天不能重复排（跨制样方式）
      const sampleSchedules = await db.schedules.where('sampleId').equals(sampleId).toArray();
      const duplicate = sampleSchedules.some(
        (s) => s.scheduledDate === scheduledDate && isActiveSchedule(s),
      );
      if (duplicate) {
        throw new ScheduleRejectedError('同一样本当天已有有效排程，不能重复排期');
      }

      // 事务内读取名额占用：与其他页签的写操作串行，保证只剩一个名额时只有一方成功
      const slotSchedules = await db.schedules
        .where('[method+scheduledDate]')
        .equals([method, scheduledDate])
        .toArray();
      const occupied = slotSchedules.filter((s) => s.status === 'scheduled').length;

      let status: 'scheduled' | 'queued';
      if (occupied < capacity) {
        status = 'scheduled';
      } else {
        // 已满：若提交时观察到名额未满，说明被其他页签抢占 → 抛冲突，调用方保留草稿
        if (observed.occupied < capacity) {
          throw new ScheduleConflictError(
            '该制样名额已被其他页签抢占，本页草稿已保留，请调整日期或制样方式后重试',
          );
        }
        status = 'queued';
      }

      const now = Date.now();
      const record: PreparationSchedule = {
        id: makeId('schedule'),
        sampleId,
        method,
        scheduledDate,
        status,
        createdAt: now,
        updatedAt: now,
        version: 1,
      };
      await db.schedules.add(record);
      return { status, id: record.id, record };
    });

    set({ schedules: [result.record, ...get().schedules] });
    return { status: result.status, id: result.id };
  },

  cancelSchedule: async (id) => {
    const schedule = get().schedules.find((s) => s.id === id);
    if (!schedule || (schedule.status !== 'scheduled' && schedule.status !== 'queued')) return;
    const now = Date.now();
    const promoted = await db.transaction('rw', db.schedules, async () => {
      await db.schedules.update(id, { status: 'cancelled', updatedAt: now });
      return await promoteQueued(schedule.method, schedule.scheduledDate);
    });
    set({
      schedules: get().schedules.map((s) => {
        if (s.id === id) return { ...s, status: 'cancelled', updatedAt: now };
        const p = promoted.find((x) => x.id === s.id);
        return p ? { ...s, status: 'scheduled', updatedAt: p.updatedAt, version: p.version } : s;
      }),
    });
  },

  failSchedule: async (id, reason = '制样失败') => {
    const schedule = get().schedules.find((s) => s.id === id);
    if (!schedule || (schedule.status !== 'scheduled' && schedule.status !== 'queued')) return;
    const now = Date.now();
    const promoted = await db.transaction('rw', db.schedules, async () => {
      await db.schedules.update(id, { status: 'failed', reason, updatedAt: now });
      return await promoteQueued(schedule.method, schedule.scheduledDate);
    });
    set({
      schedules: get().schedules.map((s) => {
        if (s.id === id) return { ...s, status: 'failed', reason, updatedAt: now };
        const p = promoted.find((x) => x.id === s.id);
        return p ? { ...s, status: 'scheduled', updatedAt: p.updatedAt, version: p.version } : s;
      }),
    });
  },

  completeSchedule: async (id, sectionInput) => {
    const schedule = get().schedules.find((s) => s.id === id);
    if (!schedule) throw new ScheduleRejectedError('排程不存在');
    if (schedule.status !== 'scheduled') {
      throw new ScheduleRejectedError('只有「已排期」的任务可以完成制样并登记切片');
    }
    const now = Date.now();
    const sectionId = makeId('section');
    const section: ThinSection = {
      ...sectionInput,
      id: sectionId,
      sampleId: schedule.sampleId,
      scheduleId: id,
      createdAt: now,
    };
    await db.transaction('rw', db.schedules, db.sections, async () => {
      await db.sections.add(section);
      await db.schedules.update(id, { status: 'completed', sectionId, updatedAt: now });
    });
    set({
      sections: [section, ...get().sections],
      schedules: get().schedules.map((s) =>
        s.id === id ? { ...s, status: 'completed', sectionId, updatedAt: now } : s,
      ),
    });
    return sectionId;
  },

  nextSampleSeq: () => {
    const year = new Date().getFullYear();
    const prefix = `MET-${year}-`;
    const used = get()
      .samples.map((s) => s.sampleNo)
      .filter((no) => no.startsWith(prefix))
      .map((no) => Number(no.slice(prefix.length)))
      .filter((n) => Number.isFinite(n));
    const max = used.length ? Math.max(...used) : 0;
    return max + 1;
  },
}));

export { ScheduleConflictError, ScheduleRejectedError };
