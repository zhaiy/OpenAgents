# OpenAgents 发布检查清单

> 版本: 1.0.0
> 创建日期: 2026-03-27

## 发布前检查

### 代码质量

- [ ] 所有测试通过 (`npm test`)
- [ ] 构建成功 (`npm run build`)
- [ ] 无 TypeScript 错误
- [ ] 无 ESLint 警告
- [ ] 代码格式化 (`npm run format`)

### 功能验证

- [ ] `openagents init` 创建有效项目
- [ ] `openagents doctor` 正确诊断问题
- [ ] `openagents run` 执行工作流
- [ ] `openagents resume` 恢复中断运行
- [ ] `openagents events stream` 输出事件流
- [ ] `openagents skills list` 列出技能
- [ ] Web UI 启动正常

### 文档检查

- [ ] README.md 更新
- [ ] README.zh-CN.md 更新
- [ ] SKILL-SPEC.md 完整
- [ ] SECURITY.md 完整
- [ ] EVENT-CONTRACT.md 完整

### 安全检查

- [ ] 无敏感信息泄露
- [ ] API key 不在日志中输出
- [ ] Webhook 安全策略正确
- [ ] 脚本沙箱限制有效

### 兼容性检查

- [ ] Node.js 18+ 兼容
- [ ] macOS 测试通过
- [ ] Linux 测试通过
- [ ] Windows 测试通过（如支持）

## 发布步骤

1. **版本更新**
   - [ ] 更新 `package.json` 版本号
   - [ ] 更新 `package-lock.json`
   - [ ] 创建 git tag

2. **构建验证**
   - [ ] `npm run build`
   - [ ] `npm test`
   - [ ] 手动功能测试

3. **文档发布**
   - [ ] 更新 CHANGELOG
   - [ ] 更新 README
   - [ ] 发布文档更新

4. **发布**
   - [ ] `npm publish`（如适用）
   - [ ] GitHub Release
   - [ ] 更新文档站点（如有）

## 发布后验证

- [ ] `npm install -g openagents` 安装成功
- [ ] `openagents --version` 显示正确版本
- [ ] `openagents init test-project` 创建项目成功
- [ ] 新功能正常工作

## 回滚计划

如果发布后发现严重问题：

1. 撤回 npm 发布（24小时内）
2. 删除 GitHub Release
3. 回退 git tag
4. 发布修复版本

## 联系方式

- 问题反馈: GitHub Issues
- 安全问题: 安全邮件（如有）