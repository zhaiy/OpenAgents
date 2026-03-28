# OpenAgents F4 专项任务卡

> 创建日期：2026-03-27
> 所属任务包：`F4 运行契约与事件口径收口`
> 子主题：轻量事件流订阅能力
> 推荐实现方式：`openagents events stream --run <id> --json`

---

## 一、任务定位

本任务不是为 OpenAgents 新增一个重型广播系统，也不是引入新的消息中间件。

本任务的目标是：

> **把 OpenAgents 现有的运行事件能力，收口成一个稳定、轻量、可被其他 Agent 订阅的事件流出口。**

适用场景包括：

- 其他 Agent 实时监听某个长任务
- workflow 失败后自动拉起复盘 Agent
- gate 等待时由外部 Agent 监听并做提醒或介入
- 长任务期间做 watchdog / timeout observer
- 外部 orchestrator 跟踪 workflow 生命周期

不在本任务范围内的内容：

- Kafka / Redis / NATS / RabbitMQ 等消息系统接入
- 多消费者组、ACK、消息重试投递
- 跨机器分布式广播
- 复杂的 Web 端新页面

---

## 二、当前基础能力

当前项目已经具备以下能力，可作为实现基础：

### 1. 持久化事件

- 每次 run 会写入 `events.jsonl`
- 入口：`src/output/logger.ts`
- 当前事件包含：
  - `ts`
  - `event`
  - `data`

### 2. 运行态 SSE 事件

- Web 端已有 `/api/runs/:runId/stream`
- 入口：
  - `src/app/events/run-event-emitter.ts`
  - `src/app/events/web-event-handler.ts`
  - `src/web/routes.ts`

### 3. sequence 语义

- SSE 事件已有 `sequence`
- 当前 `RunEventEmitter` 会按 run 维护递增序列
- 但这套语义目前主要服务于 Web UI，同 CLI 订阅契约尚未正式化

### 4. 已有事件类型

当前已覆盖的主事件大致包括：

- `workflow.started`
- `workflow.completed`
- `workflow.failed`
- `workflow.interrupted`
- `step.started`
- `step.completed`
- `step.failed`
- `step.skipped`
- `step.retrying`
- `step.stream`
- `gate.waiting`
- `gate.resolved`

结论：

> **项目并不缺事件来源，缺的是“稳定事件出口”和“对外契约”。**

---

## 三、目标交付

本任务建议交付以下内容：

1. 一个新的 CLI 命令：

```bash
openagents events stream --run <run_id> --json
```

2. 一套稳定事件 schema，明确哪些字段是其他 Agent 可以依赖的

3. 一套轻量续传语义，至少支持：

- `--from-sequence <n>`
- heartbeat
- 事件按 `sequence` 单调递增输出

4. 文档化说明：

- 该能力适合什么场景
- 如何与长任务监听配合
- 它与 `events.jsonl`、SSE 的关系

5. 自动化测试

---

## 四、推荐方案

### 方案原则

1. **CLI 优先**
   因为目标用户是其他 Agent，而不是浏览器。

2. **复用现有事件源**
   不重复建事件管道，优先复用：
   - `events.jsonl`
   - `RunEventEmitter`
   - 现有 Web 事件 payload

3. **本地优先**
   不引入 Broker，不引入外部依赖。

4. **契约先行**
   在做命令前，先定义事件 schema 与字段稳定性。

---

## 五、CLI 设计建议

### 主命令

```bash
openagents events stream --run <run_id> --json
```

### 可选参数

```bash
openagents events stream --run <run_id> --json --from-sequence 42
openagents events stream --run <run_id> --json --follow
openagents events stream --run <run_id> --json --heartbeat-seconds 15
```

### 参数建议

| 参数 | 说明 | 必选 |
|------|------|------|
| `--run <run_id>` | 指定监听的 run | 是 |
| `--json` | 使用 JSONL 输出，便于 Agent/脚本消费 | 是 |
| `--from-sequence <n>` | 从某个 sequence 之后开始输出 | 否 |
| `--follow` | 持续监听直到 run 结束 | 否，建议默认开启 |
| `--heartbeat-seconds <n>` | 空闲时输出 heartbeat 事件 | 否 |

### 输出格式建议

每一行一个 JSON 对象：

```json
{"type":"workflow.started","runId":"run_123","workflowId":"novel_writing","sequence":0,"ts":1710000000000}
{"type":"step.started","runId":"run_123","workflowId":"novel_writing","stepId":"outline","sequence":1,"ts":1710000001000}
{"type":"heartbeat","runId":"run_123","sequence":2,"ts":1710000015000}
```

说明：

- 输出采用 `JSONL`
- 不输出彩色文本
- 不夹杂日志说明文字
- 保证易被其他 Agent 直接解析

---

## 六、事件 Schema 草案

### 稳定公共字段

所有事件建议至少包含：

| 字段 | 类型 | 说明 |
|------|------|------|
| `type` | string | 事件类型 |
| `runId` | string | run ID |
| `workflowId` | string | workflow ID |
| `sequence` | number | 该 run 内单调递增序号 |
| `ts` | number | 事件时间戳（毫秒） |

