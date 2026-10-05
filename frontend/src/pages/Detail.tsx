import { useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Divider,
  FormControl,
  Grid,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import { Link as RouterLink, useParams } from 'react-router-dom';
import SampleCard from '../components/common/SampleCard';
import FieldGroup from '../components/common/FieldGroup';
import ClassificationBadge from '../components/common/Badge';
import EmptyState from '../components/common/EmptyState';
import { PrepStatusChip } from '../components/common/PrepStatusChip';
import { useSampleStore } from '../stores/sampleStore';
import { useToastStore } from '../stores/uiStore';
import {
  ANALYSIS_METHODS,
  ANALYSIS_METHOD_LABELS,
  ANALYSIS_THRESHOLDS,
  type AnalysisMethod,
} from '../types/analysis';
import {
  MINERAL_KEYS,
  MINERAL_LABELS,
  PREPARATIONS,
  PREPARATION_LABELS,
  SECTION_QUALITIES,
  SECTION_QUALITY_LABELS,
  mineralTotal,
  sectionPrepStatus,
  type MineralRatios,
  type PreparationMethod,
  type SectionQuality,
} from '../types/section';
import { capacityInfo } from '../services/scheduler';
import {
  FALL_OR_FIND_LABELS,
  STORAGE_LABELS,
  WEATHERING_LABELS,
} from '../types/sample';
import { FIND_ENVIRONMENT_LABELS, COORDINATE_SOURCE_LABELS } from '../types/find';
import { classifyByAnalysis, evaluateThresholds } from '../utils/classify';
import { formatDate, formatNumber, formatWeight } from '../utils/format';
import { formatCoordinate } from '../utils/geo';

/** `/samples/:id` 样本详情 */
export default function Detail() {
  const { id = '' } = useParams();
  const samples = useSampleStore((s) => s.samples);
  const finds = useSampleStore((s) => s.finds);
  const sections = useSampleStore((s) => s.sections);
  const analysis = useSampleStore((s) => s.analysis);
  const schedules = useSampleStore((s) => s.schedules);
  const submitSectionAction = useSampleStore((s) => s.submitSection);
  const cancelScheduleAction = useSampleStore((s) => s.cancelSchedule);
  const failScheduleAction = useSampleStore((s) => s.failSchedule);
  const completeScheduleAction = useSampleStore((s) => s.completeSchedule);
  const addAnalysis = useSampleStore((s) => s.addAnalysis);
  const updateSample = useSampleStore((s) => s.updateSample);
  const notify = useToastStore((s) => s.notify);

  const sample = useMemo(() => samples.find((s) => s.id === id), [samples, id]);
  const find = useMemo(() => finds.find((f) => f.sampleId === id), [finds, id]);
  const mySections = useMemo(() => sections.filter((s) => s.sampleId === id), [sections, id]);
  const myAnalysis = useMemo(() => analysis.filter((a) => a.sampleId === id), [analysis, id]);
  const mySchedules = useMemo(() => schedules.filter((sc) => sc.sampleId === id), [schedules, id]);

  const [sectionDraft, setSectionDraft] = useState({
    sectionNo: '',
    thickness: 30,
    preparation: 'resin' as PreparationMethod,
    scheduleDate: new Date().toISOString().slice(0, 10),
    quality: 'unrated' as SectionQuality,
    micrograph: '',
    minerals: { olivine: 40, pyroxene: 25, feldspar: 15, metal: 20 } as MineralRatios,
  });
  /** 名额被并发抢走时保留的带冲突草稿 */
  const [slotConflict, setSlotConflict] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [analysisDraft, setAnalysisDraft] = useState({
    method: 'microprobe' as AnalysisMethod,
    fa: 18,
    fs: 16,
    ni: 0.8,
    kamaciteBandwidth: 0.05,
    testedAt: new Date().toISOString().slice(0, 10),
  });

  if (!sample) {
    return (
      <Stack spacing={2}>
        <EmptyState
          title="未找到该样本档案"
          description={`样本 id「${id}」不在本地库中，可能已被删除或链接失效。`}
          actionLabel="返回样本总览"
          actionTo="/"
        />
      </Stack>
    );
  }

  const mineralSum = mineralTotal(sectionDraft.minerals);
  const advice = classifyByAnalysis(analysisDraft);
  const hits = evaluateThresholds(analysisDraft);

  const onLoan = sample.storage === 'loan-out';
  const capacity = capacityInfo(
    schedules,
    sectionDraft.preparation,
    sectionDraft.scheduleDate,
  );

  const submitSection = async () => {
    setFormError(null);
    if (!sectionDraft.scheduleDate) {
      setFormError('请选择制样日期后再送排');
      return;
    }
    const no =
      sectionDraft.sectionNo.trim() ||
      `TS-${new Date().getFullYear()}-${String(mySections.length + 1).padStart(3, '0')}`;
    const result = await submitSectionAction({
      sampleId: sample.id,
      sectionNo: no,
      thickness: Number(sectionDraft.thickness),
      preparation: sectionDraft.preparation,
      date: sectionDraft.scheduleDate,
      minerals: sectionDraft.minerals,
      micrographs: sectionDraft.micrograph.trim() ? [sectionDraft.micrograph.trim()] : [],
      quality: sectionDraft.quality,
      // 打开表单时仍有空闲名额：若事务内被另一页签抢走，则驳回并保留冲突草稿
      optimisticSlot: capacity.remaining > 0,
    });

    if (result.outcome === 'rejected') {
      if (result.reason === 'capacity-lost') {
        setSlotConflict(
          `${PREPARATION_LABELS[sectionDraft.preparation]} ${sectionDraft.scheduleDate} 的名额已满`,
        );
        notify('名额已被另一页签占用，草稿已保留', 'warning');
      } else {
        const message =
          result.reason === 'sample-loan-out'
            ? '样本外借中，制样排程直接拒绝'
            : '同一样本当天已排制样，不能重复占用名额';
        setFormError(message);
        notify(message, 'warning');
      }
      return;
    }

    setSlotConflict(null);
    notify(
      result.outcome === 'scheduled'
        ? `已为 ${sample.sampleNo} 排定制样：${no}（${sectionDraft.scheduleDate}）`
        : `当日名额已满，${no} 已进入排队，释放后自动前移`,
      result.outcome === 'scheduled' ? 'success' : 'info',
    );
    setSectionDraft((d) => ({ ...d, sectionNo: '', micrograph: '' }));
  };

  const submitAnalysis = async () => {
    await addAnalysis({
      sampleId: sample.id,
      target: 'sample',
      method: analysisDraft.method,
      fa: Number(analysisDraft.fa),
      fs: Number(analysisDraft.fs),
      ni: Number(analysisDraft.ni),
      kamaciteBandwidth: Number(analysisDraft.kamaciteBandwidth),
      testedAt: analysisDraft.testedAt,
    });
    notify(`已为 ${sample.sampleNo} 写入一条检测记录`);
  };

  return (
    <Stack spacing={2.5}>
      <Stack direction="row" spacing={1.5} alignItems="center">
        <Button component={RouterLink} to="/" startIcon={<ArrowBackIcon />} variant="text">
          返回总览
        </Button>
        <Typography variant="h4">样本详情</Typography>
      </Stack>

      <Grid container spacing={2.5}>
        <Grid item xs={12} md={4}>
          <SampleCard
            sample={sample}
            find={find}
            sectionCount={mySections.length}
            analysisCount={myAnalysis.length}
          />
        </Grid>

        <Grid item xs={12} md={8}>
          <Paper variant="outlined" sx={{ p: 2.5, height: '100%' }}>
            <Stack spacing={1.5}>
              <Stack direction="row" justifyContent="space-between" alignItems="center">
                <Typography variant="h6">基本信息</Typography>
                <Button
                  size="small"
                  variant="outlined"
                  onClick={() => {
                    void updateSample(sample.id, { storage: sample.storage === 'loan-out' ? 'cabinet-a' : 'loan-out' });
                    notify('已切换存放状态');
                  }}
                >
                  切换存放状态
                </Button>
              </Stack>
              <ClassificationBadge
                category={sample.category}
                group={sample.chemicalGroup}
                size="medium"
              />
              <Grid container spacing={1.5}>
                <Grid item xs={6} sm={4}>
                  <Typography variant="caption" color="text.secondary">
                    编号
                  </Typography>
                  <Typography variant="body1">{sample.sampleNo}</Typography>
                </Grid>
                <Grid item xs={6} sm={4}>
                  <Typography variant="caption" color="text.secondary">
                    总重量
                  </Typography>
                  <Typography variant="body1">{formatWeight(sample.totalWeight)}</Typography>
                </Grid>
                <Grid item xs={6} sm={4}>
                  <Typography variant="caption" color="text.secondary">
                    风化等级
                  </Typography>
                  <Typography variant="body1">{WEATHERING_LABELS[sample.weathering]}</Typography>
                </Grid>
                <Grid item xs={6} sm={4}>
                  <Typography variant="caption" color="text.secondary">
                    发现 / 坠落
                  </Typography>
                  <Typography variant="body1">{FALL_OR_FIND_LABELS[sample.fallOrFind]}</Typography>
                </Grid>
                <Grid item xs={6} sm={4}>
                  <Typography variant="caption" color="text.secondary">
                    存放位置
                  </Typography>
                  <Typography variant="body1">{STORAGE_LABELS[sample.storage]}</Typography>
                </Grid>
                <Grid item xs={6} sm={4}>
                  <Typography variant="caption" color="text.secondary">
                    登记 / 更新
                  </Typography>
                  <Typography variant="body1">
                    {formatDate(sample.createdAt)} / {formatDate(sample.updatedAt)}
                  </Typography>
                </Grid>
              </Grid>
              {sample.note ? (
                <Typography variant="body2" color="text.secondary">
                  备注：{sample.note}
                </Typography>
              ) : null}
              <Divider />
              <Typography variant="h6">发现地摘要</Typography>
              {find ? (
                <Grid container spacing={1.5}>
                  <Grid item xs={6} sm={4}>
                    <Typography variant="caption" color="text.secondary">
                      地名
                    </Typography>
                    <Typography variant="body2">{find.placeName}</Typography>
                  </Grid>
                  <Grid item xs={6} sm={4}>
                    <Typography variant="caption" color="text.secondary">
                      国家 / 地区
                    </Typography>
                    <Typography variant="body2">{find.region}</Typography>
                  </Grid>
                  <Grid item xs={6} sm={4}>
                    <Typography variant="caption" color="text.secondary">
                      坐标
                    </Typography>
                    <Typography variant="body2">
                      {formatCoordinate(find.longitude, find.latitude)}
                    </Typography>
                  </Grid>
                  <Grid item xs={6} sm={4}>
                    <Typography variant="caption" color="text.secondary">
                      坐标来源
                    </Typography>
                    <Typography variant="body2">
                      {COORDINATE_SOURCE_LABELS[find.coordinateSource]}
                    </Typography>
                  </Grid>
                  <Grid item xs={6} sm={4}>
                    <Typography variant="caption" color="text.secondary">
                      发现环境
                    </Typography>
                    <Typography variant="body2">
                      {FIND_ENVIRONMENT_LABELS[find.environment]}
                    </Typography>
                  </Grid>
                  <Grid item xs={6} sm={4}>
                    <Typography variant="caption" color="text.secondary">
                      发现者
                    </Typography>
                    <Typography variant="body2">{find.finder}</Typography>
                  </Grid>
                </Grid>
              ) : (
                <Alert severity="warning">
                  该样本尚未登记发现地坐标，可返回 <RouterLink to="/samples/new">样本登记</RouterLink> 补录。
                </Alert>
              )}
            </Stack>
          </Paper>
        </Grid>
      </Grid>

      <Grid container spacing={2.5}>
        <Grid item xs={12} md={7}>
          <Paper variant="outlined" sx={{ p: 2.5 }}>
            <Typography variant="h6" sx={{ mb: 1.5 }}>
              切片与制样（{mySections.length}）
            </Typography>
            {mySections.length === 0 ? (
              <Alert severity="info">暂无切片记录，可在下方按制样日期送排。</Alert>
            ) : (
              <Stack spacing={1.25}>
                {mySections.map((s) => {
                  const sch = s.scheduleId
                    ? mySchedules.find((sc) => sc.id === s.scheduleId)
                    : undefined;
                  const prep = sectionPrepStatus(s);
                  return (
                    <Box
                      key={s.id}
                      sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, p: 1.5 }}
                    >
                      <Stack direction="row" justifyContent="space-between" flexWrap="wrap" gap={1}>
                        <Typography variant="subtitle1" fontWeight={700}>
                          {s.sectionNo}
                        </Typography>
                        <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
                          <Chip size="small" label={`厚度 ${s.thickness} μm`} />
                          <Chip size="small" variant="outlined" label={PREPARATION_LABELS[s.preparation]} />
                          <PrepStatusChip status={prep} />
                          <Chip
                            size="small"
                            variant="outlined"
                            label={s.scheduleDate ? `制样日 ${s.scheduleDate}` : '待排（未选日期）'}
                          />
                        </Stack>
                      </Stack>
                      <Typography variant="body2" color="text.secondary">
                        矿物占比：{MINERAL_KEYS.map((k) => `${MINERAL_LABELS[k]} ${s.minerals[k]}%`).join(' · ')}
                        （合计 {mineralTotal(s.minerals)}%）
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        显微照片：{s.micrographs.length ? s.micrographs.join('、') : '未上传'}
                        {sch && sch.status === 'queued' ? ` · 排队第 ${sch.queuePosition} 位，名额释放后自动前移` : ''}
                      </Typography>
                      {sch && (sch.status === 'queued' || sch.status === 'scheduled') ? (
                        <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
                          {sch.status === 'scheduled' ? (
                            <>
                              <Button
                                size="small"
                                color="success"
                                variant="outlined"
                                onClick={() => {
                                  void completeScheduleAction(sch.id);
                                  notify(`切片 ${s.sectionNo} 已完成制样，可绑定检测记录`);
                                }}
                              >
                                完成制样
                              </Button>
                              <Button
                                size="small"
                                color="error"
                                variant="outlined"
                                onClick={() => {
                                  void failScheduleAction(sch.id);
                                  notify('已标记制样失败，名额释放并重排队列', 'warning');
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
                              void cancelScheduleAction(sch.id);
                              notify('已取消排程，名额释放，后面任务前移', 'info');
                            }}
                          >
                            {sch.status === 'queued' ? '退出排队' : '取消排程'}
                          </Button>
                        </Stack>
                      ) : null}
                    </Box>
                  );
                })}
              </Stack>
            )}

            <Divider sx={{ my: 2 }} />
            <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1 }}>
              送样制样（按「制样方式 × 日期」占名额）
            </Typography>
            {onLoan ? (
              <Alert severity="error" sx={{ mb: 1.5 }}>
                样本当前为「外借中」，制样排程直接拒绝；请在基本信息区切回存放状态后再送排。
              </Alert>
            ) : null}
            {formError ? <Alert severity="error" sx={{ mb: 1.5 }}>{formError}</Alert> : null}
            {slotConflict ? (
              <Alert severity="warning" sx={{ mb: 1.5 }}>
                {slotConflict}：两个页签同时提交，最后一个名额只允许一方成功。当前表单内容已保留为冲突草稿，
                可改期、改换制样方式后重提，或确认后按排队处理。
              </Alert>
            ) : null}
            <Stack spacing={1.5}>
              <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap>
                <TextField
                  id="section-no"
                  size="small"
                  label="切片编号"
                  value={sectionDraft.sectionNo}
                  onChange={(e) => setSectionDraft((d) => ({ ...d, sectionNo: e.target.value }))}
                  sx={{ width: 180 }}
                />
                <TextField
                  id="section-thickness"
                  size="small"
                  type="number"
                  label="厚度 μm"
                  value={sectionDraft.thickness}
                  onChange={(e) => setSectionDraft((d) => ({ ...d, thickness: Number(e.target.value) }))}
                  sx={{ width: 140 }}
                />
                <FormControl size="small" sx={{ minWidth: 150 }}>
                  <InputLabel id="prep-label">制样方式</InputLabel>
                  <Select
                    labelId="prep-label"
                    label="制样方式"
                    value={sectionDraft.preparation}
                    onChange={(e) => {
                      setSlotConflict(null);
                      setSectionDraft((d) => ({ ...d, preparation: e.target.value as PreparationMethod }));
                    }}
                  >
                    {PREPARATIONS.map((p) => (
                      <MenuItem key={p} value={p}>
                        {PREPARATION_LABELS[p]}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
                <TextField
                  id="section-schedule-date"
                  size="small"
                  type="date"
                  label="制样日期"
                  InputLabelProps={{ shrink: true }}
                  value={sectionDraft.scheduleDate}
                  onChange={(e) => {
                    setSlotConflict(null);
                    setSectionDraft((d) => ({ ...d, scheduleDate: e.target.value }));
                  }}
                  sx={{ width: 170 }}
                />
                <FormControl size="small" sx={{ minWidth: 170 }}>
                  <InputLabel id="quality-label">质量标注</InputLabel>
                  <Select
                    labelId="quality-label"
                    label="质量标注"
                    value={sectionDraft.quality}
                    onChange={(e) =>
                      setSectionDraft((d) => ({ ...d, quality: e.target.value as SectionQuality }))
                    }
                  >
                    {SECTION_QUALITIES.map((q) => (
                      <MenuItem key={q} value={q}>
                        {SECTION_QUALITY_LABELS[q]}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
                <TextField
                  id="section-micrograph"
                  size="small"
                  label="显微照片文件名"
                  value={sectionDraft.micrograph}
                  onChange={(e) => setSectionDraft((d) => ({ ...d, micrograph: e.target.value }))}
                  sx={{ width: 220 }}
                />
              </Stack>

              <Chip
                size="small"
                color={capacity.remaining > 0 ? 'success' : 'warning'}
                variant="outlined"
                sx={{ alignSelf: 'flex-start' }}
                label={`${PREPARATION_LABELS[sectionDraft.preparation]} · ${sectionDraft.scheduleDate} 名额 ${capacity.used}/${capacity.total}，` +
                  (capacity.remaining > 0
                    ? `剩余 ${capacity.remaining} 个`
                    : `已满，前面排队 ${capacity.queued} 位，新送样顺延`)}
              />

              <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap>
                {MINERAL_KEYS.map((k) => (
                  <FieldGroup
                    key={k}
                    title={`${MINERAL_LABELS[k]}占比`}
                    unit="%"
                    min={0}
                    max={100}
                    value={sectionDraft.minerals[k]}
                    onChange={(v) =>
                      setSectionDraft((d) => ({ ...d, minerals: { ...d.minerals, [k]: v } }))
                    }
                    inputId={`mineral-${k}`}
                    label={MINERAL_LABELS[k]}
                  />
                ))}
              </Stack>
              <Typography variant="caption" color={mineralSum === 100 ? 'success.main' : 'warning.main'}>
                矿物占比合计 {mineralSum}%（建议合计 100%）
              </Typography>
              <Button
                variant="contained"
                startIcon={<AddIcon />}
                onClick={() => void submitSection()}
                id="add-section"
                disabled={onLoan}
                sx={{ alignSelf: 'flex-start' }}
              >
                {capacity.remaining > 0 ? '送样并排定' : '送样（排入队列）'}
              </Button>
            </Stack>
          </Paper>
        </Grid>

        <Grid item xs={12} md={5}>
          <Paper variant="outlined" sx={{ p: 2.5 }}>
            <Typography variant="h6" sx={{ mb: 1.5 }}>
              分析检测记录（{myAnalysis.length}）
            </Typography>
            {myAnalysis.length === 0 ? (
              <Alert severity="info">暂无检测记录。</Alert>
            ) : (
              <Stack spacing={1.25} sx={{ mb: 2 }}>
                {myAnalysis.map((a) => {
                  const a2 = classifyByAnalysis(a);
                  return (
                    <Box
                      key={a.id}
                      sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, p: 1.5 }}
                    >
                      <Stack direction="row" justifyContent="space-between" flexWrap="wrap" gap={1}>
                        <Typography variant="subtitle2">
                          {ANALYSIS_METHOD_LABELS[a.method]} · {a.testedAt}
                        </Typography>
                        <ClassificationBadge category={a2.category} showGroup={false} />
                      </Stack>
                      <Typography variant="body2" color="text.secondary">
                        Fa {formatNumber(a.fa, 2, ' mol%')} · Fs {formatNumber(a.fs, 2, ' mol%')} · Ni{' '}
                        {formatNumber(a.ni, 2, ' wt%')} · 带宽 {formatNumber(a.kamaciteBandwidth, 3, ' mm')}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {a2.summary}
                      </Typography>
                    </Box>
                  );
                })}
              </Stack>
            )}

            <Divider sx={{ my: 2 }} />
            <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1 }}>
              就地录入检测数值
            </Typography>
            <Stack spacing={1.5}>
              <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap>
                <FormControl size="small" sx={{ minWidth: 150 }}>
                  <InputLabel id="method-label">检测方法</InputLabel>
                  <Select
                    labelId="method-label"
                    label="检测方法"
                    value={analysisDraft.method}
                    onChange={(e) =>
                      setAnalysisDraft((d) => ({ ...d, method: e.target.value as AnalysisMethod }))
                    }
                  >
                    {ANALYSIS_METHODS.map((m) => (
                      <MenuItem key={m} value={m}>
                        {ANALYSIS_METHOD_LABELS[m]}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
                <TextField
                  id="detail-tested-at"
                  size="small"
                  type="date"
                  label="检测日期"
                  InputLabelProps={{ shrink: true }}
                  value={analysisDraft.testedAt}
                  onChange={(e) => setAnalysisDraft((d) => ({ ...d, testedAt: e.target.value }))}
                  sx={{ width: 180 }}
                />
              </Stack>
              <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap>
                <FieldGroup
                  title="橄榄石 Fa"
                  unit="mol%"
                  min={0}
                  max={30}
                  value={analysisDraft.fa}
                  onChange={(v) => setAnalysisDraft((d) => ({ ...d, fa: v }))}
                  inputId="detail-fa"
                  label="Fa"
                />
                <FieldGroup
                  title="辉石 Fs"
                  unit="mol%"
                  min={0}
                  max={30}
                  value={analysisDraft.fs}
                  onChange={(v) => setAnalysisDraft((d) => ({ ...d, fs: v }))}
                  inputId="detail-fs"
                  label="Fs"
                />
                <FieldGroup
                  title="Ni 含量"
                  unit="wt%"
                  min={0}
                  max={20}
                  value={analysisDraft.ni}
                  onChange={(v) => setAnalysisDraft((d) => ({ ...d, ni: v }))}
                  inputId="detail-ni"
                  label="Ni"
                />
                <FieldGroup
                  title="铁纹石带宽"
                  unit="mm"
                  min={0}
                  max={2}
                  value={analysisDraft.kamaciteBandwidth}
                  onChange={(v) => setAnalysisDraft((d) => ({ ...d, kamaciteBandwidth: v }))}
                  inputId="detail-band"
                  label="带宽"
                />
              </Stack>
              <Alert severity={hits.every((h) => h.inRange) ? 'success' : 'warning'}>
                分类建议：{advice.summary}
                <br />
                阈值命中：{hits.filter((h) => h.inRange).length}/{hits.length} 项落在常规区间
                <br />
                命中说明：{advice.hits.join('；')}
              </Alert>
              <Button
                variant="contained"
                startIcon={<AddIcon />}
                onClick={submitAnalysis}
                id="add-analysis"
                sx={{ alignSelf: 'flex-start' }}
              >
                写入检测记录
              </Button>
              <Typography variant="caption" color="text.secondary">
                阈值参考：
                {ANALYSIS_THRESHOLDS.map((t) => `${t.label} ${t.min}~${t.max}${t.unit}`).join(' · ')}
              </Typography>
            </Stack>
          </Paper>
        </Grid>
      </Grid>
    </Stack>
  );
}
