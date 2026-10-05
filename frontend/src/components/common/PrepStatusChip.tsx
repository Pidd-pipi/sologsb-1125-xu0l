import Chip, { type ChipPropsColorOverrides } from '@mui/material/Chip';
import type { OverridableStringUnion } from '@mui/types';
import type { SectionPrepStatus } from '../../types/section';
import { SECTION_PREP_LABELS } from '../../types/section';
import type { ScheduleStatus } from '../../types/schedule';
import { SCHEDULE_STATUS_LABELS } from '../../types/schedule';

type ChipColor = OverridableStringUnion<
  'default' | 'primary' | 'secondary' | 'error' | 'info' | 'success' | 'warning',
  ChipPropsColorOverrides
>;

const SECTION_COLORS: Record<SectionPrepStatus, ChipColor> = {
  pending: 'default',
  queued: 'warning',
  'in-progress': 'info',
  done: 'success',
  failed: 'error',
  cancelled: 'default',
};

const SCHEDULE_COLORS: Record<ScheduleStatus, ChipColor> = {
  queued: 'warning',
  scheduled: 'info',
  done: 'success',
  failed: 'error',
  cancelled: 'default',
};

/** 切片制样进度徽标 */
export function PrepStatusChip({ status, size = 'small' }: { status: SectionPrepStatus; size?: 'small' | 'medium' }) {
  return (
    <Chip
      size={size}
      color={SECTION_COLORS[status]}
      variant={status === 'pending' || status === 'cancelled' ? 'outlined' : 'filled'}
      label={SECTION_PREP_LABELS[status]}
    />
  );
}

/** 排程状态徽标 */
export function ScheduleStatusChip({ status }: { status: ScheduleStatus }) {
  return (
    <Chip
      size="small"
      color={SCHEDULE_COLORS[status]}
      variant={status === 'cancelled' ? 'outlined' : 'filled'}
      label={SCHEDULE_STATUS_LABELS[status]}
    />
  );
}
