# OpenAgents 下一期模型开发提示词

> 创建日期：2026-03-27
> 适用范围：最后一次“产品化收口与标准化 Skill 收尾”迭代
> 目标：为 `gpt-5.3-codex`、`gpt-5.4`、`GLM-5`、`Kimi K2.5`、`qwen3.5` 或同级模型提供可直接执行的开发提示词

---

## 一、使用说明

本文档用于直接向模型下发最后一次收尾迭代任务。

建议使用顺序：

1. 先发送“通用总控提示词”
2. 再发送对应任务包的专项提示词
3. 如任务涉及边界判断，附上迭代计划和任务拆解文档
4. 修改完成后按交付要求审查

建议配套文档：

- `docs/future/NEXT-ITERATION-PLAN.md`
- `docs/future/NEXT-ITERATION-TASKS.md`

---

## 二、通用总控提示词

```text
你现在要在 OpenAgents 项目中完成最后一次收尾迭代中的一个明确任务。

本轮主题是：产品化收口与标准化 Skill 收尾。

请先阅读：
- docs/future/NEXT-ITERATION-PLAN.md
- docs/future/NEXT-ITERATION-TASKS.md

本轮必须遵守以下原则：

1. 不新增大功能模块，不扩新页面簇
2. 不做多厂商专用 Adapter 体系
3. 优先输出标准、边界、诊断、契约与发布质量
4. 不为了“看起来完整”补模板库
5. 测试必须与实现同步提交
6. 修改应服务于 OpenAgents 作为 Agent orchestration core 的定位

开始前请先说明：
- 你理解的任务目标
- 你准备修改的文件
- 哪些内容明确不在本次范围内

如果你发现以下情况，请停下并说明：
- 任务会把 OpenAgents 重新推向“又一个 Agent 平台”
- 需要大规模重构或新增复杂架构层
- 需要通过临时兼容逻辑掩盖边界不清的问题

完成后必须输出：
- 修改摘要
- 修改文件列表
- 新增或更新的测试
- 剩余风险
- 是否适合直接进入收尾发布阶段
```

---

## 三、任务提示词

## Prompt A：F1 标准化 Skill 规范

### 建议模型

- 主推：`gpt-5.4` / `gpt-5.3-codex`
- 可配合：`GLM-5`

### 提示词

```text
请在 OpenAgents 项目中完成 F1：标准化 Skill 规范。

先阅读：
- docs/future/NEXT-ITERATION-PLAN.md
- docs/future/NEXT-ITERATION-TASKS.md

任务目标：
- 定义一套可被外部 Agent 工具和 LLM 理解、参考、接入的 Skill 规范
- 明确 skill 元数据、能力声明、输入输出、CLI 调用、退出码和风险标签
- 保持“不做重型 Adapter，优先输出接入标准”的方向

允许重点修改：
- docs/
- src/skills/
- src/config/schema.ts
- src/types/index.ts
- 相关测试

明确禁止：
- 不把任务扩展成新的 Adapter 层
- 不新增与当前定位无关的大功能
- 不只写概念文档而没有最小可验证约束

请按以下顺序工作：
1. 盘点当前 skill 结构与使用方式
2. 提出最小但稳定的 Skill 规范
3. 说明当前实现与规范的差距
4. 做最小必要代码和文档更新
5. 补 contract / schema 测试

交付要求：
- 输出 Skill 规范字段清单
- 输出当前实现与规范的关系
- 输出修改文件列表
- 输出新增测试
```

---

## Prompt B：F2 健康检查与运行前诊断

### 建议模型

- 主推：`GLM-5`
- 可配合：`gpt-5.3-codex`

### 提示词

```text
请在 OpenAgents 项目中完成 F2：健康检查与运行前诊断。

先阅读：
- docs/future/NEXT-ITERATION-PLAN.md
- docs/future/NEXT-ITERATION-TASKS.md

任务目标：
- 提供运行前诊断能力，帮助用户在 workflow 启动前发现配置和环境问题
- 输出结构化结果和可执行修复建议

允许重点修改：
- src/cli/
- src/app/services/
- src/config/
- README.md
- 相关测试

明确禁止：
- 不做复杂 UI 页面
- 不把诊断做成另一个大系统
- 不只输出字符串而缺少结构化结果

请按以下顺序工作：
1. 明确诊断范围和结果结构
2. 实现最小可用的 doctor / preflight 能力
3. 补主要错误场景测试
4. 更新使用说明

交付要求：
- 输出支持诊断的项目项列表
- 输出结果结构
- 输出新增测试
- 输出仍未覆盖的高风险项
```

---

