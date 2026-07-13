# runtime

工具实现、审计编排、prompt 构建与 TUI 渲染的承载层。管理 dgoal 工具（dgoal_propose/dgoal_plan/dgoal_check/dgoal_done）、命令处理、审计子进程编排、启动闸门逻辑与持久化。

`src/plan/`、`src/audit/`、`src/isolated-pi/`、`src/tui/` 已按真实职责迁出。可变会话状态归 `src/goal-runtime/state.ts` 单例；Pi 注册与事件订阅归 `src/startup/index.ts`。本模块被 startup 导入工具定义和事件处理函数（见 ADR 0024/0025）。