# OpenAgents 下一期模型开发提示词

> 创建日期：2026-03-25
> 适用范围：下一期迭代 `E1-E7`
> 目标：为 `gpt-5.3-codex`、`GLM-5`、`Kimi K2.5`、`qwen3.5`、`minimax m2.7` 或更强模型提供可直接执行的开发提示词

---

## 一、使用说明

本文档用于直接向模型下发下一期“复盘与演进（聚焦版）”相关任务。

建议使用顺序：

1. 先发送“通用总控提示词”
2. 再发送对应任务的“专项提示词”
3. 如任务涉及版本来源、差异解释、历史趋势，附上任务拆解文档
4. 如任务涉及整体边界判断，附上迭代计划文档和三期路线图
5. 完成后按交付要求审查

建议配套文档：

- `docs/future/NEXT-ITERATION-PLAN.md`
- `docs/future/NEXT-ITERATION-TASKS.md`
- `docs/future/THREE-ITERATIONS-ROADMAP.md`

---

## 二、通用总控提示词

以下提示词建议在每次正式分发前先发送一次。

### 通用总控提示词

```text
你现在要在 OpenAgents 项目中完成一个有明确边界的迭代任务。

本期主题是：复盘与演进（聚焦版）。

你的目标不是自由发挥，而是在既有规划内稳定落地，让系统更适合版本比较、趋势判断和失败复盘。

请严格遵守以下要求：

1. 先阅读并遵守以下文档：
   - docs/future/NEXT-ITERATION-PLAN.md
   - docs/future/NEXT-ITERATION-TASKS.md
   - docs/future/THREE-ITERATIONS-ROADMAP.md

2. 本次任务必须遵守这些原则：
   - 不新增未约定的新主流程
   - 不擅自改变现有 run / rerun / recover 主链路核心语义
   - 不做大规模重构
   - 不通过新增兼容字段或页面特判掩盖版本来源或统计口径问题
   - 先定义版本上下文、差异口径、趋势口径，再做展示层收口
   - 测试必须与实现同步提交

3. 修改前先说明：
   - 你理解的任务目标
   - 你准备修改的文件
   - 哪些内容明确不在本次范围内

4. 如果你发现以下任一情况，不要硬做，请明确停下并说明：
   - 需要重新定义 run、workflow、snapshot 的系统级边界
   - 需要重做 compare 或 diagnostics 的主职责划分
   - 需要重新设计统计系统而不是局部增强
   - 任务说明与现有代码现实明显冲突

5. 完成后必须输出：
   - 修改摘要
   - 修改文件列表
   - 新增或更新的测试
   - 剩余风险
   - 是否建议升级到更强模型继续处理

如果你明白，请先复述你的执行边界，再开始动手。
```

---

## 三、模型分工建议

### 更适合 `gpt-5.3-codex` 的任务

- 运行版本快照语义定义
- 版本差异和复盘摘要的跨层契约设计
- 趋势与复盘聚合口径定稿
- 多服务协同修改
- 低风险结构整理

### 更适合 `GLM-5` 的任务

- service 层增强
- DTO / route / 前端类型跨层同步
- 历史趋势和复盘聚合实现
- route / integration 测试补强

### 更适合 `Kimi K2.5` 的任务

- 页面收口
- compare / diagnostics / run detail 的复盘表达
- 历史趋势摘要面板
- 文案、空态、异常态收口
- smoke / E2E / 页面行为测试补充

### 更适合 `qwen3.5` 的任务

- 页面收口
- 异常态与空态处理
- 基础 API 消费层同步
- smoke / E2E / 基础测试补充

### 更适合 `minimax m2.7` 的任务

- service 层增强
- DTO / route / 前端类型同步
- 中复杂度聚合逻辑
- route / service 测试

### 不建议直接交给中等模型独立主导的任务

- `E1` 的版本快照与 provenance 最终定稿
- `E2` 的版本差异语义与影响范围解释
- `E7` 的聚合层整理方案

---

## 四、任务提示词

## Prompt A：E1 运行版本快照与关联基线

### 建议模型

- 主推：`gpt-5.3-codex` 或同级更强模型
- 可配合：`GLM-5`
- 不建议：`qwen3.5` 独立主导

### 提示词

```text
请在 OpenAgents 项目中完成 E1：运行版本快照与关联基线。

先阅读以下文档：
- docs/future/NEXT-ITERATION-PLAN.md
- docs/future/NEXT-ITERATION-TASKS.md
- docs/future/THREE-ITERATIONS-ROADMAP.md

任务目标：
- 定义 run 的 version snapshot / provenance 稳定契约
- 明确 workflow、agent、prompt、关键配置与 run 的关联方式
- 明确 rerun、rerun-with-edits、recover 后的版本承接关系
- 为 compare、diagnostics、run detail 提供统一版本上下文

允许重点修改：
- src/app/dto.ts
- src/app/services/run-service.ts
- src/app/services/run-registry.ts
- src/app/services/workflow-service.ts
- src/web/routes.ts
- web/src/api/index.ts
- 相关测试文件

明确禁止：
- 不直接扩散到大范围页面重构
- 不在版本契约未定义清楚前先做大量 UI 表达
- 不保留长期模糊兼容字段

请按以下顺序工作：
1. 先列出当前 run 相关数据模型中哪些字段不足以表达版本来源
2. 给出 run、source run、recovered run、compared run 的共同版本字段设计
3. 设计最小必要 DTO 和 route 契约
4. 实施最小必要修改
5. 补关键 contract / route 测试

交付要求：
- 输出 run version snapshot 相关 DTO 清单
- 输出 rerun / recover 的版本承接说明
- 输出哪些字段是新引入的
- 输出新增测试
- 输出仍然需要更强模型决策的系统级问题

如果你发现当前代码无法稳定表达运行版本上下文，请明确停下并说明核心阻塞点。
```

