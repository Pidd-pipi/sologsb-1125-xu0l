/** 制样方式 */
export type PreparationMethod = 'resin' | 'epoxy';

/** 切片质量标注 */
export type SectionQuality = 'good' | 'fair' | 'poor' | 'unrated';

/**
 * 制样进度（v4 新增，由制样排程驱动）：
 *  - pending 待排：旧切片或尚未进入排程
 *  - queued 排队中：已送样但当日名额已满
 *  - in-progress 制样中：已排定，占用当日名额
 *  - done 已完成：检测记录只允许绑定该状态切片
 *  - failed 制样失败 / cancelled 已取消：名额失效
 */
export type SectionPrepStatus =
  | 'pending'
  | 'queued'
  | 'in-progress'
  | 'done'
  | 'failed'
  | 'cancelled';

/** 矿物占比（合计应约等于 100%） */
export interface MineralRatios {
  /** 橄榄石 */
  olivine: number;
  /** 辉石 */
  pyroxene: number;
  /** 长石 */
  feldspar: number;
  /** 金属 */
  metal: number;
}

/** 切片与制样（ThinSection） */
export interface ThinSection {
  id: string;
  /** 切片编号，形如 TS-2024-001 */
  sectionNo: string;
  /** 关联样本 id */
  sampleId: string;
  /** 厚度，单位 μm */
  thickness: number;
  preparation: PreparationMethod;
  minerals: MineralRatios;
  /** 显微照片清单（文件名 / 描述） */
  micrographs: string[];
  quality: SectionQuality;
  /** v4：关联制样排程 id；旧切片为 undefined（视为待排） */
  scheduleId?: string;
  /** v4：排定制样日期 YYYY-MM-DD；排队/已取消/失败记录保留，便于追溯 */
  scheduleDate?: string;
  /** v4：制样进度；缺省（旧切片）一律按 pending 待排处理 */
  prepStatus?: SectionPrepStatus;
  createdAt: number;
}

export const PREPARATION_LABELS: Record<PreparationMethod, string> = {
  resin: '树脂包埋',
  epoxy: '环氧粘接',
};

export const SECTION_QUALITY_LABELS: Record<SectionQuality, string> = {
  good: '优（可直接定量）',
  fair: '良（局部可用）',
  poor: '差（仅观察）',
  unrated: '未标注',
};

export const SECTION_PREP_LABELS: Record<SectionPrepStatus, string> = {
  pending: '待排',
  queued: '排队中',
  'in-progress': '制样中',
  done: '已完成',
  failed: '制样失败',
  cancelled: '已取消',
};

export const SECTION_PREP_STATUSES: SectionPrepStatus[] = [
  'pending',
  'queued',
  'in-progress',
  'done',
  'failed',
  'cancelled',
];

export const PREPARATIONS: PreparationMethod[] = ['resin', 'epoxy'];
export const SECTION_QUALITIES: SectionQuality[] = ['good', 'fair', 'poor', 'unrated'];

export const MINERAL_KEYS: (keyof MineralRatios)[] = ['olivine', 'pyroxene', 'feldspar', 'metal'];

export const MINERAL_LABELS: Record<keyof MineralRatios, string> = {
  olivine: '橄榄石',
  pyroxene: '辉石',
  feldspar: '长石',
  metal: '金属',
};

/** 矿物占比合计 */
export function mineralTotal(m: MineralRatios): number {
  return MINERAL_KEYS.reduce((sum, k) => sum + (Number(m[k]) || 0), 0);
}

/** 归一化制样进度：旧切片（字段缺失）一律视为待排 */
export function sectionPrepStatus(s: ThinSection): SectionPrepStatus {
  return s.prepStatus ?? 'pending';
}

/** 检测记录是否可绑定该切片：未完成制样前不能绑定 */
export function isSectionReadyForAnalysis(s: ThinSection): boolean {
  return sectionPrepStatus(s) === 'done';
}
