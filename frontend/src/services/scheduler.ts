import { db, makeId } from '../db';
import {
  ACTIVE_SCHEDULE_STATUSES,
  CAPACITY_STATUSES,
  DAILY_CAPACITY,
  type PreparationSchedule,
  type ScheduleRejectReason,
  type ScheduleStatus,
  type ScheduleSubmitInput,
} from '../types/schedule';
import type {
  SectionPrepStatus,
  ThinSection,
} from '../types/section';

/** 排程业务拒绝（外借 / 同日重复 / 抢名额失败），调用方据此保留草稿 */
export class ScheduleRejectedError extends Error {
  reason: ScheduleRejectReason;
  constructor(reason: ScheduleRejectReason) {
    super(REJECT_MESSAGES[reason]);
    this.name = 'ScheduleRejectedError';
    this.reason = reason;
  }
}

/** 检测记录绑定切片不合法（切片不存在 / 不属于该样本 / 制样未完成） */
export class AnalysisBindingError extends Error {}

export const REJECT_MESSAGES: Record<ScheduleRejectReason, string> = {
  'sample-loan-out': '样本处于外借状态，制样排程已直接拒绝',
  'duplicate-day': '同一样本当天已排制样，不能重复占用名额',
  'capacity-lost': '最后一个名额刚被另一页签占用，已保留冲突草稿，请改期或排队',
};

export type ScheduleSubmitResult =
  | { outcome: 'scheduled'; schedule: PreparationSchedule; section: ThinSection }
  | { outcome: 'queued'; schedule: PreparationSchedule; section: ThinSection }
  | { outcome: 'rejected'; reason: ScheduleRejectReason };

const STATUS_TO_SECTION: Record<ScheduleStatus, SectionPrepStatus> = {
  queued: 'queued',
  scheduled: 'in-progress',
  done: 'done',
  failed: 'failed',
  cancelled: 'cancelled',
};

/**
 * 事务内重算全部排程（必须运行在 rw 事务中）：
 *  1. 按「制样方式 × 日期」分桶，桶内按送样时间排序；
 *  2. done / scheduled 已占名额，剩余名额按顺序把 queued 提升为 scheduled；
 *  3. 仍排队的任务重排排队序号（取消 / 失败释放名额后，后面任务前移）；
 *  4. 同步切片上的制样进度。
 */
async function recompute(): Promise<void> {
  const all = await db.schedules.toArray();

  const buckets = new Map<string, PreparationSchedule[]>();
  for (const sch of all) {
    if (sch.status === 'failed' || sch.status === 'cancelled') {
      // 失效记录不再占名额、不参与排队
      if (sch.queuePosition !== 0) sch.queuePosition = 0;
      continue;
    }
    const key = `${sch.preparation}|${sch.date}`;
    const list = buckets.get(key);
    if (list) list.push(sch);
    else buckets.set(key, [sch]);
  }

  for (const list of buckets.values()) {
    list.sort((a, b) => a.submittedAt - b.submittedAt || a.id.localeCompare(b.id));
    const capacity = DAILY_CAPACITY[list[0].preparation];
    let used = list.reduce(
      (n, s) => n + (s.status === 'scheduled' || s.status === 'done' ? 1 : 0),
      0,
    );
    let queueNo = 1;
    for (const sch of list) {
      if (sch.status !== 'queued') continue;
      if (used < capacity) {
        sch.status = 'scheduled';
        sch.queuePosition = 0;
        used += 1;
      } else {
        sch.queuePosition = queueNo;
        queueNo += 1;
      }
    }
  }

  await db.schedules.bulkPut(all);

  // 同步切片制样进度（含失败 / 取消），保证两侧状态一致
  const sectionStatus = new Map<string, SectionPrepStatus>();
  for (const sch of all) {
    sectionStatus.set(sch.sectionId, STATUS_TO_SECTION[sch.status]);
  }
  if (sectionStatus.size) {
    const sections = await db.sections.bulkGet([...sectionStatus.keys()]);
    const dirty: ThinSection[] = [];
    sections.forEach((section) => {
      if (!section) return;
      const next = sectionStatus.get(section.id);
      if (!next) return;
      if (section.prepStatus !== next || section.scheduleId === undefined) {
        dirty.push({ ...section, prepStatus: next });
      }
    });
    if (dirty.length) await db.sections.bulkPut(dirty);
  }
}

/**
 * 送样制样：校验 + 占名额 + 建切片 / 排程在同一个 IndexedDB 事务中完成。
 * 同浏览器两个页签并发提交时，IndexedDB 事务串行化，
 * 抢最后一个名额的第二笔在事务内读到的是已被占满的名额。
 */
