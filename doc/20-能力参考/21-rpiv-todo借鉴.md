# 21 - rpiv-todo 借鉴

> `@juicesharp/rpiv-todo` 源码研读。支撑 dgoal 的 TUI 浮层、持久化、reducer 设计。来源：github.com/juicesharp/rpiv-mono。

## 借鉴的核心机制

### replay 幸存（dgoal 用 custom entry 等价实现，无需照搬）

rpiv-todo 状态不写磁盘，活在对话分支里。每次 `todo` 工具调用返回 `details` 是完整 snapshot，`replayFromBranch(ctx)` 遍历 `getBranch()` 找最后一个 `role==="toolResult" && toolName==="todo"` 的条目 last-write-wins。三个事件 replay：`session_start` / `session_compact` / `session_tree`。

**dgoal 已有等价机制**：用 `dgoal-state` custom entry（`appendEntry` + `loadGoal` 按 customType 过滤 last-write-wins），载体不同但本质同构。故 dgoal 的 Task Plan 直接挂进 `LoopGoal`，与 goal 同源持久化、同源恢复，不引入第二套 replay。

**关键差异**：rpiv-todo 工具名是 replay 键（改名破坏历史 replay）；dgoal 工具名不是恢复键（恢复靠 customType），故 `loop_complete`→`dgoal_done` 改名安全。

### stale ctx 边界处理

`session_compact` 时 ctx 可能是 dead proxy，抛 `/stale after session replacement/`。匹配 substring 静默忽略（替换 session 会自己 replay），其他错误才是真 bug 要传播。dgoal 实现 phase/task 时要复用这个边界处理。

### tool_execution_end 不 replay，只读 live state

overlay 在 `tool_execution_end` 触发 update，但不 replay（branch 已 stale，message_end 在其后），只读 `getState()`。dgoal TUI 浮层刷新同样遵循。

## 借鉴的状态模型

- **4 状态机**：pending → in_progress → completed + deleted tombstone。dgoal 借鉴 pending/in_progress/completed，但用 `blocked` 替代 `deleted`（dgoal 单 agent 不需要墓碑，用 blocked 表达诚实失败）。
- **blockedBy 依赖 + 环检测**：create 传初始集，update 用 add/remove 增量合并，detectCycle 在 add 前预检。dgoal 的 task 直接借鉴。
- **activeForm**：present-continuous 标签，in_progress 时浮层显示。dgoal 借鉴。
- **metadata 开放字段**：dgoal 用 evidence/blockedReason 等显式字段替代，更结构化。

## 借鉴的 TUI 浮层（aboveEditor overlay）

`todo-overlay.ts` 结构直接照搬：

- `setWidget(WIDGET_KEY, factory, { placement: "aboveEditor" })`，factory `(tui, theme) => ({ render, invalidate })`。
- 空了 `setWidget(key, undefined)` 自动隐藏。
- **12 行折叠，completed 先掉 / pending 最后留**：`selectOverlayLayout` 算可见+被藏数量，溢出时保证用户始终看到"还没做的"，末尾 `+N more` 摘要。
- **completed "显示到下一轮 agent_start 才消失"**：两个 Set（pendingHide/hidden），render 记新完成，agent_start 搬进 hidden。
- **hasActive 改 heading 样式**：有 in_progress 时 accent 色 + ●，否则 dim + ○。

dgoal 的扩展：phase 层显式显示（heading 下每行一个 phase），task 层默认隐藏 Ctrl+O 展开（双可见性轴）。

## 借鉴的工程纪律

- **分层**：reducer 纯函数 `(state, action, params) → (state, op)`，store 单点 mutation seam，replay 纯函数返回 snapshot 由 caller commit。
- **Op closed union**：`formatContent` switch 编译器强制 exhaustive——加新 action 不改 envelope 就编译失败。
- **工具名 + details schema 是 persistence 契约**：dgoal 对应——dgoal-state customType + LoopGoal schema 是契约，字段名 pin 死。
- **promptGuidelines 教模型用工具**：rpiv-todo 的 guidance（3+ 步才用、一次只一个 in_progress、完成立即标不 batch）。dgoal 的 dgoal_plan/dgoal_check guidance 借鉴此风格。
- **i18n 软依赖**：dynamic import + try/catch，SDK 缺失降级英文不挂。dgoal 暂不需要 i18n，但软依赖模式可参考。
