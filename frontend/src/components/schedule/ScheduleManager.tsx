import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Collapse,
  Divider,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import CancelOutlinedIcon from '@mui/icons-material/CancelOutlined';
import { useLocalDraft } from '../../hooks/useLocalDraft';
import { useSampleStore } from '../../stores/sampleStore';
import { useToastStore } from '../../stores/uiStore';
import {
  PREPARATION_CAPACITY,
  SCHEDULE_STATUS_LABELS,
  type PreparationSchedule,
  type ScheduleStatus,
} from '../../types/schedule';
import {
  PREPARATIONS,
  PREPARATION_LABELS,
  SECTION_QUALITIES,
  SECTION_QUALITY_LABELS,
  MINERAL_KEYS,
  MINERAL_LABELS,
  mineralTotal,
  type MineralRatios,
  type PreparationMethod,
  type SectionQuality,
  type ThinSection,
} from '../../types/section';
import {
  ScheduleConflictError,
  ScheduleRejectedError,
  generateSectionNo,
  slotUsage,
  todayStr,
} from '../../utils/schedule';
import FieldGroup from '../common/FieldGroup';

interface ScheduleDraft {
  method: PreparationMethod;
  scheduledDate: string;
}

const STATUS_COLOR: Record<
  ScheduleStatus,
  'default' | 'primary' | 'success' | 'warning' | 'error'
> = {
  queued: 'default',
  scheduled: 'primary',
  completed: 'success',
  cancelled: 'warning',
  failed: 'error',
};

