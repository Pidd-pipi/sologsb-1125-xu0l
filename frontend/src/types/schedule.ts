import type { PreparationMethod, ThinSection } from './section';

/**
 * 排程状态：
 *  - queued 排队中：当日名额已满，等待前移
 *  - scheduled 已排定（制样中）：占用「制样方式 × 日期」名额
 *  - done 已完成：名额历史占用，切片进入可检测状态
 *  - failed 制样失败：名额失效并释放，后续排队前移
 *  - cancelled 已取消：名额失效并释放，后续排队前移
 */
export type ScheduleStatus =
  | 'queued'
  | 'scheduled'
  | 'done'
  | 'failed'
  | 'cancelled';

/** 仍在占用制样流程的状态（失败 / 取消后名额即失效） */
export const ACTIVE_SCHEDULE_STATUSES: ScheduleStatus[] = [
  'queued',
  'scheduled',
  'done',
];

/** 占用当日名额的状态（排队中不占名额，只保序） */
export const CAPACITY_STATUSES: ScheduleStatus[] = ['scheduled', 'done'];

/** 制样排程（PreparationSchedule，v4 新增表） */
export interface PreparationSchedule {
  id: string;
  /** 关联样本 id */
  sampleId: string;
  /** 关联切片 id（排程提交时创建） */
  sectionId: string;
  preparation: PreparationMethod;
  /** 期望 / 排定制样日期 YYYY-MM-DD（名额按「方式 × 日期」计数） */
  date: string;
  status: ScheduleStatus;
  /** 排队序号：仅 queued 有意义，按送样时间排序，从 1 开始 */
  queuePosition: number;
  /** 送样时间（排队先后依据） */
  submittedAt: number;
  updatedAt: number;
}

export const SCHEDULE_STATUS_LABELS: Record<ScheduleStatus, string> = {
  queued: '排队中',
  scheduled: '已排定',
  done: '已完成',
  failed: '制样失败',
  cancelled: '已取消',
};

export const SCHEDULE_STATUSES: ScheduleStatus[] = [
  'queued',
  'scheduled',
  'done',
  'failed',
  'cancelled',
];

/** 每日制样容量：树脂包埋与环氧粘接各自独立计名额 */
export const DAILY_CAPACITY: Record<PreparationMethod, number> = {
  resin: 3,
  epoxy: 2,
};

/** 业务拒绝原因 */
export type ScheduleRejectReason =
  | 'sample-loan-out'
  | 'duplicate-day'
  | 'capacity-lost';

export interface ScheduleSubmitInput {
  sampleId: string;
  preparation: PreparationMethod;
  date: string;
  /** 切片档案字段 */
  sectionNo: string;
  thickness: number;
  minerals: ThinSection['minerals'];
  micrographs: string[];
  quality: ThinSection['quality'];
  /**
   * 打开表单时判断仍有空闲名额：两个页签抢最后一个名额时，
   * 事务内若发现名额已被另一页签拿走，则按 capacity-lost 冲突驳回，
   * 调用方保留带冲突标记的草稿，而不是静默降级为排队。
   */
  optimisticSlot?: boolean;
}
