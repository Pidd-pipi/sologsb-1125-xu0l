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
| `/samples/:id` | 样本详情：基本信息 + 发现地摘要 + 切片排程 + 分析记录，可就地送样制样与录入 | 五个模型 |
| `/sections` | 切片库：按厚度与矿物占比筛选，显示制样进度，回跳样本，批量标注质量 | ThinSection、MeteoriteSample |
| `/schedule` | 制样排程：按日期 × 制样方式展示名额占用与排队，取消/失败释放名额后任务前移 | PreparationSchedule、ThinSection、MeteoriteSample |
| `/analysis` | 分析检测：录入 Fa / Fs / Ni / 铁纹石带宽，实时分类建议；仅已完成制样的切片可绑定 | AnalysisRecord、MeteoriteSample、ThinSection |
| `/locations` | 发现地分布：SVG 网格按经纬度打点、按分类着色、点选弹出样本清单 | FindRecord、MeteoriteSample |

## 制样排程规则（v4）

树脂包埋与环氧粘接**每日名额独立**（默认 3 / 2，见 `DAILY_CAPACITY`），按「制样方式 × 日期」占用：

- 切片通过样本详情页「送样制样」创建，必须选择制样方式与日期；名额未满直接排定（`制样中`），满了按送样时间排队（`排队中`）
- **同一样本当天只能排一次**（不分制样方式）；样本处于「外借中」时送排直接拒绝，不产生切片与排程
- 取消排程或标记制样失败后名额立即失效，同事务内重算，后面排队任务自动前移、排队序号重排
- 全部校验、写入、重算在**同一个 IndexedDB 事务**内完成：两个页签同时抢最后一个名额时事务串行化，只允许一方成功；另一方收到 `capacity-lost` 冲突，表单内容原样保留为冲突草稿，由人工改期或确认排队
- 跨页签通过 Dexie `liveQuery` 实时同步占用情况
- 切片状态机：`待排 → 排队中 → 制样中 → 已完成`（旁路 `制样失败` / `已取消`）；只有 `已完成` 切片允许被检测记录绑定，store 层事务内强校验
- v4 升级时旧切片没有排程，统一标为 `待排`，不占名额，可补排

## 数据模型（`src/types/` 独立文件）

- `types/sample.ts` — **MeteoriteSample**：id、样本编号、总重量 g、分类、化学群、风化等级 W0–W4、发现/坠落、存放位置
- `types/find.ts` — **FindRecord**：id、关联样本、地名、国家地区、经纬度、坐标来源（GPS/文献）、发现环境、发现者
- `types/section.ts` — **ThinSection**：id、切片编号、关联样本、厚度 μm、制样方式、矿物占比、显微照片清单、制样进度（v4：待排/排队中/制样中/已完成/失败/取消）与关联排程
- `types/schedule.ts` — **PreparationSchedule**（v4 新增）：id、关联样本/切片、制样方式、制样日期、状态、排队序号、送样时间；每日容量常量
- `types/analysis.ts` — **AnalysisRecord**：id、关联样本或切片（切片必须已完成制样）、方法、橄榄石 Fa、辉石 Fs、Ni wt%、铁纹石带宽 mm、检测日期

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
        ├── types/{sample,find,section,schedule,analysis}.ts
        ├── db/index.ts                 # Dexie 封装与 v1→v4 升级迁移
        ├── services/scheduler.ts       # 名额占用/排队重算/状态流转/绑定校验（单事务）
        ├── stores/{sampleStore,uiStore}.ts
        ├── components/common/{SampleCard,Badge,PrepStatusChip,FieldGroup,EmptyState,CoordinatePicker,AppShell}.tsx
        ├── hooks/{useSampleFilter,useLocalDraft,useRegionStats}.ts
        ├── pages/{Overview,New,Detail,Sections,Schedule,Analysis,Locations}.tsx
        ├── router/index.tsx
        └── utils/{classify,format,geo}.ts
```

## 数据存储说明

- **库名**：`gbmeteorite-db`；表：`samples`、`finds`、`sections`、`analysis`、`schedules`
- **版本迁移**：
  - v1 建 `samples` / `finds` / `sections`
  - v2 新增 `analysis` 表并加 `sampleId` 索引
  - v3 为 `samples` 补 `updatedAt` 字段并按 id 回填旧记录
  - v4 新增 `schedules` 制样排程表；切片补 `prepStatus / scheduleId / scheduleDate`，旧切片统一标 `pending 待排`
- **草稿**：`/samples/new` 与 `/analysis` 的表单草稿写入 localStorage（键前缀 `gbmeteorite:draft:`），切页自动恢复，提交后清理；两个页签抢名额失败时送样表单以「冲突草稿」保留在当前页
- 首次打开会灌入 3 份演示样本、2 条发现记录、5 张切片（含待排/制样中/排队/失败各态）、5 条排程与 2 条检测记录，便于直接体验排程与前移
- **排程逻辑测试**：`npm run test:scheduler`（基于 fake-indexeddb，运行前需 `npm i --no-save fake-indexeddb tsx`），覆盖占名额、外借拒绝、同日重复、取消/失败前移、并发抢最后名额只成功一方、检测绑定拦截 27 个断言

## 环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `COMPOSE_PROJECT_NAME` | `gbmeteorite` | Compose 项目名与容器名前缀 |
| `FRONTEND_PORT` | `21825` | 宿主端口，映射到容器 80 |