/** 样本详情页的制样排程管理器：排期 / 排队 / 完成制样 / 取消 / 失败 */
export default function ScheduleManager({ sampleId }: { sampleId: string }) {
  const schedules = useSampleStore((s) => s.schedules);
  const createSchedule = useSampleStore((s) => s.createSchedule);
  const cancelSchedule = useSampleStore((s) => s.cancelSchedule);
  const failSchedule = useSampleStore((s) => s.failSchedule);
  const completeSchedule = useSampleStore((s) => s.completeSchedule);
  const notify = useToastStore((s) => s.notify);

  const mySchedules = useMemo(
    () =>
      schedules
        .filter((s) => s.sampleId === sampleId)
        .sort((a, b) => b.createdAt - a.createdAt),
    [schedules, sampleId],
  );

  const initial = useMemo<ScheduleDraft>(
    () => ({ method: 'resin', scheduledDate: todayStr() }),
    [],
  );
  const { value, patch, clear, restored } = useLocalDraft<ScheduleDraft>(
    `schedule-entry-${sampleId}`,
    initial,
  );
  const [conflict, setConflict] = useState<string | null>(null);
  const [reject, setReject] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const usage = useMemo(
    () => slotUsage(schedules, value.method, value.scheduledDate),
    [schedules, value.method, value.scheduledDate],
  );

  const submit = async () => {
    setConflict(null);
    setReject(null);
    setSubmitting(true);
    try {
      const result = await createSchedule(
        { sampleId, method: value.method, scheduledDate: value.scheduledDate },
        { occupied: usage.occupied },
      );
      clear();
      if (result.status === 'scheduled') {
        notify(`已排期：${PREPARATION_LABELS[value.method]} · ${value.scheduledDate}`);
      } else {
        notify(
          `当日名额已满，已排入队列（${PREPARATION_LABELS[value.method]} · ${value.scheduledDate}）`,
          'info',
        );
      }
    } catch (e) {
      if (e instanceof ScheduleConflictError) {
        // 名额被其他页签抢占：保留草稿，不清空
        setConflict(e.message);
      } else if (e instanceof ScheduleRejectedError) {
        setReject(e.message);
      } else {
        setReject('排程失败，请重试');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Stack spacing={2}>
      <Box>
        <Typography variant="subtitle1" fontWeight={700}>
          制样排程
        </Typography>
        <Typography variant="caption" color="text.secondary">
          按制样方式与日期占用名额（树脂 / 环氧各 {PREPARATION_CAPACITY.resin} 个 · 日），满额自动排队；
          取消或失败后名额释放，排队任务前移补位。
        </Typography>
      </Box>

      {restored ? <Alert severity="info">已恢复上次未提交的排程草稿。</Alert> : null}
      {conflict ? <Alert severity="warning">{conflict}</Alert> : null}
      {reject ? <Alert severity="error">{reject}</Alert> : null}

      <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap alignItems="center">
        <FormControl size="small" sx={{ minWidth: 150 }}>
          <InputLabel id="sched-method-label">制样方式</InputLabel>
          <Select
            labelId="sched-method-label"
            label="制样方式"
            value={value.method}
            onChange={(e) => patch({ method: e.target.value as PreparationMethod })}
          >
            {PREPARATIONS.map((p) => (
              <MenuItem key={p} value={p}>
                {PREPARATION_LABELS[p]}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        <TextField
          size="small"
          type="date"
          label="排程日期"
          InputLabelProps={{ shrink: true }}
          value={value.scheduledDate}
          onChange={(e) => patch({ scheduledDate: e.target.value })}
          sx={{ width: 170 }}
        />
        <Chip
          size="small"
          color={usage.full ? 'warning' : 'default'}
          label={`${PREPARATION_LABELS[value.method]} ${value.scheduledDate}：已占用 ${usage.occupied}/${usage.capacity}${
            usage.queued ? ` · 排队 ${usage.queued}` : ''
          }`}
        />
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={submit}
          disabled={submitting}
          id="add-schedule"
        >
          排入制样计划
        </Button>
      </Stack>

      <Divider />

      {mySchedules.length === 0 ? (
        <Alert severity="info">暂无排程，可在上方排入制样计划。</Alert>
      ) : (
        <Stack spacing={1}>
          {mySchedules.map((s) => (
            <ScheduleRow
              key={s.id}
              schedule={s}
              onCancel={() => cancelSchedule(s.id)}
              onFail={(reason) => failSchedule(s.id, reason)}
              onComplete={(section) => completeSchedule(s.id, section)}
            />
          ))}
        </Stack>
      )}
    </Stack>
  );
}

interface ScheduleRowProps {
  schedule: PreparationSchedule;
  onCancel: () => void;
  onFail: (reason: string) => void;
  onComplete: (section: Omit<ThinSection, 'id' | 'sampleId' | 'scheduleId' | 'createdAt'>) => void;
}

export function ScheduleRow({ schedule, onCancel, onFail, onComplete }: ScheduleRowProps) {
  const notify = useToastStore((s) => s.notify);
  const existingSectionNos = useSampleStore((s) => s.sections.map((sec) => sec.sectionNo));
  const sectionNoOf = useSampleStore((s) =>
    s.sections.find((sec) => sec.id === schedule.sectionId)?.sectionNo,
  );

  const [expanded, setExpanded] = useState(false);
  const [showFail, setShowFail] = useState(false);
  const [failReason, setFailReason] = useState('');
  const [draft, setDraft] = useState({
    sectionNo: '',
    thickness: 30,
    quality: 'unrated' as SectionQuality,
    micrograph: '',
    minerals: { olivine: 40, pyroxene: 25, feldspar: 15, metal: 20 } as MineralRatios,
  });

  useEffect(() => {
    if (expanded && !draft.sectionNo) {
      setDraft((d) => ({ ...d, sectionNo: generateSectionNo(existingSectionNos) }));
    }
  }, [expanded, draft.sectionNo, existingSectionNos]);

  const mineralSum = mineralTotal(draft.minerals);

  const submitComplete = () => {
    onComplete({
      sectionNo: draft.sectionNo.trim() || generateSectionNo(existingSectionNos),
      thickness: Number(draft.thickness),
      preparation: schedule.method,
      minerals: draft.minerals,
      micrographs: draft.micrograph.trim() ? [draft.micrograph.trim()] : [],
      quality: draft.quality,
    });
    notify(`已完成制样并登记切片 ${draft.sectionNo}`);
    setExpanded(false);
  };

  const submitFail = () => {
    onFail(failReason.trim() || '制样失败');
    notify('已标记制样失败，名额释放并触发前移', 'info');
    setShowFail(false);
  };

  return (
    <Box
      sx={{
        border: '1px solid',
        borderColor: 'divider',
        borderRadius: 2,
        p: 1.5,
      }}
    >
      <Stack direction="row" justifyContent="space-between" flexWrap="wrap" gap={1} alignItems="center">
        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
          <Chip size="small" color={STATUS_COLOR[schedule.status]} label={SCHEDULE_STATUS_LABELS[schedule.status]} />
          <Typography variant="subtitle2" fontWeight={700}>
            {PREPARATION_LABELS[schedule.method]} · {schedule.scheduledDate}
          </Typography>
          {schedule.status === 'completed' && sectionNoOf ? (
            <Chip size="small" variant="outlined" color="success" label={`切片 ${sectionNoOf}`} />
          ) : null}
          {schedule.status === 'failed' || schedule.status === 'cancelled' ? (
            <Typography variant="caption" color="text.secondary">
              {schedule.reason ? `原因：${schedule.reason}` : ''}
            </Typography>
          ) : null}
        </Stack>

        {schedule.status === 'scheduled' ? (
          <Stack direction="row" spacing={0.75}>
            <Button
              size="small"
              variant="contained"
              color="success"
              startIcon={<CheckCircleOutlineIcon />}
              onClick={() => setExpanded((v) => !v)}
            >
              完成制样
            </Button>
            <Button
              size="small"
              variant="outlined"
              color="warning"
              startIcon={<CancelOutlinedIcon />}
              onClick={onCancel}
            >
              取消
            </Button>
            <Button size="small" variant="text" color="error" onClick={() => setShowFail((v) => !v)}>
              标记失败
            </Button>
          </Stack>
        ) : null}
        {schedule.status === 'queued' ? (
          <Button size="small" variant="outlined" color="warning" startIcon={<CancelOutlinedIcon />} onClick={onCancel}>
            取消排队
          </Button>
        ) : null}
      </Stack>

      <Collapse in={showFail}>
        <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 1.5 }}>
          <TextField
            size="small"
            label="失败原因"
            value={failReason}
            onChange={(e) => setFailReason(e.target.value)}
            sx={{ width: 260 }}
          />
          <Button size="small" variant="contained" color="error" onClick={submitFail}>
            确认失败并释放名额
          </Button>
        </Stack>
      </Collapse>

      <Collapse in={expanded}>
        <Divider sx={{ my: 1.5 }} />
        <Stack spacing={1.5}>
          <Typography variant="subtitle2" fontWeight={700}>
            完成制样并登记切片
          </Typography>
          <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap>
            <TextField
              size="small"
              label="切片编号"
              value={draft.sectionNo}
              onChange={(e) => setDraft((d) => ({ ...d, sectionNo: e.target.value }))}
              sx={{ width: 180 }}
            />
            <TextField
              size="small"
              type="number"
              label="厚度 μm"
              value={draft.thickness}
              onChange={(e) => setDraft((d) => ({ ...d, thickness: Number(e.target.value) }))}
              sx={{ width: 130 }}
            />
            <FormControl size="small" sx={{ minWidth: 170 }}>
              <InputLabel id={`quality-label-${schedule.id}`}>质量标注</InputLabel>
              <Select
                labelId={`quality-label-${schedule.id}`}
                label="质量标注"
                value={draft.quality}
                onChange={(e) => setDraft((d) => ({ ...d, quality: e.target.value as SectionQuality }))}
              >
                {SECTION_QUALITIES.map((q) => (
                  <MenuItem key={q} value={q}>
                    {SECTION_QUALITY_LABELS[q]}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <TextField
              size="small"
              label="显微照片文件名"
              value={draft.micrograph}
              onChange={(e) => setDraft((d) => ({ ...d, micrograph: e.target.value }))}
              sx={{ width: 220 }}
            />
          </Stack>
          <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap>
            {MINERAL_KEYS.map((k) => (
              <FieldGroup
                key={k}
                title={`${MINERAL_LABELS[k]}占比`}
                unit="%"
                min={0}
                max={100}
                value={draft.minerals[k]}
                onChange={(v) => setDraft((d) => ({ ...d, minerals: { ...d.minerals, [k]: v } }))}
                inputId={`complete-mineral-${schedule.id}-${k}`}
                label={MINERAL_LABELS[k]}
              />
            ))}
          </Stack>
          <Typography variant="caption" color={mineralSum === 100 ? 'success.main' : 'warning.main'}>
            矿物占比合计 {mineralSum}%（建议合计 100%）
          </Typography>
          <Stack direction="row" spacing={1}>
            <Button size="small" variant="contained" color="success" onClick={submitComplete}>
              确认完成并登记切片
            </Button>
            <Button size="small" variant="text" onClick={() => setExpanded(false)}>
              收起
            </Button>
          </Stack>
        </Stack>
      </Collapse>
    </Box>
  );
}
