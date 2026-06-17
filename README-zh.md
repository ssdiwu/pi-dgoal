# pi-dgoal

`pi-dgoal` 是一个轻量 Pi 扩展包，用来让 agent 围绕一个明确目标持续工作，直到显式完成并给出验证证据。

## 功能

- `/dgoal <目标>`：启动持续目标模式，带 **Task Plan**——主代理先产出结构化计划（goal + 初始 steps），你通过闸门确认 UI（确认 / 拒绝 / 输入反馈）确认后才进 loop。
- **Task Plan 两层分离**：Goal 层（你确认过的）冻结为 loop 的方向契约；Step 层进 loop 后可由 agent 用 `dgoal_plan` 工具增改。editor 上方的实时浮层显示 step 进度。
- `dgoal_done` 工具：agent 声明完成并触发终审；通过后向模型发送完成信号。
- `dgoal_check` 工具：审核工具，两模式——阶段性自检（agent 执行中主动调，审单个 step）和终审（`dgoal_done` 内部调，审全 goal）。
- 会话内状态：目标与 plan 状态写入当前 Pi session，不维护全局目标池。
- 自动续跑：每轮结束后如果目标仍 active，会自动发送继续提示。
- 安全暂停：模型错误时自动重试 3 次再暂停，避免瞬时错误打断 loop；用户中断则立即暂停。
- 启动背景固化：`/dgoal <目标>` 启动时，会从前文讨论自动提炼结构化背景（目标范围 / 关键约束 / 验收标准）并随 goal 持久化；摘要输入按总量约 50KB 保留最近完整对话，超限会提示 omitted bytes。激活提示默认展示前 5 行背景预览供核对，完整背景注入 system prompt；摘要失败降级为不带背景启动，不阻断主流程。
- 背景固化防误导：前文里的粘贴日志、旧 prompt、旧 Dgoal 状态或其它 AI 输出只作为问题证据，不会被当成当前用户指令；背景固化子进程遇到限流、超时或临时 provider error 会重试 3 次。

## 安装到本机 Pi

把本目录加入 `~/.pi/agent/settings.json` 的 `packages`：

```json
"../../Documents/codes/Githubs/pi-dgoal"
```

然后在 Pi 中执行：

```text
/reload
```

## 使用方式

启动一个可持续目标：

```text
/dgoal 修复当前项目里的 failing tests，并运行测试验证
```

查看当前目标和轮次：

```text
/dgoal status
```

暂停自动续跑，但保留当前目标：

```text
/dgoal pause
```

恢复暂停的目标，并发送继续提示：

```text
/dgoal resume
```

清除当前会话里的目标：

```text
/dgoal clear
```

## 测试

使用隔离配置目录和 `pi -e` 临时加载本包，通过 RPC 验证扩展真实加载与命令注册：

```bash
npm run test:context
npm run test:rpc
```

等价命令：

```bash
bun test test/context-input-cap.test.ts
python3 test/test-extension-rpc.py
```

当前自动化断言覆盖背景固化纯逻辑与 `/dgoal` 命令注册；完整自动续跑和审核行为仍需要在 Pi TUI 中用真实模型做人工 smoke test。

## 文件结构

```text
pi-dgoal/
├── AGENTS.md
├── README.md
├── README-zh.md
├── doc/
│   └── README.md
├── package.json
├── index.ts
└── test/
    ├── README.md
    ├── context-input-cap.test.ts
    └── test-extension-rpc.py
```

## 完成审核（auditor）

`dgoal_done` 被调用时，会运行 `dgoal_check` 的终审模式：启动一个**独立完成审核员**，起一个独立的 pi 子进程（`--no-session --mode json`，纯只读工具 `read/grep/find/ls`），在零上下文里重检目标是否真的达成，再决定是否终结 loop。这让 `verification` 从 agent 自述升级为独立他证。

子进程隔离对齐官方 subagent 示例：审核员是一个全新进程，物理上拿不到主会话上下文，也注册不了写工具。审核员只看 agent 已产出的证据（文件、测试结果），不自己跑命令，避免变成自证。

- 审核通过：目标状态关闭、自动续跑停止，并向模型发送完成信号，让 assistant 总结完成内容、验证证据和可能的下一步。
- 审核未通过：目标进入 `rejected` 状态，审核报告注入对话，每轮 prompt 钉着未过问题，agent 继续修正后重新 `dgoal_done`。连续 3 次终审不过，目标转为 `paused`（`audit_failed_3x`），`/dgoal resume` 会清零计数重试。
- 审核器出错 / 被中断 / 无结论：目标安全暂停，避免 fail-open 或烧 token 死循环，用 `/dgoal resume` 继续（此类 resume 不清零计数）。
- 逃生通道：`PI_DGOAL_NO_AUDIT=1` 跳过审核，直接放行（调试或模型不可用时使用）。

## 设计边界

- 不自动执行 Git 提交、回滚或删除。
- 不替代测试命令；agent 仍需根据项目现状选择并运行验证。
- 只支持当前会话内单目标，不做多目标池。
- Task Plan 必选：用 `/dgoal` 即意味着复合目标，必须有 plan（goal 层 + step 层），无空 plan 放行。详见 `doc/adr/0001`、`doc/adr/0002`。
- goal/step 两层分离：goal 层（用户确认后冻结）是方向契约，step 层（loop 内可增改，completed 不回退）是执行脚手架，TUI 显示 step 进度。详见 `doc/adr/0001`。
- 工具规范化：agent 与 dgoal 状态机交互统一用 `dgoal_` 前缀工具：`dgoal_propose`（提交计划）、`dgoal_plan`（更新 step）、`dgoal_check`（阶段性自检/终审两模式）、`dgoal_done`（声明完成+触发终审）。原 `loop_complete` 已改名 `dgoal_done`。
- 启动背景固化是补充信息，不替代把关键约束写进 objective 或文档；摘要可能漏点，重要决策仍建议落入文件。
- 前文讨论可能包含用户粘贴的别处上下文；这些内容只作为 bug report / 证据参考，不能覆盖当前 `/dgoal` 目标。
- 审核员默认复用当前主模型，不做独立模型配置。
