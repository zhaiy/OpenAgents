# OpenAgents（中文文档）

透明可控的多 Agent 协作编排引擎。

主文档（英文）请查看 `README.md`。

## 核心价值

- **看得见**：工作流执行过程逐步可视化。
- **管得住**：关键节点可审核、可中断、可恢复。
- **查得到**：输出和运行状态持久化，便于回溯。

## 核心能力

- 终端实时进度 UI（`ora` + `chalk` + `boxen`）
- 关键节点人工审核门控（`yes/no/edit`）
- Gate 自动化控制（`--auto-approve`、`--gate-timeout`）
- 中断后基于状态文件恢复（`.state.json`）
- 事件日志追踪与审计（`events.jsonl`）
- DAG 并行调度与可配置重试机制
- 结构化输入（`--input-json`、`--input-file`）与 `{{inputs.xxx}}` 模板变量
- Script Runtime（`runtime.type: script`）支持本地脚本预处理
- 步骤后置处理器（`step.post_processors`）支持用户自定义输出精简
- 步骤缓存（`workflow.cache` / `step.cache`）与 `openagents cache` 管理命令
- 开发者工具：`openagents debug template`、`openagents dag`、`openagents validate --verbose`

## 快速开始

```bash
npm install
npm run build
npx tsx src/cli/index.ts run novel_writing --input "一个时间旅行悬疑故事"
```

初始化示例项目：

```bash
npx tsx src/cli/index.ts init my-project
cd my-project
export OPENAGENTS_API_KEY=sk-xxxx
npx tsx src/cli/index.ts run novel_writing --input "一个时间旅行悬疑故事"
```

## CLI 命令

```bash
openagents init [directory]
openagents init --list-templates
openagents init [directory] --template <name>
openagents validate
openagents validate --verbose
openagents run <workflow_id> --input "..."
openagents run <workflow_id> --input-json '{"key":"value"}'
openagents run <workflow_id> --input-file ./input.json
openagents run <workflow_id> --auto-approve
openagents resume <run_id>
openagents runs list
openagents runs show <run_id>
openagents runs logs <run_id>
openagents agents list
openagents workflows list
openagents debug template <workflow_id> --input-json '{"key":"value"}'
openagents dag <workflow_id>
openagents cache stats
openagents cache clear
```

## 错误恢复策略

- `on_failure: fail`（默认）：步骤失败即终止工作流。
- `on_failure: skip`：当前步骤标记为跳过，继续执行后续可运行步骤。
- `on_failure: fallback`：使用 `fallback_agent` 进行兜底执行。
- `on_failure: notify`：先发送 `notify.webhook`，再将步骤与运行标记为失败。

## 步骤后置处理器（脚本）

你可以在 step 上配置 `post_processors`，在步骤输出写盘和传递给下游之前做自定义处理。

```yaml
steps:
  - id: load_context
    agent: planner
    task: "生成较长上下文"
    post_processors:
      - type: script
        name: shrink_context
        command: node scripts/shrink-context.mjs
        timeout_ms: 5000
        max_output_chars: 20000
        on_error: fail # fail | skip | passthrough
```

脚本协议：

- 输入：引擎通过 `stdin` 传入原始步骤输出（UTF-8 文本）
- 输出：脚本通过 `stdout` 输出处理结果
- 日志：`stderr` 仅用于日志，不参与数据传递
- 退出码：`0` 表示成功，非 `0` 表示失败
- 环境变量：`OA_RUN_ID`、`OA_WORKFLOW_ID`、`OA_STEP_ID`、`OA_PROCESSOR_NAME`

`on_error` 行为：

- `fail`（默认）：当前步骤失败。
- `skip`：跳过该处理器，继续后续处理链。
- `passthrough`：停止处理链并透传 agent 原始输出。

最佳实践：

- 脚本应尽量保持幂等和确定性：相同输入得到相同输出。
- 脚本尽量轻量，避免在处理链路中依赖外部网络调用。
- 严格流程建议使用 `on_error: fail`，容错流程可考虑 `passthrough`。
- 建议始终设置 `timeout_ms` 与 `max_output_chars` 作为资源上限。
- 调试信息写入 `stderr`，仅将最终处理结果写入 `stdout`。
- 生产环境将脚本视为可信代码资产，按应用代码标准进行评审与审计。

推荐目录结构：

```text
your-project/
  scripts/
    post-processors/
      normalize-output.mjs
      trim-context.mjs
      redact-sensitive.mjs
```

多处理器链路示例：

```yaml
steps:
  - id: load_context
    agent: planner
    task: "生成上下文内容"
    post_processors:
      - type: script
        name: normalize
        command: node scripts/post-processors/normalize-output.mjs
        on_error: fail
      - type: script
        name: trim
        command: node scripts/post-processors/trim-context.mjs
        timeout_ms: 3000
        max_output_chars: 8000
        on_error: passthrough
```

## 项目结构

- `src/cli`：CLI 入口与子命令实现
- `src/config`：YAML 加载与 schema 校验
- `src/engine`：DAG 解析、调度、模板渲染、工作流执行
- `src/runtime`：运行时接口与实现（`llm-direct`、`script`）
- `src/output`：输出文件与事件日志
- `src/i18n`：中英文文案
- `templates`：`init` 命令生成的项目模板

## 多语言支持

- 支持语言：`en`、`zh`
- 默认语言：`en`
- 语言优先级：
  - `--lang`
  - `OPENAGENTS_LANG`
  - fallback `en`

示例：

```bash
npx tsx src/cli/index.ts --lang zh run novel_writing --input "悬疑故事"
OPENAGENTS_LANG=zh npx tsx src/cli/index.ts run novel_writing --input "悬疑故事"
```

## 文档

- 产品需求文档：`docs/PRD-v3.md`
- 技术设计与开发计划：`docs/TECHNICAL-DESIGN.md`
- 英文主文档：`README.md`

## 许可证

MIT
