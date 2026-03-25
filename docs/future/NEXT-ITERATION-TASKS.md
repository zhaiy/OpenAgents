# OpenAgents 下一期迭代任务拆解

> 创建日期：2026-03-25
> 对应文档：`docs/future/NEXT-ITERATION-PLAN.md`
> 适用阶段：下一期“复盘与演进（聚焦版）”迭代

---

## 一、文档目的

本文档用于把下一期迭代计划进一步拆成可执行任务，便于：

- 做排期
- 做依赖管理
- 分配给不同模型或不同开发者
- 作为阶段验收依据

本次拆分强调以下原则：

1. 版本上下文优先
2. 差异解释优先
3. 复盘闭环优先
4. 测试同步优先

---

## 二、优先级定义

| 优先级 | 含义 |
|------|------|
| `P0` | 必须完成，否则本期“复盘与演进”目标不成立 |
| `P1` | 强烈建议完成，能显著提升复盘和调优价值 |
| `P2` | 可伴随推进，用于控制技术债与后续成本 |

---

## 三、难度定义

| 等级 | 含义 |
|------|------|
| `S` | 涉及版本语义、跨层关联、指标口径、较高联调风险 |
| `A` | 中高复杂度业务闭环，涉及多个模块 |
| `B` | 标准页面/API/测试增强任务 |
| `C` | 收尾、整理、文档、低风险增强 |

---

## 四、推荐开发顺序

建议按以下顺序推进：

1. `E1` 运行版本快照与关联基线
2. `E2` 版本差异视图
3. `E4` 失败 run 复盘摘要
4. `E6` 复盘与趋势测试补强
5. `E3` 历史趋势分析
6. `E5` 复盘链路联动收口
7. `E7` 快照与聚合层适度整理

关键路径如下：

```text
E1 -> E2 -> E4 -> E5 -> E6
  \-> E3 -----------^
E7 可伴随进行，但不应阻塞主链路
```

---

## 五、任务总表

| 编号 | 名称 | 优先级 | 难度 | 依赖 |
|------|------|------|------|------|
| E1 | 运行版本快照与关联基线 | P0 | S | 无 |
| E2 | 版本差异视图 | P0 | A | E1 |
| E3 | 历史趋势分析 | P1 | A | E1 |
| E4 | 失败 run 复盘摘要 | P0 | A | E1, E2 |
| E5 | 复盘链路联动收口 | P1 | B | E2, E3, E4 |
| E6 | 复盘与趋势测试补强 | P0 | A | E1, E2, E4, E5 |
| E7 | 快照与聚合层适度整理 | P2 | B | E1, E3, E4 |

---

## 六、详细任务拆解

## E1. 运行版本快照与关联基线

### 目标

先定义清楚 run 的版本来源、快照引用和与 recover / rerun 的承接关系，避免后续差异分析和复盘摘要建立在不稳定的历史样本上。

### 重点范围

- `src/app/dto.ts`
- `src/app/services/run-service.ts`
- `src/app/services/run-registry.ts`
- `src/app/services/workflow-service.ts`
- `src/web/routes.ts`
- `web/src/api/index.ts`

### 子任务

1. 定义 run version snapshot / provenance DTO
2. 明确 source run、recovered run、rerun run 的版本关联字段
3. 固化 workflow / agent / prompt / config 的最小可追踪上下文
4. 收口 run detail、compare、diagnostics 共享的版本字段
5. 补关键契约测试

### 建议产出

- 运行版本快照契约表
- 版本关联说明
- 契约测试

### 验收标准

- 用户可以知道一个 run 来自哪版 workflow 和关键配置
- 前后端不再各自推断版本来源
- rerun / recover 的版本承接关系清楚

---

## E2. 版本差异视图

### 目标

把 compare 从“展示结果差异”推进到“解释版本差异和可能影响”，让用户更容易判断变化来源。

### 重点范围

- `src/app/dto.ts`
- `src/app/services/run-compare-service.ts`
- `src/app/services/diagnostics-service.ts`
- `src/web/routes.ts`
- `web/src/pages/RunComparisonPage.tsx`
- `web/src/pages/RunDetailPage.tsx`

### 子任务

1. 聚合 workflow 结构、节点配置、模型、提示词等差异
2. 区分执行路径变化与输出风险变化
3. 让 compare 支持显示差异摘要与影响提示
4. 为失败 run 或回归 run 挂接版本变化背景
5. 补差异契约与页面测试

### 建议产出

- 版本差异 DTO
- 差异摘要区
- 差异聚合测试

### 验收标准

- 用户能回答“这两次 run 到底变了什么”
- compare 可说明变化可能影响的范围
- 差异结果在页面和 API 中口径一致

---

## E3. 历史趋势分析

### 目标

建立 workflow 级趋势摘要，让恢复、成本、质量等指标从单次观察升级为历史比较。

### 重点范围

