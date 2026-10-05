import { useMemo } from 'react';
import {
  Box,
  Button,
  Chip,
  Grid,
  Paper,
  Stack,
  Typography,
} from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import EmptyState from '../components/common/EmptyState';
import { ScheduleStatusChip } from '../components/common/PrepStatusChip';
import { useSampleStore } from '../stores/sampleStore';
import { useToastStore } from '../stores/uiStore';
import { PREPARATION_LABELS, PREPARATIONS } from '../types/section';
import { DAILY_CAPACITY, type PreparationSchedule } from '../types/schedule';
import type { PreparationMethod } from '../types/section';

interface BucketRow {
  schedule: PreparationSchedule;
  sectionNo: string;
  sampleNo: string;
  onLoan: boolean;
}

/** `/schedule` 制样排程：按日期 × 制样方式展示名额占用与排队，可取消 / 失败 / 完成 */
export default function Schedule() {
  const schedules = useSampleStore((s) => s.schedules);
  const samples = useSampleStore((s) => s.samples);
  const sections = useSampleStore((s) => s.sections);
  const cancelSchedule = useSampleStore((s) => s.cancelSchedule);
  const failSchedule = useSampleStore((s) => s.failSchedule);
  const completeSchedule = useSampleStore((s) => s.completeSchedule);
  const notify = useToastStore((s) => s.notify);

  const sampleMap = useMemo(() => new Map(samples.map((s) => [s.id, s])), [samples]);
  const sectionMap = useMemo(() => new Map(sections.map((s) => [s.id, s])), [sections]);

  /** 日期 → 制样方式 → 该桶排程（按送样时间正序，与排队前移顺序一致） */
  const grid = useMemo(() => {
    const byDate = new Map<string, Map<PreparationMethod, BucketRow[]>>();
    for (const sch of schedules) {
      const sample = sampleMap.get(sch.sampleId);
      const section = sectionMap.get(sch.sectionId);
      if (!sample || !section) continue;
      let byMethod = byDate.get(sch.date);
      if (!byMethod) {
        byMethod = new Map();
        byDate.set(sch.date, byMethod);
      }
      const list = byMethod.get(sch.preparation) ?? [];
      list.push({
        schedule: sch,
        sectionNo: section.sectionNo,
        sampleNo: sample.sampleNo,
        onLoan: sample.storage === 'loan-out',
      });
      byMethod.set(sch.preparation, list);
    }
    for (const byMethod of byDate.values()) {
      for (const list of byMethod.values()) {
        list.sort(
          (a, b) =>
            a.schedule.submittedAt - b.schedule.submittedAt ||
            a.schedule.id.localeCompare(b.schedule.id),
        );
      }
    }
    return [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [schedules, sampleMap, sectionMap]);

  /** 没有排程的旧切片：待排，提示回详情页送排 */
  const pendingSections = useMemo(
    () =>
      sections
        .filter((s) => !s.scheduleId || (s.prepStatus ?? 'pending') === 'pending')
        .map((s) => ({ section: s, sampleNo: sampleMap.get(s.sampleId)?.sampleNo ?? '未知样本' })),
    [sections, sampleMap],
  );

  const today = new Date().toISOString().slice(0, 10);

  return (
    <Stack spacing={2.5}>
      <Box>
        <Typography variant="h4">制样排程</Typography>
        <Typography variant="body2" color="text.secondary">
          树脂包埋每日 {DAILY_CAPACITY.resin} 个名额、环氧粘接每日 {DAILY_CAPACITY.epoxy} 个名额，按送样顺序占用；
          满额后排入队列，取消或失败立即释放名额并自动前移。同一样本当天只允许排一次，外借样本直接拒绝。
        </Typography>
      </Box>

      {schedules.length === 0 && pendingSections.length === 0 ? (
        <EmptyState
          title="还没有任何制样排程"
          description="进入样本详情，选择制样方式与制样日期后送样，系统会按名额自动排定或排队。"
          actionLabel="去样本总览"
          actionTo="/"
        />
      ) : null}

      {pendingSections.length > 0 ? (
        <Paper variant="outlined" sx={{ p: 2 }}>
          <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1 }}>
            待排切片（{pendingSections.length}）
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
            历史切片或未送排切片统一标记为「待排」，不占任何名额，可到样本详情选择日期补排。
          </Typography>
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            {pendingSections.map(({ section, sampleNo }) => (
              <Chip
                key={section.id}
                size="small"
                variant="outlined"
                label={`${section.sectionNo} · ${sampleNo}`}
                component={RouterLink}
                to={`/samples/${section.sampleId}`}
                clickable
              />
            ))}
          </Stack>
        </Paper>
      ) : null}

      {grid.map(([date, byMethod]) => (
        <Paper key={date} variant="outlined" sx={{ p: 2 }}>
          <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mb: 1.5 }}>
            <Typography variant="h6">{date}</Typography>
            {date === today ? <Chip size="small" color="primary" label="今天" /> : null}
            {date < today ? <Chip size="small" variant="outlined" label="历史日期" /> : null}
          </Stack>
          <Grid container spacing={2}>
            {PREPARATIONS.map((method) => {
              const rows = byMethod.get(method) ?? [];
              const capacity = DAILY_CAPACITY[method];
              const used = rows.filter(
                (r) => r.schedule.status === 'scheduled' || r.schedule.status === 'done',
              ).length;
              const queued = rows.filter((r) => r.schedule.status === 'queued').length;
              return (
                <Grid item xs={12} md={6} key={method}>
                  <Box
                    sx={{
                      border: '1px solid',
                      borderColor: 'divider',
                      borderRadius: 2,
                      p: 1.5,
                      height: '100%',
                    }}
                  >
                    <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
                      <Typography variant="subtitle1">{PREPARATION_LABELS[method]}</Typography>
                      <Chip
                        size="small"
                        color={used >= capacity ? 'warning' : 'success'}
                        label={`名额 ${used}/${capacity}${queued ? ` · 排队 ${queued}` : ''}`}
                      />
                    </Stack>
                    {rows.length === 0 ? (
                      <Typography variant="caption" color="text.secondary">
                        当日无该方式排程
                      </Typography>
                    ) : (
                      <Stack spacing={1}>
                        {rows.map(({ schedule, sectionNo, sampleNo, onLoan }) => (
                          <Box
                            key={schedule.id}
                            sx={{
                              p: 1.25,
                              borderRadius: 1.5,
                              border: '1px solid',
                              borderColor: 'divider',
                              opacity:
                                schedule.status === 'cancelled' || schedule.status === 'failed'
                                  ? 0.65
                                  : 1,
                            }}
                          >
                            <Stack
                              direction="row"
                              justifyContent="space-between"
                              alignItems="center"
                              spacing={1}
                              flexWrap="wrap"
                              useFlexGap
                            >
                              <Typography variant="subtitle2">
                                {sectionNo} ·{' '}
                                <Box
                                  component={RouterLink}
                                  to={`/samples/${schedule.sampleId}`}
                                  sx={{ color: 'primary.main', textDecoration: 'none' }}
                                >
                                  {sampleNo}
                                </Box>
                                {schedule.status === 'queued'
                                  ? ` · 排队第 ${schedule.queuePosition} 位`
                                  : ''}
                              </Typography>
                              <ScheduleStatusChip status={schedule.status} />
                            </Stack>
                            {onLoan ? (
                              <Typography variant="caption" color="error.main">
                                样本已外借：后续送排将被拒绝
                              </Typography>
                            ) : null}
                            {schedule.status === 'queued' || schedule.status === 'scheduled' ? (
                              <Stack direction="row" spacing={1} sx={{ mt: 0.75 }} flexWrap="wrap" useFlexGap>
                                {schedule.status === 'scheduled' ? (
                                  <>
                                    <Button
                                      size="small"
                                      color="success"
                                      variant="outlined"
                                      onClick={() => {
                                        void completeSchedule(schedule.id);
                                        notify(`切片 ${sectionNo} 已完成制样`);
                                      }}
                                    >
                                      完成制样
                                    </Button>
                                    <Button
                                      size="small"
                                      color="error"
                                      variant="outlined"
                                      onClick={() => {
                                        void failSchedule(schedule.id);
                                        notify('已标记失败，名额释放，队列前移', 'warning');
                                      }}
                                    >
                                      标记失败
                                    </Button>
                                  </>
                                ) : null}
                                <Button
                                  size="small"
                                  color="inherit"
                                  variant="outlined"
                                  onClick={() => {
                                    void cancelSchedule(schedule.id);
                                    notify('已取消，名额释放，后面任务前移', 'info');
                                  }}
                                >
                                  {schedule.status === 'queued' ? '退出排队' : '取消'}
                                </Button>
                              </Stack>
                            ) : null}
                          </Box>
                        ))}
                      </Stack>
                    )}
                  </Box>
                </Grid>
              );
            })}
          </Grid>
        </Paper>
      ))}
    </Stack>
  );
}
