# OpenAgents 安全边界说明

> 版本: 1.0.0
> 创建日期: 2026-03-27
> 状态: 稳定

## 一、概述

本文档定义了 OpenAgents 的安全边界和执行策略，涵盖：

1. 脚本执行安全
2. Post-processor 安全
3. Webhook 安全
4. 环境变量保护
5. 文件系统访问控制
6. Webhook DNS 解析校验

---

## 二、安全原则

### 2.1 默认安全

所有高风险能力默认采用最严格的限制策略，需要用户显式配置才能放开。

### 2.2 最小权限

只授予完成任务所需的最小权限，避免过度授权。

### 2.3 显式确认

涉及敏感操作时，需要用户显式确认或配置。

### 2.4 审计日志

所有安全相关操作都有日志记录，便于追溯。

---

## 三、高风险能力清单

| 能力 | 风险级别 | 默认策略 | 可配置放开 |
|------|----------|----------|------------|
| Script Runtime | 高 | VM 沙箱 + 模块限制 | 环境变量 |
| Post-processor | 高 | 命令策略限制 | 配置文件 |
| Webhook | 中 | 私有地址阻断 + HTTPS 建议 | 环境变量 |
| 环境变量访问 | 中 | 白名单过滤 | Skill 配置 |
| 文件系统访问 | 高 | 沙箱禁止 | Skill 配置 |

---

## 四、Script Runtime 安全

### 4.1 沙箱执行

Script Runtime 使用 Node.js VM 模块创建沙箱环境：

```javascript
// 允许的模块（无副作用）
const ALLOWED_MODULES = new Set(['util', 'crypto', 'os', 'url']);

// 禁止的模块（有文件系统访问）
// fs, path, child_process, etc.
```

### 4.2 环境变量过滤

默认只传递非敏感环境变量：

```javascript
const SAFE_ENV_VARS = new Set([
  'PATH', 'HOME', 'USER', 'LANG', 'LC_ALL',
  'SHELL', 'TERM', 'TMPDIR', 'NODE_ENV',
]);
```

### 4.3 超时保护

- 默认超时：300 秒
- 防止同步死循环：VM timeout
- 防止异步挂起：Promise.race

### 4.4 安全边界

| 限制项 | 说明 |
|--------|------|
| 文件系统 | 完全禁止 |
| 网络访问 | 完全禁止 |
| 子进程 | 完全禁止 |
| 模块加载 | 仅允许白名单 |

---

## 五、Post-processor 安全

### 5.1 命令策略

禁止使用 Shell 解释器，必须直接调用目标程序：

```javascript
const DISALLOWED_EXECUTABLES = new Set([
  'sh', 'bash', 'zsh', 'fish', 'dash',
  'cmd', 'cmd.exe', 'powershell', 'powershell.exe', 'pwsh', 'pwsh.exe',
]);
```

**正确示例**：
```yaml
post_processors:
  - type: script
    command: jq '.field' input.json
```

**错误示例**（会被拒绝）：
```yaml
post_processors:
  - type: script
    command: bash -c 'cat file | grep pattern'
```

### 5.2 超时控制

- 默认超时：5000ms
- 可配置：`timeout_ms`
- 超时行为：SIGKILL 终止进程

### 5.3 输出限制

- 默认最大输出：20000 字符
- 可配置：`max_output_chars`
- 超限行为：终止进程并报错

### 5.4 错误处理

| 模式 | 说明 |
|------|------|
| `fail` | 默认，post-processor 失败时步骤失败 |
| `skip` | 忽略错误，继续执行 |
| `passthrough` | 返回原始输入，忽略处理结果 |

---

## 六、Webhook 安全

### 6.1 私有地址阻断

默认禁止向私有网络地址发送 webhook：

- `127.0.0.0/8` (localhost)
- `10.0.0.0/8` (私有网络 A)
- `172.16.0.0/12` (私有网络 B)
- `192.168.0.0/16` (私有网络 C)
- `169.254.0.0/16` (链路本地)
- `localhost`, `*.localhost`, `*.local`
- IPv6 本地地址 (`::1`, `fc00::/7`, `fd00::/8`)

除直接填写私有 IP / hostname 之外，OpenAgents 在真正发送 webhook 前还会执行 DNS 解析校验：

- 如果公网域名解析结果落到私有网段，也会被阻断
- 用于降低 DNS rebinding / SSRF 绕过风险

### 6.2 HTTPS 建议

生产环境强烈建议使用 HTTPS：

```yaml
notify:
  webhook: https://secure-api.example.com/hook
```

HTTP 仅在以下情况允许：
- 开发环境（显式配置）
- 内部网络（显式配置）

### 6.3 白名单配置

通过环境变量配置允许的 webhook 目标：

```bash
# 允许私有地址
OPENAGENTS_ALLOW_PRIVATE_WEBHOOKS=true

# Webhook 超时（毫秒）
OPENAGENTS_WEBHOOK_TIMEOUT_MS=10000
```

### 6.4 超时保护

- 默认超时：5000ms
- 可配置：`OPENAGENTS_WEBHOOK_TIMEOUT_MS`

### 6.5 失败处理

Webhook 失败**不会**阻塞工作流执行，只会记录错误日志。

---

## 七、环境变量保护

### 7.1 敏感变量识别

以下变量模式被视为敏感：

- `*_API_KEY`
- `*_SECRET`
- `*_TOKEN`
- `*_PASSWORD`
- `*_CREDENTIAL`

### 7.2 访问控制

| 场景 | 默认行为 |
|------|----------|
| Script Runtime | 仅安全白名单 |
| Skill 执行 | 需显式声明 |
| 日志输出 | 自动脱敏 |

### 7.3 Skill 环境变量声明

Skill 需要显式声明所需环境变量：

```yaml
skill:
  id: my-skill
  # ...

permissions:
  environment:
    - PATH
    - MY_API_KEY  # 显式声明
```

---

## 八、文件系统访问控制

### 8.1 Script Runtime

完全禁止文件系统访问。

### 8.2 Skill 文件系统权限

Skill 可声明文件系统访问需求：

```yaml
permissions:
  filesystem: read-only  # 或 read-write, none
```

### 8.3 输出目录

工作流输出写入配置的 `output.directory`，与项目代码隔离。

---

## 九、安全配置清单

### 9.1 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `OPENAGENTS_ALLOW_PRIVATE_WEBHOOKS` | 允许私有地址 webhook | `false` |
| `OPENAGENTS_WEBHOOK_TIMEOUT_MS` | Webhook 超时 | `5000` |
| `OPENAGENTS_SCRIPT_TIMEOUT_SECONDS` | 脚本超时 | `300` |

### 9.2 配置文件

```yaml
# project.yaml
runtime:
  default_type: llm-direct
  timeout_seconds: 300

# workflow.yaml
steps:
  - id: step1
    post_processors:
      - type: script
        command: jq '.field'
        timeout_ms: 5000
        max_output_chars: 20000
        on_error: fail
```

---

## 十、安全最佳实践

1. **最小权限原则**：只授予必要的权限
2. **显式配置**：敏感操作需要显式配置
3. **HTTPS 优先**：生产环境使用 HTTPS
4. **定期审计**：检查 webhook 目标和 post-processor 配置
5. **日志监控**：关注安全相关日志

---

## 十一、安全事件响应

如果发现安全问题：

1. 立即停止相关操作
2. 检查日志确定影响范围
3. 更新配置限制访问
4. 必要时撤销相关凭证

---

## 十二、变更历史

| 版本 | 日期 | 变更 |
|------|------|------|
| 1.0.0 | 2026-03-27 | 初始版本 |