---

## Prompt B：E2 版本差异视图

### 建议模型

- 主推：`gpt-5.3-codex` 定边界后，`GLM-5` 落地
- 可配合：`Kimi K2.5`

### 提示词

```text
请在 OpenAgents 项目中完成 E2：版本差异视图。

先阅读以下文档：
- docs/future/NEXT-ITERATION-PLAN.md
- docs/future/NEXT-ITERATION-TASKS.md
- docs/future/THREE-ITERATIONS-ROADMAP.md

任务目标：
- 把 compare 从结果对比推进到版本和配置差异解释
- 解释 workflow 结构、节点配置、模型、提示词等关键差异
- 区分“执行路径变化”和“输出风险变化”
- 让失败 run 或回归 run 具备可解释的变化背景

允许重点修改：
- src/app/dto.ts
- src/app/services/run-compare-service.ts
- src/app/services/diagnostics-service.ts
- src/web/routes.ts
- web/src/pages/RunComparisonPage.tsx
- web/src/pages/RunDetailPage.tsx
- 相关测试文件

明确禁止：
- 不做只展示差异名称、不解释影响范围的 UI
- 不返回没有来源依据的差异结果
- 不新增独立新页面

请按以下顺序工作：
1. 明确 compare 最需要表达哪些差异类型
2. 先做 DTO / service / route
3. 再做页面上的差异摘要和影响提示
4. 补差异结果与页面展示一致性的测试

交付要求：
- 输出差异 DTO 返回了哪些信息
- 输出差异如何聚合得出
- 输出页面如何帮助用户判断结果变化原因
- 输出新增测试
```

---

## Prompt C：E3 历史趋势分析

### 建议模型

- 主推：`GLM-5`
- 可配合：`Kimi K2.5`

### 提示词

```text
请在 OpenAgents 项目中完成 E3：历史趋势分析。

先阅读以下文档：
- docs/future/NEXT-ITERATION-PLAN.md
- docs/future/NEXT-ITERATION-TASKS.md
- docs/future/THREE-ITERATIONS-ROADMAP.md

任务目标：
- 建立 workflow 级历史趋势摘要
- 聚合成功率、失败率、duration、token、gate、recovery 等指标
- 让用户能识别回归、波动和优化效果
- 在首页、runs 或 workflow 概览中补充趋势入口

允许重点修改：
- src/app/dto.ts
- src/app/services/run-metrics.ts
- src/app/services/run-service.ts
- src/app/services/diagnostics-service.ts
- src/web/routes.ts
- web/src/pages/HomePage.tsx
- web/src/pages/RunsPage.tsx
- web/src/pages/WorkflowOverviewPage.tsx
- 相关测试文件

明确禁止：
- 不只是在更多页面重复展示同一组数字
- 不引入没有统一口径的趋势指标
- 不把趋势分析提前做成重报表系统

请按以下顺序工作：
1. 梳理当前可用的恢复、成本、质量指标
2. 定义本次趋势聚合口径和最近 N 次窗口
3. 实施 DTO / service / route 增强
4. 更新页面摘要
5. 补趋势统计测试

交付要求：
- 说明趋势分析新增了哪些信息
- 说明这些信息如何聚合得出
- 说明页面如何帮助用户识别回归或波动
- 说明新增测试
```

---

## Prompt D：E4 失败 run 复盘摘要

### 建议模型

- 主推：`GLM-5`
- 可配合：`Kimi K2.5`

### 提示词

```text
请在 OpenAgents 项目中完成 E4：失败 run 复盘摘要。

先阅读以下文档：
- docs/future/NEXT-ITERATION-PLAN.md
- docs/future/NEXT-ITERATION-TASKS.md
- docs/future/THREE-ITERATIONS-ROADMAP.md

任务目标：
- 让失败 run 具备结构化复盘摘要
- 汇总失败节点、失败类型、下游影响、关键版本变化和恢复关系
- 让 diagnostics 与 run detail 能给出一致的复盘表达
- 给后续 compare、recover、rerun-with-edits 提供明确入口

允许重点修改：
- src/app/dto.ts
- src/app/services/diagnostics-service.ts
- src/app/services/run-compare-service.ts
- src/app/services/recovery-planner.ts
- src/web/routes.ts
- web/src/pages/DiagnosticsPage.tsx
- web/src/pages/RunDetailPage.tsx
- web/src/pages/RunExecutionPage.tsx
- 相关测试文件

明确禁止：
- 不做没有结构化来源的“AI 总结腔”文案
- 不把复盘摘要写成只适合单个页面消费的特判结构
- 不新增独立复盘页面

请按以下顺序工作：
1. 明确复盘摘要需要覆盖哪些最关键的信息
2. 先做 DTO / service / route
3. 再做 diagnostics / run detail 的复盘摘要区
4. 补复盘摘要与真实数据一致性的测试

交付要求：
- 输出复盘摘要包含哪些信息
- 输出这些信息如何从已有数据聚合得出
- 输出页面如何帮助用户进入下一步处理
- 输出新增测试
```

