# OpenAgents 验收清单

> 版本: 1.0.0
> 验收日期: 2026-03-27

## 自动化测试

| 测试套件 | 状态 | 测试数 |
|----------|------|--------|
| env-loading.test.ts | ✅ 通过 | 10 |
| state.test.ts | ✅ 通过 | 7 |
| llm-direct.test.ts | ✅ 通过 | 12 |
| cache.test.ts | ✅ 通过 | 14 |
| scheduler.test.ts | ✅ 通过 | 3 |
| loader.test.ts | ✅ 通过 | 5 |
| quality-observation.test.ts | ✅ 通过 | 18 |
| eval.test.ts | ✅ 通过 | 8 |
| run-reuse-service.test.ts | ✅ 通过 | 25 |
| web-router.test.ts | ✅ 通过 | 39 |
| diagnostics-service.test.ts | ✅ 通过 | 41 |
| skills.test.ts | ✅ 通过 | 12 |
| schema.test.ts | ✅ 通过 | 49 |
| main-flow.integration.test.ts | ✅ 通过 | 22 |
| review-chain.integration.test.ts | ✅ 通过 | 15 |
| workflow-engine.integration.test.ts | ✅ 通过 | 10 |
| error-recovery.test.ts | ✅ 通过 | 20 |
| gate.test.ts | ✅ 通过 | 11 |
| gate-deferred.test.ts | ✅ 通过 | 4 |
| cost-observation.test.ts | ✅ 通过 | 16 |
| run-visual-service.test.ts | ✅ 通过 | 22 |
| writer.test.ts | ✅ 通过 | 7 |
| run-event-emitter.test.ts | ✅ 通过 | 18 |
| run-metrics.test.ts | ✅ 通过 | 18 |
| template.test.ts | ✅ 通过 | 22 |
| recovery-planner.test.ts | ✅ 通过 | 23 |
| context-processor.test.ts | ✅ 通过 | 11 |
| app-services.test.ts | ✅ 通过 | 8 |
| init-templates.test.ts | ✅ 通过 | 13 |
| validator.test.ts | ✅ 通过 | 12 |
| command-policy.test.ts | ✅ 通过 | 5 |
| dag-visualizer.test.ts | ✅ 通过 | 8 |
| runtime-factory.test.ts | ✅ 通过 | 10 |
| dag.test.ts | ✅ 通过 | 5 |
| run-compare-service.test.ts | ✅ 通过 | 19 |
| script-runtime.test.ts | ✅ 通过 | 21 |

**总计**: 36 测试文件, 563 测试用例, 全部通过

---

## 功能验收

### F1: 标准化 Skill 规范

| 验收项 | 状态 | 说明 |
|--------|------|------|
| Skill 元数据定义 | ✅ | id, name, description, version, author, tags |
| 输入输出 schema | ✅ | input_schema, output_format |
| 权限声明 | ✅ | network, filesystem, environment |
| 依赖声明 | ✅ | skills, tools (MCP/script) |
| 风险级别 | ✅ | low, medium, high |
| CLI 命令 | ✅ | `openagents skills list/show` |
| 文档 | ✅ | docs/SKILL-SPEC.md |

### F2: 健康检查与运行前诊断

| 验收项 | 状态 | 说明 |
|--------|------|------|
| doctor 命令 | ✅ | `openagents doctor` |
| preflight 命令 | ✅ | `openagents preflight` |
| 配置检查 | ✅ | project.yaml, runtime config |
| API key 检查 | ✅ | 配置存在性验证 |
| 引用完整性 | ✅ | workflow/agent/skill 引用 |
| 安全检查 | ✅ | webhook, post-processor 警告 |
| JSON 输出 | ✅ | `--json` 选项 |
| 服务实现 | ✅ | PreflightService |

### F3: 安全边界与执行策略收口

| 验收项 | 状态 | 说明 |
|--------|------|------|
| Script 沙箱 | ✅ | VM 沙箱 + 模块限制 |
| Post-processor 策略 | ✅ | 禁止 shell 解释器 |
| Webhook 私有地址阻断 | ✅ | SSRF 保护 |
| Webhook HTTPS 强制 | ✅ | 默认强制 HTTPS |
| Webhook 白名单 | ✅ | OPENAGENTS_WEBHOOK_WHITELIST |
| 环境变量 | ✅ | 多个安全配置变量 |
| 文档 | ✅ | docs/SECURITY.md |
| 测试 | ✅ | error-recovery.test.ts |

### F4: 运行契约与事件口径收口

| 验收项 | 状态 | 说明 |
|--------|------|------|
| events stream 命令 | ✅ | `openagents events stream --run <id> --json` |
| JSONL 输出 | ✅ | 每行一个 JSON 对象 |
| sequence 支持 | ✅ | 单调递增序列号 |
| from-sequence | ✅ | 续传支持 |
| heartbeat | ✅ | 默认 15 秒心跳 |
| follow 模式 | ✅ | 默认开启 |
| 事件 schema | ✅ | 稳定公共字段 |
| 文档 | ✅ | docs/EVENT-CONTRACT.md |

### F5: 文档与发布收尾

| 验收项 | 状态 | 说明 |
|--------|------|------|
| README 更新 | ✅ | 新功能说明 |
| Skill 规范文档 | ✅ | docs/SKILL-SPEC.md |
| 安全文档 | ✅ | docs/SECURITY.md |
| 事件契约文档 | ✅ | docs/EVENT-CONTRACT.md |
| 发布检查清单 | ✅ | docs/RELEASE-CHECKLIST.md |
| 发布说明草案 | ✅ | docs/RELEASE-NOTES.md |

---

## 手动验收清单

### CLI 命令

- [ ] `openagents --help` 显示帮助
- [ ] `openagents doctor` 运行诊断
- [ ] `openagents skills list` 列出技能
- [ ] `openagents events stream --run <id> --json` 输出事件

### Web UI

- [ ] `npm run web` 启动后端
- [ ] `npm run web:dev` 启动前端
- [ ] 首页加载正常
- [ ] 工作流列表显示
- [ ] 运行创建正常

### 文档

- [ ] README.md 链接有效
- [ ] docs/SKILL-SPEC.md 完整
- [ ] docs/SECURITY.md 完整
- [ ] docs/EVENT-CONTRACT.md 完整

---

## 遗留问题

| 问题 | 优先级 | 状态 |
|------|--------|------|
| Event streaming 使用轮询而非文件监听 | P2 | 已知限制 |
| Windows 兼容性未完全测试 | P2 | 待验证 |

---

## 验收结论

**验收通过** ✅

所有自动化测试通过，功能验收完成，文档齐全。项目已准备好进入发布阶段。