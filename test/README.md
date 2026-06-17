# test/

pi-dloop 的测试。两类：背景固化逻辑测试（bun test）和扩展加载 RPC 测试（python）。

## 运行

```bash
npm run test:context   # bun test test/context-input-cap.test.ts
npm run test:rpc       # python3 test/test-extension-rpc.py
```

## 文件

| 文件 | 验证什么 |
|---|---|
| `context-input-cap.test.ts` | 启动背景固化的文本截断 / 摘要逻辑：`capPriorDiscussionText`、`buildContextBlock`、`buildContextSummarizerTask`、`isRetryableSubprocessError`。纯逻辑测试，不依赖 Pi。 |
| `test-extension-rpc.py` | 用隔离配置目录 + `pi -e` 临时加载本包，通过 RPC 验证扩展真实加载、`/dloop` 命令注册。覆盖命令注册断言。 |

## 边界

- 自动化测试覆盖背景固化逻辑和命令注册。
- 完整自动续跑和审核行为（含 auditor 子进程）仍需在 Pi TUI 中用真实模型做人工 smoke test。