## Prompt C：F3 安全边界与执行策略收口

### 建议模型

- 主推：`gpt-5.3-codex`
- 可配合：`GLM-5`

### 提示词

```text
请在 OpenAgents 项目中完成 F3：安全边界与执行策略收口。

先阅读：
- docs/future/NEXT-ITERATION-PLAN.md
- docs/future/NEXT-ITERATION-TASKS.md

任务目标：
- 收口 script runtime、post-processor、webhook 等高风险能力的默认策略
- 明确“受信任本地执行”的边界
- 让文档、配置校验和实际行为保持一致

允许重点修改：
- src/runtime/
- src/engine/post-processor.ts
- src/output/notifier.ts
- src/config/schema.ts
- README.md
- docs/
- 相关测试

明确禁止：
- 不引入大而重的权限系统
- 不只改文档不改默认行为
- 不通过隐藏开关掩盖边界问题

请按以下顺序工作：
1. 盘点高风险能力
2. 明确默认安全策略与可放开项
3. 实施最小必要代码增强
4. 补测试
5. 更新文档

交付要求：
- 输出高风险能力清单
- 输出默认策略与 override 方式
- 输出新增测试
- 输出剩余无法完全消除的风险
```

---

## Prompt D：F4 运行契约与事件口径收口

### 建议模型

- 主推：`gpt-5.4` / `gpt-5.3-codex`

### 提示词

```text
请在 OpenAgents 项目中完成 F4：运行契约与事件口径收口。

先阅读：
- docs/future/NEXT-ITERATION-PLAN.md
- docs/future/NEXT-ITERATION-TASKS.md

任务目标：
- 梳理并收口 OpenAgents 的 CLI、run、step、event、output 契约
- 明确哪些字段是稳定可依赖的
- 为项目作为长期复用底座提供稳定接口说明
- 提供一个适合其他 Agent 监听长任务的轻量事件流入口，优先采用 `openagents events stream --run <id> --json`

允许重点修改：
- src/app/dto.ts
- src/app/services/
- src/web/routes.ts
- README.md
- docs/
- 相关测试

明确禁止：
- 不做大规模接口重写
- 不把临时字段直接宣称为稳定契约
- 不扩展无关功能

请按以下顺序工作：
1. 盘点现有对外契约
2. 标记稳定字段与待观察字段
3. 设计事件流订阅命令与事件 schema
4. 做最小必要收口
5. 补契约测试
6. 更新文档说明

交付要求：
- 输出契约清单
- 输出新增或调整字段说明
- 输出事件流命令和事件 schema
- 输出新增测试
```

---

## Prompt E：F5 文档与发布收尾

### 建议模型

- 主推：`Kimi K2.5`
- 可配合：`qwen3.5`

### 提示词

```text
请在 OpenAgents 项目中完成 F5：文档与发布收尾。

先阅读：
- docs/future/NEXT-ITERATION-PLAN.md
- docs/future/NEXT-ITERATION-TASKS.md

任务目标：
- 把 README、Quick Start、接入说明、发布检查材料整理到可交付状态
- 体现项目的最终定位：Agent orchestration core

允许重点修改：
- README.md
- docs/
- 发布说明文档

明确禁止：
- 不为了文档好看而夸大项目能力
- 不补未经验证的模板推荐
- 不新增与文档无关的实现改动

请按以下顺序工作：
1. 收口 README
2. 增加 Skill 规范和安全边界入口
3. 增加运行前诊断入口说明
4. 补发布清单与版本说明草案

交付要求：
- 输出 README 收口点
- 输出新增文档清单
- 输出发布前仍需人工确认的事项
```

---

## Prompt F：F6 回归测试与收尾验证

### 建议模型

- 主推：`GLM-5`
- 可配合：`qwen3.5`

### 提示词

```text
请在 OpenAgents 项目中完成 F6：回归测试与收尾验证。

先阅读：
- docs/future/NEXT-ITERATION-PLAN.md
- docs/future/NEXT-ITERATION-TASKS.md

任务目标：
- 把最后一轮新增的标准、边界、诊断、契约能力纳入自动化回归
- 形成最终人工验收路径

允许重点修改：
- src/__tests__/
- web/
- README.md
- docs/

明确禁止：
- 不只补表面 smoke 而忽略关键行为
- 不写与本轮目标无关的大量测试

请按以下顺序工作：
1. 识别本轮最脆弱的关键路径
2. 补自动化测试
3. 形成手动验收清单
4. 输出最终验证结论

交付要求：
- 输出新增测试列表
- 输出覆盖的关键路径
- 输出仍需人工验证的部分
```
