import Dexie, { type Table } from 'dexie';
import type { MeteoriteSample } from '../types/sample';
import type { FindRecord } from '../types/find';
import type { ThinSection } from '../types/section';
import type { AnalysisRecord } from '../types/analysis';
import type { PreparationSchedule } from '../types/schedule';

/** 库名固定为 gbmeteorite-db */
export const DB_NAME = 'gbmeteorite-db';

/**
 * 版本历史（IndexedDB 升级迁移）：
 *  - v1：建 samples / finds / sections 三张表
 *  - v2：新增 analysis 表，并为 analysis 加 sampleId 索引
 *  - v3：为 samples 补 updatedAt 字段，并按 id 回填旧记录
 *  - v4：新增 schedules 制样排程表；sections 加 scheduleId 索引（旧切片无排程 → 待排）
 */
export class MeteoriteDB extends Dexie {
  samples!: Table<MeteoriteSample, string>;
  finds!: Table<FindRecord, string>;
  sections!: Table<ThinSection, string>;
  analysis!: Table<AnalysisRecord, string>;
  schedules!: Table<PreparationSchedule, string>;

  constructor() {
    super(DB_NAME);

    this.version(1).stores({
      samples: 'id, sampleNo, category, chemicalGroup, totalWeight, createdAt',
      finds: 'id, sampleId, region, createdAt',
      sections: 'id, sectionNo, sampleId, thickness, createdAt',
    });

    this.version(2)
      .stores({
        samples: 'id, sampleNo, category, chemicalGroup, totalWeight, createdAt',
        finds: 'id, sampleId, region, createdAt',
        sections: 'id, sectionNo, sampleId, thickness, createdAt',
        analysis: 'id, sampleId, sectionId, method, testedAt, createdAt',
      })
      .upgrade(async (tx) => {
        // v2：旧记录补齐新表所需字段，避免读取时 undefined
        await tx
          .table<AnalysisRecord, string>('analysis')
          .toCollection()
          .modify((rec) => {
            if (typeof rec.createdAt !== 'number') rec.createdAt = Date.now();
          });
      });

    this.version(3)
      .stores({
        samples:
          'id, sampleNo, category, chemicalGroup, totalWeight, createdAt, updatedAt',
        finds: 'id, sampleId, region, createdAt',
        sections: 'id, sectionNo, sampleId, thickness, createdAt',
        analysis: 'id, sampleId, sectionId, method, testedAt, createdAt',
      })
      .upgrade(async (tx) => {
        // v3：为样本表补 updatedAt，并按 id 回填旧记录
        await tx
          .table<MeteoriteSample, string>('samples')
          .toCollection()
          .modify((sample) => {
            if (typeof sample.updatedAt !== 'number') {
              sample.updatedAt =
                typeof sample.createdAt === 'number' ? sample.createdAt : Date.now();
            }
          });
      });

    this.version(4)
      .stores({
        samples:
          'id, sampleNo, category, chemicalGroup, totalWeight, createdAt, updatedAt',
        finds: 'id, sampleId, region, createdAt',
        sections: 'id, sectionNo, sampleId, thickness, createdAt, scheduleId',
        analysis: 'id, sampleId, sectionId, method, testedAt, createdAt',
        schedules:
          'id, sampleId, method, scheduledDate, status, createdAt, [method+scheduledDate]',
      })
      .upgrade(async (tx) => {
        // v4：旧切片没有排程，保持 scheduleId 为空 → 界面标「待排」
        // 无需回填，读取时按是否有 scheduleId 判断即可
        await tx
          .table<ThinSection, string>('sections')
          .toCollection()
          .modify((section) => {
            if (typeof section.scheduleId !== 'string') section.scheduleId = undefined;
          });
      });
  }
}

export const db = new MeteoriteDB();

