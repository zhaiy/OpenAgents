# OpenAgents Skill 规范

> 版本: 1.0.0
> 创建日期: 2026-03-27
> 状态: 稳定

## 一、概述

本文档定义了 OpenAgents 的 Skill 规范，用于：

1. 让外部 Agent 工具和 LLM 理解、参考、接入 OpenAgents 的能力
2. 作为 OpenAgents 内部 Skill 开发的标准规范
3. 确保 Skill 的可发现性、可验证性和可组合性

### 设计原则

- **最小必要**: 只定义必要的字段，避免过度设计
- **可验证**: 所有字段都可通过 schema 验证
- **可扩展**: 支持未来扩展而不破坏兼容性
- **安全优先**: 明确声明权限和风险

---

## 二、Skill 文件结构

Skill 配置文件采用 YAML 格式，放置在项目的 `skills/` 目录下：

```
project/
├── skills/
│   ├── my-skill.yaml
│   └── another-skill.yaml
└── ...
```

### 最小示例

```yaml
skill:
  id: text-summarizer
  name: Text Summarizer
  description: Summarizes long text into concise summaries
  version: "1.0.0"

instructions: |
  You are a text summarization expert. Your task is to create concise, 
  accurate summaries that capture the key points of the input text.
```

### 完整示例

```yaml
skill:
  id: code-reviewer
  name: Code Reviewer
  description: Reviews code for quality, security, and best practices
  version: "2.1.0"
  author: OpenAgents Team
  tags:
    - code-quality
    - security
    - review

instructions: |
  You are an expert code reviewer. Analyze the provided code for:
  1. Security vulnerabilities
  2. Performance issues
  3. Code style and best practices
  4. Potential bugs

input_schema:
  type: object
  properties:
    code:
      type: string
      description: The code to review
    language:
      type: string
      description: Programming language
      default: auto-detect
  required:
    - code

output_format: |
  ## Summary
  [Brief summary of findings]

  ## Issues Found
  - [Issue 1]
  - [Issue 2]

  ## Recommendations
  - [Recommendation 1]
  - [Recommendation 2]

permissions:
  network: false
  filesystem: read-only
  environment:
    - PATH
    - HOME

dependencies:
  skills:
    - syntax-highlighter
  tools:
    - type: mcp
      server: ast-parser
      tool: parse

risk_level: medium
risk_description: |
  This skill processes user-provided code which may contain malicious patterns.
  The skill does not execute code, only analyzes it.

examples:
  - input:
      code: "function add(a, b) { return a + b; }"
      language: javascript
    output_preview: |
      ## Summary
      Simple addition function with no security concerns.
      
      ## Issues Found
      None
      
      ## Recommendations
      Consider adding type checking for robustness.
```

---

## 三、字段规范

### 3.1 必需字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `skill.id` | string | Skill 唯一标识符，格式: `[a-z][a-z0-9_-]*` |
| `skill.name` | string | Skill 显示名称 |
| `skill.description` | string | Skill 功能描述 |
| `skill.version` | string | 语义化版本号 |
| `instructions` | string | 给 LLM 的指令模板 |

### 3.2 可选字段

#### skill 块

| 字段 | 类型 | 说明 |
|------|------|------|
| `skill.author` | string | 作者信息 |
| `skill.tags` | string[] | 标签列表，用于分类和搜索 |
| `skill.homepage` | string | 文档或主页 URL |
| `skill.repository` | string | 源码仓库 URL |

#### 输入输出

| 字段 | 类型 | 说明 |
|------|------|------|
| `input_schema` | object | JSON Schema 格式的输入定义 |
| `output_format` | string | 输出格式说明（Markdown 模板） |

#### 权限声明

| 字段 | 类型 | 说明 |
|------|------|------|
| `permissions.network` | boolean | 是否需要网络访问 |
| `permissions.filesystem` | string | 文件系统访问级别: `none`, `read-only`, `read-write` |
| `permissions.environment` | string[] | 需要访问的环境变量名 |

