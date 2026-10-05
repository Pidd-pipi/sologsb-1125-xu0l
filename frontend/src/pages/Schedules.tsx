import { useMemo, useState } from 'react';
import {
  Box,
  Chip,
  Grid,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import EmptyState from '../components/common/EmptyState';
import { ScheduleRow } from '../components/schedule/ScheduleManager';
import { useSampleStore } from '../stores/sampleStore';
import { PREPARATION_CAPACITY, SCHEDULE_STATUS_LABELS } from '../types/schedule';
import { PREPARATIONS, PREPARATION_LABELS } from '../types/section';
import { slotUsage, todayStr } from '../utils/schedule';

/** `/schedules` 制样排程全局视图：按日期查看名额占用与排队情况 */
export default function Schedules() {
  const schedules = useSampleStore((s) => s.schedules);
  const samples = useSampleStore((s) => s.samples);
  const cancelSchedule = useSampleStore((s) => s.cancelSchedule);
  const failSchedule = useSampleStore((s) => s.failSchedule);
  const completeSchedule = useSampleStore((s) => s.completeSchedule);

  const [date, setDate] = useState(todayStr());

  const sampleMap = useMemo(() => new Map(samples.map((s) => [s.id, s])), [samples]);

  const daySchedules = useMemo(
    () =>
      schedules
        .filter((s) => s.scheduledDate === date)
        .sort((a, b) => {
          // 排队中的按提交顺序靠前，其余按状态 + 时间
          if (a.status === 'queued' && b.status !== 'queued') return -1;
          if (b.status === 'queued' && a.status !== 'queued') return 1;
          return a.createdAt - b.createdAt;
        }),
    [schedules, date],
  );

  return (
    <Stack spacing={2.5}>
      <Box>
        <Typography variant="h4">制样排程</Typography>
        <Typography variant="body2" color="text.secondary">
          按日期查看树脂包埋 / 环氧粘接的名额占用与排队顺序；取消或失败后名额释放，排队任务自动前移补位。
        </Typography>
      </Box>

      <Paper variant="outlined" sx={{ p: 2 }}>
        <Stack direction="row" spacing={2} alignItems="center" flexWrap="wrap" useFlexGap>
          <TextField
            size="small"
            type="date"
            label="排程日期"
            InputLabelProps={{ shrink: true }}
            value={date}
            onChange={(e) => setDate(e.target.value)}
            sx={{ width: 180 }}
          />
          {PREPARATIONS.map((m) => {
            const u = slotUsage(schedules, m, date);
            return (
              <Chip
                key={m}
                size="small"
                color={u.full ? 'warning' : 'default'}
                label={`${PREPARATION_LABELS[m]}：已占用 ${u.occupied}/${u.capacity}${
                  u.queued ? ` · 排队 ${u.queued}` : ''
                }`}
              />
            );
          })}
        </Stack>
      </Paper>

      {daySchedules.length === 0 ? (
        <EmptyState
          title="当日暂无排程"
          description="可到样本详情页通过「制样排程」排入计划。"
          actionLabel="去样本总览"
          actionTo="/"
        />
      ) : (
        <Grid container spacing={2}>
          {PREPARATIONS.map((m) => {
            const list = daySchedules.filter((s) => s.method === m);
            if (list.length === 0) return null;
            return (
              <Grid item xs={12} md={6} key={m}>
                <Paper variant="outlined" sx={{ p: 2 }}>
                  <Stack spacing={1.5}>
                    <Stack direction="row" spacing={1} alignItems="center">
                      <Typography variant="subtitle1" fontWeight={700}>
                        {PREPARATION_LABELS[m]}
                      </Typography>
                      <Chip
                        size="small"
                        variant="outlined"
                        label={`容量 ${PREPARATION_CAPACITY[m]} · 已占用 ${
                          list.filter((s) => s.status === 'scheduled').length
                        }`}
                      />
                    </Stack>
                    {list.map((s) => {
                      const sample = sampleMap.get(s.sampleId);
                      return (
                        <Box key={s.id}>
                          <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5, display: 'block' }}>
                            {sample ? sample.sampleNo : '未知样本'} · {SCHEDULE_STATUS_LABELS[s.status]}
                          </Typography>
                          <ScheduleRow
                            schedule={s}
                            onCancel={() => cancelSchedule(s.id)}
                            onFail={(reason) => failSchedule(s.id, reason)}
                            onComplete={(section) => completeSchedule(s.id, section)}
                          />
                        </Box>
                      );
                    })}
                  </Stack>
                </Paper>
              </Grid>
            );
          })}
        </Grid>
      )}
    </Stack>
  );
}
