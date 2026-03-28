# OpenAgents 事件契约

> 版本: 1.0.0
> 创建日期: 2026-03-27
> 状态: 稳定

## 一、概述

本文档定义了 OpenAgents 对外暴露的事件契约，供其他 Agent 工具监听长任务使用。

### 设计原则

1. **稳定字段**: 所有标记为"稳定"的字段保证向后兼容
2. **JSONL 格式**: 每行一个 JSON 对象，便于流式解析
3. **单调序列**: 每个事件有唯一的 `sequence` 号，支持续传
4. **心跳机制**: 长时间无事件时输出心跳，保持连接活跃

---

## 二、事件订阅

### CLI 命令

```bash
openagents events stream --run <run_id> --json
```

### 参数

| 参数 | 必选 | 说明 |
|------|------|------|
| `--run <run_id>` | 是 | 指定监听的 run ID |
| `--json` | 是 | 使用 JSONL 输出格式 |
| `--from-sequence <n>` | 否 | 从指定 sequence 之后开始输出 |
| `--follow` | 否 | 持续监听直到 run 结束（默认开启） |
| `--heartbeat-seconds <n>` | 否 | 心跳间隔秒数（默认 15） |

### 输出格式

每行一个 JSON 对象：

```json
{"type":"workflow.started","runId":"run_123","workflowId":"novel_writing","sequence":0,"ts":1710000000000}
{"type":"step.started","runId":"run_123","workflowId":"novel_writing","stepId":"outline","sequence":1,"ts":1710000001000}
{"type":"heartbeat","runId":"run_123","sequence":2,"ts":1710000015000}
```

---

## 三、事件 Schema

### 3.1 稳定公共字段

所有事件都包含以下字段：

| 字段 | 类型 | 说明 | 稳定性 |
|------|------|------|--------|
| `type` | string | 事件类型 | 稳定 |
| `runId` | string | Run ID | 稳定 |
| `workflowId` | string | Workflow ID | 稳定 |
| `sequence` | number | 单调递增序列号 | 稳定 |
| `ts` | number | 时间戳（毫秒） | 稳定 |

### 3.2 事件类型

#### Lifecycle 事件

| 类型 | 说明 | 附加字段 |
|------|------|----------|
| `workflow.started` | 工作流开始 | `resumed`, `input` |
| `workflow.completed` | 工作流完成 | - |
| `workflow.failed` | 工作流失败 | `error` |
| `workflow.interrupted` | 工作流中断 | - |

#### Step 事件

| 类型 | 说明 | 附加字段 |
|------|------|----------|
| `step.started` | 步骤开始 | `stepId` |
| `step.completed` | 步骤完成 | `stepId`, `duration`, `outputPreview`, `tokenUsage` |
| `step.failed` | 步骤失败 | `stepId`, `error` |
| `step.skipped` | 步骤跳过 | `stepId`, `reason` |
| `step.retrying` | 步骤重试 | `stepId`, `attempt`, `maxAttempts`, `error` |
| `step.stream` | 步骤流式输出 | `stepId`, `chunk` |

#### Control 事件

| 类型 | 说明 | 附加字段 |
|------|------|----------|
| `gate.waiting` | 等待审批 | `stepId`, `preview` |
| `gate.resolved` | 审批完成 | `stepId`, `action` |
| `heartbeat` | 心跳 | - |
| `stream.sync` | 流同步 | `status`, `startSequence` |

### 3.3 条件字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `stepId` | string | 步骤 ID |
| `status` | string | 运行状态 |
| `error` | string | 错误信息 |
| `attempt` | number | 当前重试次数 |
| `maxAttempts` | number | 最大重试次数 |
| `outputPreview` | string | 输出预览 |
| `tokenUsage` | object | Token 使用量 |
| `duration` | number | 持续时间（毫秒） |
| `resumed` | boolean | 是否恢复运行 |
| `input` | string | 输入内容 |
| `chunk` | string | 流式输出片段 |
| `preview` | string | Gate 预览 |
| `action` | string | Gate 动作 |
| `reason` | string | 跳过原因 |

---

## 四、事件示例

### workflow.started

```json
{
  "type": "workflow.started",
  "runId": "run_abc123",
  "workflowId": "novel_writing",
  "sequence": 0,
  "ts": 1710000000000,
  "resumed": false,
  "input": "Write a short story about a robot"
}
```

### step.completed

```json
{
  "type": "step.completed",
  "runId": "run_abc123",
  "workflowId": "novel_writing",
  "sequence": 5,
  "ts": 1710000030000,
  "stepId": "outline",
  "duration": 2500,
  "outputPreview": "Chapter 1: The Awakening\nChapter 2: The Journey...",
  "tokenUsage": {
    "promptTokens": 150,
    "completionTokens": 300,
    "totalTokens": 450
  }
}
```

### heartbeat

```json
{
  "type": "heartbeat",
  "runId": "run_abc123",
  "sequence": 10,
  "ts": 1710000100000
}
```

### workflow.failed

```json
{
  "type": "workflow.failed",
  "runId": "run_abc123",
  "workflowId": "novel_writing",
  "sequence": 15,
  "ts": 1710000150000,
  "error": "API rate limit exceeded"
}
```

---

## 五、续传机制

### 从指定 sequence 继续

```bash
openagents events stream --run run_abc123 --json --from-sequence 10
```

这将输出 `sequence > 10` 的所有持久化事件。

### 实现说明

1. 首先读取 `events.jsonl` 获取历史事件
2. 过滤出 sequence > from-sequence 的事件
3. 如果 run 仍在运行，继续监听新事件
4. run 结束后自动退出

---

## 六、心跳机制

### 默认行为

- 心跳间隔：15 秒
- 心跳事件类型：`heartbeat`
- 心跳会复用最近一个已持久化事件的 `sequence`
- 心跳仅用于保活，不参与续传边界计算

### 自定义间隔

```bash
openagents events stream --run run_abc123 --json --heartbeat-seconds 30
```

### 禁用心跳

```bash
openagents events stream --run run_abc123 --json --heartbeat-seconds 0
```

---

## 七、退出码

| 退出码 | 说明 |
|--------|------|
| 0 | 正常退出（run 完成） |
| 1 | 一般错误 |
| 2 | Run 不存在 |
| 3 | 读取事件失败 |

---

## 八、与现有系统的关系

### events.jsonl

- 持久化事件日志
- 位于 `<output-directory>/<run-id>/events.jsonl`
- CLI 命令优先读取此文件

### Web SSE

- Web UI 使用 `/api/runs/:runId/stream`
- 使用相同的事件 schema
- CLI 命令复用事件转换逻辑

---

## 九、变更历史

| 版本 | 日期 | 变更 |
|------|------|------|
| 1.0.0 | 2026-03-27 | 初始版本 |