- `src/app/dto.ts`
- `src/app/services/run-metrics.ts`
- `src/app/services/run-service.ts`
- `src/app/services/diagnostics-service.ts`
- `src/web/routes.ts`
- `web/src/pages/HomePage.tsx`
- `web/src/pages/RunsPage.tsx`
- `web/src/pages/WorkflowOverviewPage.tsx`

### 子任务

1. 定义最近 N 次运行的趋势聚合口径
2. 聚合成功率、失败率、duration、token、gate、recovery 等核心指标
3. 增加基础回归或异常波动提示
4. 在首页、runs 或 workflow 概览补趋势摘要入口
5. 补趋势统计测试

### 建议产出

- workflow trend DTO
- 趋势摘要卡片或列表增强
- 趋势口径测试

### 验收标准

- 用户能看出某个 workflow 最近是变好还是变差
- 关键指标在不同页面不各算一套
- 回归信号至少具备基础可见性

---

## E4. 失败 run 复盘摘要

### 目标

围绕失败 run 提供结构化复盘摘要，让 diagnostics 和 run detail 不再只是零散信息堆叠。

### 重点范围

- `src/app/dto.ts`
- `src/app/services/diagnostics-service.ts`
- `src/app/services/run-compare-service.ts`
- `src/app/services/recovery-planner.ts`
- `src/web/routes.ts`
- `web/src/pages/DiagnosticsPage.tsx`
- `web/src/pages/RunDetailPage.tsx`
- `web/src/pages/RunExecutionPage.tsx`

### 子任务

1. 汇总失败节点、失败类型和下游影响范围
2. 结合版本差异、恢复关系和关键指标生成复盘摘要
3. 提供 compare、recover、rerun-with-edits 等后续动作入口
4. 统一 diagnostics 与 run detail 的复盘表达
5. 补复盘摘要测试

### 建议产出

- 失败复盘 DTO
- 复盘摘要区
- 复盘聚合测试

### 验收标准

- 用户能更快理解失败发生在哪、影响到哪里
- 复盘摘要不是无来源文本，而是基于已有结构化数据
- diagnostics 可直接引导下一步动作

---

## E5. 复盘链路联动收口

### 目标

把 diagnostics、compare、timeline、recovery 这些已有能力串成一条更完整的复盘链路。

### 重点范围

- `src/web/routes.ts`
- `web/src/api/index.ts`
- `web/src/pages/DiagnosticsPage.tsx`
- `web/src/pages/RunComparisonPage.tsx`
- `web/src/pages/RunDetailPage.tsx`
- `web/src/pages/RunExecutionPage.tsx`

### 子任务

1. 统一失败 run 的推荐入口和导航表达
2. 让版本差异、趋势、复盘摘要可互相跳转
3. 强化 recovered run 与 source run 的复盘联动
4. 收口关键文案、空态、异常态
5. 补页面级 smoke / E2E 测试

### 建议产出

- 复盘导航闭环
- 页面联动收口
- smoke / E2E 用例

### 验收标准

- 用户不需要自己拼复盘路径
- run detail、diagnostics、compare 的角色边界更清晰
- 联动入口在异常态下也有合理反馈

---

## E6. 复盘与趋势测试补强

### 目标

建立版本、差异、趋势、复盘主链路的自动化保护，避免这期能力变成表面可看但后续容易回退的薄层功能。

### 重点范围

- `src/__tests__/`
- `src/app/services/*.test.ts`
- `web/tests/`

### 子任务

1. 版本快照与 run 关联测试
2. 差异 DTO / route / service 测试
3. 趋势口径测试
4. 失败复盘摘要测试
5. 关键跨页面复盘链路 smoke / E2E 回归

### 建议产出

- 复盘测试矩阵
- 一组差异与趋势统计测试
- 一组页面级复盘回归用例

### 验收标准

- 至少一条完整复盘主链路有自动化覆盖
- 版本差异和趋势口径的回归可被及时发现
- 页面联动变化不会静默破坏复盘体验

---

## E7. 快照与聚合层适度整理

### 目标

适度整理版本快照、趋势统计、复盘摘要相关聚合逻辑，为后续更深的版本演进与趋势分析做结构预留。

### 重点范围

- `src/app/services/run-metrics.ts`
- `src/app/services/run-compare-service.ts`
- `src/app/services/diagnostics-service.ts`
- `src/app/dto.ts`
- `src/web/routes.ts`

### 子任务

1. 收敛重复的版本和趋势聚合逻辑
2. 明确快照 DTO、trend DTO、recap DTO 的职责边界
3. 清理明显无价值的兼容字段
4. 补统计口径说明
5. 补必要的低风险回归测试

### 建议产出

- 轻量聚合层整理
- 口径说明文档
- 低风险结构回归测试

### 验收标准

- 聚合逻辑不再分散在多个页面和服务里
- 版本、趋势、复盘三类字段含义更清晰
- 下一轮趋势与复盘增强不需要大面积返工