export async function submitSectionPreparation(
  input: ScheduleSubmitInput,
): Promise<ScheduleSubmitResult> {
  return db.transaction(
    'rw',
    db.samples,
    db.sections,
    db.schedules,
    async () => {
      // 先重算，保证判断基于最新名额（前一个事务可能刚释放或占走）
      await recompute();

      const sample = await db.samples.get(input.sampleId);
      if (!sample) throw new Error('关联样本不存在，无法排程');

      // 外借样本直接拒绝
      if (sample.storage === 'loan-out') {
        return { outcome: 'rejected', reason: 'sample-loan-out' };
      }

      // 同一样本当天不能重复排（无论制样方式、无论排队还是已排定）
      const sameDay = await db.schedules
        .where('sampleId')
        .equals(input.sampleId)
        .filter(
          (s) =>
            s.date === input.date && ACTIVE_SCHEDULE_STATUSES.includes(s.status),
        )
        .toArray();
      if (sameDay.length > 0) {
        return { outcome: 'rejected', reason: 'duplicate-day' };
      }

      const occupied = await db.schedules
        .where('date')
        .equals(input.date)
        .filter(
          (s) =>
            s.preparation === input.preparation &&
            CAPACITY_STATUSES.includes(s.status),
        )
        .count();
      const capacity = DAILY_CAPACITY[input.preparation];
      const now = Date.now();

      // 打开表单时还有名额，事务内却满了：并发抢名额失败，保留冲突草稿
      if (occupied >= capacity && input.optimisticSlot) {
        return { outcome: 'rejected', reason: 'capacity-lost' };
      }

      const section: ThinSection = {
        id: makeId('section'),
        sectionNo: input.sectionNo,
        sampleId: input.sampleId,
        thickness: input.thickness,
        preparation: input.preparation,
        minerals: input.minerals,
        micrographs: input.micrographs,
        quality: input.quality,
        scheduleDate: input.date,
        createdAt: now,
      };

      if (occupied >= capacity) {
        const queuedAhead = await db.schedules
          .where('date')
          .equals(input.date)
          .filter((s) => s.preparation === input.preparation && s.status === 'queued')
          .count();
        const schedule: PreparationSchedule = {
          id: makeId('schedule'),
          sampleId: input.sampleId,
          sectionId: section.id,
          preparation: input.preparation,
          date: input.date,
          status: 'queued',
          queuePosition: queuedAhead + 1,
          submittedAt: now,
          updatedAt: now,
        };
        section.scheduleId = schedule.id;
        section.prepStatus = 'queued';
        await db.sections.add(section);
        await db.schedules.add(schedule);
        return { outcome: 'queued', schedule, section };
      }

      const schedule: PreparationSchedule = {
        id: makeId('schedule'),
        sampleId: input.sampleId,
        sectionId: section.id,
        preparation: input.preparation,
        date: input.date,
        status: 'scheduled',
        queuePosition: 0,
        submittedAt: now,
        updatedAt: now,
      };
      section.scheduleId = schedule.id;
      section.prepStatus = 'in-progress';
      await db.sections.add(section);
      await db.schedules.add(schedule);
      return { outcome: 'scheduled', schedule, section };
    },
  );
}

async function transition(
  id: string,
  next: ScheduleStatus,
  allowed: ScheduleStatus[],
): Promise<PreparationSchedule> {
  return db.transaction('rw', db.schedules, db.sections, async () => {
    const sch = await db.schedules.get(id);
    if (!sch) throw new Error('排程记录不存在');
    if (!allowed.includes(sch.status)) {
      throw new Error(`当前状态「${sch.status}」不允许该操作`);
    }
    const now = Date.now();
    const updated: PreparationSchedule = {
      ...sch,
      status: next,
      queuePosition: next === 'queued' ? sch.queuePosition : 0,
      updatedAt: now,
    };
    await db.schedules.put(updated);

    const section = await db.sections.get(sch.sectionId);
    if (section) {
      await db.sections.put({
        ...section,
        prepStatus: STATUS_TO_SECTION[next],
        scheduleId: updated.id,
        scheduleDate: updated.date,
      });
    }

    // 名额失效后重算，后面排队任务前移
    await recompute();
    return updated;
  });
}

/** 取消：排队中或已排定 → 已取消（名额失效） */
export function cancelSchedule(id: string): Promise<PreparationSchedule> {
  return transition(id, 'cancelled', ['queued', 'scheduled']);
}

/** 标记制样失败：已排定 → 失败（名额失效） */
export function failSchedule(id: string): Promise<PreparationSchedule> {
  return transition(id, 'failed', ['scheduled']);
}

/** 完成制样：已排定 → 已完成（此后切片才允许绑定检测记录） */
export function completeSchedule(id: string): Promise<PreparationSchedule> {
  return transition(id, 'done', ['scheduled']);
}

/**
 * 检测记录绑定切片校验（运行在 rw 事务中）：
 * 未完成制样前，检测记录不能绑定切片。
 */
export async function assertAnalysisBinding(args: {
  sampleId: string;
  sectionId?: string;
}): Promise<void> {
  const { sampleId, sectionId } = args;
  if (!sectionId) return;
  const section = await db.sections.get(sectionId);
  if (!section) throw new AnalysisBindingError('关联切片不存在，无法绑定检测记录');
  if (section.sampleId !== sampleId) {
    throw new AnalysisBindingError('切片不属于所选样本，无法绑定检测记录');
  }
  if ((section.prepStatus ?? 'pending') !== 'done') {
    throw new AnalysisBindingError('切片尚未完成制样，检测记录不能绑定（可先保存为样本级检测）');
  }
}

/** 某日某制样方式的名额占用情况（供页面提示剩余名额） */
export function capacityInfo(
  schedules: PreparationSchedule[],
  preparation: PreparationSchedule['preparation'],
  date: string,
): { total: number; used: number; queued: number; remaining: number } {
  const inBucket = schedules.filter((s) => s.preparation === preparation && s.date === date);
  const used = inBucket.filter((s) => CAPACITY_STATUSES.includes(s.status)).length;
  const queued = inBucket.filter((s) => s.status === 'queued').length;
  const total = DAILY_CAPACITY[preparation];
  return { total, used, queued, remaining: Math.max(0, total - used) };
}
