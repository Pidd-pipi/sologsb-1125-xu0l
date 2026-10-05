import { create } from 'zustand';
import { liveQuery } from 'dexie';
import { db, makeId, seedIfEmpty } from '../db';
import type { AnalysisRecord } from '../types/analysis';
import type { FindRecord } from '../types/find';
import type { MeteoriteSample } from '../types/sample';
import type { ThinSection } from '../types/section';
import type {
  PreparationSchedule,
  ScheduleSubmitInput,
} from '../types/schedule';
import {
  assertAnalysisBinding,
  cancelSchedule as cancelScheduleSvc,
  completeSchedule as completeScheduleSvc,
  failSchedule as failScheduleSvc,
  submitSectionPreparation,
  type ScheduleSubmitResult,
} from '../services/scheduler';

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
  /** 送样制样：事务内占名额 / 排队 / 拒绝，返回结果由页面决定如何提示与保留草稿 */
  submitSection: (input: ScheduleSubmitInput) => Promise<ScheduleSubmitResult>;
  updateSection: (id: string, patch: Partial<ThinSection>) => Promise<void>;
  cancelSchedule: (id: string) => Promise<void>;
  failSchedule: (id: string) => Promise<void>;
  completeSchedule: (id: string) => Promise<void>;
  addAnalysis: (input: Omit<AnalysisRecord, 'id' | 'createdAt'>) => Promise<string>;
  nextSampleSeq: () => number;
}

const desc = <T extends { createdAt: number }>(list: T[]): T[] =>
  list.sort((a, b) => b.createdAt - a.createdAt);

/** 从 IndexedDB 全量拉取并按时间倒序整理 */
async function fetchAll() {
  const [samples, finds, sections, analysis, schedules] = await Promise.all([
    db.samples.toArray(),
    db.finds.toArray(),
    db.sections.toArray(),
    db.analysis.toArray(),
    db.schedules.toArray(),
  ]);
  desc(samples);
  desc(finds);
  desc(sections);
  desc(analysis);
  schedules.sort((a, b) => b.submittedAt - a.submittedAt);
  return { samples, finds, sections, analysis, schedules };
}

let liveSyncStarted = false;

/**
 * 跨页签实时同步：两个页签抢同一名额时，败者通过 liveQuery 立即看到
 * 最新占用情况，从而把表单保留为「带冲突的草稿」而不是覆盖胜者结果。
 */
function startLiveSync(apply: (patch: Partial<SampleState>) => void) {
  if (liveSyncStarted) return;
  liveSyncStarted = true;
  liveQuery(fetchAll).subscribe({
    next: (data) => apply(data),
    error: () => {
      /* 后台同步失败不阻塞页面操作 */
    },
  });
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
    const data = await fetchAll();
    set({ ...data, loading: false, loaded: true });
    startLiveSync((patch) => set(patch));
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
        await db.schedules.where('sampleId').equals(id).delete();
        await db.sections.where('sampleId').equals(id).delete();
        await db.analysis.where('sampleId').equals(id).delete();
      },
    );
    set({
      samples: get().samples.filter((s) => s.id !== id),
      finds: get().finds.filter((f) => f.sampleId !== id),
      sections: get().sections.filter((s) => s.sampleId !== id),
      analysis: get().analysis.filter((a) => a.sampleId !== id),
      schedules: get().schedules.filter((sc) => sc.sampleId !== id),
    });
  },

  addFind: async (input) => {
    const record: FindRecord = { ...input, id: makeId('find'), createdAt: Date.now() };
    await db.finds.add(record);
    set({ finds: [record, ...get().finds] });
    return record.id;
  },

  submitSection: async (input) => {
    // 名额校验 / 排队 / 重算都在服务层的单个事务内完成
    const result = await submitSectionPreparation(input);
    if (result.outcome !== 'rejected') {
      const data = await fetchAll();
      set(data);
    }
    return result;
  },

  updateSection: async (id, patch) => {
    await db.sections.update(id, patch);
    set({ sections: get().sections.map((s) => (s.id === id ? { ...s, ...patch } : s)) });
  },

  cancelSchedule: async (id) => {
    await cancelScheduleSvc(id);
    set(await fetchAll());
  },

  failSchedule: async (id) => {
    await failScheduleSvc(id);
    set(await fetchAll());
  },

  completeSchedule: async (id) => {
    await completeScheduleSvc(id);
    set(await fetchAll());
  },

  addAnalysis: async (input) => {
    return db.transaction('rw', db.analysis, db.sections, async () => {
      // 未完成制样前，检测记录不能绑定切片
      await assertAnalysisBinding({
        sampleId: input.sampleId,
        sectionId: input.target === 'section' ? input.sectionId : undefined,
      });
      const record: AnalysisRecord = { ...input, id: makeId('analysis'), createdAt: Date.now() };
      await db.analysis.add(record);
      set({ analysis: [record, ...get().analysis] });
      return record.id;
    });
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