#### 依赖声明

| 字段 | 类型 | 说明 |
|------|------|------|
| `dependencies.skills` | string[] | 依赖的其他 Skill ID |
| `dependencies.tools` | ToolConfig[] | 依赖的工具配置 |

#### 风险声明

| 字段 | 类型 | 说明 |
|------|------|------|
| `risk_level` | string | 风险级别: `low`, `medium`, `high` |
| `risk_description` | string | 风险说明 |

#### 示例

| 字段 | 类型 | 说明 |
|------|------|------|
| `examples` | array | 使用示例列表 |

---

## 四、权限级别

### 4.1 网络权限

| 值 | 说明 |
|------|------|
| `false` | 不允许网络访问（默认） |
| `true` | 允许网络访问 |

### 4.2 文件系统权限

| 值 | 说明 |
|------|------|
| `none` | 不允许文件系统访问（默认） |
| `read-only` | 只读访问 |
| `read-write` | 读写访问 |

### 4.3 环境变量

默认情况下，Skill 无法访问任何环境变量。需要显式声明：

```yaml
permissions:
  environment:
    - PATH
    - HOME
    - CUSTOM_API_KEY
```

---

## 五、风险级别

| 级别 | 说明 | 示例 |
|------|------|------|
| `low` | 无安全风险，纯文本处理 | 文本摘要、翻译 |
| `medium` | 处理用户输入，但不执行 | 代码分析、格式化 |
| `high` | 可能执行代码或访问外部资源 | 脚本执行、API 调用 |

---

## 六、工具配置

### 6.1 MCP 工具

```yaml
dependencies:
  tools:
    - type: mcp
      server: my-mcp-server
      tool: tool-name
```

### 6.2 脚本工具

```yaml
dependencies:
  tools:
    - type: script
      path: ./scripts/my-tool.sh
      args:
        - "--verbose"
```

---

## 七、CLI 调用约定

### 7.1 列出 Skills

```bash
openagents skills list
```

输出：
```
ID                  NAME                    VERSION   RISK
text-summarizer     Text Summarizer         1.0.0     low
code-reviewer       Code Reviewer           2.1.0     medium
```

### 7.2 查看 Skill 详情

```bash
openagents skills show <skill-id>
```

### 7.3 验证 Skill 配置

```bash
openagents validate skills
```

---

## 八、退出码约定

| 退出码 | 说明 |
|--------|------|
| 0 | 成功 |
| 1 | 一般错误 |
| 2 | 配置错误 |
| 3 | 验证错误 |
| 10 | 权限错误 |
| 11 | 依赖缺失 |
| 99 | 用户中断 |

---

## 九、版本兼容性

### 9.1 语义化版本

Skill 版本号遵循 [SemVer 2.0.0](https://semver.org/)：

- `MAJOR`: 不兼容的 API 变更
- `MINOR`: 向后兼容的功能新增
- `PATCH`: 向后兼容的问题修复

### 9.2 版本范围

在 `dependencies.skills` 中支持版本范围：

```yaml
dependencies:
  skills:
    - text-summarizer>=1.0.0
    - code-reviewer^2.0.0
```

---

## 十、最佳实践

1. **描述清晰**: `description` 应简洁说明 Skill 的功能和使用场景
2. **指令具体**: `instructions` 应包含具体的输出格式要求
3. **权限最小**: 只声明必要的权限
4. **风险透明**: 如实声明风险级别和原因
5. **示例完整**: 提供典型的输入输出示例

---

## 十一、Schema 定义

完整的 Zod schema 定义见 `src/config/schema.ts` 中的 `SkillConfigSchema`。

---

## 十二、变更历史

| 版本 | 日期 | 变更 |
|------|------|------|
| 1.0.0 | 2026-03-27 | 初始版本 |