/** 生成一个稳定的本地 id */
export function makeId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now().toString(36)}_${rand}`;
}

/** 首次运行时灌入演示档案，保证页面有可检索内容 */
export async function seedIfEmpty(): Promise<void> {
  const count = await db.samples.count();
  if (count > 0) return;
  const now = Date.now();
  await db.transaction('rw', db.samples, db.finds, db.sections, db.analysis, async () => {
    await db.samples.bulkAdd([
      {
        id: 'sample_seed_1',
        sampleNo: 'MET-2024-001',
        totalWeight: 1250.4,
        category: 'chondrite',
        chemicalGroup: 'H',
        weathering: 'W1',
        fallOrFind: 'find',
        storage: 'cabinet-a',
        note: '撒哈拉回收，熔壳完整',
        createdAt: now - 86400000 * 40,
        updatedAt: now - 86400000 * 40,
      },
      {
        id: 'sample_seed_2',
        sampleNo: 'MET-2024-002',
        totalWeight: 8420,
        category: 'iron',
        chemicalGroup: 'IAB',
        weathering: 'W0',
        fallOrFind: 'find',
        storage: 'cabinet-b',
        note: '八面体结构清晰',
        createdAt: now - 86400000 * 30,
        updatedAt: now - 86400000 * 30,
      },
      {
        id: 'sample_seed_3',
        sampleNo: 'MET-2024-003',
        totalWeight: 318.9,
        category: 'achondrite',
        chemicalGroup: 'ungrouped',
        weathering: 'W2',
        fallOrFind: 'fall',
        storage: 'desiccator',
        note: '目击坠落，无熔壳',
        createdAt: now - 86400000 * 18,
        updatedAt: now - 86400000 * 18,
      },
    ]);
    await db.finds.bulkAdd([
      {
        id: 'find_seed_1',
        sampleId: 'sample_seed_1',
        placeName: 'Dar al Gani 区域',
        region: '利比亚',
        longitude: 16.2,
        latitude: 27.4,
        coordinateSource: 'gps',
        environment: 'desert',
        finder: '野外队 A 组',
        createdAt: now - 86400000 * 40,
      },
      {
        id: 'find_seed_2',
        sampleId: 'sample_seed_2',
        placeName: 'Gobi 南缘',
        region: '中国 内蒙古',
        longitude: 108.6,
        latitude: 42.1,
        coordinateSource: 'literature',
        environment: 'desert',
        finder: '标本室交换',
        createdAt: now - 86400000 * 30,
      },
    ]);
    await db.sections.bulkAdd([
      {
        id: 'section_seed_1',
        sectionNo: 'TS-2024-001',
        sampleId: 'sample_seed_1',
        thickness: 30,
        preparation: 'resin',
        minerals: { olivine: 42, pyroxene: 28, feldspar: 12, metal: 18 },
        micrographs: ['met001_ppl.jpg', 'met001_xpl.jpg'],
        quality: 'good',
        createdAt: now - 86400000 * 35,
        scheduleId: 'schedule_seed_1',
      },
      {
        id: 'section_seed_2',
        sectionNo: 'TS-2024-002',
        sampleId: 'sample_seed_2',
        thickness: 60,
        preparation: 'epoxy',
        minerals: { olivine: 2, pyroxene: 5, feldspar: 1, metal: 92 },
        micrographs: ['met002_reflect.jpg'],
        quality: 'fair',
        createdAt: now - 86400000 * 25,
        // 无排程 → 标记「待排」
      },
    ]);
    await db.schedules.bulkAdd([
      {
        id: 'schedule_seed_1',
        sampleId: 'sample_seed_1',
        method: 'resin',
        scheduledDate: '2024-05-20',
        status: 'completed',
        sectionId: 'section_seed_1',
        createdAt: now - 86400000 * 36,
        updatedAt: now - 86400000 * 35,
        version: 1,
      },
      {
        id: 'schedule_seed_2',
        sampleId: 'sample_seed_2',
        method: 'resin',
        scheduledDate: new Date().toISOString().slice(0, 10),
        status: 'scheduled',
        createdAt: now - 86400000 * 2,
        updatedAt: now - 86400000 * 2,
        version: 1,
      },
      {
        id: 'schedule_seed_3',
        sampleId: 'sample_seed_3',
        method: 'resin',
        scheduledDate: new Date().toISOString().slice(0, 10),
        status: 'scheduled',
        createdAt: now - 86400000,
        updatedAt: now - 86400000,
        version: 1,
      },
      {
        id: 'schedule_seed_4',
        sampleId: 'sample_seed_1',
        method: 'resin',
        scheduledDate: new Date().toISOString().slice(0, 10),
        status: 'queued',
        reason: '',
        createdAt: now - 86400000 / 2,
        updatedAt: now - 86400000 / 2,
        version: 1,
      },
    ]);
    await db.analysis.bulkAdd([
      {
        id: 'analysis_seed_1',
        sampleId: 'sample_seed_1',
        target: 'sample',
        method: 'microprobe',
        fa: 18.6,
        fs: 16.2,
        ni: 0.8,
        kamaciteBandwidth: 0.02,
        testedAt: '2024-06-12',
        createdAt: now - 86400000 * 20,
      },
      {
        id: 'analysis_seed_2',
        sampleId: 'sample_seed_2',
        target: 'sample',
        method: 'sem-eds',
        fa: 3.2,
        fs: 4.1,
        ni: 7.4,
        kamaciteBandwidth: 0.62,
        testedAt: '2024-07-03',
        createdAt: now - 86400000 * 12,
      },
      {
        id: 'analysis_seed_3',
        sampleId: 'sample_seed_1',
        sectionId: 'section_seed_1',
        target: 'section',
        method: 'microprobe',
        fa: 18.2,
        fs: 15.9,
        ni: 0.9,
        kamaciteBandwidth: 0.02,
        testedAt: '2024-06-18',
        createdAt: now - 86400000 * 10,
      },
    ]);
  });
}
