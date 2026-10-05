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
import ScheduleManager from '../components/schedule/ScheduleManager';
import { useSampleStore } from '../stores/sampleStore';
import { useToastStore } from '../stores/uiStore';
import {
  ANALYSIS_METHODS,
  ANALYSIS_METHOD_LABELS,
  ANALYSIS_TARGETS,
  ANALYSIS_TARGET_LABELS,
  ANALYSIS_THRESHOLDS,
  type AnalysisMethod,
  type AnalysisTarget,
} from '../types/analysis';
import {
  MINERAL_KEYS,
  MINERAL_LABELS,
  PREPARATION_LABELS,
  SECTION_QUALITY_LABELS,
  mineralTotal,
} from '../types/section';
import {
  FALL_OR_FIND_LABELS,
  STORAGE_LABELS,
  WEATHERING_LABELS,
} from '../types/sample';
import { FIND_ENVIRONMENT_LABELS, COORDINATE_SOURCE_LABELS } from '../types/find';
import { SCHEDULE_STATUS_LABELS, isSectionPrepComplete } from '../types/schedule';
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
  const addAnalysis = useSampleStore((s) => s.addAnalysis);
  const updateSample = useSampleStore((s) => s.updateSample);
  const notify = useToastStore((s) => s.notify);

  const sample = useMemo(() => samples.find((s) => s.id === id), [samples, id]);
  const find = useMemo(() => finds.find((f) => f.sampleId === id), [finds, id]);
  const mySections = useMemo(() => sections.filter((s) => s.sampleId === id), [sections, id]);
  const myAnalysis = useMemo(() => analysis.filter((a) => a.sampleId === id), [analysis, id]);

  const completedSections = useMemo(
    () => mySections.filter((s) => isSectionPrepComplete(schedules, s.id)),
    [mySections, schedules],
  );

  const [analysisDraft, setAnalysisDraft] = useState({
    target: 'sample' as AnalysisTarget,
    sectionId: '',
    method: 'microprobe' as AnalysisMethod,
    fa: 18,
    fs: 16,
    ni: 0.8,
    kamaciteBandwidth: 0.05,
    testedAt: new Date().toISOString().slice(0, 10),
  });
  const [analysisError, setAnalysisError] = useState<string | null>(null);

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

  const advice = classifyByAnalysis(analysisDraft);
  const hits = evaluateThresholds(analysisDraft);

  const submitAnalysis = async () => {
    setAnalysisError(null);
    try {
      await addAnalysis({
        sampleId: sample.id,
        sectionId: analysisDraft.target === 'section' ? analysisDraft.sectionId : undefined,
        target: analysisDraft.target,
        method: analysisDraft.method,
        fa: Number(analysisDraft.fa),
        fs: Number(analysisDraft.fs),
        ni: Number(analysisDraft.ni),
        kamaciteBandwidth: Number(analysisDraft.kamaciteBandwidth),
        testedAt: analysisDraft.testedAt,
      });
      notify(`已为 ${sample.sampleNo} 写入一条检测记录`);
    } catch (e) {
      setAnalysisError(e instanceof Error ? e.message : '检测记录写入失败');
    }
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

      <Paper variant="outlined" sx={{ p: 2.5 }}>
        <ScheduleManager sampleId={sample.id} />
      </Paper>

      <Grid container spacing={2.5}>
        <Grid item xs={12} md={7}>
          <Paper variant="outlined" sx={{ p: 2.5 }}>
            <Typography variant="h6" sx={{ mb: 1.5 }}>
              切片列表（{mySections.length}）
            </Typography>
            {mySections.length === 0 ? (
              <Alert severity="info">暂无切片，可通过上方「制样排程」完成制样后自动登记。</Alert>
            ) : (
              <Stack spacing={1.25}>
                {mySections.map((s) => {
                  const sch = schedules.find((x) => x.sectionId === s.id);
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
                          <Chip size="small" color="secondary" label={SECTION_QUALITY_LABELS[s.quality]} />
                          {sch ? (
                            <Chip
                              size="small"
                              color={sch.status === 'completed' ? 'success' : 'primary'}
                              label={`制样：${SCHEDULE_STATUS_LABELS[sch.status]}`}
                            />
                          ) : (
                            <Chip size="small" color="warning" label="待排" />
                          )}
                        </Stack>
                      </Stack>
                      <Typography variant="body2" color="text.secondary">
                        矿物占比：{MINERAL_KEYS.map((k) => `${MINERAL_LABELS[k]} ${s.minerals[k]}%`).join(' · ')}
                        （合计 {mineralTotal(s.minerals)}%）
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        显微照片：{s.micrographs.length ? s.micrographs.join('、') : '未上传'}
                      </Typography>
                    </Box>
                  );
                })}
              </Stack>
            )}
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
                  const targetSection = a.sectionId
                    ? mySections.find((s) => s.id === a.sectionId)
                    : undefined;
                  return (
                    <Box
                      key={a.id}
                      sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, p: 1.5 }}
                    >
                      <Stack direction="row" justifyContent="space-between" flexWrap="wrap" gap={1}>
                        <Typography variant="subtitle2">
                          {ANALYSIS_METHOD_LABELS[a.method]} · {a.testedAt}
                        </Typography>
                        <Stack direction="row" spacing={0.5}>
                          <Chip
                            size="small"
                            variant="outlined"
                            label={
                              targetSection
                                ? `${ANALYSIS_TARGET_LABELS[a.target]}：${targetSection.sectionNo}`
                                : ANALYSIS_TARGET_LABELS[a.target]
                            }
                          />
                          <ClassificationBadge category={a2.category} showGroup={false} />
                        </Stack>
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
              {analysisError ? <Alert severity="error">{analysisError}</Alert> : null}
              <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap>
                <FormControl size="small" sx={{ minWidth: 130 }}>
                  <InputLabel id="detail-target-label">检测对象</InputLabel>
                  <Select
                    labelId="detail-target-label"
                    label="检测对象"
                    value={analysisDraft.target}
                    onChange={(e) =>
                      setAnalysisDraft((d) => ({ ...d, target: e.target.value as AnalysisTarget, sectionId: '' }))
                    }
                  >
                    {ANALYSIS_TARGETS.map((t) => (
                      <MenuItem key={t} value={t}>
                        {ANALYSIS_TARGET_LABELS[t]}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
                {analysisDraft.target === 'section' ? (
                  <FormControl size="small" sx={{ minWidth: 180 }}>
                    <InputLabel id="detail-section-label">关联切片</InputLabel>
                    <Select
                      labelId="detail-section-label"
                      label="关联切片"
                      value={analysisDraft.sectionId}
                      onChange={(e) => setAnalysisDraft((d) => ({ ...d, sectionId: e.target.value }))}
                    >
                      {completedSections.length === 0 ? (
                        <MenuItem value="" disabled>
                          暂无已完成制样的切片
                        </MenuItem>
                      ) : null}
                      {completedSections.map((s) => (
                        <MenuItem key={s.id} value={s.id}>
                          {s.sectionNo}（{s.thickness} μm）
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                ) : null}
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
              {analysisDraft.target === 'section' && completedSections.length === 0 ? (
                <Alert severity="warning">
                  该样本暂无已完成制样的切片，检测记录暂不能绑定切片；请先通过「制样排程」完成制样。
                </Alert>
              ) : null}
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
