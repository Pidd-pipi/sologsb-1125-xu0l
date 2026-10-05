import type { PreparationMethod } from './section';

/** 制样排程状态 */
export type ScheduleStatus = 'queued' | 'scheduled' | 'completed' | 'cancelled' | 'failed';

/**
 * 制样排程（PreparationSchedule）。
 * 按「制样方式 + 日期」占用名额：容量内为 scheduled（已排期），满了为 queued（排队中）。
 * 取消 / 失败后名额释放，排队中最早的任务前移补位。
 */
export interface PreparationSchedule {
  id: string;
  /** 关联样本 id */
  sampleId: string;
  /** 制样方式：树脂包埋 / 环氧粘接 */
  method: PreparationMethod;
  /** 计划占用日期 YYYY-MM-DD */
  scheduledDate: string;
  status: ScheduleStatus;
  /** 制样完成后产出的切片 id */
  sectionId?: string;
  /** 取消 / 失败原因 */
  reason?: string;
  createdAt: number;
  updatedAt: number;
  /** 乐观并发版本号 */
  version: number;
}

/** 每种制样方式每天的容量（树脂包埋 / 环氧粘接各 2 个名额） */
export const PREPARATION_CAPACITY: Record<PreparationMethod, number> = {
  resin: 2,
  epoxy: 2,
};

export const SCHEDULE_STATUS_LABELS: Record<ScheduleStatus, string> = {
  queued: '排队中',
  scheduled: '已排期',
  completed: '已完成',
  cancelled: '已取消',
  failed: '制样失败',
};

export const SCHEDULE_STATUSES: ScheduleStatus[] = [
  'queued',
  'scheduled',
  'completed',
  'cancelled',
  'failed',
];

/** 占用名额的有效状态：排队中 / 已排期 */
export function isActiveSchedule(s: PreparationSchedule | undefined | null): boolean {
  return !!s && (s.status === 'queued' || s.status === 'scheduled');
}

/** 已占用名额（已排期）计数 */
export function occupiedCount(
  schedules: PreparationSchedule[],
  method: PreparationMethod,
  date: string,
): number {
  return schedules.filter(
    (s) => s.method === method && s.scheduledDate === date && s.status === 'scheduled',
  ).length;
}

/** 排队中计数 */
export function queuedCount(
  schedules: PreparationSchedule[],
  method: PreparationMethod,
  date: string,
): number {
  return schedules.filter(
    (s) => s.method === method && s.scheduledDate === date && s.status === 'queued',
  ).length;
}

/** 样本当天是否已存在有效排程（排队中 / 已排期），同一样本当天不能重复排 */
export function hasSameDaySchedule(
  schedules: PreparationSchedule[],
  sampleId: string,
  date: string,
): boolean {
  return schedules.some(
    (s) => s.sampleId === sampleId && s.scheduledDate === date && isActiveSchedule(s),
  );
}

/** 切片是否已完成制样（检测记录仅可绑定已完成制样的切片） */
export function isSectionPrepComplete(
  schedules: PreparationSchedule[],
  sectionId: string,
): boolean {
  const s = schedules.find((x) => x.sectionId === sectionId);
  return s?.status === 'completed';
}

/** 取切片对应的排程（sectionId 反查） */
export function scheduleForSection(
  schedules: PreparationSchedule[],
  sectionId: string,
): PreparationSchedule | undefined {
  return schedules.find((x) => x.sectionId === sectionId);
}
