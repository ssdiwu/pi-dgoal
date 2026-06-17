# AGENTS.md — pi-dloop

> pi-dloop 是一个 Pi 扩展，让 agent 围绕一个明确目标持续工作，直到显式完成并给出验证证据。

## 先读

1. `README.md`（功能、安装、使用、完成审核机制、设计边界——必读）
2. `index.ts`（扩展入口，单文件实现）

## 项目结构

```text
pi-dloop/
├── index.ts                          ← Pi 扩展入口（单文件，~1000 行）
├── test/
│   ├── test-extension-rpc.py         ← RPC 加载与命令注册测试
│   └── context-input-cap.test.ts     ← 启动背景固化测试
└── package.json
```

## 代码边界

- **会话内单目标**：只支持当前会话内单目标，不做多目标池。
- **不碰 Git**：不自动执行 Git 提交、回滚或删除。
- **不替代测试**：不替代项目自身测试命令；agent 仍需按项目现状选择并运行验证。
- **背景固化是补充**：启动背景固化是补充信息，不替代把关键约束写进 objective 或文档；摘要可能漏点。
- **审核员默认复用主模型**：不做独立模型配置。
- 不硬编码密钥、token、私有路径。

## 验证

改动后至少执行：

```bash
npm run test:rpc      # RPC 加载 + /dloop 命令注册
npm run test:context  # 启动背景固化逻辑（bun test）
```

完整自动续跑和审核行为仍需在 Pi TUI 中用真实模型做人工 smoke test。

## Git 规范

- 每次 commit 只做一件事。
- 提交标题默认中文，格式：`分类：动作 + 对象`。
- 禁止 `git push --force` 到 `main`。

## 文档现状说明

本项目是单文件扩展，`doc/README.md` 是文档入口。当前**唯一权威文档是根 `README.md`**，`doc/` 暂无独立子文档（adr / 术语表按需建立）。

详见 [`doc/README.md`](./doc/README.md) 的阅读地图和迁移条件。
