# test/

pi-dgoal 的测试。两类：背景固化逻辑测试（bun test）和扩展加载 RPC 测试（python）。

## 运行

```bash
npm run test:context   # bun test test/context-input-cap.test.ts
npm run test:rpc       # python3 test/test-extension-rpc.py
```

## 文件

| 文件 | 验证什么 |
|---|---|
| `command-aliases.test.ts` | `/dgoal` 子命令解析：全拼 / 单字母 `s/p/r/c`，以及移除 `stop` 别名后的行为。 |
| `context-input-cap.test.ts` | 启动背景固化的文本截断 / 摘要逻辑：`capPriorDiscussionText`、`buildContextBlock`、`buildContextPreview`、`buildStartPrompt`、`buildContextSummarizerTask`、`isRetryableSubprocessError`。纯逻辑测试，不依赖 Pi。 |
| `subprocess-supervision.test.ts` | 用真实 `child_process`（子进程）树复现“父进程退出但孙进程继承 pipe 导致 `close` 挂住”的场景，验证 dgoal 的 detached process group（独立进程组）终止逻辑能整体收尸。 |
| `test-extension-rpc.py` | 用隔离配置目录 + `pi -e` 临时加载本包，通过 RPC 验证扩展真实加载、`/dgoal` 命令注册。覆盖命令注册断言。 |

## 边界

- 自动化测试覆盖背景固化逻辑、命令注册、子进程收尸监督，以及部分建检辅助逻辑（如审核进度摘要）。
- 完整自动续跑和审核行为（含真实 auditor 子进程内容、流式审核输出、真实测试命令执行）仍需在 Pi TUI 中用真实模型做人工 smoke test。