### 条件字段

按事件类型附带：

| 字段 | 类型 | 说明 |
|------|------|------|
| `stepId` | string | 步骤类事件携带 |
| `status` | string | 某些收口型事件可带 |
| `error` | string | 失败事件携带 |
| `attempt` | number | retry 事件携带 |
| `maxAttempts` | number | retry 事件携带 |
| `outputPreview` | string | completed / gate.waiting 可带预览 |
| `tokenUsage` | object | completed 事件可带 |
| `durationMs` | number | completed 事件可带 |

### 新增事件建议

建议新增 2 个显式事件类型：

1. `heartbeat`
   - 用于长时间无新事件时保持订阅方感知

2. `stream.sync`
   - 可选
   - 用于订阅开始时告知当前 run 状态、起始 sequence、是否存在补发

### 事件类型分层建议

建议将事件分为三类：

- Lifecycle
  - `workflow.started`
  - `workflow.completed`
  - `workflow.failed`
  - `workflow.interrupted`
- Step
  - `step.started`
  - `step.completed`
  - `step.failed`
  - `step.skipped`
  - `step.retrying`
  - `step.stream`
- Control
  - `gate.waiting`
  - `gate.resolved`
  - `heartbeat`
  - `stream.sync`

---

## 七、实现切点建议

### 切点 1：CLI 新命令

建议新增：

- `src/cli/events.ts`
- 在 `src/cli/index.ts` 注册 `events` 命令

职责：

- 参数解析
- 读取已有事件
- 跟随新事件
- JSONL 输出

### 切点 2：服务层事件读取与订阅接口

建议新增或扩展：

- `src/app/services/run-service.ts`
  - 增加按 `sequence` 读取/转换事件的能力
  - 增加事件订阅辅助方法

如果需要单独抽离，也可新增：

- `src/app/services/run-event-stream-service.ts`

职责：

- 从 `events.jsonl` 读取历史事件
- 转为稳定对外 schema
- 与 `RunEventEmitter` 对接，获取后续增量事件

### 切点 3：事件 DTO 与契约

建议修改：

- `src/app/dto.ts`
- `src/types/index.ts`

职责：

- 明确事件 schema
- 区分“Web UI 私有字段”和“对外稳定字段”

### 切点 4：Emitter 补强

建议扩展：

- `src/app/events/run-event-emitter.ts`

可选增强：

- 支持 CLI 订阅者
- 支持 heartbeat 定时输出
- 支持从某个 `sequence` 之后追增量事件

注意：

> 不要求 emitter 负责历史事件补发；历史部分应优先由 `events.jsonl` 读取，增量部分再接 emitter。

---

## 八、推荐实现顺序

1. 定义事件对外 schema
2. 补齐 `events.jsonl` 到稳定 schema 的转换逻辑
3. 实现 `openagents events stream --run <id> --json --from-sequence <n>`
4. 接入增量 follow 能力
5. 增加 heartbeat
6. 补测试和文档

---

## 九、测试建议

### 单元测试

- 事件 schema 转换正确
- `sequence` 单调递增
- `from-sequence` 过滤正确
- heartbeat 在空闲期正常输出
- 运行结束后流正确关闭

### 集成测试

- 对运行中 workflow 能持续收到事件
- 对已结束 workflow 能读到完整历史事件
- 对中断重连场景能从指定 `sequence` 继续

### CLI 行为测试

- 输出为 JSONL
- 不混入额外日志文本
- 错误 runId 时返回友好错误

---

## 十、验收标准

- 可通过 `openagents events stream --run <id> --json` 实时监听长任务
- 输出事件 schema 稳定且可被其他 Agent 直接解析
- 支持从指定 `sequence` 继续读取
- 长时间无新事件时可输出 heartbeat
- 不引入重型消息系统
- 与现有 `events.jsonl` / SSE 能力关系清晰

---

## 十一、开放问题

以下问题建议在实现前快速定稿：

1. `--follow` 是否默认开启？
   - 建议：默认开启，run 结束后自动退出

2. `heartbeat` 是否默认开启？
   - 建议：默认开启，间隔 15 秒

3. `step.stream` 是否默认原样透出？
   - 建议：默认透出，但限制单条 chunk 大小，避免订阅端被刷爆

4. 对外 schema 是否完全复用 Web SSE DTO？
   - 建议：不要直接复用，应该定义一层更稳定的 Agent-facing schema

---

## 十二、适合下发给模型的简版任务说明

```text
请在 OpenAgents 中实现一个轻量事件流订阅能力，供其他 Agent 监听长任务。

目标命令：
openagents events stream --run <run_id> --json

要求：
1. 不引入 Kafka/Redis/NATS 等重型消息系统
2. 优先复用现有 events.jsonl、RunEventEmitter、SSE 语义
3. 输出稳定 JSONL 事件
4. 支持 sequence
5. 支持 from-sequence 续传
6. 支持 heartbeat
7. 补充测试与文档

请先定义稳定事件 schema，再开始实现。
```