---

## Prompt E：E5 复盘链路联动收口

### 建议模型

- 主推：`Kimi K2.5`
- 可配合：`qwen3.5`

### 提示词

```text
请在 OpenAgents 项目中完成 E5：复盘链路联动收口。

先阅读以下文档：
- docs/future/NEXT-ITERATION-PLAN.md
- docs/future/NEXT-ITERATION-TASKS.md
- docs/future/THREE-ITERATIONS-ROADMAP.md

任务目标：
- 串联 diagnostics、compare、timeline、recovery 的复盘入口
- 让失败 run 可以自然跳转到更合适的下一步
- 统一复盘相关页面的文案、空态、异常态和推荐动作

允许重点修改：
- src/web/routes.ts
- web/src/api/index.ts
- web/src/pages/DiagnosticsPage.tsx
- web/src/pages/RunComparisonPage.tsx
- web/src/pages/RunDetailPage.tsx
- web/src/pages/RunExecutionPage.tsx
- 相关测试文件

明确禁止：
- 不增加新的独立主导航
- 不通过硬编码跳转掩盖缺失的数据契约
- 不在联动收口任务里顺手做大规模 UI 改版

请按以下顺序工作：
1. 列出当前最割裂的复盘跳转链路
2. 统一入口和推荐动作
3. 补空态、异常态和基础导航收口
4. 补 smoke / E2E 测试

交付要求：
- 输出联动改进清单
- 输出每个页面在复盘链路中的职责
- 输出新增测试
- 输出仍存在的复盘链路缺口
```

---

## Prompt F：E6 复盘与趋势测试补强

### 建议模型

- 主推：`GLM-5`
- 可配合：`Kimi K2.5` 或 `qwen3.5`

### 提示词

```text
请在 OpenAgents 项目中完成 E6：复盘与趋势测试补强。

先阅读以下文档：
- docs/future/NEXT-ITERATION-PLAN.md
- docs/future/NEXT-ITERATION-TASKS.md
- docs/future/THREE-ITERATIONS-ROADMAP.md

任务目标：
- 让版本快照、差异分析、趋势统计、失败复盘主链路具备自动化回归能力
- 覆盖 route、service、integration、最小 smoke / E2E

允许重点修改：
- src/__tests__/*
- src/app/services/*.test.ts
- web/tests/*
- 少量测试辅助代码

明确禁止：
- 不为了测试通过而弱化真实行为
- 不引入高维护成本的脆弱测试
- 不做与当前任务无关的大量产品逻辑改动

请按以下顺序工作：
1. 列出复盘主链路当前最缺的自动化覆盖
2. 优先补 version snapshot / diff / trend / recap / navigation
3. 尽量复用已有测试模式
4. 保持测试可读、可维护、可稳定运行

交付要求：
- 输出新增测试清单
- 说明每个测试覆盖了哪个复盘场景
- 说明还有哪些高风险空白没有覆盖
- 如果某些测试当前无法稳定实现，请明确原因
```

---

## Prompt G：E7 快照与聚合层适度整理

### 建议模型

- 主推：`gpt-5.3-codex` 或同级更强模型
- 不建议：`qwen3.5` 或 `minimax m2.7` 独立主导

### 提示词

```text
请在 OpenAgents 项目中完成 E7：快照与聚合层适度整理。

先阅读以下文档：
- docs/future/NEXT-ITERATION-PLAN.md
- docs/future/NEXT-ITERATION-TASKS.md
- docs/future/THREE-ITERATIONS-ROADMAP.md

任务目标：
- 收敛版本快照、趋势统计、失败复盘相关聚合逻辑
- 为后续更深的版本演进和趋势分析预留统一入口
- 在不做大迁移的前提下控制复杂度增长

允许重点修改：
- src/app/services/*
- src/app/dto.ts
- src/web/routes.ts
- 相关测试文件

明确禁止：
- 不做大规模目录重构
- 不为了“看起来更整洁”而改动大量稳定逻辑
- 不破坏上一期已经稳定的恢复与观测主链路

请按以下顺序工作：
1. 列出当前重复或分散的版本 / 趋势 / 复盘聚合逻辑
2. 设计最小必要的收敛方案
3. 做低风险整理
4. 补回归测试

交付要求：
- 说明聚合逻辑收敛到了哪里
- 说明哪些重复逻辑被消除
- 说明这样整理后对下一轮复盘能力有什么帮助
- 说明新增测试与剩余风险
```

