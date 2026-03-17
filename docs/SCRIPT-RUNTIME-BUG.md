# Script Runtime ESM Compatibility Bug Report

**发现日期**: 2026-03-17  
**状态**: Open  
**严重程度**: High  

---

## 问题现象

Script runtime 的 inline script 无法调用 `require()`，报错 `require is not defined`。

---

## 复现步骤

1. 创建一个使用 script runtime 的 agent：

```yaml
# agents/test.yaml
agent:
  id: test
  name: 测试
  description: 测试

prompt:
  system: Test

runtime:
  type: script
  timeout_seconds: 10

script:
  inline: 'const fs = require("fs"); return typeof fs.readFileSync === "function" ? "ok" : "fail"'
```

2. 创建对应的 workflow 并运行：

```bash
openagents run test --input "test" --auto-approve
```

3. 预期结果：输出 `"ok"`
4. 实际结果：`Script execution failed: require is not defined`

---

## 调试发现

### 1. Sandbox 中 `require` 存在

```javascript
// 在 vm.createContext 后测试
typeof require  // 返回 "function" ✅
require.toString()  // 返回 "function () { [native code] }" ✅
```

### 2. `safeRequire` 被正确调用

```javascript
// 调试日志显示
[DEBUG safeRequire] called with id: fs
[DEBUG safeRequire] loading module: fs
// 然后失败
```

### 3. 问题在 `safeRequire` 内部的 `require(id)` 调用

**关键代码** (`src/runtime/script.ts`):

```typescript
private safeRequire(id: string): unknown {
  const allowedModules = ['fs', 'path', 'url', 'util', 'crypto', 'os'];
  if (allowedModules.includes(id)) {
    return require(id);  // ❌ 这里失败：require is not defined
  }
  // ...
}
```

### 4. 独立测试正常

直接用 Node.js/tsx 测试 `ScriptRuntime` 类工作正常：

```bash
# 直接运行 ScriptRuntime 类
node -e "const { ScriptRuntime } = require('./dist/runtime/script.js'); ..."
# 结果：正常工作 ✅
```

```bash
# 通过 OpenAgents CLI 运行
openagents run test --input "test"
# 结果：失败 ❌
```

---

## 根本原因分析

问题出在 **ESM 编译后 `require` 不可用**。

OpenAgents 项目：
- 使用 TypeScript 编写
- 编译成 ES Module (`"type": "module"` in package.json)
- 使用 `tsc` 编译到 `dist/` 目录

在 ESM 模块中，顶层的 `require` 不存在。TypeScript 的 `require` 在编译后可能变成了 `undefined`。

**证据**：
- `safeRequire` 方法中的 `require(id)` 在运行时找不到 `require`
- 但在 vm sandbox 中，`require` 变量存在（因为是我们传入的 arrow function）

---

## 可能的修复方向

### 方案 1：使用 `createRequire` (推荐)

```typescript
import { createRequire } from 'module';

// 在 ScriptRuntime 类中
private get nodeRequire() {
  return createRequire(import.meta.url);
}

private safeRequire(id: string): unknown {
  const allowedModules = ['fs', 'path', 'url', 'util', 'crypto', 'os'];
  if (allowedModules.includes(id)) {
    return this.nodeRequire(id);  // 使用 createRequire 创建的 require
  }
  // ...
}
```

### 方案 2：预加载所有允许的模块

```typescript
// 在模块顶层预加载
import fs from 'fs';
import path from 'path';
// ...

const PRELOADED_MODULES = { fs, path, url, util, crypto, os };

private safeRequire(id: string): unknown {
  return PRELOADED_MODULES[id];
}
```

### 方案 3：使用动态 import

```typescript
private async safeRequire(id: string): Promise<unknown> {
  return await import(id);
}
```

**注意**：方案 3 需要修改整个 execute 方法为异步模式。

---

## 相关文件

- `src/runtime/script.ts` - ScriptRuntime 类实现
- `src/runtime/factory.ts` - 创建 runtime 实例
- `src/engine/workflow-engine.ts` - 调用 runtime

---

## 单元测试

可以添加这个单元测试来验证修复：

```typescript
// src/__tests__/script-runtime-esm.test.ts
import { ScriptRuntime } from '../runtime/script.js';

describe('ScriptRuntime ESM compatibility', () => {
  it('should be able to require fs module', async () => {
    const runtime = new ScriptRuntime({
      projectRoot: process.cwd(),
      scriptInline: 'const fs = require("fs"); return typeof fs.readFileSync === "function" ? "ok" : "fail"',
    });

    const result = await runtime.execute({
      systemPrompt: '',
      userPrompt: '',
      model: '',
      timeoutSeconds: 10,
    });

    expect(result.output).toBe('ok');
  });

  it('should be able to require path module', async () => {
    const runtime = new ScriptRuntime({
      projectRoot: process.cwd(),
      scriptInline: 'const path = require("path"); return typeof path.join === "function" ? "ok" : "fail"',
    });

    const result = await runtime.execute({
      systemPrompt: '',
      userPrompt: '',
      model: '',
      timeoutSeconds: 10,
    });

    expect(result.output).toBe('ok');
  });

  it('should be able to read files', async () => {
    const runtime = new ScriptRuntime({
      projectRoot: process.cwd(),
      scriptInline: `
        const fs = require('fs');
        const path = require('path');
        const pkgPath = path.join(process.cwd(), 'package.json');
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
        return pkg.name || 'fail';
      `,
    });

    const result = await runtime.execute({
      systemPrompt: '',
      userPrompt: '',
      model: '',
      timeoutSeconds: 10,
    });

    expect(result.output).toBe('openagents');
  });
});
```

---

## 临时解决方案

在官方修复之前，可以使用以下替代方案：

### 替代方案：使用外部预处理脚本

不使用 script runtime，而是用外部 Node.js 脚本预处理数据：

```bash
# 使用外部脚本预处理
node scripts/prepare-context.js --novel "新笔仙" --chapter 4 > context.json

# 然后在 workflow 中读取预处理结果
openagents run novel_writing --input-file context.json
```

---

*报告人: 贾维斯 (OpenClaw Agent)*  
*日期: 2026-03-17*