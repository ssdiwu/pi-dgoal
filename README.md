# pi-dloop

`pi-dloop` 是一个轻量 Pi 扩展包，用来让 agent 围绕一个明确目标持续工作，直到显式完成并给出验证证据。

## 功能

- `/dloop <目标>`：启动持续目标模式。
- `loop_complete` 工具：agent 完成目标并验证后调用，触发独立审核，通过后停止自动续跑。
- 会话内状态：目标状态写入当前 Pi session，不维护全局目标池。
- 自动续跑：每轮结束后如果目标未完成，会自动发送继续提示。
- 安全暂停：模型错误时自动重试 3 次再暂停，避免瞬时错误打断 loop；用户中断则立即暂停。

## 安装到本机 Pi

把本目录加入 `~/.pi/agent/settings.json` 的 `packages`：

```json
"../../Documents/codes/Githubs/pi-dloop"
```

然后在 Pi 中执行：

```text
/reload
```

## 使用方式

```text
/dloop 修复当前项目里的 failing tests，并运行测试验证
```

常用控制命令：

```text
/dloop status
/dloop pause
/dloop resume
/dloop clear
```

## 测试

使用隔离配置目录和 `pi -e` 临时加载本包，通过 RPC 验证扩展真实加载与命令注册：

```bash
npm run test:rpc
```

等价命令：

```bash
python3 test/test-extension-rpc.py
```

当前自动化断言覆盖 `/dloop` 命令的注册；完整自动续跑和审核行为仍需要在 Pi TUI 中用真实模型做人工 smoke test。

## 文件结构

```text
pi-dloop/
├── README.md
├── package.json
├── index.ts
└── test/
    └── test-extension-rpc.py
```

## 完成审核（auditor）

`loop_complete` 被调用时，会先启动一个**独立完成审核员**：起一个独立的 pi 子进程（`--no-session --mode json`，纯只读工具 `read/grep/find/ls`），在零上下文里重检目标是否真的达成，再决定是否终结 loop。这让 `verification` 从 agent 自述升级为独立他证。

子进程隔离对齐官方 subagent 示例：审核员是一个全新进程，物理上拿不到主会话上下文，也注册不了写工具。审核员只看 agent 已产出的证据（文件、测试结果），不自己跑命令，避免变成自证。

- 审核通过：目标完成，loop 结束。
- 审核未通过：目标保持 active，审核报告注入对话，agent 继续修正后重新 `loop_complete`。
- 审核器出错 / 被中断 / 无结论：目标安全暂停，避免 fail-open 或烧 token 死循环，用 `/dloop resume` 继续。
- 逃生通道：`PI_DLOOP_NO_AUDIT=1` 跳过审核，直接放行（调试或模型不可用时使用）。

## 设计边界

- 不自动执行 Git 提交、回滚或删除。
- 不替代测试命令；agent 仍需根据项目现状选择并运行验证。
- 只支持当前会话内单目标，不做多目标池。
- 审核员默认复用当前主模型，不做独立模型配置。
