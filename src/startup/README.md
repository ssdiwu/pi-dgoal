# `src/startup/` — Pi 注册与事件 wiring

`registerDgoal` 是扩展入口，注册九个公共工具、`/dgoal` 命令及 session / input / agent / tool 事件处理器。

## 职责

- 注册 `work_list` / `execution_plan` / `goal_plan` / `staged_plan` / `work_create` / `work_read` / `work_update` / `phase_check` / `goal_check`。
- `before_agent_start` 只向系统提示注入固定路由 guidance：明确交付用 `execution_plan`，仅记录或等待后续输入用 soft Work List；讨论、解释和单步回答不建清单。`context` 在每次模型请求的消息尾部投影当前 active Work List / Plan Contract 与审核反馈，不写会话历史；移除同类型旧快照，保留其他扩展消息，paused / clear / 无效 session 不投影旧执行指令。
- `before_provider_request` 以实际 Anthropic client-tool 载荷的自有名称、`strict: true` 与 object `input_schema` 判别并仅移除九个自有工具的 strict 标记，避开全局 union 编译限制；虚拟模型选中后路由至 Anthropic 也按真实载荷处理，不依赖仍指向虚拟选择的 `ctx.model`。不改工具 schema、其他扩展、缓存字段或 OpenAI/Codex 的 `parameters` / `function.parameters` 载荷。
- 识别真实用户明确要求使用 dgoal 的自然语言授权并注入 Goal Check / Staged Check guidance；能力问句、引用、否定、处理中追加与 extension 注入不授权，也不能静默降级为 Execution。
- Execution 达到 `model_error` 阈值后，可由 Goal ID + 原 prompt 精确绑定的下一条真实、非流式 interactive/RPC 输入一次性恢复；extension、流式 follow-up 与 prompt 改写不能走该路径。
- `session_start(startup|resume)` 冷恢复时，active Plan Contract 先原地持久化为 `paused(session_recovery)`；完整 pending proposal 只恢复状态，不自动确认、弹窗或重试。`fork` 新 session 用 `dgoal-session-scope-v1` 边界标记忽略宿主复制来的 Plan / History；`reload` / `session_tree` / `session_compact` 只重同步并递增 session generation。compaction 仅为 active Plan Contract 补 continuation，soft Work List 不补。
- proposal 自动确认只接受当前进程内新鲜启动因果；`/dgoal review` 手动消费恢复的 proposal。确认期间用 session generation + Goal/Contract/revision/proposal 隔离并发与旧分支选择。
- proposal 确认、resume 与反馈重提用一次性 marker 穿过 `input` → `before_agent_start` → user `message_end`：`input` 复核并为 START 落安全 checkpoint，`before_agent_start` 只预检最终 prompt；精确 user `message_end` 才在有效 abort signal 下提交 active 并清除 marker，随后 `context` 才投影已提交的 Plan。streaming 期间只排队，由 `agent_settled` 以独立 turn 投递；宿主未真正开跑时保持 pending / paused。反馈改写未形成合法新 proposal 时保留旧 proposal，并停止回 `/dgoal review`，不进入底层 Plan continuation。
- 每轮只在 Plan Contract active 时冻结结构化指纹、记录 activity / durable progress 并执行 3/8 双层熔断；soft Work List 不进入 no-progress 计数。
- tool / agent 事件结束后刷新 fail-soft TUI 投影；事件 wiring 不逐字段复制 Work List 或 Plan Contract 状态机。

不存在隐式 proposal、runtime budget、旧工具 alias 或旧持久态恢复。真实工具动作仍由 Pi 与对应扩展的权限边界决定。

Pi 可在起始 user 消息前先发送 system 提示/工具更新的 `message_end`。恢复门只由 user 消息提交或拒绝，忽略非 user 事件；user 空正文或被改写的 marker 仍然 fail-closed。

## 文件

- `index.ts` — `registerDgoal` 与全部事件处理器 wiring

## 依赖

- `src/runtime` — 九工具、命令、状态、History 与 prompt
- `src/goal-runtime` — 可变 session Goal / continuation / liveness 状态
- 仅由仓库根 `index.ts` 调用
