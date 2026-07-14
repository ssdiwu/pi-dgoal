# runtime

工具实现、审计编排、prompt 构建与 TUI 渲染的承载层。管理 dgoal 工具（dgoal_propose/dgoal_plan/dgoal_check/dgoal_done/dgoal_pause）、命令处理、审计子进程编排、启动闸门逻辑与持久化。

`src/plan/`、`src/audit/`、`src/isolated-pi/`、`src/tui/` 已按真实职责迁出。可变会话状态归 `src/goal-runtime/state.ts` 单例；Pi 注册与事件订阅归 `src/startup/index.ts`。本模块被 startup 导入工具定义和事件处理函数（见 ADR 0024/0025）。

## 语义预审可观测性

`dgoal_propose` 的启动前语义预审以流式接收当前会话模型响应，默认 60s idle timeout（无有效流事件才超时，收到任意事件重置；可通过 `pi-dgoal.json` 的 `proposalSemanticReviewIdleTimeoutSeconds` 配置）。预审过程通过工具 `onUpdate` 输出活性状态（认证中/接收评审结果/校验评审 JSON）与空闲倒计时。终态拆为 `approved` / `rewritten` / `rejected`（语义，`isError:false`）与 `technical_error`（基础设施失败，`isError:true`）。这与 `dgoal_check` / `dgoal_done` 的隔离建检共享“有事件续命、无进展才超时”的计时理念，但预审不启动子进程、不授予工具、不走审核候选链、不认 APPROVED/REJECTED 标记。

隔离建检区分模型和工具两种静默：模型思考/报告阶段保持 180s idle timeout；Pi 的 `tool_execution_*` 事件表明审核器正在跑内置工具时，窗口扩展到 1800s。`bash` 运行全量测试期间不会持续产生 child 事件，这个区分避免把正常的长验证误杀为 `auditor_error`。