# 陨石样本编目台（sologsb-1125 / gbmeteorite）

## Docker 一键启动

```bash
cp .env.example .env
docker compose up -d --build
```

启动后访问：<http://localhost:21825>

停止（镜像保留）：

```bash
docker compose down
```

## 项目简介

面向陨石收藏者与标本室的纯前端单页应用：把样本、发现记录、切片制样与检测数值整理成本地可检索档案。
核心动作是登记样本与发现地坐标、挂接切片、录入电子探针数值并给出分类建议。
标本室按送样顺序排切片：树脂包埋与环氧粘接每天容量有限，满额自动排队；同一样本当天不能重复排，外借样本直接拒绝；取消或失败后名额释放、排队任务前移；两个页签抢最后一个名额时只有一方成功，另一方保留带冲突的草稿。旧切片升级为「待排」，未完成制样前检测记录不能绑定切片。

- 纯前端 SPA：**无后端、无数据库服务、无外部 API**
- 所有数据保存在浏览器本地：业务数据走 **IndexedDB（Dexie，库名 `gbmeteorite-db`）**，表单草稿走 **localStorage**
- 容器无状态，不挂载任何命名卷；换浏览器即换档案库

## 技术栈

| 层次 | 选型 |
| --- | --- |
| 框架 | React 18 + TypeScript 5.7 |
| 构建 | Vite 6（`build` 脚本为 `tsc -b && vite build`，类型检查零错误） |
| UI 组件库 | MUI（@mui/material 6 + @mui/icons-material） |
| 状态管理 | Zustand（`sampleStore` 业务数据 / `uiStore` 筛选与提示） |
| 路由 | React Router 6（BrowserRouter + nginx `try_files` 兜底） |
| 本地存储 | Dexie 4（IndexedDB）+ localStorage（草稿） |
| 部署 | 多阶段 Dockerfile：node:20-alpine 构建 → nginx:alpine 托管 |

## 核心页面

| 路由 | 说明 | 消费模型 |
| --- | --- | --- |
| `/` | 样本总览：卡片流 + 分类/化学群/重量区间筛选与排序，缺坐标或缺切片显示角标 | MeteoriteSample |
| `/samples/new` | 样本登记：编号生成、分类化学群、重量、存放位置，可补录发现地坐标并即时校验 | MeteoriteSample、FindRecord |
| `/samples/:id` | 样本详情：基本信息 + 发现地摘要 + 制样排程 + 切片列表 + 分析记录，可就地新增 | 四个模型 + PreparationSchedule |
| `/schedules` | 制样排程：按日期查看树脂/环氧名额占用与排队顺序，支持取消、失败与完成制样 | PreparationSchedule、MeteoriteSample |
| `/sections` | 切片库：按厚度与矿物占比筛选，回跳样本，批量标注质量，显示「待排」徽标 | ThinSection、MeteoriteSample |
| `/analysis` | 分析检测：录入 Fa / Fs / Ni / 铁纹石带宽，实时分类建议与阈值命中说明；仅已完成制样的切片可绑定 | AnalysisRecord、MeteoriteSample |
| `/locations` | 发现地分布：SVG 网格按经纬度打点、按分类着色、点选弹出样本清单 | FindRecord、MeteoriteSample |

## 数据模型（`src/types/` 独立文件）

- `types/sample.ts` — **MeteoriteSample**：id、样本编号、总重量 g、分类、化学群、风化等级 W0–W4、发现/坠落、存放位置
- `types/find.ts` — **FindRecord**：id、关联样本、地名、国家地区、经纬度、坐标来源（GPS/文献）、发现环境、发现者
- `types/section.ts` — **ThinSection**：id、切片编号、关联样本、厚度 μm、制样方式、矿物占比、显微照片清单、scheduleId（无排程的旧切片标记「待排」）
- `types/analysis.ts` — **AnalysisRecord**：id、关联样本或切片、方法、橄榄石 Fa、辉石 Fs、Ni wt%、铁纹石带宽 mm、检测日期
- `types/schedule.ts` — **PreparationSchedule**：id、关联样本、制样方式、排程日期、状态（queued/scheduled/completed/cancelled/failed）、完成后产出的 sectionId；按「方式 + 日期」占用名额，同一样本当天不可重复排

## 目录结构

```
sologsb-1125/
├── docker-compose.yml
├── .env / .env.example
├── README.md
└── frontend/
    ├── Dockerfile          # 多阶段：node:20-alpine → nginx:alpine
    ├── nginx.conf          # try_files + gzip
    ├── index.html
    ├── package.json
    ├── tsconfig*.json
    ├── vite.config.ts
    ├── public/favicon.svg
    └── src/
        ├── types/{sample,find,section,analysis,schedule}.ts
        ├── db/index.ts                 # Dexie 封装与 v1→v4 升级迁移
        ├── stores/{sampleStore,uiStore}.ts
        ├── components/common/{SampleCard,Badge,FieldGroup,EmptyState,CoordinatePicker,AppShell}.tsx
        ├── components/schedule/ScheduleManager.tsx   # 制样排程：排期/排队/完成/取消/失败
        ├── hooks/{useSampleFilter,useLocalDraft,useRegionStats}.ts
        ├── pages/{Overview,New,Detail,Sections,Analysis,Locations,Schedules}.tsx
        ├── router/index.tsx
        └── utils/{classify,format,geo,schedule}.ts
```

## 数据存储说明

- **库名**：`gbmeteorite-db`；表：`samples`、`finds`、`sections`、`analysis`、`schedules`
- **版本迁移**：
  - v1 建 `samples` / `finds` / `sections`
  - v2 新增 `analysis` 表并加 `sampleId` 索引
  - v3 为 `samples` 补 `updatedAt` 字段并按 id 回填旧记录
  - v4 新增 `schedules` 制样排程表（含 `[method+scheduledDate]` 复合索引），`sections` 加 `scheduleId` 索引；旧切片无排程 → 界面标「待排」
- **制样排程规则**：树脂包埋 / 环氧粘接各 2 个 · 日容量，满额自动排队；同一样本当天不可重复排；外借样本直接拒绝；取消 / 失败后名额释放、排队中最早任务前移补位；跨页签抢最后一个名额时只有一方成功，另一方保留带冲突的草稿（localStorage）
- **检测绑定限制**：仅「已完成制样」的切片可被检测记录绑定，未完成制样前检测记录不能绑定切片
- **草稿**：`/samples/new` 与 `/analysis` 的表单草稿写入 localStorage（键前缀 `gbmeteorite:draft:`），切页自动恢复，提交后清理
- 首次打开会灌入 3 份演示样本、2 条发现记录、2 张切片与 2 条检测记录，便于直接体验筛选与打点

## 环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `COMPOSE_PROJECT_NAME` | `gbmeteorite` | Compose 项目名与容器名前缀 |
| `FRONTEND_PORT` | `21825` | 宿主端口，映射到容器 80 |
