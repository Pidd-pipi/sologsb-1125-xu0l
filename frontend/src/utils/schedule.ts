import type { PreparationSchedule } from '../types/schedule';
import { PREPARATION_CAPACITY, occupiedCount, queuedCount } from '../types/schedule';
import type { PreparationMethod } from '../types/section';

/** 排程被业务规则拒绝（外借样本 / 当天重复排） */
export class ScheduleRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ScheduleRejectedError';
  }
}

/** 排程名额冲突：其他页签已抢占最后一个名额，当前页保留草稿 */
export class ScheduleConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ScheduleConflictError';
  }
}

/** 某制样方式在某日的名额占用情况 */
export interface SlotUsage {
  method: PreparationMethod;
  date: string;
  capacity: number;
  occupied: number;
  queued: number;
  full: boolean;
}

export function slotUsage(
  schedules: PreparationSchedule[],
  method: PreparationMethod,
  date: string,
): SlotUsage {
  const capacity = PREPARATION_CAPACITY[method];
  const occupied = occupiedCount(schedules, method, date);
  const queued = queuedCount(schedules, method, date);
  return { method, date, capacity, occupied, queued, full: occupied >= capacity };
}

/** 今天 YYYY-MM-DD */
export function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

/** 生成下一个切片编号 TS-<年>-<三位序号> */
export function generateSectionNo(existing: string[]): string {
  const year = new Date().getFullYear();
  const prefix = `TS-${year}-`;
  const used = existing
    .filter((no) => no.startsWith(prefix))
    .map((no) => Number(no.slice(prefix.length)))
    .filter((n) => Number.isFinite(n));
  const max = used.length ? Math.max(...used) : 0;
  return `${prefix}${String(max + 1).padStart(3, '0')}`;
}
